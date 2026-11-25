import {
  completeLogin,
  createSession,
  demoEnabled,
  getSession,
  lifecycleWebhook,
  logout,
  requireSession,
  startLogin,
} from "./auth";
import {
  activity,
  createWire,
  rateLimit,
  recipient,
  reconciliation,
  resolveWire,
  summary,
  wires,
} from "./banking";
import type { Env } from "./env";
import { handleExchange } from "./exchange";
import {
  amountField,
  ApiError,
  cookie,
  idempotencyKey,
  json,
  readBody,
  sha256,
  textField,
} from "./http";

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const exchange = await handleExchange(request, env);
  if (exchange) return exchange;
  if (!url.pathname.startsWith("/v1/")) return env.ASSETS.fetch(request);
  if (request.method === "POST" && url.pathname === "/v1/auth/webhook")
    return lifecycleWebhook(request, env);
  if (!["GET", "POST"].includes(request.method))
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      "This method is unavailable.",
    );
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== env.APP_ORIGIN
  ) {
    throw new ApiError(
      403,
      "ORIGIN_REJECTED",
      "Use the Joe Banking website for this action.",
    );
  }
  if (url.pathname === "/v1/health" && request.method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ service: "joe-banking", status: "ok", stage: "foundation" });
  }
  if (url.pathname === "/v1/auth/session" && request.method === "GET") {
    const session = await getSession(request, env);
    return json({
      customer: session?.customer ?? null,
      csrf_token: session?.csrfToken ?? null,
      local_demo: demoEnabled(request, env),
      joeauth_configured: Boolean(
        env.JOEAUTH_CLIENT_ID &&
        env.JOEAUTH_CLIENT_SECRET &&
        (env.SESSION_SECRET?.length ?? 0) >= 32,
      ),
    });
  }
  if (url.pathname === "/v1/auth/login" && request.method === "GET") {
    await rateLimit(
      env,
      request.headers.get("cf-connecting-ip") ?? "local",
      "login",
      10,
    );
    return startLogin(request, env);
  }
  if (url.pathname === "/v1/auth/callback" && request.method === "GET")
    return completeLogin(request, env);
  if (url.pathname === "/v1/dev/session" && request.method === "POST") {
    if (!demoEnabled(request, env))
      throw new ApiError(404, "NOT_FOUND", "This route is unavailable.");
    const body = await readBody(request);
    const id = body.customer_id;
    if (id !== "demo-alice" && id !== "demo-bob")
      throw new ApiError(
        400,
        "INVALID_DEMO_MEMBER",
        "Choose a local demonstration member.",
      );
    const member = await env.DB.prepare(
      "SELECT id FROM bank_customers WHERE id = ? AND joe_auth_user_id IS NULL AND role = 'member' AND status = 'active'",
    )
      .bind(id)
      .first();
    if (!member)
      throw new ApiError(
        409,
        "DEMO_NOT_SEEDED",
        "Load the local demonstration data first.",
      );
    const previous = cookie(request, "joebank_session");
    if (previous)
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await sha256(previous))
        .run();
    return json({ signed_in: true }, 200, {
      "set-cookie": await createSession(env, id, "demo", undefined, 3600),
    });
  }
  if (url.pathname === "/v1/auth/logout" && request.method === "POST")
    return logout(await requireSession(request, env), env);

  const session = await requireSession(request, env, request.method === "POST");
  if (
    url.pathname === "/v1/console/reconciliation" &&
    request.method === "GET"
  ) {
    if (session.customer.role !== "administrator")
      throw new ApiError(
        403,
        "FORBIDDEN",
        "A banking administrator role is required.",
      );
    return json(await reconciliation(env));
  }
  if (session.customer.role !== "member")
    throw new ApiError(
      403,
      "MEMBER_REQUIRED",
      "A banking member role is required for this action.",
    );
  if (request.method === "GET") {
    if (url.pathname === "/v1/me/summary")
      return json(await summary(env, session.customer));
    if (url.pathname === "/v1/me/activity")
      return json(await activity(env, session.customer.id));
    if (url.pathname === "/v1/wires")
      return json(await wires(env, session.customer.id));
    if (url.pathname === "/v1/me/inbox")
      return json(await wires(env, session.customer.id, true));
    if (url.pathname === "/v1/recipients") {
      await rateLimit(env, session.customer.id, "recipient", 10);
      return json(
        await recipient(
          env,
          textField(url.searchParams.get("query"), "recipient", 254),
          session.customer.id,
        ),
      );
    }
    if (url.pathname === "/v1/rates/current")
      return json({
        weekly_rate_ppm: null,
        status: "awaiting_initial_rate",
        minimum_ppm: 3000,
        maximum_ppm: 20000,
      });
    if (url.pathname === "/v1/rates/history") return json([]);
    if (url.pathname === "/v1/deposits/catalog")
      return json({
        available: false,
        products: [
          { term_weeks: 2, fixed_weekly_rate_ppm: 10000 },
          { term_weeks: 4, fixed_weekly_rate_ppm: 15000 },
          { term_weeks: 8, fixed_weekly_rate_ppm: 22500 },
        ],
      });
  }
  if (request.method === "POST") {
    await rateLimit(env, session.customer.id, "wire", 20);
    if (url.pathname === "/v1/wires") {
      const body = await readBody(request);
      const key = idempotencyKey(request);
      const receiverId = textField(body.receiver_id, "recipient", 100);
      const result = await createWire(
        env,
        session.customer.id,
        key,
        receiverId,
        amountField(body.amount_cents),
        textField(body.memo ?? "", "memo", 240, false),
      );
      return json(result.data, result.status);
    }
    const resolution =
      /^\/v1\/wires\/([a-f0-9-]{36})\/(accept|decline|cancel)$/.exec(
        url.pathname,
      );
    if (resolution) {
      const result = await resolveWire(
        env,
        session.customer.id,
        idempotencyKey(request),
        resolution[1],
        resolution[2] as "accept" | "decline" | "cancel",
      );
      return json(result.data, result.status);
    }
  }
  throw new ApiError(
    404,
    "NOT_FOUND",
    "This banking feature is not available yet.",
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      const expected = error instanceof ApiError;
      // Log a request identifier only; provider responses, tokens and user data
      // must never be written to application logs.
      if (!expected) console.error("Banking request failed", { requestId });
      response = new Response(
        JSON.stringify({
          error: {
            code: expected ? error.code : "INTERNAL_ERROR",
            message: expected
              ? error.message
              : "Joe Banking could not complete this action.",
            request_id: requestId,
          },
        }),
        {
          status: expected ? error.status : 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    if (new URL(request.url).pathname.startsWith("/v1/")) {
      headers.set("cache-control", "no-store");
      headers.set(
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
    }
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
