import { requireReserve } from "./core";
import {
  allocate,
  calendar,
  previewWeeklyTax,
  wallToSeconds,
  weekBounds,
} from "../../../shared/economy/runtime";
import { sha256 } from "../http";
import {
  account,
  add,
  all,
  fail,
  income,
  integer,
  one,
  operator,
  outbox,
  policy,
  post,
  str,
  type Context,
  type Input,
  type Row,
} from "./core";
export async function circulationAction(
  c: Context,
  action: string,
  b: Input,
): Promise<unknown> {
  const { e } = c;
  if (action === "income.record") {
    const customer = str(b.customerId);
    if (
      !(await one(
        e,
        "SELECT 1 FROM bank_customers WHERE id=? AND role='member'",
        customer,
      ))
    )
      fail("The income member was not found.");
    const reference = str(b.reference, "sale reference", 180),
      submittedAt = integer(b.occurredAt, "sale time", 0, c.now);
    let occurredAt = submittedAt;
    const evidence = b.evidence as Row | undefined;
    if (evidence?.bankOperationId) {
      const settlement = await one(
        e,
        "SELECT t.created_at,SUM(l.amount_cents) AS proceeds FROM ledger_transactions t JOIN ledger_lines l ON l.transaction_id=t.id JOIN bank_accounts a ON a.id=l.account_id WHERE t.id=? AND t.state='posted' AND t.transaction_type IN ('exchange_settlement','exchange_payment') AND a.customer_id=? GROUP BY t.id",
        str(evidence.bankOperationId),
        customer,
      );
      if (!settlement || settlement.proceeds !== evidence.netProceedsCents)
        fail(
          "The realized gain must match the seller’s posted settlement evidence.",
        );
      occurredAt = settlement.created_at;
    }
    const week = calendar(occurredAt).weekKey;
    if (
      ![
        "realized_stock_gain",
        "realized_crypto_gain",
        "realized_frozen_share_gain",
      ].includes(String(b.category))
    )
      fail(
        "The exchange may only report realized trading gains.",
        "INVALID_SOURCE",
        403,
      );
    if (b.basisComplete !== true) {
      add(
        c,
        "INSERT INTO economy_basis_holds(customer_id,week_key,source_reference) VALUES(?,?,?) ON CONFLICT DO NOTHING",
        customer,
        week,
        reference,
      );
      return { id: reference, state: "basis_review_required" };
    }
    if (
      await one(
        e,
        "SELECT 1 FROM economy_basis_holds WHERE customer_id=? AND week_key=? AND source_reference=? AND resolved_at IS NULL",
        customer,
        week,
        reference,
      )
    )
      fail("Resolve the existing basis review with attributed evidence.");
    income(
      c,
      customer,
      String(b.category),
      integer(b.gainCents, "realized gain", -1e12, 1e12),
      reference,
      b.evidence ?? {},
      occurredAt,
      "exchange",
    );
    return { id: reference, state: "recorded" };
  }
  if (action === "income.resolve") {
    operator(c.actor);
    const customer = str(b.customerId),
      reference = str(b.reference, "sale reference", 180),
      week = str(b.week, "week", 10),
      hold = await one(
        e,
        "SELECT * FROM economy_basis_holds WHERE customer_id=? AND week_key=? AND source_reference=? AND resolved_at IS NULL",
        customer,
        week,
        reference,
      );
    if (!hold) fail("An unresolved sale evidence record is required.");
    const evidence = str(b.evidence, "review evidence", 2000),
      occurredAt = integer(b.occurredAt, "original sale time", 0, c.now);
    if (calendar(occurredAt).weekKey !== week)
      fail("A correction must use its original sale week.");
    if (
      ![
        "realized_stock_gain",
        "realized_crypto_gain",
        "realized_frozen_share_gain",
      ].includes(String(b.category))
    )
      fail("Choose a realized-gain category.");
    add(
      c,
      "UPDATE economy_basis_holds SET resolved_at=?,evidence_reference=? WHERE customer_id=? AND week_key=? AND source_reference=?",
      c.now,
      evidence,
      customer,
      week,
      reference,
    );
    income(
      c,
      customer,
      String(b.category),
      integer(b.gainCents, "reviewed gain", -1e12, 1e12),
      reference,
      { reviewedBy: c.actor.id, evidence },
      occurredAt,
      "exchange",
    );
    return { id: reference, state: "resolved" };
  }
  if (action === "income.checkpoint") {
    add(
      c,
      "INSERT INTO economy_exchange_checkpoint(singleton,complete_through,reference,received_at) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET complete_through=MAX(complete_through,excluded.complete_through),reference=excluded.reference,received_at=excluded.received_at",
      integer(b.completeThrough, "exchange cutoff", 0, c.now),
      str(b.reference),
      c.now,
    );
    return { state: "recorded" };
  }
  const p = await policy(c);
  if (action === "tax.assess") {
    operator(c.actor);
    const customer = str(b.customerId);
    await account(e, customer);
    const week = str(b.week, "closed week", 10),
      [start, end] = weekBounds(week);
    if (end > c.now) fail("Tax requires a closed New York week.");
    const previous = await one(
      e,
      "SELECT * FROM weekly_tax_assessments WHERE customer_id=? AND week_key=? ORDER BY revision DESC LIMIT 1",
      customer,
      week,
    );
    if (previous && b.supersedesId !== previous.id)
      fail(
        "Select the current assessment and provide correction evidence for a revision.",
      );
    const evidence = previous
      ? str(b.evidence, "correction evidence", 2000)
      : "Initial closed-week assessment";
    const events = await all(
      e,
      "SELECT * FROM economy_income_events WHERE customer_id=? AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at,id",
      customer,
      start,
      end,
    );
    const holds = await all(
        e,
        "SELECT source_reference FROM economy_basis_holds WHERE customer_id=? AND week_key=? AND resolved_at IS NULL",
        customer,
        week,
      ),
      checkpoint = await one(
        e,
        "SELECT * FROM economy_exchange_checkpoint WHERE singleton=1",
      );
    const complete =
      holds.length === 0 && checkpoint && checkpoint.complete_through >= end;
    let wages = 0,
      gains = 0;
    for (const event of events) {
      if (["employee_wage", "deposit_interest"].includes(event.category))
        wages += event.amount_cents;
      else if (event.category.startsWith("realized_"))
        gains += event.amount_cents;
    }
    const tax = previewWeeklyTax(Math.max(0, wages) + Math.max(0, gains)),
      revision = (previous?.revision ?? 0) + 1;
    add(
      c,
      "INSERT INTO weekly_tax_assessments(id,customer_id,week_key,revision,policy_id,taxable_cents,rate_bps,assessed_cents,basis_complete,supersedes_id,evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      c.id,
      customer,
      week,
      revision,
      p.id,
      tax.incomeCents,
      tax.rateBps,
      complete ? tax.taxCents : 0,
      complete ? 1 : 0,
      previous?.id ?? null,
      JSON.stringify({
        events: events.map((v) => v.id),
        basisHolds: holds,
        exchangeCheckpoint: checkpoint?.reference ?? null,
        evidence,
        reviewedBy: c.actor.id,
      }),
    );
    return {
      id: c.id,
      revision,
      state: complete ? "assessed" : "held_for_evidence",
      assessedCents: complete ? tax.taxCents : null,
    };
  }
  if (action === "tax.collect" || action === "tax.refund") {
    await requireReserve(c);
    operator(c.actor);
    const selected = await one(
      e,
      "SELECT * FROM weekly_tax_assessments WHERE id=?",
      str(b.id),
    );
    if (!selected) fail("Select an assessment.");
    const current = await one(
      e,
      "SELECT * FROM weekly_tax_assessments WHERE customer_id=? AND week_key=? ORDER BY revision DESC LIMIT 1",
      selected!.customer_id,
      selected!.week_key,
    );
    if (current!.id !== selected!.id || !current!.basis_complete)
      fail("Only the latest complete assessment can be settled.");
    const paid = await netTaxPaid(e, current!.customer_id, current!.week_key),
      a = await account(e, current!.customer_id),
      difference = current!.assessed_cents - paid;
    if (action === "tax.collect") {
      const amount = Math.min(Math.max(0, difference), a.available_cents);
      if (amount === 0)
        return {
          id: current!.id,
          collectedCents: 0,
          unpaidCents: Math.max(0, difference),
        };
      const ledger = post(c, "tax", "tax_collection", "Weekly income tax", [
        { account: a.id, amount: -amount },
        { account: "economy-reserve", amount },
      ]);
      add(
        c,
        "INSERT INTO tax_collections(id,assessment_id,amount_cents,ledger_transaction_id) VALUES(?,?,?,?)",
        c.id,
        current!.id,
        amount,
        ledger,
      );
      return {
        id: c.id,
        collectedCents: amount,
        unpaidCents: difference - amount,
      };
    }
    if (difference >= 0) return { id: current!.id, refundedCents: 0 };
    const ledger = post(
      c,
      "tax-refund",
      "tax_refund",
      "Reviewed weekly tax correction refund",
      [
        { account: "economy-reserve", amount: difference },
        { account: a.id, amount: -difference },
      ],
    );
    add(
      c,
      "INSERT INTO tax_refunds(id,assessment_id,amount_cents,ledger_transaction_id) VALUES(?,?,?,?)",
      c.id,
      current!.id,
      -difference,
      ledger,
    );
    return { id: c.id, refundedCents: -difference };
  }
  if (action === "redistribution.run") {
    operator(c.actor);
    const week = str(b.week, "closed week", 10),
      [, end] = weekBounds(week);
    if (end > c.now) fail("Redistribution requires a closed week.");
    if (
      await one(e, "SELECT 1 FROM redistribution_runs WHERE period_key=?", week)
    )
      fail("This redistribution week already has a run.");
    const amount = integer(
        b.amountCents,
        "approved distribution",
        1,
        p.rules.redistributionBudgetCents,
      ),
      reserve = await one(
        e,
        "SELECT posted_cents FROM bank_accounts WHERE id='economy-reserve'",
      );
    if (!reserve || reserve.posted_cents - amount < 9000000)
      fail("The distribution must preserve the J$90,000 reserve floor.");
    const received = await one(
      e,
      "SELECT (SELECT COALESCE(SUM(amount_cents),0) FROM tax_collections)-(SELECT COALESCE(SUM(amount_cents),0) FROM tax_refunds)+(SELECT COALESCE(SUM(interest_cents),0) FROM bank_loan_payments)-(SELECT COALESCE(SUM(budget_cents),0) FROM redistribution_runs WHERE state='posted') AS amount",
    );
    const unreviewedDeposits = await one(
      e,
      "SELECT COUNT(*) AS n FROM bank_accounts WHERE account_kind='flexible_deposit' AND posted_cents>0",
    );
    if (unreviewedDeposits!.n)
      fail(
        "Review existing deposit obligations before distributing bank income.",
      );
    let refundObligations = 0;
    for (const assessment of await all(
      e,
      "SELECT a.* FROM weekly_tax_assessments a WHERE NOT EXISTS(SELECT 1 FROM weekly_tax_assessments n WHERE n.supersedes_id=a.id)",
    )) {
      const paid = await netTaxPaid(
        e,
        assessment.customer_id,
        assessment.week_key,
      );
      refundObligations += assessment.basis_complete
        ? Math.max(0, paid - assessment.assessed_cents)
        : paid;
    }
    if (
      reserve.posted_cents - amount - refundObligations < 9000000 ||
      amount > received!.amount - refundObligations
    )
      fail(
        "Outstanding tax corrections must remain funded before redistribution.",
      );
    // Only collected tax and loan interest, after refund obligations, is distributable.
    if (amount > received!.amount)
      fail("Received tax and bank interest do not fund this distribution.");
    const members = await all(
      e,
      "SELECT c.id,a.id AS account_id FROM bank_customers c JOIN economy_member_eligibility el ON el.customer_id=c.id AND el.joe_auth_subject=c.joe_auth_user_id JOIN bank_accounts a ON a.customer_id=c.id AND a.account_kind='transaction' WHERE c.role='member' AND c.status='active' ORDER BY c.id",
    );
    if (!members.length) fail("No reviewed eligible members are available.");
    const lines = allocate(
      amount,
      members.map((m) => ({ id: m.id, weight: 1 })),
    );
    add(
      c,
      "INSERT INTO redistribution_runs(id,period_key,policy_id,approved_by,budget_cents,state,eligibility_json) VALUES(?,?,?,?,?,'posted',?)",
      c.id,
      week,
      p.id,
      c.actor.id,
      amount,
      JSON.stringify({
        members: members.map((m) => m.id),
        funding: received!.amount,
        policyVersion: p.version,
      }),
    );
    for (const line of lines.filter((l) => l.amount > 0)) {
      const a = members.find((m) => m.id === line.id)!;
      const ledger = post(
        c,
        `redistribution:${a.id}`,
        "redistribution",
        "Approved equal member redistribution",
        [
          { account: "economy-reserve", amount: -line.amount },
          { account: a.account_id, amount: line.amount },
        ],
      );
      add(
        c,
        "INSERT INTO redistribution_lines(run_id,customer_id,amount_cents,ledger_transaction_id) VALUES(?,?,?,?)",
        c.id,
        a.id,
        line.amount,
        ledger,
      );
      income(c, a.id, "redistribution", line.amount, ledger);
    }
    return { id: c.id, amountCents: amount, members: members.length };
  }
  if (action === "snapshot.capture" || action === "snapshot.revise") {
    operator(c.actor);
    const today = calendar(c.now),
      scheduled = wallToSeconds(today.dateKey + "T12:00");
    if (c.now < scheduled) fail("The daily snapshot is due at New York noon.");
    const old = await one(
      e,
      "SELECT * FROM economy_snapshots WHERE date_key=?",
      today.dateKey,
    );
    if (old && action === "snapshot.capture")
      return { dateKey: today.dateKey, state: old.state };
    const component = await bankComponent(e, c.now),
      exchange = b.exchange as Row | undefined;
    const reconciled = Boolean(
      exchange &&
      b.bankCheckpoint === component.checkpoint &&
      exchange.locked === true &&
      exchange.memberCheckpoint === component.memberCheckpoint &&
      Number.isSafeInteger(exchange.assetsCents) &&
      exchange.asOf >= c.now - 30 &&
      exchange.asOf <= c.now,
    );
    const count = component.metrics.memberCount as number,
      assets = reconciled
        ? integer(exchange!.assetsCents, "member market assets")
        : null,
      liabilities = component.metrics.loanLiabilityCents as number;
    const metrics: Row = {
      ...component.metrics,
      totalMemberAssetsCents: assets,
      averageAssetsCents:
        assets !== null && count ? Math.round(assets / count) : null,
      averageAssetsVs10kPercent:
        assets !== null && count ? (assets / count / 1000000 - 1) * 100 : null,
      averagePortfolioCents:
        assets !== null && count
          ? Math.round(
              ((component.metrics.memberPostedCents as number) +
                assets -
                liabilities) /
                count,
            )
          : null,
      capturedAt: c.now,
      scheduledFor: scheduled,
      exchangeAsOf: exchange?.asOf ?? null,
      comparison:
        "Member assets exclude company treasury, issuer inventory and cash. Portfolio includes posted cash and loan liabilities.",
    };
    const state = reconciled ? "reconciled" : "provisional";
    if (reconciled)
      add(
        c,
        "INSERT INTO economy_snapshot_guards(command_id,unchanged) SELECT ?,CASE WHEN (SELECT json_group_array(json_array(id,customer_id,posted_cents,held_cents,role,status)) FROM (SELECT a.id,a.customer_id,a.posted_cents,a.held_cents,c.role,c.status FROM account_balances a LEFT JOIN bank_customers c ON c.id=a.customer_id ORDER BY a.id))=? THEN 1 ELSE 0 END",
        c.id,
        component.accountFingerprint,
      );
    if (!old)
      add(
        c,
        "INSERT INTO economy_snapshots(date_key,scheduled_for,bank_as_of,exchange_as_of,state,metrics_json,bank_checkpoint,exchange_checkpoint) VALUES(?,?,?,?,?,?,?,?)",
        today.dateKey,
        scheduled,
        c.now,
        exchange?.asOf ?? c.now,
        state,
        JSON.stringify(metrics),
        component.checkpoint,
        String(exchange?.checkpoint ?? "unavailable"),
      );
    else {
      const revision = (await one(
        e,
        "SELECT COALESCE(MAX(revision),0)+1 AS v FROM economy_snapshot_revisions WHERE date_key=?",
        today.dateKey,
      ))!.v;
      add(
        c,
        "INSERT INTO economy_snapshot_revisions(date_key,revision,captured_at,actor_id,metrics_json) VALUES(?,?,?,?,?)",
        today.dateKey,
        revision,
        c.now,
        c.actor.id,
        JSON.stringify({ state, metrics }),
      );
    }
    return { dateKey: today.dateKey, state, metrics };
  }
  return undefined;
}
export async function netTaxPaid(
  e: Context["e"],
  customer: string,
  week: string,
) {
  const sums = await one(
    e,
    `SELECT (SELECT COALESCE(SUM(c.amount_cents),0) FROM tax_collections c JOIN weekly_tax_assessments a ON a.id=c.assessment_id WHERE a.customer_id=? AND a.week_key=?)-(SELECT COALESCE(SUM(c.amount_cents),0) FROM tax_refunds c JOIN weekly_tax_assessments a ON a.id=c.assessment_id WHERE a.customer_id=? AND a.week_key=?) AS amount`,
    customer,
    week,
    customer,
    week,
  );
  return sums!.amount as number;
}
export async function bankComponent(e: Context["e"], now: number) {
  const accounts = await all(
      e,
      "SELECT a.*,c.role,c.status,el.customer_id AS eligible FROM account_balances a LEFT JOIN bank_customers c ON c.id=a.customer_id LEFT JOIN economy_member_eligibility el ON el.customer_id=c.id ORDER BY a.id",
    ),
    journal = await one(
      e,
      "SELECT COUNT(*) AS entries,COALESCE(SUM(created_at),0) AS time_sum FROM ledger_transactions WHERE state='posted'",
    );
  const members = accounts.filter(
      (a) =>
        a.role === "member" &&
        a.account_kind === "transaction" &&
        a.status === "active",
    ),
    sum = (rows: Row[], field: string) =>
      rows.reduce((n, r) => n + r[field], 0);
  const [start] = weekBounds(calendar(now).weekKey),
    reserve = accounts.find((a) => a.id === "economy-reserve"),
    company = accounts.filter(
      (a) => a.id.startsWith("company:") && a.id.endsWith(":operating"),
    );
  const cashflows = await one(
    e,
    `SELECT COALESCE(SUM(CASE WHEN t.transaction_type='economy_tax_collection' AND l.amount_cents>0 THEN l.amount_cents ELSE 0 END),0) AS taxes,COALESCE(SUM(CASE WHEN t.transaction_type='economy_employee_wage' AND l.amount_cents>0 THEN l.amount_cents ELSE 0 END),0) AS wages FROM ledger_transactions t JOIN ledger_lines l ON l.transaction_id=t.id WHERE t.state='posted' AND t.created_at>=?`,
    start,
  );
  const loans = await one(
      e,
      "SELECT COALESCE(SUM(principal_outstanding_cents+interest_due_cents),0) AS amount FROM bank_loan_contracts WHERE state='active'",
    ),
    loanInterest = await one(
      e,
      "SELECT COALESCE(SUM(p.interest_cents),0) AS amount FROM bank_loan_payments p JOIN ledger_transactions t ON t.id=p.ledger_transaction_id WHERE t.created_at>=?",
      start,
    );
  const flows = await one(
    e,
    `SELECT
 COALESCE(SUM(CASE WHEN t.transaction_type='economy_tax_refund' AND l.amount_cents>0 THEN l.amount_cents ELSE 0 END),0) AS tax_refunds,
 COALESCE(SUM(CASE WHEN t.transaction_type='economy_commerce_refund' AND l.amount_cents>0 THEN l.amount_cents ELSE 0 END),0) AS service_refunds,
 COALESCE(SUM(CASE WHEN t.transaction_type='economy_redistribution' AND l.amount_cents>0 THEN l.amount_cents ELSE 0 END),0) AS redistribution,
 COALESCE(SUM(CASE WHEN t.transaction_type='economy_opening_grant' AND l.amount_cents>0 THEN l.amount_cents ELSE 0 END),0) AS grants,
 COALESCE(SUM(CASE WHEN t.transaction_type='economy_deposit_interest' AND l.amount_cents>0 THEN l.amount_cents ELSE 0 END),0) AS deposit_interest
 FROM ledger_transactions t JOIN ledger_lines l ON l.transaction_id=t.id WHERE t.state='posted' AND t.created_at>=?`,
    start,
  );
  const metrics = {
    memberCount: members.length,
    marketPostedMoneyCents:
      sum(members, "posted_cents") + sum(company, "posted_cents"),
    weeklyTaxRefundedCents: flows!.tax_refunds,
    weeklyServiceRefundedCents: flows!.service_refunds,
    weeklyRedistributedCents: flows!.redistribution,
    weeklyOpeningGrantsCents: flows!.grants,
    weeklyDepositInterestPaidCents: flows!.deposit_interest,
    memberPostedCents: sum(members, "posted_cents"),
    memberAvailableCents: sum(members, "available_cents"),
    memberHeldCents: sum(members, "held_cents"),
    companyOperatingCents: sum(company, "posted_cents"),
    reserveCents: reserve?.posted_cents ?? null,
    reserveRatioPercent: reserve ? reserve.posted_cents / 100000 : null,
    lockedCapitalCents:
      accounts.find((a) => a.id === "joese-capital")?.posted_cents ?? 0,
    feeClearingCents:
      accounts.find((a) => a.id === "joese-clearing")?.posted_cents ?? 0,
    weeklyTaxReceivedCents: cashflows!.taxes,
    weeklyWagesCents: cashflows!.wages,
    weeklyLoanInterestReceivedCents: loanInterest!.amount,
    loanLiabilityCents: loans!.amount,
  };
  return {
    asOf: now,
    checkpoint: await sha256(JSON.stringify({ accounts, journal, metrics })),
    accountFingerprint: JSON.stringify(
      accounts.map((a) => [
        a.id,
        a.customer_id,
        a.posted_cents,
        a.held_cents,
        a.role,
        a.status,
      ]),
    ),
    memberCheckpoint: await sha256(
      JSON.stringify(members.map((m) => m.customer_id).sort()),
    ),
    metrics,
  };
}
export async function recommendation(
  e: Context["e"],
  rate: number | null,
  reserve: number | null,
  now: number,
) {
  const assumptions = [
    "Seven-day projection; only active reserve-funded variable loans.",
    "Deposit products remain disabled; there are no new variable deposit obligations.",
    "Interest is projected collectible only for active members with sufficient current available cash.",
    "Operator approval is required; no rate is applied by this recommendation.",
  ];
  if (rate === null || reserve === null)
    return {
      action: "insufficient_data" as const,
      deltaPpm: 0,
      explanation: "Approve the initial rate and initialize the reserve first.",
      assumptions,
    };
  const used = await one(
    e,
    "SELECT COUNT(*) AS n FROM bank_rate_week_slots WHERE week_key=?",
    calendar(now).weekKey,
  );
  if (used!.n >= 2)
    return {
      action: "hold" as const,
      deltaPpm: 0,
      explanation: "This week’s two rate slots are occupied.",
      assumptions,
    };
  const deposits = await one(
    e,
    "SELECT COUNT(*) AS n FROM bank_accounts WHERE account_kind='flexible_deposit' AND posted_cents>0",
  );
  if (deposits!.n)
    return {
      action: "insufficient_data" as const,
      deltaPpm: 0,
      explanation:
        "Existing deposit obligations need reviewed terms before a cash-flow recommendation.",
      assumptions,
    };
  const loans = await all(
    e,
    "SELECT l.principal_outstanding_cents,o.customer_id,o.terms_json FROM bank_loan_contracts l JOIN bank_loan_offers o ON o.id=l.offer_id JOIN bank_customers c ON c.id=o.customer_id WHERE l.state='active' AND c.status='active'",
  );
  let total = 0;
  for (const loan of loans) {
    const terms = JSON.parse(loan.terms_json);
    if (!terms.variable) continue;
    const a = await account(e, loan.customer_id),
      due = Math.ceil(
        (loan.principal_outstanding_cents * (rate + terms.spreadPpm + 50)) /
          1e6,
      );
    if (a.available_cents < due)
      return {
        action: "insufficient_data" as const,
        deltaPpm: 0,
        explanation:
          "A variable-loan projection lacks sufficient currently collectible cash.",
        assumptions,
      };
    total += loan.principal_outstanding_cents;
  }
  if (reserve >= 10000000 || total === 0 || rate + 50 > 20000)
    return {
      action: "hold" as const,
      deltaPpm: 0,
      explanation:
        "No eligible rate adjustment improves the defined reserve forecast below its opening target.",
      assumptions,
    };
  return {
    action: "increase" as const,
    deltaPpm: 50,
    explanation: `A 0.005-point increase projects ${(total * 50) / 1e6} additional J$ cents of seven-day variable-loan interest; collection is uncertain.`,
    assumptions,
  };
}
