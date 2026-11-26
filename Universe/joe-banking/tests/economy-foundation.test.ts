import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TestD1 } from "./database";
import {
  cents,
  newYorkCalendar,
  previewRate,
  previewWeeklyTax,
  reserveCondition,
  STAGE_ONE_CAPABILITIES,
  utcInstant,
  valueChangePercent,
} from "../src/economy-foundation";

describe("Stage 1 economy units and calendar", () => {
  it("uses whole-income brackets, correct cents rounding and the owner example", () => {
    expect(previewWeeklyTax(160000)).toEqual({
      incomeCents: 160000,
      rateBps: 200,
      taxCents: 3200,
    });
    const values = [
      [50000, 0],
      [50001, 200],
      [200000, 200],
      [200001, 300],
      [350000, 300],
      [350001, 500],
      [500000, 500],
      [500001, 1000],
    ];
    for (const [amount, rate] of values)
      expect(previewWeeklyTax(amount).rateBps).toBe(rate);
    expect(previewWeeklyTax(50025).taxCents).toBe(1001);
    expect(() => previewWeeklyTax(-1)).toThrow();
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => cents(0.5)).toThrow();
  });
  it("permits signed rate steps without crossing bounds or accepting precision errors", () => {
    expect(previewRate(10000, -50)).toBe(9950);
    expect(previewRate(10000, 2000)).toBe(12000);
    for (const movement of [0, 49, 51, 2001, -2050, 0.5])
      expect(() => previewRate(10000, movement)).toThrow();
    expect(() => previewRate(3000, -50)).toThrow();
    expect(() => previewRate(20000, 50)).toThrow();
  });
  it("uses New York dates/week keys through UTC rollover and daylight-saving changes", () => {
    expect(newYorkCalendar("2026-11-02T04:59:00.000Z")).toMatchObject({
      dateKey: "2026-11-01",
      weekKey: "2026-10-26",
      hour: 23,
      minute: 59,
    });
    expect(newYorkCalendar("2026-11-02T05:00:00.000Z")).toMatchObject({
      dateKey: "2026-11-02",
      weekKey: "2026-11-02",
      hour: 0,
    });
    expect(newYorkCalendar("2026-03-08T16:00:00.000Z").hour).toBe(12);
    expect(newYorkCalendar("2026-11-01T17:00:00.000Z").hour).toBe(12);
    expect(() => utcInstant("2026-02-30T12:00:00.000Z")).toThrow();
    expect(() => utcInstant("2026-11-25T12:00:00-05:00")).toThrow();
  });
  it("marks only reserves below 90,000 dangerous and does not invent zero denominators", () => {
    expect(reserveCondition(9000000)).toBe("normal");
    expect(reserveCondition(8999999)).toBe("danger");
    expect(valueChangePercent(0, 0)).toBeNull();
    expect(valueChangePercent(1100000, 1000000)).toBeCloseTo(10);
    expect(
      Object.values(STAGE_ONE_CAPABILITIES).every((x) => x.available === false),
    ).toBe(true);
  });
});

describe("isolated bank schema draft", () => {
  function draft() {
    return new TestD1();
  }
  it("adds no grants, policies, balances or reserve initialization by itself", () => {
    const db = new TestD1(false);
    try {
      const before = db.db
        .prepare("SELECT * FROM account_balances ORDER BY id")
        .all();
      const entries = db.db
        .prepare("SELECT COUNT(*) AS n FROM ledger_transactions")
        .get();
      db.db.exec(
        readFileSync(
          new URL("../database/migrations/0003_economy.sql", import.meta.url),
          "utf8",
        ),
      );
      expect(
        db.db.prepare("SELECT * FROM account_balances ORDER BY id").all(),
      ).toEqual(before);
      expect(
        db.db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions").get(),
      ).toEqual(entries);
      expect(
        db.db
          .prepare("SELECT COUNT(*) AS n FROM bank_reserve_initializations")
          .get()?.n,
      ).toBe(0);
      expect(
        db.db.prepare("SELECT COUNT(*) AS n FROM economy_policy_versions").get()
          ?.n,
      ).toBe(0);
    } finally {
      db.db.close();
    }
  });
  it("protects company operating cash and locked capital while preserving the original journal", async () => {
    const db = draft();
    try {
      db.db.exec(
        "INSERT INTO economy_companies(id,exchange_asset_id,state) VALUES('company','asset','active'); INSERT INTO bank_accounts(id,account_kind) VALUES('company-cash','internal_clearing'),('company-capital','internal_clearing'),('test-source','internal_clearing'); INSERT INTO economy_accounts VALUES('company-cash','company','company_operating'),('company-capital','company','company_capital');",
      );
      async function post(
        id: string,
        from: string,
        to: string,
        amount: number,
      ) {
        return db.batch([
          db
            .prepare(
              "INSERT INTO ledger_transactions(id,transaction_type,business_reference,description) VALUES(?,'test',?,'test')",
            )
            .bind(id, id),
          db
            .prepare("INSERT INTO ledger_lines VALUES(?,?,?,?)")
            .bind(id + "-a", id, from, -amount),
          db
            .prepare("INSERT INTO ledger_lines VALUES(?,?,?,?)")
            .bind(id + "-b", id, to, amount),
          db
            .prepare("UPDATE ledger_transactions SET state='posted' WHERE id=?")
            .bind(id),
        ]);
      }
      await post("fund", "test-source", "company-cash", 100);
      await post("capital", "test-source", "company-capital", 100);
      await expect(
        post("overspend", "company-cash", "test-source", 101),
      ).rejects.toThrow("INSUFFICIENT_ECONOMY_FUNDS");
      await expect(
        post("redeem", "company-capital", "test-source", 1),
      ).rejects.toThrow("CAPITAL_LOCKED");
      expect(
        db.db
          .prepare(
            "SELECT posted_cents FROM bank_accounts WHERE id='company-cash'",
          )
          .get()?.posted_cents,
      ).toBe(100);
      expect(
        db.db
          .prepare(
            "SELECT COUNT(*) AS n FROM ledger_transactions WHERE id IN ('overspend','redeem')",
          )
          .get()?.n,
      ).toBe(0);
    } finally {
      db.db.close();
    }
  });
  it("bounds reserved weekly rate slots and rejects duplicate source delivery", () => {
    const db = draft();
    try {
      db.db.exec(
        "INSERT INTO economy_policy_versions(id,version,rules_json) VALUES('draft',1,'{}');",
      );
      for (let i = 1; i <= 3; i++)
        db.db
          .prepare(
            "INSERT INTO bank_rate_operations(id,policy_id,actor_id,expected_policy_version,delta_ppm,previous_rate_ppm,next_rate_ppm,requested_effective_at,state,reason_category,explanation,internal_note) VALUES(?,'draft','demo-alice',1,50,10000,10050,1,'pending','normal_fluctuation','example','example')",
          )
          .run("rate" + i);
      db.db.exec(
        "INSERT INTO bank_rate_week_slots VALUES('2026-11-23',1,'rate1'),('2026-11-23',2,'rate2');",
      );
      expect(() =>
        db.db.exec(
          "INSERT INTO bank_rate_week_slots VALUES('2026-11-23',3,'rate3')",
        ),
      ).toThrow();
      db.db.exec(
        "INSERT INTO economy_outbox(event_id,source_operation_id,kind,payload_json,payload_hash,created_at) VALUES('event','rate1','rate.applied','{}','hash',1);",
      );
      expect(() =>
        db.db.exec(
          "INSERT INTO economy_outbox(event_id,source_operation_id,kind,payload_json,payload_hash,created_at) VALUES('event2','rate1','rate.applied','{}','hash',1)",
        ),
      ).toThrow();
    } finally {
      db.db.close();
    }
  });
});
