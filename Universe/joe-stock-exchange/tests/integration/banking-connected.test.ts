import { captureDueEconomySnapshot } from "../../workers/exchange-api/src/lib/economy-snapshot";
import {
  syncEconomy,
  receiveEconomyEvent,
} from "../../workers/exchange-api/src/lib/economy-delivery";
import { newsImpactForAsset } from "../../workers/market-engine/src/news-impact";
import { newYorkWall } from "../../../shared/economy/runtime";
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
        if (
          lostResponse &&
          (String(input).endsWith("/operations") ||
            String(input).endsWith("/economy/commands"))
        ) {
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
    const portfolio = await call(alice, "/me/portfolio");
    expect(portfolio.data.summary).toMatchObject({
      disposableBalanceCents: 999799,
      postedBalanceCents: 1000000,
      heldBalanceCents: 201,
    });
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
  async function policyV2() {
    const draft = await call(operator, "/console/economy/commands", {
      action: "policy.draft",
      input: {
        rules: {
          designVersion: "economy-v2",
          initialRatePpm: 10000,
          lendingBudgetCents: 100000,
          redistributionBudgetCents: 0,
          openingGrantsEnabled: false,
          loans: [
            {
              id: "loan",
              title: "Accepted test terms",
              minimumCents: 100,
              maximumCents: 100000,
              termWeeks: 4,
              weeklyRatePpm: 10000,
              variable: false,
              spreadPpm: 0,
            },
          ],
        },
      },
    });
    expect(draft.status, JSON.stringify(draft)).toBe(200);
    expect(
      (
        await call(operator, "/console/economy/commands", {
          action: "policy.approve",
          input: { id: draft.data.id },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(operator, "/console/economy/commands", {
          action: "reserve.initialize",
          input: {},
        })
      ).status,
    ).toBe(200);
    return draft.data;
  }
  it("publishes company-specific posts, rechecks settled ownership and preserves author removal after selling", async () => {
    const launched = await launch(),
      asset = launched.listing.id;
    const denied = await call(bob, "/posts", {
      companyId: asset,
      title: "No ownership",
      body: "Should not publish.",
    });
    expect(denied.status).toBe(403);
    const pending = await call(alice, "/share-offers", {
      buyer: "bob",
      ticker: "ABC",
      quantity: 1000,
      askingPriceCents: 600000,
    });
    expect(
      (
        await call(bob, "/posts", {
          companyId: asset,
          title: "Pending is not owned",
          body: "Still forbidden.",
        })
      ).status,
    ).toBe(403);
    const published = await call(alice, "/posts", {
      companyId: asset,
      title: "Company progress",
      body: "A real developer update.",
    });
    expect(published.status, JSON.stringify(published)).toBe(200);
    expect(
      (await call(bob, `/posts/${published.data.id}/delete`, { version: 1 }))
        .status,
    ).toBe(403);
    expect(
      (await call(bob, `/share-offers/${pending.data.id}/accept`, {})).status,
    ).toBe(200);
    expect(
      (
        await call(bob, "/posts", {
          companyId: asset,
          title: "Shareholder update",
          body: "Now a settled shareholder.",
        })
      ).status,
    ).toBe(200);
    db.db
      .prepare("UPDATE assets SET developer_user_id='demo-bob' WHERE id=?")
      .run(asset);
    expect(
      (
        await call(alice, "/posts", {
          companyId: asset,
          title: "Former owner",
          body: "Cannot post.",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(alice, `/posts/${published.data.id}/withdraw`, {
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(alice, `/posts/${published.data.id}/delete`, { version: 2 }))
        .status,
    ).toBe(200);
    expect(
      db.db
        .prepare("SELECT title,body,state FROM company_posts WHERE id=?")
        .get(published.data.id),
    ).toMatchObject({ title: null, body: null, state: "deleted" });
    expect(
      JSON.stringify(db.db.prepare("SELECT * FROM company_commands").all()),
    ).not.toContain("A real developer update.");
  });
  it("supports operator moderation and scopes company revenue/payment data to managers", async () => {
    await policyV2();
    const launched = await launch(),
      asset = launched.listing.id;
    expect(
      (await call(alice, "/companies/register", { companyId: asset })).status,
    ).toBe(200);
    const mine = await call(alice, "/companies");
    expect(mine.data[0].bank.lockedCapitalCents).toBe(500000);
    const service = await call(alice, "/economy/commands", {
      action: "service.request",
      input: {
        companyId: asset,
        appId: "merchant-app",
        name: "Member service",
      },
    });
    expect(service.status).toBe(200);
    expect(
      (
        await call(operator, "/console/economy/commands", {
          action: "service.approve",
          input: { id: service.data.id },
        })
      ).status,
    ).toBe(200);
    const plan = await call(alice, "/economy/commands", {
      action: "plan.create",
      input: {
        serviceId: service.data.id,
        title: "Service access",
        terms: "One fictional J$ purchase.",
        kind: "purchase",
        amountCents: 10000,
      },
    });
    expect(plan.status).toBe(200);
    const checkout = await call(
      bob,
      "/economy/commands",
      {
        action: "checkout.accept",
        input: {
          planId: plan.data.id,
          termsHash: plan.data.termsHash,
          consent: true,
        },
      },
      "single-checkout-reference",
    );
    expect(checkout.status).toBe(200);
    lostResponse = true;
    const retry = await call(
      bob,
      "/economy/commands",
      {
        action: "checkout.accept",
        input: {
          planId: plan.data.id,
          termsHash: plan.data.termsHash,
          consent: true,
        },
      },
      "single-checkout-reference",
    );
    expect(retry.status).toBe(503);
    expect(
      (
        await call(
          bob,
          "/economy/commands",
          {
            action: "checkout.accept",
            input: {
              planId: plan.data.id,
              termsHash: plan.data.termsHash,
              consent: true,
            },
          },
          "single-checkout-reference",
        )
      ).status,
    ).toBe(200);
    expect(balance("demo-bob")).toBe(990000);
    const offer = await call(alice, "/share-offers", {
      buyer: "bob",
      ticker: "ABC",
      quantity: 1,
      askingPriceCents: 100,
    });
    await call(bob, `/share-offers/${offer.data.id}/accept`, {});
    const holder = await call(bob, "/companies");
    expect(holder.data[0].bank.weeklyRevenueCents).toBe(10000);
    expect(holder.data[0].bank.payments).toBeUndefined();
    expect(holder.data[0].bank.services).toBeUndefined();
    const post = await call(bob, "/posts", {
      companyId: asset,
      title: "Shareholder progress",
      body: "Can be moderated by a console operator.",
    });
    expect(
      (
        await call(operator, `/console/posts/${post.data.id}/delete`, {
          version: 1,
          reason: "Test removal",
        })
      ).status,
    ).toBe(200);
  });
  it("records exact founding and frozen-share gain evidence once across settlement retries", async () => {
    await launch();
    const offer = await call(alice, "/share-offers", {
        buyer: "bob",
        ticker: "ABC",
        quantity: 100,
        askingPriceCents: 60000,
      }),
      key = crypto.randomUUID();
    await call(bob, `/share-offers/${offer.data.id}/accept`, {}, key);
    await call(bob, `/share-offers/${offer.data.id}/accept`, {}, key);
    const disposal = db.db
      .prepare(
        "SELECT allocated_basis_cents,net_proceeds_cents,realized_gain_cents FROM trade_basis_disposals",
      )
      .get();
    expect(disposal).toMatchObject({
      allocated_basis_cents: 50000,
      net_proceeds_cents: 59850,
      realized_gain_cents: 9850,
    });
    await syncEconomy(env);
    await syncEconomy(env);
    expect(
      bankDB.db
        .prepare(
          "SELECT amount_cents FROM economy_income_events WHERE category='realized_frozen_share_gain'",
        )
        .get()!.amount_cents,
    ).toBe(9850);
    expect(
      db.db
        .prepare(
          "SELECT total_basis_cents FROM trade_cost_lots WHERE user_id='demo-bob'",
        )
        .get()!.total_basis_cents,
    ).toBe(60150);
  });
  it("publishes one bounded monetary-policy bulletin after rate application, then consumes it for one eligible tick", async () => {
    const policy = await policyV2(),
      now = Math.floor(Date.now() / 1000),
      change = await call(operator, "/console/economy/commands", {
        action: "rate.schedule",
        input: {
          policyVersion: policy.version,
          effectiveLocal: newYorkWall(now),
          deltaPpm: -50,
          explanation: "Approved in-universe rate change.",
        },
      });
    expect(change.status, JSON.stringify(change)).toBe(200);
    await syncEconomy(env);
    await syncEconomy(env);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM news_events WHERE category='monetary_policy'",
        )
        .get()!.n,
    ).toBe(1);
    const event = bankDB.db
      .prepare("SELECT * FROM economy_outbox WHERE kind='rate.applied'")
      .get() as any;
    await expect(
      receiveEconomyEvent(env, { ...event, payload_hash: "changed" }),
    ).rejects.toMatchObject({ code: "RECEIPT_HASH_CONFLICT" });
    const link = db.db
      .prepare("SELECT news_event_id FROM rate_market_event_links")
      .get()!;
    const first = new Date(Date.now() + 86400000),
      impact = await newsImpactForAsset(env.DB, "JAI", first),
      cryptoImpact = await newsImpactForAsset(env.DB, "JBC", first);
    expect(impact.events.some((x) => x.id === link.news_event_id)).toBe(true);
    expect(cryptoImpact.events.some((x) => x.id === link.news_event_id)).toBe(
      false,
    );
    await runScheduledTick(
      { DB: env.DB, BANKING_MODE: "connected", INTERNAL_API_KEY: "unused" },
      first,
      true,
    );
    expect(
      (
        await newsImpactForAsset(
          env.DB,
          "JAI",
          new Date(first.getTime() + 3600000),
        )
      ).events.some((x) => x.id === link.news_event_id),
    ).toBe(false);
  });
  it("prevents members from invoking operator or trusted income commands and keeps the bank loan reserve-funded", async () => {
    await policyV2();
    expect(
      (
        await call(alice, "/economy/commands", {
          action: "reserve.initialize",
          input: {},
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(alice, "/economy/commands", {
          action: "income.record",
          input: {},
        })
      ).status,
    ).toBe(403);
    const offered = await call(operator, "/console/economy/commands", {
      action: "loan.offer",
      input: {
        customerId: "demo-alice",
        productId: "loan",
        principalCents: 10000,
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    });
    expect(offered.status).toBe(200);
    expect(balance("demo-alice")).toBe(1000000);
    expect(
      (
        await call(bob, "/economy/commands", {
          action: "loan.accept",
          input: { id: offered.data.id, termsHash: offered.data.termsHash },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(alice, "/economy/commands", {
          action: "loan.accept",
          input: { id: offered.data.id, termsHash: offered.data.termsHash },
        })
      ).status,
    ).toBe(200);
    expect(balance("demo-alice")).toBe(1010000);
    expect(
      (await call(alice, "/me/portfolio")).data.summary.borrowedCents,
    ).toBe(10000);
    expect(
      bankDB.db
        .prepare(
          "SELECT posted_cents FROM bank_accounts WHERE id='economy-reserve'",
        )
        .get()!.posted_cents,
    ).toBe(9990000);
  });
  function queuedIncome(count: number) {
    const at = Math.floor(Date.now() / 1000) - 60;
    for (let n = 0; n < count; n++)
      db.db
        .prepare(
          "INSERT INTO trade_income_outbox(id,customer_id,sale_reference,category,occurred_at,basis_complete,evidence_json) VALUES(?,'demo-alice',?,'realized_stock_gain',?,0,'{}')",
        )
        .run(`queued-${String(n).padStart(3, "0")}`, `historical-${n}`, at);
  }
  it("drains multiple same-time income batches without waiting for another clock bucket", async () => {
    queuedIncome(23);
    await syncEconomy(env);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM trade_income_outbox WHERE delivered_at IS NOT NULL",
        )
        .get()!.n,
    ).toBe(10);
    await syncEconomy(env);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM trade_income_outbox WHERE delivered_at IS NOT NULL",
        )
        .get()!.n,
    ).toBe(20);
    await syncEconomy(env);
    expect(
      bankDB.db.prepare("SELECT COUNT(*) AS n FROM economy_basis_holds").get()!
        .n,
    ).toBe(23);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM trade_income_outbox WHERE delivered_at IS NULL",
        )
        .get()!.n,
    ).toBe(0);
  });
  it("recovers income delivery after a bank commit loses its response, without duplicate evidence", async () => {
    queuedIncome(2);
    lostResponse = true;
    await expect(syncEconomy(env)).rejects.toMatchObject({
      code: "SETTLEMENT_PENDING",
    });
    expect(
      bankDB.db.prepare("SELECT COUNT(*) AS n FROM economy_basis_holds").get()!
        .n,
    ).toBe(2);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM trade_income_outbox WHERE delivered_at IS NOT NULL",
        )
        .get()!.n,
    ).toBe(0);
    await recover(env);
    await syncEconomy(env);
    expect(
      bankDB.db.prepare("SELECT COUNT(*) AS n FROM economy_basis_holds").get()!
        .n,
    ).toBe(2);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM trade_income_outbox WHERE delivered_at IS NULL",
        )
        .get()!.n,
    ).toBe(0);
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM financial_mutex").get()!.n,
    ).toBe(0);
  });
  it("rejects changes to settlement income evidence while permitting its delivery marker", () => {
    queuedIncome(1);
    expect(() =>
      db.db.exec(
        "UPDATE trade_income_outbox SET gain_cents=1 WHERE id='queued-000'",
      ),
    ).toThrow("INCOME_EVIDENCE_IMMUTABLE");
    db.db.exec(
      "UPDATE trade_income_outbox SET delivered_at=unixepoch() WHERE id='queued-000'",
    );
  });
  it("automatically captures reconciled noon figures without policy approval and retries once after response loss", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-26T18:00:00Z"));
      lostResponse = true;
      await expect(captureDueEconomySnapshot(env)).rejects.toMatchObject({
        code: "SETTLEMENT_PENDING",
      });
      await recover(env);
      await captureDueEconomySnapshot(env);
      const snapshot = bankDB.db
        .prepare("SELECT * FROM economy_snapshots")
        .get()!;
      expect(snapshot.state).toBe("reconciled");
      expect(snapshot.date_key).toBe("2026-11-26");
      const before = bankDB.db
        .prepare("SELECT COUNT(*) AS n FROM economy_snapshot_revisions")
        .get()!.n;
      await captureDueEconomySnapshot(env);
      expect(
        bankDB.db
          .prepare("SELECT COUNT(*) AS n FROM economy_snapshot_revisions")
          .get()!.n,
      ).toBe(before);
      expect(balance("demo-alice")).toBe(1000000);
    } finally {
      vi.useRealTimers();
    }
  });
});
