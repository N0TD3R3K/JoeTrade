import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWire, reconciliation, resolveWire } from "../src/banking";
import type { Env } from "../src/env";
import { parseCents } from "../web/api";
import { TestD1 } from "./database";

describe("banking ledger and receiver-approved wires", () => {
  let d1: TestD1;
  let env: Env;
  beforeEach(() => {
    d1 = new TestD1();
    env = d1.env();
  });
  afterEach(() => d1.db.close());
  function balance(id: string) {
    return d1.db
      .prepare(
        "SELECT posted_cents, held_cents, available_cents FROM account_balances WHERE customer_id = ? AND account_kind = 'transaction'",
      )
      .get(id);
  }
  async function send(key = "send-first", cents = 25000) {
    return createWire(
      env,
      "demo-alice",
      key,
      "demo-bob",
      cents,
      "For the Joe project",
    );
  }

  it("reserves a sender's funds without crediting the receiver until acceptance", async () => {
    const wire = await send();
    expect(balance("demo-alice")).toMatchObject({
      posted_cents: 1000000,
      held_cents: 25000,
      available_cents: 975000,
    });
    expect(balance("demo-bob")).toMatchObject({
      posted_cents: 1000000,
      held_cents: 0,
    });
    await resolveWire(
      env,
      "demo-bob",
      "receive-first",
      String(wire.data.id),
      "accept",
    );
    expect(balance("demo-alice")).toMatchObject({
      posted_cents: 975000,
      held_cents: 0,
      available_cents: 975000,
    });
    expect(balance("demo-bob")).toMatchObject({ posted_cents: 1025000 });
    expect(await reconciliation(env)).toEqual({
      unbalanced_transactions: 0,
      projection_mismatches: 0,
      negative_available_accounts: 0,
    });
  });

  it("replays the original response and rejects a changed request using the same key", async () => {
    const original = await send();
    expect(await send()).toEqual(original);
    await expect(send("send-first", 500)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    await resolveWire(
      env,
      "demo-bob",
      "receive-first",
      String(original.data.id),
      "accept",
    );
    const settled = balance("demo-bob");
    await resolveWire(
      env,
      "demo-bob",
      "receive-first",
      String(original.data.id),
      "accept",
    );
    expect(balance("demo-bob")).toEqual(settled);
    expect(await send()).toEqual(original);
  });

  it("concurrent duplicate submissions create only one wire and one hold", async () => {
    const responses = await Promise.all([send(), send()]);
    expect(responses[0]).toEqual(responses[1]);
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM member_wires").get(),
    ).toMatchObject({ count: 1 });
    expect(balance("demo-alice")).toMatchObject({ held_cents: 25000 });
  });

  it("checks funds atomically when competing holds would overspend", async () => {
    const results = await Promise.allSettled([
      send("large-wire-one", 800000),
      send("large-wire-two", 800000),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(balance("demo-alice")).toMatchObject({
      available_cents: 200000,
      held_cents: 800000,
    });
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM idempotency_records").get(),
    ).toMatchObject({ count: 1 });
  });

  it.each(["decline", "cancel"] as const)(
    "releases the hold on %s without creating a debit or credit",
    async (action) => {
      const wire = await send();
      await resolveWire(
        env,
        action === "decline" ? "demo-bob" : "demo-alice",
        `resolve-${action}`,
        String(wire.data.id),
        action,
      );
      expect(balance("demo-alice")).toMatchObject({
        available_cents: 1000000,
        held_cents: 0,
      });
      expect(balance("demo-bob")).toMatchObject({ posted_cents: 1000000 });
      expect(
        d1.db
          .prepare(
            "SELECT COUNT(*) AS count FROM ledger_transactions WHERE transaction_type = 'wire'",
          )
          .get(),
      ).toMatchObject({ count: 0 });
      expect(
        d1.db
          .prepare("SELECT COUNT(*) AS count FROM member_notifications")
          .get(),
      ).toMatchObject({ count: 3 });
    },
  );

  it("lets exactly one competing accept/cancel resolution win", async () => {
    const wire = await send();
    const results = await Promise.allSettled([
      resolveWire(
        env,
        "demo-bob",
        "accept-race",
        String(wire.data.id),
        "accept",
      ),
      resolveWire(
        env,
        "demo-alice",
        "cancel-race",
        String(wire.data.id),
        "cancel",
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await reconciliation(env)).toEqual({
      unbalanced_transactions: 0,
      projection_mismatches: 0,
      negative_available_accounts: 0,
    });
    expect(balance("demo-alice")).toMatchObject({ held_cents: 0 });
  });

  it("does not let a sender accept its own outgoing wire or another member cancel it", async () => {
    const wire = await send();
    await expect(
      resolveWire(
        env,
        "demo-alice",
        "forged-accept",
        String(wire.data.id),
        "accept",
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      resolveWire(
        env,
        "demo-bob",
        "forged-cancel",
        String(wire.data.id),
        "cancel",
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(balance("demo-bob")).toMatchObject({ posted_cents: 1000000 });
  });

  it("rolls back the hold and idempotency key when the receiver becomes unavailable", async () => {
    d1.db
      .prepare(
        "UPDATE bank_customers SET status = 'frozen' WHERE id = 'demo-bob'",
      )
      .run();
    await expect(send()).rejects.toMatchObject({ code: "WIRE_UNAVAILABLE" });
    expect(balance("demo-alice")).toMatchObject({ held_cents: 0 });
    expect(
      d1.db.prepare("SELECT COUNT(*) AS count FROM idempotency_records").get(),
    ).toMatchObject({ count: 0 });
  });

  it("blocks settlement after a freeze, while allowing the active receiver to decline", async () => {
    const wire = await send();
    d1.db
      .prepare(
        "UPDATE bank_customers SET status = 'frozen' WHERE id = 'demo-alice'",
      )
      .run();
    await expect(
      resolveWire(
        env,
        "demo-bob",
        "frozen-accept",
        String(wire.data.id),
        "accept",
      ),
    ).rejects.toMatchObject({ code: "WIRE_UNAVAILABLE" });
    expect(balance("demo-alice")).toMatchObject({ held_cents: 25000 });
    await resolveWire(
      env,
      "demo-bob",
      "frozen-decline",
      String(wire.data.id),
      "decline",
    );
    expect(balance("demo-alice")).toMatchObject({ held_cents: 0 });
  });

  it("keeps posted ledger and audit rows immutable at the database boundary", async () => {
    await send();
    expect(() =>
      d1.db.exec("UPDATE ledger_lines SET amount_cents = 1"),
    ).toThrow("LEDGER_IMMUTABLE");
    expect(() => d1.db.exec("DELETE FROM ledger_transactions")).toThrow(
      "LEDGER_IMMUTABLE",
    );
    expect(() => d1.db.exec("DELETE FROM audit_log")).toThrow(
      "AUDIT_IMMUTABLE",
    );
    expect(() =>
      d1.db.exec(
        "UPDATE ledger_transactions SET description = 'rewrite' WHERE state = 'posted'",
      ),
    ).toThrow("LEDGER_IMMUTABLE");
  });

  it("rejects an unbalanced posting and detects a corrupted balance projection", async () => {
    d1.db.exec(
      "INSERT INTO ledger_transactions (id, transaction_type, business_reference, description) VALUES ('broken', 'test', 'broken', 'broken')",
    );
    d1.db.exec(
      "INSERT INTO ledger_lines VALUES ('broken-line', 'broken', 'demo-alice-transaction', 100)",
    );
    expect(() =>
      d1.db.exec(
        "UPDATE ledger_transactions SET state = 'posted' WHERE id = 'broken'",
      ),
    ).toThrow("UNBALANCED_LEDGER");
    expect(balance("demo-alice")).toMatchObject({ posted_cents: 1000000 });
    d1.db.exec(
      "UPDATE bank_accounts SET posted_cents = 99 WHERE id = 'demo-alice-transaction'",
    );
    expect((await reconciliation(env)).projection_mismatches).toBe(1);
  });

  it("does not allow opening-balance fixtures to run twice", () => {
    expect(() =>
      d1.db.exec(
        "INSERT INTO ledger_transactions (id, transaction_type, business_reference, description) VALUES ('another', 'demo_opening', 'demo:alice', 'duplicate')",
      ),
    ).toThrow();
  });
});

describe("exact amount entry", () => {
  it("converts decimals into integer cents and rejects invalid precision or values", () => {
    expect(parseCents("100.01")).toBe(10001);
    expect(parseCents("0.29")).toBe(29);
    expect(parseCents("10.5")).toBe(1050);
    for (const value of [
      "0",
      "-1",
      "1.001",
      "NaN",
      "1e3",
      "10000000000.01",
      "",
    ])
      expect(parseCents(value)).toBeNull();
  });
});
