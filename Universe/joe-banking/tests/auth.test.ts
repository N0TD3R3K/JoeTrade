import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  completeLogin,
  createSession,
  getSession,
  lifecycleWebhook,
  requireSession,
  startLogin,
  validateClaims,
} from "../src/auth";
import type { Env } from "../src/env";
import { TestD1 } from "./database";

describe("JoeAuth integration", () => {
  let d1: TestD1;
  let env: Env;
  beforeEach(() => {
    d1 = new TestD1();
    env = d1.env();
    env.JOEAUTH_ISSUER = `https://issuer-${crypto.randomUUID()}.example.test`;
    env.JOEAUTH_CLIENT_ID = "banking-test-client";
    env.JOEAUTH_APP_ID = "internal-banking-app";
    env.JOEAUTH_CLIENT_SECRET = "synthetic-client-secret";
    env.SESSION_SECRET = "synthetic-session-secret-for-testing-only";
    env.JOEAUTH_WEBHOOK_SECRET = "synthetic-webhook-secret";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    d1.db.close();
  });

  async function identity() {
    const keys = await generateKeyPair("EdDSA");
    const publicJwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: "test-key",
      alg: "EdDSA",
      use: "sig",
    };
    const issue = (
      claims: Record<string, unknown>,
      audience: string | string[] = env.JOEAUTH_CLIENT_ID!,
      issuer = env.JOEAUTH_ISSUER,
    ) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
        .setSubject("auth-alice")
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("15m")
        .sign(keys.privateKey);
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/jwks.json"))
        return Response.json({ keys: [publicJwk] });
      throw new Error("Unexpected identity request");
    });
    vi.stubGlobal("fetch", fetcher);
    return { issue, publicJwk, fetcher };
  }

  it("validates EdDSA, exact issuer/audience, and known signing key", async () => {
    const { issue } = await identity();
    expect((await validateClaims(await issue({}), env)).sub).toBe("auth-alice");
    await expect(validateClaims(await issue({}, [env.JOEAUTH_CLIENT_ID!, "other-product"]), env)).rejects.toThrow();
    await expect(
      validateClaims(await issue({}, "other-product"), env),
    ).rejects.toThrow();
    await expect(
      validateClaims(
        await issue({}, env.JOEAUTH_CLIENT_ID, "https://wrong.example.test"),
        env,
      ),
    ).rejects.toThrow();
    const unrelated = await generateKeyPair("EdDSA");
    const unknown = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", kid: "unknown" })
      .setSubject("auth-alice")
      .setIssuer(env.JOEAUTH_ISSUER)
      .setAudience(env.JOEAUTH_CLIENT_ID!)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(unrelated.privateKey);
    await expect(validateClaims(unknown, env)).rejects.toThrow();
  });

  it("binds the one-use login transaction to the initiating browser", async () => {
    const response = await startLogin(
      new Request(`${env.APP_ORIGIN}/v1/auth/login`),
      env,
    );
    const target = new URL(response.headers.get("location")!);
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("scope")).toBe("openid profile email");
    const callback = `${env.APP_ORIGIN}/v1/auth/callback?code=code&state=${target.searchParams.get("state")}`;
    await expect(
      completeLogin(
        new Request(callback, {
          headers: { cookie: "joebank_login=other-browser" },
        }),
        env,
      ),
    ).rejects.toMatchObject({ code: "LOGIN_EXPIRED" });
    const loginCookie = response.headers.get("set-cookie")!.split(";")[0];
    const denied = callback.replace("code=code", "error=access_denied");
    await expect(
      completeLogin(
        new Request(denied, { headers: { cookie: loginCookie } }),
        env,
      ),
    ).rejects.toMatchObject({ code: "LOGIN_DECLINED" });
    await expect(
      completeLogin(
        new Request(callback, { headers: { cookie: loginCookie } }),
        env,
      ),
    ).rejects.toMatchObject({ code: "LOGIN_EXPIRED" });
  });

  it("completes a linked JoeAuth callback without creating a customer or opening balance", async () => {
    const { issue, publicJwk } = await identity();
    d1.db.exec(
      "UPDATE bank_customers SET joe_auth_user_id = 'auth-alice' WHERE id = 'demo-alice'",
    );
    const login = await startLogin(
      new Request(`${env.APP_ORIGIN}/v1/auth/login`),
      env,
    );
    const target = new URL(login.headers.get("location")!);
    const idToken = await issue({
      nonce: target.searchParams.get("nonce"),
      email_verified: true,
    });
    const accessToken = await issue({
      client_id: env.JOEAUTH_CLIENT_ID,
      token_type: "user",
      scope: "openid profile email",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/jwks.json"))
          return Response.json({ keys: [publicJwk] });
        if (String(url).endsWith("/token")) {
          expect(String(init?.body)).toContain("code_verifier=");
          expect(String(init?.body)).toContain("client_secret=");
          return Response.json({
            id_token: idToken,
            access_token: accessToken,
          });
        }
        return Response.json({
          sub: "auth-alice",
          name: "Alice Joe",
          email: "alice@example.test",
          email_verified: true,
        });
      }),
    );
    const callback = new Request(
      `${env.APP_ORIGIN}/v1/auth/callback?code=code&state=${target.searchParams.get("state")}`,
      {
        headers: { cookie: login.headers.get("set-cookie")!.split(";")[0] },
      },
    );
    const completed = await completeLogin(callback, env);
    expect(completed.status).toBe(302);
    const sessionCookie = completed.headers
      .getSetCookie()
      .find((value) => value.startsWith("joebank_session="))!
      .split(";")[0];
    const session = await getSession(
      new Request(env.APP_ORIGIN, { headers: { cookie: sessionCookie } }),
      env,
    );
    expect(session?.customer.id).toBe("demo-alice");
    expect(session?.kind).toBe("joeauth");
    const stored = d1.db
      .prepare("SELECT access_token_cipher, token_hash FROM sessions")
      .get() as { access_token_cipher: string; token_hash: string };
    expect(stored.access_token_cipher).not.toContain(accessToken);
    expect(stored.token_hash).not.toBe(sessionCookie.split("=")[1]);
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM bank_customers").get(),
    ).toMatchObject({ count: 2 });
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM ledger_transactions").get(),
    ).toMatchObject({ count: 2 });
  });

  it("rechecks live identity before a sensitive operation and rejects suspension", async () => {
    d1.db.exec(
      "UPDATE bank_customers SET joe_auth_user_id = 'auth-alice' WHERE id = 'demo-alice'",
    );
    const sessionCookie = (
      await createSession(
        env,
        "demo-alice",
        "joeauth",
        "synthetic-access-token",
      )
    ).split(";")[0];
    const incoming = new Request(env.APP_ORIGIN, {
      headers: { cookie: sessionCookie },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    await expect(requireSession(incoming, env, true)).rejects.toMatchObject({
      code: "IDENTITY_UNAVAILABLE",
    });
  });

  it("does not grant a session for missing identity configuration", async () => {
    env.JOEAUTH_CLIENT_SECRET = "";
    await expect(
      startLogin(new Request(env.APP_ORIGIN), env),
    ).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
  });

  async function signedEvent(
    body: string,
    timestamp = Math.floor(Date.now() / 1000),
  ) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.JOEAUTH_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${timestamp}.${body}`),
      ),
    );
    const signature = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return new Request(`${env.APP_ORIGIN}/v1/auth/webhook`, {
      method: "POST",
      body,
      headers: {
        "x-joeauth-event": "user.suspended",
        "x-joeauth-signature": `t=${timestamp},v1=${signature}`,
      },
    });
  }

  it("authenticates lifecycle events, revokes sessions, and deduplicates delivery", async () => {
    d1.db.exec(
      "UPDATE bank_customers SET joe_auth_user_id = 'auth-alice' WHERE id = 'demo-alice'",
    );
    await createSession(env, "demo-alice", "joeauth", "old-access-token");
    const body = JSON.stringify({
      id: crypto.randomUUID(),
      event: "user.suspended",
      timestamp: Math.floor(Date.now() / 1000),
      data: { user_id: "auth-alice", app_id: env.JOEAUTH_APP_ID },
    });
    const signed = await signedEvent(body);
    expect(
      (await lifecycleWebhook(signed.clone() as unknown as Request, env))
        .status,
    ).toBe(200);
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM sessions").get(),
    ).toMatchObject({ count: 0 });
    await createSession(env, "demo-alice", "joeauth", "new-access-token");
    await lifecycleWebhook(signed, env);
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM sessions").get(),
    ).toMatchObject({ count: 1 });
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM ledger_transactions").get(),
    ).toMatchObject({ count: 2 });
  });

  it("rejects stale, forged, and wrong-application events", async () => {
    const body = JSON.stringify({
      id: crypto.randomUUID(),
      event: "user.suspended",
      timestamp: Math.floor(Date.now() / 1000),
      data: { user_id: "auth-alice", app_id: env.JOEAUTH_APP_ID },
    });
    await expect(
      lifecycleWebhook(
        await signedEvent(body, Math.floor(Date.now() / 1000) - 600),
        env,
      ),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    const signed = await signedEvent(body);
    const forged = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: `${body} `,
    });
    await expect(lifecycleWebhook(forged, env)).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
    const wrongApp = JSON.parse(body);
    wrongApp.data.app_id = "another-app";
    await expect(
      lifecycleWebhook(await signedEvent(JSON.stringify(wrongApp)), env),
    ).rejects.toMatchObject({ code: "WRONG_APP" });
  });
});
