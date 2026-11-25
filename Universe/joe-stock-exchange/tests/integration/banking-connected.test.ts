import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { TestD1 } from "../../../joe-banking/tests/database";
import bankWorker from "../../../joe-banking/src/index";
import exchangeWorker from "../../workers/exchange-api/src/index";
import {
  execute,
  s,
  recover,
} from "../../workers/exchange-api/src/lib/financial-operations";
import { reconciliation } from "../../../joe-banking/src/banking";
import { runScheduledTick } from "../../workers/market-engine/src/scheduled-tick";
import type { Env } from "../../workers/exchange-api/src/env";
import type { Env as BankEnv } from "../../../joe-banking/src/env";
class ExchangeDB extends TestD1 {
  constructor() {
    super();
    this.db.close();
    this.db = new DatabaseSync(":memory:");
    const dir = new URL("../../database/migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      this.db.exec(readFileSync(new URL(file, dir), "utf8"));
    this.db.exec(
      readFileSync(
        new URL("../../database/seed/0001_reference_data.sql", import.meta.url),
        "utf8",
      ),
    );
    this.db.exec(
      readFileSync(
        new URL("../../database/seed/local-members.sql", import.meta.url),
        "utf8",
      ),
    );
  }
}
describe("JoeTrade connected economy", () => {
  let bankDB: TestD1, db: ExchangeDB, env: Env, be: BankEnv;
  let offline = false,
    lostResponse = false;
  type Actor = { cookie: string; csrf: string; surface: "member" | "console" };
  let alice: Actor, bob: Actor, operator: Actor;
  beforeEach(async () => {
    bankDB = new TestD1();
    db = new ExchangeDB();
    offline = false;
    lostResponse = false;
    be = {
      ...bankDB.env(),
      JOESE_LOCAL_SERVICE_SECRET:
        "a-local-test-service-secret-of-at-least-32-characters",
    };
    env = {
      DB: db as unknown as D1Database,
      ENVIRONMENT: "local",
      BANKING_MODE: "connected",
      LOCAL_DEMO: "true",
      BANKING_API_URL: "http://127.0.0.1:8788",
      LOCAL_SERVICE_SECRET: be.JOESE_LOCAL_SERVICE_SECRET,
      APP_ORIGIN: "http://127.0.0.1:4173",
      CONSOLE_ORIGIN: "http://127.0.0.1:4174",
      ALLOWED_ORIGINS: "http://127.0.0.1:4173,http://127.0.0.1:4174",
      SESSION_SECRET: "an-isolated-local-session-secret-for-tests",
      INTERNAL_API_KEY: "unused",
      ALLOWED_EMAIL_DOMAINS: "example.test",
      REQUIRE_INVITE: "true",
      ENFORCE_TRADING_SCHEDULE: "false",
      RESEND_FROM_EMAIL: "unused",
      JOEAUTH_ISSUER: "https://auth.example.test",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (offline) throw new Error("offline");
        const response = await bankWorker.fetch(new Request(input, init), be);
        if (lostResponse && String(input).endsWith("/operations")) {
          lostResponse = false;
          throw new Error("response lost after bank commit");
        }
        return response;
      }),
    );
    alice = await login("alice");
    bob = await login("bob");
    operator = await login("operator");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    db.db.close();
    bankDB.db.close();
  });
  async function login(which: string): Promise<Actor> {
    const surface = which === "operator" ? "console" : "member",
      origin = surface === "console" ? env.CONSOLE_ORIGIN! : env.APP_ORIGIN!;
    const response = await exchangeWorker.fetch(
      new Request(`${origin}/v1/sso/demo`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-joese-surface": surface,
        },
        body: JSON.stringify({ member: which }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const state = await exchangeWorker.fetch(
      new Request(`${origin}/v1/sso/session`, {
        headers: { cookie, "x-joese-surface": surface },
      }),
      env,
    );
    const data = (await state.json()) as { data: { csrf: string } };
    return { cookie, csrf: data.data.csrf, surface };
  }
  async function call(
    actor: Actor,
    path: string,
    body?: unknown,
    key = crypto.randomUUID(),
    method = body === undefined ? "GET" : "POST",
  ) {
    const origin =
      actor.surface === "console" ? env.CONSOLE_ORIGIN! : env.APP_ORIGIN!;
    const response = await exchangeWorker.fetch(
      new Request(`${origin}/v1${path}`, {
        method,
        headers: {
          cookie: actor.cookie,
          "x-joese-surface": actor.surface,
          origin,
          "content-type": "application/json",
          "x-csrf-token": actor.csrf,
          "idempotency-key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    const payload = (await response.json()) as {
      data: any;
      error?: { code: string; message: string };
    };
    return { status: response.status, ...payload };
  }
  function balance(id: string) {
    return bankDB.db
      .prepare(
        "SELECT available_cents FROM account_balances WHERE customer_id=? AND account_kind='transaction'",
      )
      .get(id)?.available_cents as number;
  }
  async function launch(ticker = "ABC") {
    const proposal = await call(operator, "/console/listing-proposals", {
      ticker,
      name: "Alice Builds",
      description: "A fictional project company in the Joe Universe.",
      projectUrl: "https://example.test/project",
      developerUserId: "demo-alice",
      contributionCents: 500000,
      shares: 1000,
    });
    expect(proposal.status).toBe(201);
    const launched = await call(
      alice,
      `/listing-proposals/${proposal.data.id}/launch`,
      {},
    );
    expect(launched.status, JSON.stringify(launched)).toBe(200);
    return { proposal: proposal.data, listing: launched.data };
  }
  it("uses the bank balance without duplicating an opening grant", async () => {
    const result = await call(alice, "/me/portfolio");
    expect(result.data.summary.disposableBalanceCents).toBe(1000000);
    expect(
      db.db
        .prepare(
          "SELECT disposable_balance_cents FROM users WHERE id='demo-alice'",
        )
        .get()?.disposable_balance_cents,
    ).toBe(0);
    expect(
      bankDB.db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions").get()
        ?.n,
    ).toBe(2);
  });
  it("requires founder approval and moves capital exactly once into frozen shares", async () => {
    const p = await call(operator, "/console/listing-proposals", {
      ticker: "ABC",
      name: "Alice Builds",
      description: "A fictional company project",
      projectUrl: "https://example.test/project",
      developerUserId: "demo-alice",
      contributionCents: 500000,
      shares: 1000,
    });
    expect(balance("demo-alice")).toBe(1000000);
    expect(
      (await call(bob, `/listing-proposals/${p.data.id}/launch`, {})).status,
    ).toBe(409);
    const key = crypto.randomUUID();
    expect(
      (await call(alice, `/listing-proposals/${p.data.id}/launch`, {}, key))
        .status,
    ).toBe(200);
    expect(
      (await call(alice, `/listing-proposals/${p.data.id}/launch`, {}, key))
        .status,
    ).toBe(200);
    expect(balance("demo-alice")).toBe(500000);
    const h = db.db
      .prepare(
        "SELECT quantity,frozen_quantity FROM holdings WHERE user_id='demo-alice' AND holding_kind='shareholding'",
      )
      .get();
    expect(h).toMatchObject({ quantity: 1000, frozen_quantity: 1000 });
    expect(
      (
        await call(alice, "/orders", {
          ticker: "ABC",
          side: "sell",
          quantity: 1,
        })
      ).status,
    ).toBe(409);
  });
  it("converts only the specified frozen shares into bank cash when another member accepts", async () => {
    await launch();
    const offer = await call(alice, "/share-offers", {
      buyer: "bob",
      ticker: "ABC",
      quantity: 100,
      askingPriceCents: 60000,
    });
    expect(offer.status).toBe(201);
    expect(balance("demo-alice")).toBe(500000);
    const key = crypto.randomUUID();
    const accepted = await call(
      bob,
      `/share-offers/${offer.data.id}/accept`,
      {},
      key,
    );
    expect(accepted.status, JSON.stringify(accepted)).toBe(200);
    await call(bob, `/share-offers/${offer.data.id}/accept`, {}, key);
    expect(balance("demo-alice")).toBe(559850);
    expect(balance("demo-bob")).toBe(939850);
    expect(
      db.db
        .prepare(
          "SELECT quantity,frozen_quantity FROM holdings WHERE user_id='demo-bob' AND holding_kind='shareholding'",
        )
        .get(),
    ).toMatchObject({ quantity: 100, frozen_quantity: 100 });
    expect(await reconciliation(be)).toMatchObject({
      projection_mismatches: 0,
      unbalanced_transactions: 0,
      negative_available_accounts: 0,
    });
  });
  it("declining an offer returns the frozen reservation without moving bank money", async () => {
    await launch();
    const offer = await call(alice, "/share-offers", {
      buyer: "bob",
      ticker: "ABC",
      quantity: 100,
      askingPriceCents: 60000,
    });
    await call(bob, `/share-offers/${offer.data.id}/decline`, {});
    expect(balance("demo-alice")).toBe(500000);
    expect(
      db.db
        .prepare(
          "SELECT frozen_quantity,reserved_quantity FROM holdings WHERE user_id='demo-alice' AND holding_kind='shareholding'",
        )
        .get(),
    ).toMatchObject({ frozen_quantity: 1000, reserved_quantity: 0 });
  });
  it("settles ordinary purchases and matched member sales through bank holds", async () => {
    const buy = await call(alice, "/orders", {
      ticker: "JAI",
      side: "buy",
      quantity: 5,
    });
    expect(buy.status, JSON.stringify(buy)).toBe(201);
    expect(buy.data.status).toBe("filled");
    const afterBuy = balance("demo-alice");
    expect(afterBuy).toBeLessThan(1000000);
    const sell = await call(alice, "/orders", {
      ticker: "JAI",
      side: "sell",
      quantity: 2,
    });
    expect(sell.data.status).toBe("open");
    expect(balance("demo-alice")).toBe(afterBuy);
    const bobBuy = await call(bob, "/orders", {
      ticker: "JAI",
      side: "buy",
      quantity: 2,
    });
    expect(bobBuy.status).toBe(201);
    expect(balance("demo-alice")).toBeGreaterThan(afterBuy);
    expect(await reconciliation(be)).toMatchObject({
      unbalanced_transactions: 0,
      projection_mismatches: 0,
      negative_available_accounts: 0,
    });
  });
  it("reserves unmatched buy cash and releases it once on cancellation", async () => {
    const order = await call(alice, "/orders", {
      ticker: "JAI",
      side: "buy",
      quantity: 2,
      limitPriceCents: 100,
    });
    expect(order.data.status).toBe("open");
    expect(balance("demo-alice")).toBe(999799);
    const key = crypto.randomUUID();
    await call(alice, `/orders/${order.data.id}/cancel`, {}, key);
    await call(alice, `/orders/${order.data.id}/cancel`, {}, key);
    expect(balance("demo-alice")).toBe(1000000);
  });
  it("uses the same receiver-approved bank wires from the exchange inbox", async () => {
    const wire = await call(alice, "/transfers", {
      receiver: "bob",
      amountCents: 20000,
      message: "Shared ledger",
    });
    expect(wire.status).toBe(201);
    expect(balance("demo-alice")).toBe(980000);
    const inbox = await call(bob, "/me/inbox");
    expect(inbox.data.transfers[0].id).toBe(wire.data.id);
    await call(bob, `/transfers/${wire.data.id}/accept`, {});
    expect(balance("demo-bob")).toBe(1020000);
  });
  it("recovers a lost bank response without charging twice or losing the shares", async () => {
    lostResponse = true;
    const key = "lost-bank-response";
    let plans = 0;
    const plan = async () => {
      plans++;
      return {
        bank: {
          action: "capital",
          customer_id: "demo-alice",
          amount_cents: 500000,
          credits: [{ customer_id: null, amount_cents: 500000 }],
        },
        statements: [
          s(
            "INSERT INTO audit_log(id,action,target_type,target_id) VALUES('recovery-test','recovered','test','test')",
          ),
        ],
        response: { ok: true },
      };
    };
    await expect(
      execute(env, "demo-alice", key, { same: true }, plan),
    ).rejects.toMatchObject({ code: "SETTLEMENT_PENDING" });
    expect(balance("demo-alice")).toBe(500000);
    await execute(env, "demo-alice", key, { same: true }, plan);
    expect(balance("demo-alice")).toBe(500000);
    expect(plans).toBe(1);
    expect(
      db.db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE id='recovery-test'")
        .get()?.n,
    ).toBe(1);
  });
  it("rejects operators trading, member console access, cross-account and unapproved launches", async () => {
    expect(
      (
        await call(operator, "/orders", {
          ticker: "JAI",
          side: "buy",
          quantity: 1,
        })
      ).status,
    ).toBe(403);
    expect((await call(alice, "/console/assets")).status).toBe(401);
    const p = await call(alice, "/listings", {
      ticker: "XYZ",
      name: "My project",
      description: "A useful fictional listing",
      projectUrl: "https://example.test",
      contributionCents: 500000,
      shares: 1000,
    });
    expect(
      (await call(alice, `/listing-proposals/${p.data.id}/launch`, {})).status,
    ).toBe(409);
  });
  it("enforces minimum capital, duplicate tickers, self-offers and precise whole stock quantities", async () => {
    expect(
      (
        await call(alice, "/listings", {
          ticker: "ABC",
          name: "Bad capital",
          description: "A fictional listing",
          projectUrl: "https://example.test",
          contributionCents: 499999,
          shares: 1000,
        })
      ).status,
    ).toBe(400);
    await launch();
    expect(
      (
        await call(alice, "/listings", {
          ticker: "ABC",
          name: "Duplicate company",
          description: "A fictional listing",
          projectUrl: "https://example.test",
          contributionCents: 500000,
          shares: 1000,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(alice, "/share-offers", {
          buyer: "alice",
          ticker: "ABC",
          quantity: 1,
          askingPriceCents: 500,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(alice, "/orders", {
          ticker: "JAI",
          side: "buy",
          quantity: 0.5,
        })
      ).status,
    ).toBe(400);
    expect((await call(alice, "/me/portfolio")).status).toBe(200);
  });
  it("fails closed during bank outages and does not fall back to a local wallet", async () => {
    offline = true;
    expect(
      (
        await call(alice, "/orders", {
          ticker: "JAI",
          side: "buy",
          quantity: 1,
        })
      ).status,
    ).toBe(503);
    expect(
      db.db
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id='demo-alice'")
        .get()?.n,
    ).toBe(0);
  });
  it("serializes competing spends and rejects idempotency terms changes", async () => {
    const key = "same-operation-key";
    const first = await call(
      alice,
      "/orders",
      { ticker: "JAI", side: "buy", quantity: 1, limitPriceCents: 1 },
      key,
    );
    expect(first.status).toBe(201);
    expect(
      (
        await call(
          alice,
          "/orders",
          { ticker: "JAI", side: "buy", quantity: 2, limitPriceCents: 1 },
          key,
        )
      ).status,
    ).toBe(409);
    expect(
      db.db
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id='demo-alice'")
        .get()?.n,
    ).toBe(1);
  });
  it("blocks demo access on non-local deployments and old independent password routes", async () => {
    expect(
      (
        await call(alice, "/auth/login", {
          email: "alice@example.test",
          password: "unused",
        })
      ).status,
    ).toBe(410);
    env.ENVIRONMENT = "production";
    expect((await call(alice, "/sso/demo", {})).status).toBe(404);
    expect((await call(alice, "/me/portfolio")).status).toBe(401);
  });
  it("prevents bank wires from spending cash already reserved by an exchange order", async () => {
    const order = await call(alice, "/orders", {
      ticker: "JAI",
      side: "buy",
      quantity: 2,
      limitPriceCents: 100,
    });
    expect(
      (
        await call(alice, "/transfers", {
          receiver: "bob",
          amountCents: 1000000,
        })
      ).status,
    ).toBe(409);
    expect(balance("demo-alice")).toBe(999799);
    await call(alice, `/orders/${order.data.id}/cancel`, {});
    expect(
      (
        await call(alice, "/transfers", {
          receiver: "bob",
          amountCents: 1000000,
        })
      ).status,
    ).toBe(201);
    expect(balance("demo-alice")).toBe(0);
  });
  it("recovers exchange finalization after a bank commit without repeating effects", async () => {
    const batch = db.batch.bind(db);
    let failOnce = true;
    vi.spyOn(db, "batch").mockImplementation(async (statements) => {
      if (
        failOnce &&
        statements.some((x) =>
          String((x as unknown as { sql: string }).sql).includes(
            "INSERT INTO financial_receipts",
          ),
        )
      ) {
        failOnce = false;
        throw new Error("temporary exchange storage failure");
      }
      return batch(statements);
    });
    const plan = async () => ({
      bank: {
        action: "capital",
        customer_id: "demo-alice",
        amount_cents: 500000,
        credits: [{ customer_id: null, amount_cents: 500000 }],
      },
      statements: [
        s(
          "INSERT INTO audit_log(id,action,target_type,target_id) VALUES('finalization-recovery','recovered','test','test')",
        ),
      ],
      response: { ok: true },
    });
    await expect(
      execute(env, "demo-alice", "failed-finalization", {}, plan),
    ).rejects.toMatchObject({ code: "SETTLEMENT_PENDING" });
    expect(balance("demo-alice")).toBe(500000);
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM financial_mutex").get()?.n,
    ).toBe(1);
    await recover(env);
    await execute(env, "demo-alice", "failed-finalization", {}, plan);
    expect(balance("demo-alice")).toBe(500000);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_log WHERE id='finalization-recovery'",
        )
        .get()?.n,
    ).toBe(1);
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM financial_mutex").get()?.n,
    ).toBe(0);
  });
  it("rejects browser and unauthenticated callers of bank settlement routes", async () => {
    const path = "http://127.0.0.1:8788/internal/joese/operations";
    const body = JSON.stringify({ id: "unauthorized-test", action: "noop" });
    const noSecret = await bankWorker.fetch(
      new Request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      be,
    );
    expect(noSecret.status).not.toBe(200);
    const browser = await bankWorker.fetch(
      new Request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: env.APP_ORIGIN!,
          "x-local-service-secret": be.JOESE_LOCAL_SERVICE_SECRET!,
        },
        body,
      }),
      be,
    );
    expect(browser.status).toBe(403);
    const production = await bankWorker.fetch(
      new Request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-service-secret": be.JOESE_LOCAL_SERVICE_SECRET!,
        },
        body,
      }),
      { ...be, ENVIRONMENT: "production" },
    );
    expect(production.status).not.toBe(200);
    expect(
      bankDB.db.prepare("SELECT COUNT(*) AS n FROM exchange_operations").get()
        ?.n,
    ).toBe(0);
  });
  it("serializes metadata edits and prevents bypassing the listing lifecycle", async () => {
    const edited = await call(
      operator,
      "/console/assets/JAI",
      {
        name: "Joe AI Lab",
        description: "Updated fictional company description.",
      },
      crypto.randomUUID(),
      "PATCH",
    );
    expect(edited.status).toBe(200);
    expect(edited.data.name).toBe("Joe AI Lab");
    expect(
      (
        await call(
          operator,
          "/console/assets/JAI",
          { active: false },
          crypto.randomUUID(),
          "PATCH",
        )
      ).status,
    ).toBe(409);
    expect((await call(operator, "/console/invitations", {})).status).toBe(410);
    expect((await call(operator, "/internal/bootstrap-admin", {})).status).toBe(
      410,
    );
    expect(balance("demo-alice")).toBe(1000000);
  });
  it("market ticks cannot change assets while a financial operation holds the mutex", async () => {
    db.db.exec(
      "INSERT INTO financial_mutex(id,operation_id) VALUES('market','held-test')",
    );
    await expect(
      runScheduledTick(
        { DB: env.DB, BANKING_MODE: "connected", INTERNAL_API_KEY: "unused" },
        new Date("2026-11-24T19:00:00Z"),
        true,
      ),
    ).rejects.toThrow();
    expect(
      db.db.prepare("SELECT operation_id FROM financial_mutex").get()
        ?.operation_id,
    ).toBe("held-test");
  });
});
