import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { createSession } from "../src/auth";
import { createWire } from "../src/banking";
import type { Env } from "../src/env";
import { TestD1 } from "./database";

describe("banking API boundaries", () => {
  let d1: TestD1;
  let env: Env;
  let cookie: string;
  let csrf: string;
  beforeEach(async () => {
    d1 = new TestD1();
    env = d1.env();
    cookie = (await createSession(env, "demo-alice", "demo")).split(";")[0];
    const session = await worker.fetch(
      new Request(`${env.APP_ORIGIN}/v1/auth/session`, { headers: { cookie } }),
      env,
    );
    csrf = ((await session.json()) as { data: { csrf_token: string } }).data
      .csrf_token;
  });
  afterEach(() => d1.db.close());
  async function call(
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    return worker.fetch(
      new Request(`${env.APP_ORIGIN}/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          cookie,
          origin: env.APP_ORIGIN,
          "content-type": "application/json",
          "x-csrf-token": csrf,
          "idempotency-key": "test-request-key",
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  }

  it("returns only the signed-in member's summary and ledger history", async () => {
    expect((await call("/me/summary")).status).toBe(200);
    const payload = (await (await call("/me/activity")).json()) as {
      data: Array<{ id: string }>;
    };
    expect(payload.data.map((row) => row.id)).toEqual(["demo-opening-alice"]);
    expect((await call("/me/summary", undefined, { cookie: "" })).status).toBe(
      401,
    );
  });

  it("requires both the exact browser origin and session CSRF token", async () => {
    const body = { receiver_id: "demo-bob", amount_cents: 100 };
    expect(
      (await call("/wires", body, { origin: "https://untrusted.test" })).status,
    ).toBe(403);
    expect(
      (await call("/wires", body, { "x-csrf-token": "wrong" })).status,
    ).toBe(403);
    expect((await call("/wires", body, { origin: "" })).status).toBe(403);
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM member_wires").get(),
    ).toMatchObject({ count: 0 });
  });

  it.each([-1, 0, 0.1, "100", 1000000000001])(
    "rejects invalid amount %s",
    async (amount) => {
      expect(
        (
          await call("/wires", {
            receiver_id: "demo-bob",
            amount_cents: amount,
          })
        ).status,
      ).toBe(400);
    },
  );

  it("requires idempotency and does not allow self transfers", async () => {
    expect(
      (
        await call(
          "/wires",
          { receiver_id: "demo-bob", amount_cents: 100 },
          { "idempotency-key": "" },
        )
      ).status,
    ).toBe(400);
    expect(
      (await call("/wires", { receiver_id: "demo-alice", amount_cents: 100 }))
        .status,
    ).toBe(400);
  });

  it("replays a completed creation even after its receiver becomes unavailable", async () => {
    const body = { receiver_id: "demo-bob", amount_cents: 100, memo: "Retry test" };
    const original = await call("/wires", body);
    expect(original.status).toBe(201);
    const saved = await original.json();
    d1.db.exec("UPDATE bank_customers SET status = 'suspended' WHERE id = 'demo-bob'");
    const retried = await call("/wires", body);
    expect(retried.status).toBe(201);
    expect(await retried.json()).toEqual(saved);
    expect(d1.db.prepare("SELECT COUNT(*) AS count FROM member_wires").get()).toMatchObject({ count: 1 });
  });

  it("does not expose a user directory and rate-limits exact recipient lookups", async () => {
    const found = (await (await call("/recipients?query=bob")).json()) as {
      data: { id: string; masked_email: string };
    };
    expect(found.data).toEqual({
      id: "demo-bob",
      display_name: "Bob Joe",
      masked_email: "b***@example.test",
    });
    expect((await call("/recipients?query=b")).status).toBe(404);
    expect((await call("/recipients?query=bob%27%20OR%201%3D1")).status).toBe(
      404,
    );
    for (let i = 0; i < 7; i++) await call("/recipients?query=unavailable");
    expect((await call("/recipients?query=bob")).status).toBe(429);
  });

  it("limits wires and notifications to participants", async () => {
    d1.db.exec(
      "INSERT INTO bank_customers (id, display_name, username, email) VALUES ('charlie', 'Charlie', 'charlie', 'charlie@example.test')",
    );
    const charlieCookie = (await createSession(env, "charlie", "demo")).split(
      ";",
    )[0];
    const wire = await createWire(
      env,
      "demo-alice",
      "private-wire",
      "demo-bob",
      500,
      "Private memo",
    );
    const result = (await (
      await call("/wires", undefined, { cookie: charlieCookie })
    ).json()) as { data: unknown[] };
    expect(result.data).toEqual([]);
    const state = (await (
      await call("/auth/session", undefined, { cookie: charlieCookie })
    ).json()) as { data: { csrf_token: string } };
    expect(
      (
        await call(
          `/wires/${wire.data.id}/accept`,
          {},
          { cookie: charlieCookie, "x-csrf-token": state.data.csrf_token },
        )
      ).status,
    ).toBe(404);
  });

  it("rejects operator member actions and member console access", async () => {
    expect((await call("/console/reconciliation")).status).toBe(403);
    d1.db.exec(
      "UPDATE bank_customers SET role = 'operator' WHERE id = 'demo-alice'",
    );
    expect(
      (await call("/wires", { receiver_id: "demo-bob", amount_cents: 100 }))
        .status,
    ).toBe(403);
  });

  it("immediately enforces freezes and expired sessions", async () => {
    d1.db.exec(
      "UPDATE bank_customers SET status = 'frozen' WHERE id = 'demo-alice'",
    );
    expect((await call("/me/summary")).status).toBe(200);
    expect(
      (await call("/wires", { receiver_id: "demo-bob", amount_cents: 100 }))
        .status,
    ).toBe(403);
    d1.db.exec("UPDATE sessions SET expires_at = unixepoch() - 1");
    expect((await call("/me/summary")).status).toBe(401);
  });

  it("rotates demo sessions and invalidates sessions on logout", async () => {
    const response = await call("/dev/session", { customer_id: "demo-bob" });
    expect(response.status).toBe(200);
    expect((await call("/me/summary")).status).toBe(401);
    cookie = response.headers.get("set-cookie")!.split(";")[0];
    const state = (await (await call("/auth/session")).json()) as {
      data: { csrf_token: string };
    };
    csrf = state.data.csrf_token;
    expect((await call("/auth/logout", {})).status).toBe(200);
    expect((await call("/me/summary")).status).toBe(401);
  });

  it("disables demo login and demo sessions on deployed hostnames and non-local environments", async () => {
    env.APP_ORIGIN = "https://bank.example.test";
    expect(
      (await call("/dev/session", { customer_id: "demo-alice" })).status,
    ).toBe(404);
    expect((await call("/me/summary")).status).toBe(401);
    env.APP_ORIGIN = "http://127.0.0.1:4180";
    env.ENVIRONMENT = "production";
    expect(
      (await call("/dev/session", { customer_id: "demo-alice" })).status,
    ).toBe(404);
    expect((await call("/me/summary")).status).toBe(401);
  });

  it("does not invent a live rate, deposit funding, or loan products", async () => {
    const rate = (await (await call("/rates/current")).json()) as {
      data: { weekly_rate_ppm: null };
    };
    expect(rate.data.weekly_rate_ppm).toBeNull();
    expect(
      (await call("/deposits/flexible/fund", { amount_cents: 100 })).status,
    ).toBe(404);
    expect(
      (await call("/loan-applications", { amount_cents: 100 })).status,
    ).toBe(404);
  });
});
