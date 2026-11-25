import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  EncryptJWT,
  jwtDecrypt,
  jwtVerify,
  type JWTPayload,
} from "jose";
import type { Customer, Env, Session } from "./env";
import { ApiError, cookie, json, sha256, token } from "./http";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const now = () => Math.floor(Date.now() / 1000);

export function demoEnabled(request: Request, env: Env): boolean {
  return (
    env.ENVIRONMENT === "local" &&
    env.ALLOW_LOCAL_DEMO === "true" &&
    loopback.has(new URL(request.url).hostname) &&
    loopback.has(new URL(env.APP_ORIGIN).hostname)
  );
}

function sessionName(env: Env) {
  return env.APP_ORIGIN.startsWith("https:")
    ? "__Host-joebank_session"
    : "joebank_session";
}

function cookieValue(name: string, value: string, env: Env, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`;
}

function configured(env: Env) {
  if (
    !env.JOEAUTH_CLIENT_ID ||
    !env.JOEAUTH_CLIENT_SECRET ||
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32
  ) {
    throw new ApiError(
      503,
      "AUTH_NOT_CONFIGURED",
      "JoeAuth sign-in is not configured for this banking environment yet.",
    );
  }
  const issuer = new URL(env.JOEAUTH_ISSUER);
  const app = new URL(env.APP_ORIGIN);
  if (
    issuer.protocol !== "https:" ||
    issuer.origin !== env.JOEAUTH_ISSUER ||
    app.origin !== env.APP_ORIGIN ||
    (app.protocol !== "https:" &&
      !(env.ENVIRONMENT === "local" && loopback.has(app.hostname)))
  ) {
    throw new ApiError(
      503,
      "AUTH_NOT_CONFIGURED",
      "The banking identity configuration needs review.",
    );
  }
}

async function encryptionKey(env: Env): Promise<Uint8Array> {
  configured(env);
  return new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(env.SESSION_SECRET),
    ),
  );
}

export async function validateClaims(
  jwt: string,
  env: Env,
): Promise<JWTPayload> {
  configured(env);
  const header = decodeProtectedHeader(jwt);
  if (!header.kid || header.alg !== "EdDSA")
    throw new ApiError(
      401,
      "INVALID_IDENTITY",
      "JoeAuth identity could not be verified.",
    );
  let keys = jwks.get(env.JOEAUTH_ISSUER);
  if (!keys) {
    keys = createRemoteJWKSet(
      new URL(`${env.JOEAUTH_ISSUER}/.well-known/jwks.json`),
      { timeoutDuration: 5000 },
    );
    jwks.set(env.JOEAUTH_ISSUER, keys);
  }
  const { payload } = await jwtVerify(jwt, keys, {
    algorithms: ["EdDSA"],
    issuer: env.JOEAUTH_ISSUER,
    audience: env.JOEAUTH_CLIENT_ID,
    requiredClaims: ["sub", "iat", "exp"],
    clockTolerance: 5,
  });
  if (
    !payload.sub ||
    payload.aud !== env.JOEAUTH_CLIENT_ID ||
    typeof payload.iat !== "number" ||
    payload.iat > now() + 5
  ) {
    throw new ApiError(
      401,
      "INVALID_IDENTITY",
      "JoeAuth identity could not be verified.",
    );
  }
  return payload;
}

async function liveIdentity(
  accessToken: string,
  env: Env,
): Promise<{
  sub: string;
  name?: string;
  email: string;
  email_verified: boolean;
}> {
  const response = await fetch(`${env.JOEAUTH_ISSUER}/api/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!response.ok)
    throw new ApiError(
      response.status === 401 || response.status === 403 ? 401 : 503,
      "IDENTITY_UNAVAILABLE",
      "Please sign in again when JoeAuth is available.",
    );
  const profile = (await response.json()) as {
    sub: string;
    name?: string;
    email: string;
    email_verified: boolean;
  };
  if (
    !profile.sub ||
    profile.email_verified !== true ||
    typeof profile.email !== "string"
  ) {
    throw new ApiError(
      403,
      "VERIFIED_IDENTITY_REQUIRED",
      "A verified JoeAuth identity is required.",
    );
  }
  return profile;
}

export async function createSession(
  env: Env,
  customerId: string,
  kind: "demo" | "joeauth",
  accessToken?: string,
  ttl = 900,
) {
  const bearer = token();
  const csrf = token();
  const cipher = accessToken
    ? await new EncryptJWT({ access_token: accessToken })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt()
        .setExpirationTime(now() + ttl)
        .encrypt(await encryptionKey(env))
    : null;
  await env.DB.prepare(
    "INSERT INTO sessions (id, customer_id, token_hash, csrf_token, access_token_cipher, kind, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      customerId,
      await sha256(bearer),
      csrf,
      cipher,
      kind,
      now() + ttl,
    )
    .run();
  return cookieValue(sessionName(env), bearer, env, ttl);
}

export async function getSession(
  request: Request,
  env: Env,
): Promise<Session | null> {
  const bearer = cookie(request, sessionName(env));
  if (!bearer || bearer.length > 128) return null;
  const record = await env.DB.prepare(
    `SELECT s.id AS session_id, s.csrf_token, s.access_token_cipher, s.kind,
    c.* FROM sessions s JOIN bank_customers c ON c.id = s.customer_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(bearer), now())
    .first<
      Customer & {
        session_id: string;
        csrf_token: string;
        access_token_cipher: string | null;
        kind: "demo" | "joeauth";
      }
    >();
  if (
    !record ||
    record.status === "closed" ||
    record.status === "suspended" ||
    (record.kind === "demo" && !demoEnabled(request, env))
  )
    return null;
  let accessToken: string | null = null;
  if (record.access_token_cipher) {
    try {
      const { payload } = await jwtDecrypt(
        record.access_token_cipher,
        await encryptionKey(env),
      );
      accessToken =
        typeof payload.access_token === "string" ? payload.access_token : null;
    } catch {
      return null;
    }
  }
  return {
    id: record.session_id,
    kind: record.kind,
    csrfToken: record.csrf_token,
    accessToken,
    customer: {
      id: record.id,
      joe_auth_user_id: record.joe_auth_user_id,
      display_name: record.display_name,
      username: record.username,
      email: record.email,
      role: record.role,
      status: record.status,
    },
  };
}

export async function requireSession(
  request: Request,
  env: Env,
  sensitive = false,
): Promise<Session> {
  const session = await getSession(request, env);
  if (!session)
    throw new ApiError(401, "SIGN_IN_REQUIRED", "Sign in to Joe Banking.");
  if (request.method !== "GET") {
    if (request.headers.get("x-csrf-token") !== session.csrfToken)
      throw new ApiError(
        403,
        "CSRF_REJECTED",
        "Refresh the page before continuing.",
      );
  }
  if (sensitive) {
    if (session.customer.status !== "active")
      throw new ApiError(
        403,
        "ACCOUNT_FROZEN",
        "Outgoing activity is unavailable for this account.",
      );
    if (session.kind === "joeauth") {
      if (!session.accessToken)
        throw new ApiError(401, "SIGN_IN_REQUIRED", "Please sign in again.");
      const profile = await liveIdentity(session.accessToken, env);
      if (profile.sub !== session.customer.joe_auth_user_id)
        throw new ApiError(401, "IDENTITY_MISMATCH", "Please sign in again.");
    }
  }
  return session;
}

export async function startLogin(request: Request, env: Env) {
  configured(env);
  const state = token();
  const browser = token();
  const nonce = token();
  const verifier = token();
  const challenge = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const encoded = btoa(String.fromCharCode(...challenge))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  await env.DB.prepare(
    "INSERT INTO login_transactions (state_hash, browser_hash, nonce, verifier, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      await sha256(state),
      await sha256(browser),
      nonce,
      verifier,
      now() + 300,
    )
    .run();
  const target = new URL(`${env.JOEAUTH_ISSUER}/oauth/authorize`);
  target.search = new URLSearchParams({
    client_id: env.JOEAUTH_CLIENT_ID!,
    redirect_uri: `${env.APP_ORIGIN}/v1/auth/callback`,
    response_type: "code",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: encoded,
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      location: target.href,
      "set-cookie": cookieValue("joebank_login", browser, env, 300),
      "cache-control": "no-store",
    },
  });
}

export async function completeLogin(request: Request, env: Env) {
  configured(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const browser = cookie(request, "joebank_login");
  if (!state || state.length > 128 || !browser || browser.length > 128)
    throw new ApiError(400, "LOGIN_EXPIRED", "Start sign-in again.");
  // UPDATE RETURNING consumes the browser-bound transaction atomically, including
  // denied authorizations. A callback cannot be replayed or moved to a new browser.
  const transaction = await env.DB.prepare(
    `UPDATE login_transactions SET consumed_at = ? WHERE state_hash = ?
    AND browser_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING nonce, verifier`,
  )
    .bind(now(), await sha256(state), await sha256(browser), now())
    .first<{ nonce: string; verifier: string }>();
  if (!transaction)
    throw new ApiError(400, "LOGIN_EXPIRED", "Start sign-in again.");
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code || code.length > 512)
    throw new ApiError(
      401,
      "LOGIN_DECLINED",
      "JoeAuth sign-in was not completed.",
    );
  const response = await fetch(`${env.JOEAUTH_ISSUER}/api/oauth/token`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env.APP_ORIGIN}/v1/auth/callback`,
      client_id: env.JOEAUTH_CLIENT_ID!,
      client_secret: env.JOEAUTH_CLIENT_SECRET!,
      code_verifier: transaction.verifier,
    }),
  });
  if (!response.ok)
    throw new ApiError(
      401,
      "LOGIN_FAILED",
      "JoeAuth sign-in could not be completed. Start again.",
    );
  const tokens = (await response.json()) as {
    id_token?: string;
    access_token?: string;
  };
  if (!tokens.id_token || !tokens.access_token)
    throw new ApiError(
      401,
      "LOGIN_FAILED",
      "JoeAuth did not return the required identity tokens.",
    );
  let identity: JWTPayload;
  let access: JWTPayload;
  try {
    [identity, access] = await Promise.all([
      validateClaims(tokens.id_token, env),
      validateClaims(tokens.access_token, env),
    ]);
  } catch {
    throw new ApiError(
      401,
      "INVALID_IDENTITY",
      "JoeAuth identity could not be verified.",
    );
  }
  if (
    identity.nonce !== transaction.nonce ||
    identity.email_verified !== true ||
    access.sub !== identity.sub ||
    access.token_type !== "user" ||
    access.client_id !== env.JOEAUTH_CLIENT_ID ||
    !["openid", "profile", "email"].every((scope) =>
      String(access.scope).split(" ").includes(scope),
    )
  ) {
    throw new ApiError(
      401,
      "INVALID_IDENTITY",
      "JoeAuth identity could not be verified.",
    );
  }
  const profile = await liveIdentity(tokens.access_token, env);
  if (profile.sub !== identity.sub)
    throw new ApiError(
      401,
      "IDENTITY_MISMATCH",
      "JoeAuth identity could not be verified.",
    );
  const customer = await env.DB.prepare(
    "SELECT id FROM bank_customers WHERE joe_auth_user_id = ? AND status IN ('active', 'frozen')",
  )
    .bind(identity.sub)
    .first<{ id: string }>();
  if (!customer)
    throw new ApiError(
      403,
      "MEMBERSHIP_REQUIRED",
      "Your JoeAuth account is not linked to a banking membership yet. Contact the Joe team.",
    );
  const ttl = Math.min(900, Number(access.exp) - now());
  if (ttl <= 0)
    throw new ApiError(401, "LOGIN_EXPIRED", "Start sign-in again.");
  await env.DB.prepare(
    "UPDATE bank_customers SET display_name = ?, email = ? WHERE id = ?",
  )
    .bind(
      (profile.name ?? "Joe member").slice(0, 100),
      profile.email,
      customer.id,
    )
    .run();
  // Rotate any previous banking session without changing the JoeAuth session.
  const old = cookie(request, sessionName(env));
  if (old)
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(old))
      .run();
  const headers = new Headers({
    location: env.APP_ORIGIN,
    "cache-control": "no-store",
  });
  headers.append(
    "set-cookie",
    await createSession(env, customer.id, "joeauth", tokens.access_token, ttl),
  );
  headers.append("set-cookie", cookieValue("joebank_login", "", env, 0));
  return new Response(null, { status: 302, headers });
}

export async function logout(session: Session, env: Env) {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(session.id)
    .run();
  return json({ signed_out: true }, 200, {
    "set-cookie": cookieValue(sessionName(env), "", env, 0),
  });
}

export async function lifecycleWebhook(request: Request, env: Env) {
  if (!env.JOEAUTH_WEBHOOK_SECRET || !env.JOEAUTH_APP_ID)
    throw new ApiError(
      503,
      "WEBHOOK_NOT_CONFIGURED",
      "Webhook is not configured.",
    );
  const header = request.headers.get("x-joeauth-signature") ?? "";
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
  if (!match || Math.abs(now() - Number(match[1])) > 300)
    throw new ApiError(401, "INVALID_SIGNATURE", "Invalid webhook signature.");
  const body = await request.text();
  if (body.length > 8192)
    throw new ApiError(413, "BODY_TOO_LARGE", "Webhook is too large.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.JOEAUTH_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(match[2].match(/../g)!, (hex) =>
    parseInt(hex, 16),
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      new TextEncoder().encode(`${match[1]}.${body}`),
    ))
  ) {
    throw new ApiError(401, "INVALID_SIGNATURE", "Invalid webhook signature.");
  }
  let event: {
    id?: string;
    event?: string;
    timestamp?: number;
    data?: { user_id?: string; app_id?: string };
  };
  try {
    event = JSON.parse(body);
  } catch {
    throw new ApiError(400, "INVALID_EVENT", "Invalid webhook event.");
  }
  if (
    !event ||
    typeof event !== "object" ||
    typeof event.id !== "string" ||
    !event.id ||
    event.id.length > 128 ||
    event.timestamp !== Number(match[1]) ||
    event.event !== request.headers.get("x-joeauth-event")
  ) {
    throw new ApiError(400, "INVALID_EVENT", "Invalid webhook event.");
  }
  if (event.data?.app_id !== env.JOEAUTH_APP_ID)
    throw new ApiError(
      400,
      "WRONG_APP",
      "Webhook does not belong to this application.",
    );
  if (
    !["consent.revoked", "user.suspended", "user.deleted"].includes(
      event.event ?? "",
    )
  )
    return json({ received: true });
  if (typeof event.data.user_id !== "string" || !event.data.user_id)
    throw new ApiError(400, "INVALID_EVENT", "Invalid webhook event.");
  // Session revocation is a trigger on a new receipt. A duplicate delivery
  // cannot revoke sessions established after that event was first processed.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO webhook_receipts (digest, subject) VALUES (?, ?)",
  )
    .bind(await sha256(`${env.JOEAUTH_APP_ID}:${event.id}`), event.data.user_id)
    .run();
  return json({ received: true });
}
