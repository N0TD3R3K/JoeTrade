import {
  createRemoteJWKSet,
  jwtVerify,
  decodeProtectedHeader,
  EncryptJWT,
  jwtDecrypt,
} from "jose";
import type { Env } from "../env";
import type { SessionUser } from "./auth";
import { HttpError, json, readJson } from "./http";
import { digest } from "./financial-operations";
import { bankBalance } from "./banking-client";
type Surface = "member" | "console";
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const seconds = () => Math.floor(Date.now() / 1000);
function random() {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function cookies(r: Request, name: string) {
  return r.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export const surfaceFor = (r: Request): Surface =>
  new URL(r.url).pathname.startsWith("/v1/console/") ||
  r.headers.get("x-joese-surface") === "console"
    ? "console"
    : "member";
export function localDemo(r: Request, e: Env) {
  return (
    e.ENVIRONMENT === "local" &&
    e.LOCAL_DEMO === "true" &&
    ["127.0.0.1", "localhost"].includes(new URL(r.url).hostname)
  );
}
const origin = (e: Env, s: Surface) =>
  s === "console" ? e.CONSOLE_ORIGIN! : e.APP_ORIGIN!;
const client = (e: Env, s: Surface) =>
  s === "console"
    ? {
        id: e.JOEAUTH_CONSOLE_CLIENT_ID,
        secret: e.JOEAUTH_CONSOLE_CLIENT_SECRET,
      }
    : { id: e.JOEAUTH_CLIENT_ID, secret: e.JOEAUTH_CLIENT_SECRET };
function configured(e: Env, s: Surface) {
  const c = client(e, s);
  if (
    !c.id ||
    !c.secret ||
    !e.JOEAUTH_ISSUER?.startsWith("https://") ||
    !e.SESSION_SECRET ||
    e.SESSION_SECRET.length < 32
  )
    throw new HttpError(
      503,
      "SSO_NOT_CONFIGURED",
      "JoeAuth has not been configured for this application.",
    );
  return c as { id: string; secret: string };
}
const name = (s: Surface) => `joese_${s}_session`;
const cookie = (n: string, value: string, e: Env, ttl: number) =>
  `${n}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${e.ENVIRONMENT !== "local" ? "; Secure" : ""}`;
async function encryption(e: Env) {
  return new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(e.SESSION_SECRET),
    ),
  );
}
async function claims(jwt: string, e: Env, s: Surface) {
  const c = configured(e, s),
    header = decodeProtectedHeader(jwt);
  if (!header.kid || header.alg !== "EdDSA")
    throw new Error("Signing key required");
  let k = keysets.get(e.JOEAUTH_ISSUER!);
  if (!k) {
    k = createRemoteJWKSet(
      new URL(`${e.JOEAUTH_ISSUER}/.well-known/jwks.json`),
    );
    keysets.set(e.JOEAUTH_ISSUER!, k);
  }
  const { payload: p } = await jwtVerify(jwt, k, {
    issuer: e.JOEAUTH_ISSUER,
    audience: c.id,
    algorithms: ["EdDSA"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (p.aud !== c.id || !p.sub || Number(p.iat) > seconds() + 5)
    throw new Error("Invalid claims");
  return p;
}
async function live(access: string, e: Env) {
  let res: Response;
  try {
    res = await fetch(`${e.JOEAUTH_ISSUER}/api/oauth/userinfo`, {
      headers: { authorization: `Bearer ${access}` },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError(
      503,
      "IDENTITY_UNAVAILABLE",
      "JoeAuth is temporarily unavailable.",
    );
  }
  if (!res.ok)
    throw new HttpError(
      401,
      "AUTH_REQUIRED",
      "Please sign in through JoeAuth again.",
    );
  const p = (await res.json()) as { sub: string; email_verified: boolean };
  if (!p.sub || p.email_verified !== true)
    throw new HttpError(
      403,
      "IDENTITY_UNVERIFIED",
      "A verified JoeAuth identity is required.",
    );
  return p;
}
async function sessionCookie(
  e: Env,
  user: string,
  s: Surface,
  kind: "demo" | "joeauth",
  access?: string,
  ttl = 900,
) {
  const bearer = random(),
    csrf = random();
  const cipher = access
    ? await new EncryptJWT({ access })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setExpirationTime(seconds() + ttl)
        .encrypt(await encryption(e))
    : null;
  await e.DB.prepare(
    "INSERT INTO central_sessions(id,user_id,token_hash,csrf_token,access_cipher,kind,surface,expires_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      user,
      await digest(bearer),
      csrf,
      cipher,
      kind,
      s,
      seconds() + ttl,
    )
    .run();
  return cookie(name(s), bearer, e, ttl);
}
export async function centralSession(r: Request, e: Env) {
  const s = surfaceFor(r),
    bearer = cookies(r, name(s));
  if (!bearer || bearer.length > 128) return null;
  const row = await e.DB.prepare(
    `SELECT u.*,s.id AS session_id,s.csrf_token,s.access_cipher,s.kind FROM central_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.surface=? AND s.expires_at>? AND u.status='active'`,
  )
    .bind(await digest(bearer), s, seconds())
    .first<Record<string, unknown>>();
  if (!row || (row.kind === "demo" && !localDemo(r, e))) return null;
  if (
    (s === "member" && row.role !== "member") ||
    (s === "console" &&
      !["operator", "administrator"].includes(String(row.role)))
  )
    return null;
  if (!["GET", "HEAD", "OPTIONS"].includes(r.method)) {
    if (
      r.headers.get("x-csrf-token") !== row.csrf_token ||
      r.headers.get("origin") !== origin(e, s)
    )
      throw new HttpError(
        403,
        "CSRF_REJECTED",
        "Refresh the application before continuing.",
      );
    if (row.kind === "joeauth") {
      try {
        const { payload } = await jwtDecrypt(
          String(row.access_cipher),
          await encryption(e),
        );
        const p = await live(String(payload.access), e);
        if (p.sub !== row.joe_auth_user_id) throw new Error();
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          401,
          "AUTH_REQUIRED",
          "Sign in through JoeAuth again.",
        );
      }
    }
  }
  return row;
}
export async function centralUser(
  r: Request,
  e: Env,
): Promise<SessionUser | null> {
  const row = await centralSession(r, e);
  if (!row) return null;
  let available = 0;
  if (row.role === "member") {
    if (!row.bank_customer_id)
      throw new HttpError(
        403,
        "BANK_LINK_REQUIRED",
        "Your JoeAuth membership needs a verified banking link.",
      );
    const account = await bankBalance(e, String(row.bank_customer_id));
    if (row.kind === "joeauth" && account.subject !== row.joe_auth_user_id)
      throw new HttpError(
        403,
        "IDENTITY_LINK_MISMATCH",
        "The exchange and bank identity links need review.",
      );
    available = account.available_cents;
  }
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    role: row.role as SessionUser["role"],
    status: String(row.status),
    disposableBalanceCents: available,
    borrowedPrincipalCents: 0,
    financialStatus: row.financial_status as "normal" | "bankrupt",
    financialStatusVersion: Number(row.financial_status_version),
    preferences: JSON.parse(String(row.preferences_json)),
    bankCustomerId: row.bank_customer_id
      ? String(row.bank_customer_id)
      : undefined,
  };
}
export async function handleCentralAuth(
  r: Request,
  u: URL,
  e: Env,
): Promise<Response | null> {
  if (!u.pathname.startsWith("/v1/sso/")) return null;
  const s = surfaceFor(r);
  if (u.pathname === "/v1/sso/session" && r.method === "GET") {
    const row = await centralSession(r, e);
    return json({
      user: row ? { id: row.id, username: row.username, role: row.role } : null,
      csrf: row?.csrf_token ?? null,
      localDemo: localDemo(r, e),
      configured: Boolean(client(e, s).id && client(e, s).secret),
    });
  }
  if (u.pathname === "/v1/sso/demo" && r.method === "POST") {
    if (!localDemo(r, e)) throw new HttpError(404, "NOT_FOUND", "Not found.");
    if (r.headers.get("origin") !== origin(e, s))
      throw new HttpError(403, "ORIGIN_REJECTED", "Use the local application.");
    const b = await readJson<{ member?: string }>(r);
    const id =
      s === "console"
        ? "demo-market-operator"
        : b.member === "bob"
          ? "demo-bob"
          : "demo-alice";
    if (
      !(await e.DB.prepare(
        "SELECT id FROM users WHERE id=? AND status='active'",
      )
        .bind(id)
        .first())
    )
      throw new HttpError(
        409,
        "DEMO_NOT_SEEDED",
        "Local test members are not ready.",
      );
    const old = cookies(r, name(s));
    if (old)
      await e.DB.prepare("DELETE FROM central_sessions WHERE token_hash=?")
        .bind(await digest(old))
        .run();
    return json({ ready: true }, 200, {
      "set-cookie": await sessionCookie(e, id, s, "demo", undefined, 3600),
    });
  }
  if (u.pathname === "/v1/sso/logout" && r.method === "POST") {
    const session = await centralSession(r, e);
    if (session)
      await e.DB.prepare("DELETE FROM central_sessions WHERE id=?")
        .bind(session.session_id)
        .run();
    return json({ signedOut: true }, 200, {
      "set-cookie": cookie(name(s), "", e, 0),
    });
  }
  const login = /^\/v1\/sso\/(member|console)\/login$/.exec(u.pathname);
  if (login && r.method === "GET") {
    const surf = login[1] as Surface,
      c = configured(e, surf),
      state = random(),
      browser = random(),
      nonce = random(),
      verifier = random();
    await e.DB.prepare(
      "INSERT INTO central_logins(state_hash,browser_hash,verifier,nonce,surface,expires_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        await digest(state),
        await digest(browser),
        verifier,
        nonce,
        surf,
        seconds() + 300,
      )
      .run();
    const challenge = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      ),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const target = new URL(`${e.JOEAUTH_ISSUER}/oauth/authorize`);
    target.search = new URLSearchParams({
      client_id: c.id,
      redirect_uri: `${origin(e, surf)}/v1/sso/${surf}/callback`,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        location: target.href,
        "set-cookie": cookie(`joese_${surf}_login`, browser, e, 300),
      },
    });
  }
  const callback = /^\/v1\/sso\/(member|console)\/callback$/.exec(u.pathname);
  if (callback && r.method === "GET") {
    const surf = callback[1] as Surface,
      c = configured(e, surf),
      state = u.searchParams.get("state"),
      browser = cookies(r, `joese_${surf}_login`);
    if (!state || !browser)
      throw new HttpError(400, "LOGIN_EXPIRED", "Start JoeAuth sign-in again.");
    const tx = await e.DB.prepare(
      "UPDATE central_logins SET consumed_at=? WHERE state_hash=? AND browser_hash=? AND surface=? AND consumed_at IS NULL AND expires_at>? RETURNING verifier,nonce",
    )
      .bind(
        seconds(),
        await digest(state),
        await digest(browser),
        surf,
        seconds(),
      )
      .first<{ verifier: string; nonce: string }>();
    if (!tx || !u.searchParams.get("code") || u.searchParams.has("error"))
      throw new HttpError(400, "LOGIN_EXPIRED", "Start JoeAuth sign-in again.");
    const res = await fetch(`${e.JOEAUTH_ISSUER}/api/oauth/token`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: c.id,
        client_secret: c.secret,
        code: u.searchParams.get("code")!,
        code_verifier: tx.verifier,
        redirect_uri: `${origin(e, surf)}/v1/sso/${surf}/callback`,
      }),
    });
    if (!res.ok)
      throw new HttpError(
        401,
        "LOGIN_FAILED",
        "JoeAuth sign-in was not completed.",
      );
    const tokens = (await res.json()) as {
      access_token: string;
      id_token: string;
    };
    let id, access;
    try {
      [id, access] = await Promise.all([
        claims(tokens.id_token, e, surf),
        claims(tokens.access_token, e, surf),
      ]);
    } catch {
      throw new HttpError(
        401,
        "INVALID_IDENTITY",
        "JoeAuth identity could not be verified.",
      );
    }
    if (
      id.nonce !== tx.nonce ||
      id.email_verified !== true ||
      access.sub !== id.sub ||
      access.token_type !== "user" ||
      access.client_id !== c.id ||
      !["openid", "profile", "email"].every((v) =>
        String(access.scope).split(" ").includes(v),
      )
    )
      throw new HttpError(
        401,
        "INVALID_IDENTITY",
        "JoeAuth identity could not be verified.",
      );
    const profile = await live(tokens.access_token, e);
    if (profile.sub !== id.sub)
      throw new HttpError(401, "INVALID_IDENTITY", "Identity mismatch.");
    const member = await e.DB.prepare(
      "SELECT id,role,bank_customer_id FROM users WHERE joe_auth_user_id=? AND status='active'",
    )
      .bind(id.sub)
      .first<{ id: string; role: string; bank_customer_id: string }>();
    if (
      !member ||
      (surf === "member"
        ? member.role !== "member"
        : !["operator", "administrator"].includes(member.role))
    )
      throw new HttpError(
        403,
        "MEMBERSHIP_REQUIRED",
        "Your verified JoeAuth account needs the appropriate product membership.",
      );
    if (surf === "member") {
      if (
        !member.bank_customer_id ||
        (await bankBalance(e, member.bank_customer_id)).subject !== id.sub
      )
        throw new HttpError(
          403,
          "BANK_LINK_REQUIRED",
          "A verified bank identity link is required.",
        );
    }
    const headers = new Headers({ location: origin(e, surf) });
    headers.append(
      "set-cookie",
      await sessionCookie(
        e,
        member.id,
        surf,
        "joeauth",
        tokens.access_token,
        Math.min(900, Number(access.exp) - seconds()),
      ),
    );
    headers.append("set-cookie", cookie(`joese_${surf}_login`, "", e, 0));
    return new Response(null, { status: 302, headers });
  }
  const hook = /^\/v1\/sso\/(member|console)\/webhook$/.exec(u.pathname);
  if (hook && r.method === "POST") {
    const surf = hook[1] as Surface,
      secret =
        surf === "member"
          ? e.JOEAUTH_WEBHOOK_SECRET
          : e.JOEAUTH_CONSOLE_WEBHOOK_SECRET,
      app = surf === "member" ? e.JOEAUTH_APP_ID : e.JOEAUTH_CONSOLE_APP_ID;
    const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(
      r.headers.get("x-joeauth-signature") ?? "",
    );
    if (!secret || !app)
      throw new HttpError(503, "NOT_CONFIGURED", "Webhook not configured.");
    if (!match || Math.abs(seconds() - Number(match[1])) > 300)
      throw new HttpError(401, "INVALID_SIGNATURE", "Invalid signature.");
    const body = await r.text();
    if (body.length > 8192)
      throw new HttpError(413, "TOO_LARGE", "Event is too large.");
    const k = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        k,
        Uint8Array.from(match[2].match(/../g)!, (v) => parseInt(v, 16)),
        new TextEncoder().encode(`${match[1]}.${body}`),
      ))
    )
      throw new HttpError(401, "INVALID_SIGNATURE", "Invalid signature.");
    const event = JSON.parse(body) as {
      id: string;
      event: string;
      timestamp: number;
      data: { app_id: string; user_id: string };
    };
    if (
      !event.id ||
      event.data?.app_id !== app ||
      event.timestamp !== Number(match[1]) ||
      event.event !== r.headers.get("x-joeauth-event")
    )
      throw new HttpError(400, "INVALID_EVENT", "Invalid event.");
    if (
      ["user.suspended", "user.deleted", "consent.revoked"].includes(
        event.event,
      ) &&
      event.data.user_id
    )
      await e.DB.prepare(
        "INSERT OR IGNORE INTO central_webhooks(event_id,subject) VALUES(?,?)",
      )
        .bind(`${app}:${event.id}`, event.data.user_id)
        .run();
    return json({ received: true });
  }
  return null;
}
