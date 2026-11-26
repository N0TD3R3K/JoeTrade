import type { Env } from "./env";
import { applyCors, corsHeaders, HttpError, json, problem } from "./lib/http";
import { openApiDocument } from "./openapi";
import { connectedOpenApi } from "./connected-openapi";
import { handleAuth } from "./routes/auth";
import { handleBootstrap } from "./routes/bootstrap";
import { handleMarket } from "./routes/market";
import { handleJoeBank } from "./routes/joe-bank";
import { handleOperations } from "./routes/operations";
import { handlePortfolio } from "./routes/portfolio";
import { handleTrades } from "./routes/trades";
import { handleWebhooks } from "./routes/webhooks";
import { handleCentralAuth } from "./lib/central-auth";
import { handleConnected, matchConnected } from "./routes/connected";
import { recover, releaseJobs } from "./lib/financial-operations";

import { handleCompanyEconomy } from "./routes/company-economy";
import { syncEconomy } from "./lib/economy-delivery";

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, env),
    });
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const allowedOrigins = env.ALLOWED_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (origin && !allowedOrigins.includes(origin)) {
      throw new HttpError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "This write request did not come from an approved JOESE application.",
      );
    }
  }
  if (env.BANKING_MODE === "connected") {
    const auth = await handleCentralAuth(request, url, env);
    if (auth) return auth;
    const economy = await handleCompanyEconomy(request, url, env);
    if (economy) return economy;
    const financial = await handleConnected(request, url, env);
    if (financial) return financial;
  }
  if (request.method === "GET" && url.pathname === "/v1/health") {
    const database = await env.DB.prepare("SELECT 1 AS ok").first<{
      ok: number;
    }>();
    return json({
      service: "joese-exchange-api",
      status: database?.ok === 1 ? "ok" : "degraded",
      time: new Date().toISOString(),
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/openapi.json") {
    return json(
      env.BANKING_MODE === "connected" ? connectedOpenApi : openApiDocument,
    );
  }

  const handlers = [
    handleWebhooks,
    handleBootstrap,
    handleAuth,
    handleMarket,
    handlePortfolio,
    handleJoeBank,
    handleTrades,
    handleOperations,
  ];
  for (const handler of handlers) {
    const response = await handler(request, url, env);
    if (response) return response;
  }
  return problem(
    404,
    "NOT_FOUND",
    "The requested JOESE API route does not exist.",
  );
}

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (env.BANKING_MODE !== "connected") return;
    await recover(env);
    await releaseJobs(env);
    await syncEconomy(env);
    // Finish a bounded part of the oldest matching queue on each recovery tick.
    const queued = await env.DB.prepare(
      `SELECT b.asset_id FROM orders b JOIN orders s ON s.asset_id=b.asset_id JOIN assets a ON a.id=b.asset_id
      WHERE a.active=1 AND b.side='buy' AND s.side='sell' AND b.status IN ('open','partially_filled') AND s.status IN ('open','partially_filled')
      AND b.remaining_quantity>0 AND s.remaining_quantity>0 AND b.limit_price_cents>=s.limit_price_cents AND b.user_id!=s.user_id
      ORDER BY b.updated_at,b.id LIMIT 1`,
    ).first<{ asset_id: string }>();
    if (queued) {
      try {
        await matchConnected(env, queued.asset_id, 1);
      } catch (error) {
        if (!(
          error instanceof HttpError &&
          ["MARKET_CLOSED", "MARKET_BUSY"].includes(error.code)
        ))
          throw error;
      }
    }
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId =
      request.headers.get("x-request-id") ?? crypto.randomUUID();
    try {
      const response = await route(request, env);
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      return applyCors(
        new Response(response.body, { status: response.status, headers }),
        request,
        env,
      );
    } catch (error) {
      if (error instanceof HttpError) {
        return applyCors(
          problem(error.status, error.code, error.message, requestId),
          request,
          env,
        );
      }
      console.error("JOESE API request failed", {
        requestId,
        category: error instanceof Error ? error.name : "UnexpectedError",
      });
      return applyCors(
        problem(
          500,
          "INTERNAL_ERROR",
          "The JOESE API could not complete the request.",
          requestId,
        ),
        request,
        env,
      );
    }
  },
} satisfies ExportedHandler<Env>;
