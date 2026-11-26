import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { TestD1 } from "./database";
import {
  economyCommand,
  companyReport,
  runEconomyJobs,
} from "../src/economy/routes";
import { reconciliation } from "../src/banking";
import {
  allocate,
  wallToSeconds,
  newYorkWall,
  type BankingPolicy,
} from "../../shared/economy/runtime";
import type { Customer } from "../src/env";
import { bankComponent, recommendation } from "../src/economy/circulation";
const start = wallToSeconds("2026-11-16T12:00");
const rules: BankingPolicy = {
  designVersion: "economy-v2",
  initialRatePpm: 10000,
  lendingBudgetCents: 500000,
  redistributionBudgetCents: 10000,
  openingGrantsEnabled: true,
  loans: [
    {
      id: "fixed",
      title: "Reviewed test fixed loan",
      minimumCents: 100,
      maximumCents: 100000,
      termWeeks: 4,
      weeklyRatePpm: 10000,
      variable: false,
      spreadPpm: 0,
    },
    {
      id: "variable",
      title: "Reviewed test variable loan",
      minimumCents: 100,
      maximumCents: 100000,
      termWeeks: 4,
      weeklyRatePpm: 10000,
      variable: true,
      spreadPpm: 0,
    },
  ],
};
describe("Bank-owned economy services", () => {
  let db: TestD1,
    operator: Customer,
    alice: Customer,
    bob: Customer,
    now: number,
    counter: number;
  beforeEach(() => {
    db = new TestD1();
    db.db.exec(
      "INSERT INTO bank_customers(id,display_name,username,email,role) VALUES('operator','Operator','operator','operator@example.test','operator')",
    );
    operator = db.db
      .prepare("SELECT * FROM bank_customers WHERE id='operator'")
      .get() as unknown as Customer;
    alice = db.db
      .prepare("SELECT * FROM bank_customers WHERE id='demo-alice'")
      .get() as unknown as Customer;
    bob = db.db
      .prepare("SELECT * FROM bank_customers WHERE id='demo-bob'")
      .get() as unknown as Customer;
    now = start;
    counter = 0;
  });
  afterEach(() => db.db.close());
  const cmd = (
    actor: Customer,
    action: string,
    input: Record<string, unknown> = {},
    key?: string,
  ) =>
    economyCommand(
      db.env(),
      actor,
      key ?? `test_command_${++counter}`,
      action,
      input,
      now,
      true,
    ) as Promise<any>;
  const balance = (id: string) =>
    Number(
      db.db
        .prepare("SELECT posted_cents FROM bank_accounts WHERE id=?")
        .get(id)!.posted_cents,
    );
  async function policy() {
    const draft = await cmd(operator, "policy.draft", { rules });
    await cmd(operator, "policy.approve", { id: draft.id });
    return draft;
  }
  async function funded() {
    await policy();
    await cmd(operator, "reserve.initialize");
  }
  async function company(kind = "purchase", amount = 10000) {
    await cmd(alice, "company.register", {
      assetId: "TEST",
      ownerId: alice.id,
      name: "Test Company",
    });
    const service = await cmd(alice, "service.request", {
      companyId: "TEST",
      appId: "approved-app",
      name: "Test Service",
    });
    await cmd(operator, "service.approve", { id: service.id });
    const plan = await cmd(alice, "plan.create", {
      serviceId: service.id,
      title: "Test plan",
      terms: "Fictional J$ only. Full linked refunds from company cash.",
      kind,
      amountCents: amount,
      ...(kind === "subscription" ? { intervalDays: 1 } : {}),
    });
    return plan;
  }
  async function checkout(plan: any, actor = bob, key?: string) {
    return cmd(
      actor,
      "checkout.accept",
      { planId: plan.id, termsHash: plan.termsHash, consent: true },
      key,
    );
  }
  function event(
    category: string,
    amount: number,
    at = start,
    reference: string = crypto.randomUUID(),
  ) {
    db.db
      .prepare(
        "INSERT INTO economy_income_events(id,customer_id,source_system,source_reference,category,amount_cents,occurred_at,evidence_json) VALUES(?,'demo-alice','bank',?,?,?,?, '{}')",
      )
      .run(reference, reference, category, amount, at);
  }
  async function closedTax() {
    now = wallToSeconds("2026-11-23T12:00");
    await cmd(alice, "income.checkpoint", {
      completeThrough: now,
      reference: "closed-exchange-proof",
    });
    return cmd(operator, "tax.assess", {
      customerId: alice.id,
      week: "2026-11-16",
    });
  }
  it("requires approved policies and server roles, leaving funds unchanged", async () => {
    await expect(cmd(alice, "policy.draft", { rules })).rejects.toMatchObject({
      status: 403,
    });
    await expect(cmd(operator, "reserve.initialize")).rejects.toMatchObject({
      code: "POLICY_REQUIRED",
    });
    expect(balance("demo-alice-transaction")).toBe(1000000);
    expect(
      db.db
        .prepare("SELECT COUNT(*) AS n FROM bank_reserve_initializations")
        .get()!.n,
    ).toBe(0);
  });
  it("initializes the reserve exactly once with a balanced journal and immutable approval", async () => {
    await policy();
    const first = await cmd(
      operator,
      "reserve.initialize",
      {},
      "same_initialization",
    );
    expect(
      await cmd(operator, "reserve.initialize", {}, "same_initialization"),
    ).toEqual(first);
    await expect(cmd(operator, "reserve.initialize")).rejects.toThrow(
      "already",
    );
    expect(balance("economy-reserve")).toBe(10000000);
    expect(balance("economy-issuance")).toBe(-10000000);
    expect(() =>
      db.db.exec(
        "UPDATE economy_policy_versions SET rules_json='{}' WHERE state='approved'",
      ),
    ).toThrow("TERMS_IMMUTABLE");
    expect(await reconciliation(db.env())).toEqual({
      unbalanced_transactions: 0,
      projection_mismatches: 0,
      negative_available_accounts: 0,
    });
  });
  it("reconciles an existing grant without issuing another and rejects duplicate identities", async () => {
    await funded();
    db.db.exec(
      "UPDATE bank_customers SET joe_auth_user_id='joe-auth-alice' WHERE id='demo-alice'",
    );
    await cmd(operator, "member.eligibility", {
      customerId: alice.id,
      subject: "joe-auth-alice",
      evidence: "Reviewed local opening ledger",
    });
    await cmd(operator, "grant.reconcile", {
      customerId: alice.id,
      ledgerId: "demo-opening-alice",
    });
    await expect(
      cmd(operator, "grant.issue", { customerId: alice.id }),
    ).rejects.toThrow("already");
    expect(balance("demo-alice-transaction")).toBe(1000000);
    expect(balance("economy-reserve")).toBe(10000000);
  });
  it("posts only consented server-priced purchases, retries once and scopes manager reports", async () => {
    await funded();
    const plan = await company();
    await expect(
      cmd(bob, "checkout.accept", {
        planId: plan.id,
        termsHash: plan.termsHash,
        consent: false,
      }),
    ).rejects.toThrow("accept");
    const paid = await checkout(plan, bob, "purchase_retry_key");
    expect(await checkout(plan, bob, "purchase_retry_key")).toEqual(paid);
    expect(balance("demo-bob-transaction")).toBe(990000);
    expect(balance("company:TEST:operating")).toBe(10000);
    const member = await companyReport(db.env(), "TEST", bob.id),
      manager = await companyReport(db.env(), "TEST", alice.id);
    expect(member.services).toBeUndefined();
    expect(member.payments).toBeUndefined();
    expect(manager.totalRevenueCents).toBe(10000);
    expect(manager.payments).toHaveLength(1);
    await expect(
      cmd(bob, "plan.create", { serviceId: "wrong" }),
    ).rejects.toThrow();
  });
  it("keeps order/wire holds unspendable during checkout", async () => {
    await funded();
    const plan = await company("purchase", 10000);
    db.db.exec(
      "INSERT INTO exchange_holds(id,customer_id,account_id,amount_cents,remaining_cents,status) VALUES('hold','demo-bob','demo-bob-transaction',995000,995000,'active')",
    );
    await expect(checkout(plan)).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    expect(balance("company:TEST:operating")).toBe(0);
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM commerce_operations").get()!.n,
    ).toBe(0);
  });
  it("makes a missed subscription past due, requires member retry, and cancellation stops renewal", async () => {
    await funded();
    const plan = await company("subscription", 500000),
      initial = await checkout(plan);
    now += 86400;
    await cmd(bob, "subscription.renew", { id: initial.subscriptionId });
    now += 86400;
    await cmd(bob, "subscription.renew", { id: initial.subscriptionId });
    expect(
      db.db.prepare("SELECT state FROM company_subscriptions").get()!.state,
    ).toBe("past_due");
    expect(balance("company:TEST:operating")).toBe(1000000);
    await expect(
      cmd(alice, "subscription.retry", { id: initial.subscriptionId }),
    ).rejects.toMatchObject({ status: 403 });
    await cmd(bob, "subscription.cancel", { id: initial.subscriptionId });
    await expect(
      cmd(bob, "subscription.renew", { id: initial.subscriptionId }),
    ).rejects.toThrow("not active");
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM commerce_operations").get()!.n,
    ).toBe(2);
  });
  it("refunds a payment only once and reverses revenue without creating cash", async () => {
    await funded();
    const plan = await company(),
      paid = await checkout(plan);
    await cmd(alice, "payment.refund", { id: paid.id });
    await cmd(alice, "payment.refund", { id: paid.id });
    expect(balance("demo-bob-transaction")).toBe(1000000);
    expect(balance("company:TEST:operating")).toBe(0);
    const report = await companyReport(db.env(), "TEST", alice.id);
    expect(report.refundsCents).toBe(10000);
    expect(report.retainedRevenueCents).toBe(0);
  });
  it("pays accepted employee allocations in exact cents from closed-week revenue and holds an underfunded refund", async () => {
    await funded();
    const plan = await company("purchase", 10001),
      paid = await checkout(plan);
    await cmd(alice, "company.pool", { companyId: "TEST", poolBps: 5000 });
    const a = await cmd(alice, "employee.invite", {
        companyId: "TEST",
        employeeId: "alice",
        allocationBps: 5000,
      }),
      b = await cmd(alice, "employee.invite", {
        companyId: "TEST",
        employeeId: "bob",
        allocationBps: 5000,
      });
    await cmd(alice, "employee.accept", { id: a.id, termsHash: a.termsHash });
    await cmd(bob, "employee.accept", { id: b.id, termsHash: b.termsHash });
    now = wallToSeconds("2026-11-23T00:05");
    const payroll = await cmd(alice, "payroll.run", {
      companyId: "TEST",
      week: "2026-11-16",
    });
    expect(payroll.amountCents).toBe(5001);
    expect(balance("company:TEST:operating")).toBe(5000);
    expect(
      db.db
        .prepare(
          "SELECT SUM(amount_cents) AS n FROM economy_income_events WHERE category='employee_wage'",
        )
        .get()!.n,
    ).toBe(5001);
    const refund = await cmd(alice, "payment.refund", { id: paid.id });
    expect(refund.state).toBe("pending");
    expect(balance("company:TEST:operating")).toBe(5000);
    await expect(
      cmd(alice, "payroll.run", { companyId: "TEST", week: "2026-11-16" }),
    ).rejects.toThrow("already");
  });
  it("assesses the owner’s J$32 example and collects only available cash, preserving unpaid tax", async () => {
    await funded();
    event("employee_wage", 100000);
    event("realized_stock_gain", 60000);
    const assessed = await closedTax();
    expect(assessed.assessedCents).toBe(3200);
    db.db.exec(
      "INSERT INTO exchange_holds(id,customer_id,account_id,amount_cents,remaining_cents,status) VALUES('tax-hold','demo-alice','demo-alice-transaction',999000,999000,'active')",
    );
    const collected = await cmd(operator, "tax.collect", { id: assessed.id });
    expect(collected.collectedCents).toBe(1000);
    expect(collected.unpaidCents).toBe(2200);
    expect(balance("demo-alice-transaction")).toBe(999000);
  });
  it("trading losses offset trading gains, never wages, and missing evidence prevents collection", async () => {
    await funded();
    event("employee_wage", 100000);
    event("realized_stock_gain", -200000);
    const assessed = await closedTax();
    expect(assessed.assessedCents).toBe(2000);
    await cmd(alice, "income.record", {
      customerId: alice.id,
      reference: "unresolved-sale",
      category: "realized_stock_gain",
      occurredAt: start,
      basisComplete: false,
    });
    const revision = await cmd(operator, "tax.assess", {
      customerId: alice.id,
      week: "2026-11-16",
      supersedesId: assessed.id,
      evidence: "New unresolved historical sale",
    });
    expect(revision.state).toBe("held_for_evidence");
    await expect(
      cmd(operator, "tax.collect", { id: revision.id }),
    ).rejects.toThrow("complete");
  });
  it("revises a corrected week explicitly and refunds excess previously collected tax", async () => {
    await funded();
    event("employee_wage", 100000);
    event("realized_stock_gain", 60000);
    const first = await closedTax();
    await cmd(operator, "tax.collect", { id: first.id });
    event("realized_stock_gain", -60000);
    const revision = await cmd(operator, "tax.assess", {
      customerId: alice.id,
      week: "2026-11-16",
      supersedesId: first.id,
      evidence: "Corrected sale evidence",
    });
    expect(revision.assessedCents).toBe(2000);
    const refund = await cmd(operator, "tax.refund", { id: revision.id });
    expect(refund.refundedCents).toBe(1200);
    expect(
      (await cmd(operator, "tax.refund", { id: revision.id })).refundedCents,
    ).toBe(0);
  });
  it("schedules, cancels and applies two weekly changes with one event each; rejects a third", async () => {
    const p = await policy();
    const first = await cmd(operator, "rate.schedule", {
      policyVersion: p.version,
      effectiveLocal: "2026-11-16T13:00",
      deltaPpm: -50,
      explanation: "Planned reserve policy adjustment.",
    });
    await cmd(operator, "rate.cancel", { id: first.id });
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM bank_rate_week_slots").get()!.n,
    ).toBe(0);
    for (const wall of ["2026-11-16T14:00", "2026-11-16T15:00"])
      await cmd(operator, "rate.schedule", {
        policyVersion: p.version,
        effectiveLocal: wall,
        deltaPpm: -50,
        explanation: "Reviewed reduction.",
      });
    await expect(
      cmd(operator, "rate.schedule", {
        policyVersion: p.version,
        effectiveLocal: "2026-11-16T16:00",
        deltaPpm: -50,
        explanation: "Third change.",
      }),
    ).rejects.toThrow("Both rate");
    now = wallToSeconds("2026-11-16T15:30");
    await runEconomyJobs(db.env(), now);
    expect(
      db.db.prepare("SELECT rate_ppm FROM economy_runtime").get()!.rate_ppm,
    ).toBe(9900);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM economy_outbox WHERE kind='rate.applied'",
        )
        .get()!.n,
    ).toBe(2);
    await runEconomyJobs(db.env(), now);
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM economy_outbox WHERE kind='rate.applied'",
        )
        .get()!.n,
    ).toBe(2);
  });
  it("funds loans only on exact member acceptance and keeps fixed rates through rate changes", async () => {
    await funded();
    const before = balance("demo-bob-transaction"),
      offer = await cmd(operator, "loan.offer", {
        customerId: bob.id,
        productId: "fixed",
        principalCents: 10000,
        expiresAt: now + 86400,
      });
    expect(balance("demo-bob-transaction")).toBe(before);
    await expect(
      cmd(alice, "loan.accept", { id: offer.id, termsHash: offer.termsHash }),
    ).rejects.toThrow();
    await expect(
      cmd(bob, "loan.accept", { id: offer.id, termsHash: "wrong" }),
    ).rejects.toThrow("exact");
    const loan = await cmd(bob, "loan.accept", {
      id: offer.id,
      termsHash: offer.termsHash,
    });
    expect(balance("economy-reserve")).toBe(9990000);
    now += 604800;
    await cmd(bob, "loan.accrue", { id: loan.id });
    expect(
      db.db.prepare("SELECT interest_due_cents FROM bank_loan_contracts").get()!
        .interest_due_cents,
    ).toBe(100);
    const paid = await cmd(bob, "loan.repay", {
      id: loan.id,
      amountCents: 10100,
    });
    expect(paid.interestCents).toBe(100);
    expect(balance("economy-reserve")).toBe(10000100);
    expect(
      db.db.prepare("SELECT state FROM bank_loan_contracts").get()!.state,
    ).toBe("repaid");
  });
  it("splits variable accrual at effective rate boundaries and carries fractional cents", async () => {
    await funded();
    const offer = await cmd(operator, "loan.offer", {
        customerId: bob.id,
        productId: "variable",
        principalCents: 10000,
        expiresAt: now + 86400,
      }),
      loan = await cmd(bob, "loan.accept", {
        id: offer.id,
        termsHash: offer.termsHash,
      });
    now += 302400;
    await cmd(operator, "rate.schedule", {
      policyVersion: 1,
      effectiveLocal: newYorkWall(now),
      deltaPpm: 1000,
      explanation: "Reviewed variable interest change.",
    });
    now += 302400;
    await cmd(bob, "loan.accrue", { id: loan.id });
    expect(
      db.db.prepare("SELECT interest_due_cents FROM bank_loan_contracts").get()!
        .interest_due_cents,
    ).toBe(105);
  });
  it("keeps snapshots provisional without exchange cutoff evidence and explains insufficient recommendation data", async () => {
    await funded();
    await cmd(operator, "snapshot.capture");
    expect(
      db.db.prepare("SELECT state FROM economy_snapshots").get()!.state,
    ).toBe("provisional");
    const comp = await bankComponent(db.env(), now);
    expect(comp.metrics.memberHeldCents).toBe(0);
    const revised = await cmd(operator, "snapshot.revise", {
      bankCheckpoint: comp.checkpoint,
      exchange: {
        assetsCents: 1000000,
        asOf: now,
        locked: true,
        memberCheckpoint: comp.memberCheckpoint,
        checkpoint: "isolated-test-market-lock",
      },
    });
    expect(revised.state).toBe("reconciled");
    expect(revised.metrics.averageAssetsCents).toBe(500000);
    expect((await recommendation(db.env(), null, null, now)).action).toBe(
      "insufficient_data",
    );
  });
  it("handles New York DST recurrence and deterministic remainder allocations", () => {
    expect(
      new Date(wallToSeconds("2026-11-01T01:30") * 1000).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(() => wallToSeconds("2026-03-08T02:30")).toThrow();
    expect(newYorkWall(wallToSeconds("2026-03-08T02:30", true))).toBe(
      "2026-03-08T03:00",
    );
    expect(
      allocate(5, [
        { id: "b", weight: 1 },
        { id: "a", weight: 1 },
      ]),
    ).toEqual([
      { id: "a", amount: 3 },
      { id: "b", amount: 2 },
    ]);
  });
  it("serializes competing purchases with no duplicate revenue or partial journal", async () => {
    await funded();
    const plan = await company("purchase", 600000);
    const result = await Promise.allSettled([
      checkout(plan, bob, "concurrent_checkout_one"),
      checkout(plan, bob, "concurrent_checkout_two"),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(balance("demo-bob-transaction")).toBe(400000);
    expect(balance("company:TEST:operating")).toBe(600000);
    expect(await reconciliation(db.env())).toEqual({
      unbalanced_transactions: 0,
      projection_mismatches: 0,
      negative_available_accounts: 0,
    });
  });
  it("redistributes only received funded income equally to reviewed identities without minting cash", async () => {
    await funded();
    db.db.exec(
      "UPDATE bank_customers SET joe_auth_user_id='subject-alice' WHERE id='demo-alice';UPDATE bank_customers SET joe_auth_user_id='subject-bob' WHERE id='demo-bob'",
    );
    for (const [customer, subject] of [
      [alice, "subject-alice"],
      [bob, "subject-bob"],
    ] as const)
      await cmd(operator, "member.eligibility", {
        customerId: customer.id,
        subject,
        evidence: "Reviewed exact stable identity",
      });
    event("employee_wage", 100000);
    event("realized_stock_gain", 60000);
    const tax = await closedTax();
    await expect(
      cmd(operator, "redistribution.run", {
        week: "2026-11-16",
        amountCents: 3200,
      }),
    ).rejects.toThrow("fund");
    await cmd(operator, "tax.collect", { id: tax.id });
    const before =
      balance("demo-alice-transaction") +
      balance("demo-bob-transaction") +
      balance("economy-reserve");
    const result = await cmd(
      operator,
      "redistribution.run",
      { week: "2026-11-16", amountCents: 3200 },
      "same_funded_distribution",
    );
    expect(result.members).toBe(2);
    await cmd(
      operator,
      "redistribution.run",
      { week: "2026-11-16", amountCents: 3200 },
      "same_funded_distribution",
    );
    expect(
      balance("demo-alice-transaction") +
        balance("demo-bob-transaction") +
        balance("economy-reserve"),
    ).toBe(before);
    expect(
      db.db
        .prepare("SELECT SUM(amount_cents) AS n FROM redistribution_lines")
        .get()!.n,
    ).toBe(3200);
    await expect(
      cmd(operator, "redistribution.run", {
        week: "2026-11-16",
        amountCents: 1,
      }),
    ).rejects.toThrow("already");
  });
  it("rejects loan acceptance before reserve initialization and stale variable starting terms", async () => {
    await policy();
    const offer = await cmd(operator, "loan.offer", {
      customerId: bob.id,
      productId: "variable",
      principalCents: 10000,
      expiresAt: now + 86400,
    });
    await expect(
      cmd(bob, "loan.accept", { id: offer.id, termsHash: offer.termsHash }),
    ).rejects.toMatchObject({ code: "RESERVE_REQUIRED" });
    await cmd(operator, "reserve.initialize");
    await cmd(operator, "rate.schedule", {
      policyVersion: 1,
      effectiveLocal: newYorkWall(now),
      deltaPpm: 50,
      explanation: "A new current rate requires a refreshed starting offer.",
    });
    await expect(
      cmd(bob, "loan.accept", { id: offer.id, termsHash: offer.termsHash }),
    ).rejects.toMatchObject({ code: "TERMS_CHANGED" });
    expect(balance("demo-bob-transaction")).toBe(1000000);
  });
  it("refuses early subscription retry and safely repeats an underfunded past-due retry", async () => {
    await funded();
    const plan = await company("subscription", 600000),
      paid = await checkout(plan);
    await expect(
      cmd(bob, "subscription.retry", { id: paid.subscriptionId }),
    ).rejects.toThrow("past-due");
    expect(balance("demo-bob-transaction")).toBe(400000);
    now += 86400;
    expect(
      (await cmd(bob, "subscription.renew", { id: paid.subscriptionId })).state,
    ).toBe("past_due");
    expect(
      (await cmd(bob, "subscription.retry", { id: paid.subscriptionId })).state,
    ).toBe("past_due");
    expect(
      (await cmd(bob, "subscription.retry", { id: paid.subscriptionId })).state,
    ).toBe("past_due");
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM economy_outbox WHERE kind='subscription.past_due'",
        )
        .get()!.n,
    ).toBe(1);
    expect(balance("demo-bob-transaction")).toBe(400000);
  });
  it("keeps the consented wall-time anchor across an actual spring DST renewal", async () => {
    now = wallToSeconds("2026-03-07T02:30");
    await funded();
    const plan = await company("subscription", 100),
      paid = await checkout(plan);
    let sub = db.db.prepare("SELECT * FROM company_subscriptions").get()!;
    expect(newYorkWall(Number(sub.next_charge_at))).toBe("2026-03-08T03:00");
    now = Number(sub.next_charge_at) + 60;
    await cmd(bob, "subscription.renew", { id: paid.subscriptionId });
    sub = db.db.prepare("SELECT * FROM company_subscriptions").get()!;
    expect(newYorkWall(Number(sub.next_charge_at))).toBe("2026-03-09T02:30");
    expect(balance("demo-bob-transaction")).toBe(999800);
  });
  it("settles a cancellation/renewal race once and prevents all later charges", async () => {
    await funded();
    const plan = await company("subscription", 100),
      paid = await checkout(plan);
    now += 86400;
    await Promise.allSettled([
      cmd(bob, "subscription.cancel", { id: paid.subscriptionId }),
      cmd(bob, "subscription.renew", { id: paid.subscriptionId }),
    ]);
    await cmd(bob, "subscription.cancel", { id: paid.subscriptionId });
    expect(balance("demo-bob-transaction")).toBeGreaterThanOrEqual(999800);
    now += 86400;
    await expect(
      cmd(bob, "subscription.renew", { id: paid.subscriptionId }),
    ).rejects.toThrow("not active");
    expect(await reconciliation(db.env())).toEqual({
      unbalanced_transactions: 0,
      projection_mismatches: 0,
      negative_available_accounts: 0,
    });
  });
  it("rotates past five deferred payroll jobs so a sixth eligible company is processed", async () => {
    await funded();
    for (let i = 0; i < 6; i++) {
      const id = `queue-company-${i}`;
      db.db
        .prepare(
          "INSERT INTO economy_companies(id,exchange_asset_id,state,display_name,employee_pool_bps) VALUES(?,?,'active',?,5000)",
        )
        .run(id, id, id);
      db.db
        .prepare(
          "INSERT INTO bank_accounts(id,account_kind) VALUES(?,'internal_clearing')",
        )
        .run(`company:${id}:operating`);
      db.db
        .prepare(
          "INSERT INTO economy_accounts(account_id,company_id,purpose) VALUES(?,?,'company_operating')",
        )
        .run(`company:${id}:operating`, id);
    }
    db.db.exec(
      "INSERT INTO company_employee_agreements(id,company_id,employee_id,version,allocation_bps,terms_hash,accepted_at,state) VALUES('sixth-agreement','queue-company-5','demo-bob',1,10000,'reviewed-fixture',1,'accepted')",
    );
    now = wallToSeconds("2026-11-23T12:00");
    await runEconomyJobs(db.env(), now);
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM company_payroll_runs").get()!.n,
    ).toBe(0);
    await runEconomyJobs(db.env(), now + 300);
    expect(
      db.db
        .prepare(
          "SELECT state FROM company_payroll_runs WHERE company_id='queue-company-5'",
        )
        .get()!.state,
    ).toBe("posted");
    expect(
      db.db
        .prepare(
          "SELECT COUNT(*) AS n FROM economy_job_attempts WHERE queue='payroll' AND outcome='deferred'",
        )
        .get()!.n,
    ).toBe(5);
  });
  it("blocks stale tax collection after late evidence until an explicit revision", async () => {
    await funded();
    event("employee_wage", 100000);
    event("realized_stock_gain", 60000);
    const tax = await closedTax();
    event("realized_stock_gain", -60000, start, "late-loss");
    await expect(
      cmd(operator, "tax.collect", { id: tax.id }),
    ).rejects.toMatchObject({ code: "ASSESSMENT_STALE" });
    const revision = await cmd(operator, "tax.assess", {
      customerId: alice.id,
      week: "2026-11-16",
      supersedesId: tax.id,
      evidence: "Late exact disposal evidence",
    });
    expect(revision.assessedCents).toBe(2000);
    expect(
      (await cmd(operator, "tax.collect", { id: revision.id })).collectedCents,
    ).toBe(2000);
  });
  it("captures read-only noon totals even before any cash policy is approved", async () => {
    await runEconomyJobs(db.env(), now);
    expect(
      db.db.prepare("SELECT state FROM economy_snapshots").get()!.state,
    ).toBe("provisional");
    expect(balance("demo-alice-transaction")).toBe(1000000);
    expect(
      db.db
        .prepare("SELECT COUNT(*) AS n FROM bank_reserve_initializations")
        .get()!.n,
    ).toBe(0);
  });
});
