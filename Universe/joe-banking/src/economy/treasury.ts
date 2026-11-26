import { requireReserve } from "./core";
import {
  calendar,
  previewRate,
  wallToSeconds,
  weeklyRate,
  seconds,
} from "../../../shared/economy/runtime";
import {
  BANK_RESERVE_INITIAL_CENTS,
  OPENING_GRANT_CENTS,
} from "../../../shared/economy/policy";
import { sha256 } from "../http";
import {
  account,
  add,
  all,
  audit,
  fail,
  income,
  integer,
  internalAccount,
  one,
  operator,
  outbox,
  policy,
  post,
  str,
  validatePolicy,
  type Context,
  type Input,
  type Row,
} from "./core";
export async function treasuryAction(
  c: Context,
  action: string,
  b: Input,
): Promise<unknown> {
  const { e } = c;
  if (action === "policy.draft") {
    operator(c.actor);
    const rules = validatePolicy(b.rules),
      v = await one(
        e,
        "SELECT COALESCE(MAX(version),0)+1 AS v FROM economy_policy_versions",
      );
    add(
      c,
      "INSERT INTO economy_policy_versions(id,version,state,rules_json) VALUES(?,?,'draft',?)",
      c.id,
      v!.v,
      JSON.stringify(rules),
    );
    return { id: c.id, version: v!.v, state: "draft" };
  }
  if (action === "policy.approve") {
    operator(c.actor);
    const id = str(b.id),
      p = await one(
        e,
        "SELECT * FROM economy_policy_versions WHERE id=? AND state='draft'",
        id,
      );
    if (!p) fail("Select a draft policy.");
    validatePolicy(JSON.parse(p!.rules_json));
    if (
      c.state.active_policy_id &&
      (await one(
        e,
        "SELECT id FROM bank_rate_operations WHERE state='pending' LIMIT 1",
      ))
    )
      fail("Cancel pending rate operations before replacing the policy.");
    add(
      c,
      "UPDATE economy_policy_versions SET state='approved',approved_by=?,approved_at=? WHERE id=?",
      c.actor.id,
      c.now,
      id,
    );
    add(
      c,
      "UPDATE economy_runtime SET active_policy_id=? WHERE singleton=1",
      id,
    );
    if (c.state.rate_ppm === null) {
      const r = JSON.parse(p!.rules_json).initialRatePpm;
      add(
        c,
        "UPDATE economy_runtime SET rate_ppm=?,rate_version=1,rate_checkpoint=? WHERE singleton=1",
        r,
        c.now,
      );
      add(
        c,
        "INSERT INTO economy_rate_history(version,rate_ppm,effective_at) VALUES(1,?,?)",
        r,
        c.now,
      );
    }
    return { id, state: "approved" };
  }
  const p = await policy(c);
  if (action === "reserve.initialize") {
    operator(c.actor);
    if (await one(e, "SELECT 1 FROM bank_reserve_initializations"))
      fail("The opening reserve has already been initialized.");
    internalAccount(c, "economy-reserve", "bank_reserve");
    internalAccount(c, "economy-issuance", "issuance");
    const ledger = post(
      c,
      "opening-reserve",
      "reserve_initialization",
      "Approved opening bank reserve",
      [
        { account: "economy-issuance", amount: -BANK_RESERVE_INITIAL_CENTS },
        { account: "economy-reserve", amount: BANK_RESERVE_INITIAL_CENTS },
      ],
    );
    add(
      c,
      "INSERT INTO bank_reserve_initializations(singleton,initial_cents,policy_id,ledger_transaction_id) VALUES(1,?,?,?)",
      BANK_RESERVE_INITIAL_CENTS,
      p.id,
      ledger,
    );
    return { id: c.id, amountCents: BANK_RESERVE_INITIAL_CENTS };
  }
  if (action === "member.eligibility") {
    operator(c.actor);
    const a = await account(e, str(b.customerId)),
      subject = str(b.subject, "verified JoeAuth subject", 180),
      evidence = str(b.evidence, "review evidence", 500);
    const customer = await one(
      e,
      "SELECT * FROM bank_customers WHERE id=?",
      a.customer_id,
    );
    if (!customer!.joe_auth_user_id || customer!.joe_auth_user_id !== subject)
      fail("Link the verified JoeAuth identity before approving eligibility.");
    add(
      c,
      "INSERT INTO economy_member_eligibility(customer_id,joe_auth_subject,evidence_reference,approved_by,approved_at) VALUES(?,?,?,?,?)",
      a.customer_id,
      subject,
      evidence,
      c.actor.id,
      c.now,
    );
    return { id: a.customer_id, eligible: true };
  }
  if (action === "grant.reconcile" || action === "grant.issue") {
    operator(c.actor);
    const customer = str(b.customerId),
      a = await account(e, customer),
      eligible = await one(
        e,
        "SELECT * FROM economy_member_eligibility WHERE customer_id=?",
        customer,
      );
    if (!eligible)
      fail(
        "Review and approve this member’s identity and existing grant history first.",
      );
    if (
      await one(
        e,
        "SELECT 1 FROM economy_grants WHERE customer_id=? OR joe_auth_subject=?",
        customer,
        eligible!.joe_auth_subject,
      )
    )
      fail("This member already has a recorded opening grant.");
    let ledger: string;
    if (action === "grant.reconcile") {
      ledger = str(b.ledgerId);
      const old = await one(
        e,
        "SELECT t.id,SUM(l.amount_cents) AS amount FROM ledger_transactions t JOIN ledger_lines l ON l.transaction_id=t.id WHERE t.id=? AND t.state='posted' AND l.account_id=? AND t.transaction_type IN ('opening_grant','demo_opening','economy_opening_grant') GROUP BY t.id",
        ledger,
        a.id,
      );
      if (!old || old.amount !== OPENING_GRANT_CENTS)
        fail(
          "The selected opening journal does not prove a J$10,000 grant to this member.",
        );
    } else {
      if (!p.rules.openingGrantsEnabled)
        fail("Opening grants are disabled by the approved policy.");
      if (
        a.posted_cents !== 0 ||
        (await one(
          e,
          "SELECT 1 FROM ledger_lines WHERE account_id=? LIMIT 1",
          a.id,
        ))
      )
        fail(
          "Existing accounts require grant reconciliation; no automatic new grant is allowed.",
        );
      internalAccount(c, "economy-issuance", "issuance");
      ledger = post(
        c,
        "opening-grant",
        "opening_grant",
        "Approved member opening balance",
        [
          { account: "economy-issuance", amount: -OPENING_GRANT_CENTS },
          { account: a.id, amount: OPENING_GRANT_CENTS },
        ],
      );
      income(c, customer, "opening_grant", OPENING_GRANT_CENTS, ledger);
    }
    add(
      c,
      "INSERT INTO economy_grants(joe_auth_subject,customer_id,grant_kind,policy_id,ledger_transaction_id) VALUES(?,?,'opening_member',?,?)",
      eligible!.joe_auth_subject,
      customer,
      p.id,
      ledger,
    );
    return { id: ledger, status: "recorded" };
  }
  if (action === "rate.schedule") {
    operator(c.actor);
    if (integer(b.policyVersion, "policy version", 1) !== p.version)
      fail("The approved policy changed. Refresh before scheduling.");
    const effective = wallToSeconds(
      str(b.effectiveLocal, "New York operation date", 16),
    );
    if (effective < c.now - 120)
      fail("Choose the current or a future New York date and time.");
    const pending = await all(
      e,
      "SELECT * FROM bank_rate_operations WHERE state='pending' ORDER BY requested_effective_at,id",
    );
    if (pending.some((o) => o.requested_effective_at >= effective))
      fail(
        "Schedule after the last pending rate operation, or cancel it first.",
      );
    const previous = pending.length
      ? pending[pending.length - 1].next_rate_ppm
      : c.state.rate_ppm;
    const delta = integer(b.deltaPpm, "signed rate change", -2000, 2000),
      next = previewRate(previous, delta),
      week = calendar(Math.max(c.now, effective)).weekKey;
    const slots = await all(
      e,
      "SELECT slot FROM bank_rate_week_slots WHERE week_key=?",
      week,
    );
    const slot = [1, 2].find((x) => !slots.some((s) => s.slot === x));
    if (!slot)
      fail(
        "Both rate changes for this New York week are already used or scheduled.",
      );
    const reason =
        b.reasonCategory === "news_event" ? "news_event" : "normal_fluctuation",
      explanation = str(b.explanation, "public explanation", 2000),
      note =
        typeof b.internalNote === "string" ? b.internalNote.slice(0, 2000) : "";
    const op: Row = {
      id: c.id,
      policy_id: p.id,
      actor_id: c.actor.id,
      previous_rate_ppm: previous,
      next_rate_ppm: next,
      delta_ppm: delta,
      expected_rate_version: c.state.rate_version + pending.length,
      requested_effective_at: effective,
      explanation,
      reason_category: reason,
    };
    add(
      c,
      "INSERT INTO bank_rate_operations(id,policy_id,actor_id,expected_policy_version,expected_rate_version,delta_ppm,previous_rate_ppm,next_rate_ppm,requested_effective_at,state,reason_category,explanation,internal_note) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?)",
      c.id,
      p.id,
      c.actor.id,
      p.version,
      op.expected_rate_version,
      delta,
      previous,
      next,
      effective,
      reason,
      explanation,
      note,
    );
    add(
      c,
      "INSERT INTO bank_rate_week_slots(week_key,slot,operation_id) VALUES(?,?,?)",
      week,
      slot,
      c.id,
    );
    if (effective <= c.now) await applyRate(c, op);
    return {
      id: c.id,
      state: effective <= c.now ? "applied" : "pending",
      previousRatePpm: previous,
      nextRatePpm: next,
    };
  }
  if (action === "rate.cancel") {
    operator(c.actor);
    const id = str(b.id),
      op = await one(
        e,
        "SELECT * FROM bank_rate_operations WHERE id=? AND state='pending'",
        id,
      );
    if (!op) fail("Only a pending rate operation can be canceled.");
    add(
      c,
      "UPDATE bank_rate_operations SET state='canceled',version=version+1 WHERE id=?",
      id,
    );
    add(c, "DELETE FROM bank_rate_week_slots WHERE operation_id=?", id);
    return { id, state: "canceled" };
  }
  if (action === "rate.execute") {
    const op = await one(
      e,
      "SELECT * FROM bank_rate_operations WHERE id=? AND state='pending'",
      str(b.id),
    );
    if (!op) return { state: "already_resolved" };
    if (op.requested_effective_at > c.now)
      fail("This rate operation is not due.");
    const actualWeek = calendar(c.now).weekKey,
      slot = await one(
        e,
        "SELECT * FROM bank_rate_week_slots WHERE operation_id=?",
        op.id,
      );
    if (
      op.policy_id !== p.id ||
      op.previous_rate_ppm !== c.state.rate_ppm ||
      op.expected_rate_version !== c.state.rate_version
    ) {
      add(
        c,
        "UPDATE bank_rate_operations SET state='failed',version=version+1 WHERE id=?",
        op.id,
      );
      add(c, "DELETE FROM bank_rate_week_slots WHERE operation_id=?", op.id);
      audit(c, "rate.sequence_failed", { id: op.id });
      return {
        id: op.id,
        state: "failed",
        reason: "Policy or rate sequence changed; reschedule explicitly.",
      };
    }
    if (slot?.week_key !== actualWeek) {
      const used = await all(
          e,
          "SELECT slot FROM bank_rate_week_slots WHERE week_key=?",
          actualWeek,
        ),
        free = [1, 2].find((x) => !used.some((s) => s.slot === x));
      add(c, "DELETE FROM bank_rate_week_slots WHERE operation_id=?", op.id);
      if (!free) {
        add(
          c,
          "UPDATE bank_rate_operations SET state='failed',version=version+1 WHERE id=?",
          op.id,
        );
        return {
          id: op.id,
          state: "failed",
          reason: "Actual execution week quota is full.",
        };
      }
      add(
        c,
        "INSERT INTO bank_rate_week_slots(week_key,slot,operation_id) VALUES(?,?,?)",
        actualWeek,
        free,
        op.id,
      );
    }
    await applyRate(c, op);
    return { id: op.id, state: "applied" };
  }
  if (action === "loan.offer") {
    operator(c.actor);
    const customer = str(b.customerId),
      a = await account(e, customer),
      product = p.rules.loans.find((x) => x.id === b.productId);
    if (!product) fail("Choose a product from the approved loan catalog.");
    const principal = integer(
        b.principalCents,
        "principal",
        product!.minimumCents,
        product!.maximumCents,
      ),
      expires = integer(b.expiresAt, "expiry", c.now + 60, c.now + 30 * 86400);
    const terms = {
        ...product!,
        weeklyRatePpm: product!.variable
          ? c.state.rate_ppm! + product!.spreadPpm
          : product!.weeklyRatePpm,
      },
      termsJson = JSON.stringify(terms),
      hash = await sha256(termsJson);
    add(
      c,
      "INSERT INTO bank_loan_offers(id,customer_id,policy_id,product_id,principal_cents,terms_json,terms_hash,expires_at,version,state) VALUES(?,?,?,?,?,?,?,?,1,'offered')",
      c.id,
      a.customer_id,
      p.id,
      product!.id,
      principal,
      termsJson,
      hash,
      expires,
    );
    await outbox(c, "loan.offered", { customerId: customer, offerId: c.id });
    return { id: c.id, state: "offered", termsHash: hash };
  }
  if (action === "loan.expire") {
    const id = str(b.id),
      offer = await one(
        e,
        "SELECT * FROM bank_loan_offers WHERE id=? AND state='offered' AND expires_at<=?",
        id,
        c.now,
      );
    if (!offer) return { state: "already_resolved" };
    add(c, "UPDATE bank_loan_offers SET state='expired' WHERE id=?", id);
    return { id, state: "expired" };
  }
  if (action === "loan.withdraw" || action === "loan.decline") {
    const o = await one(
      e,
      "SELECT * FROM bank_loan_offers WHERE id=? AND state='offered'",
      str(b.id),
    );
    if (!o) fail("This loan offer is no longer available.");
    if (action === "loan.withdraw") operator(c.actor);
    else if (o!.customer_id !== c.actor.id)
      fail("This offer belongs to another member.", "FORBIDDEN", 403);
    const state = action === "loan.withdraw" ? "withdrawn" : "declined";
    add(c, "UPDATE bank_loan_offers SET state=? WHERE id=?", state, o!.id);
    return { id: o!.id, state };
  }
  if (action === "loan.accept") {
    await requireReserve(c);
    const o = await one(
      e,
      "SELECT * FROM bank_loan_offers WHERE id=? AND customer_id=? AND state='offered'",
      str(b.id),
      c.actor.id,
    );
    if (!o || o.expires_at <= c.now || o.policy_id !== p.id)
      fail("This loan offer expired or its policy changed.");
    if (str(b.termsHash) !== o!.terms_hash)
      fail("Accept the exact displayed loan terms.", "TERMS_CHANGED");
    const offeredTerms = JSON.parse(o!.terms_json);
    if (
      offeredTerms.variable &&
      offeredTerms.weeklyRatePpm !== c.state.rate_ppm! + offeredTerms.spreadPpm
    )
      fail(
        "The variable starting rate changed before acceptance. Request a refreshed exact offer.",
        "TERMS_CHANGED",
      );
    const outstanding = await one(
      e,
      "SELECT COALESCE(SUM(principal_outstanding_cents),0) AS amount FROM bank_loan_contracts WHERE state='active'",
    );
    if (outstanding!.amount + o!.principal_cents > p.rules.lendingBudgetCents)
      fail("The approved lending budget is exhausted.");
    const a = await account(e, c.actor.id),
      receivable = `${c.id}:receivable`,
      obligation = `${c.id}:obligation`;
    internalAccount(c, receivable);
    internalAccount(c, obligation);
    const ledger = post(
      c,
      "disbursement",
      "loan_disbursement",
      "Accepted reserve-funded bank loan",
      [
        { account: "economy-reserve", amount: -o!.principal_cents },
        { account: a.id, amount: o!.principal_cents },
        { account: receivable, amount: o!.principal_cents },
        { account: obligation, amount: -o!.principal_cents },
      ],
    );
    add(c, "UPDATE bank_loan_offers SET state='accepted' WHERE id=?", o!.id);
    add(
      c,
      "INSERT INTO bank_loan_contracts(id,offer_id,accepted_terms_hash,accepted_at,disbursement_transaction_id,state,accrual_checkpoint,principal_outstanding_cents,receivable_account_id,obligation_account_id) VALUES(?,?,?,?,?,'active',?,?,?,?)",
      c.id,
      o!.id,
      o!.terms_hash,
      c.now,
      ledger,
      c.now,
      o!.principal_cents,
      receivable,
      obligation,
    );
    income(c, c.actor.id, "loan_principal", o!.principal_cents, ledger);
    return { id: c.id, state: "active" };
  }
  if (action === "loan.accrue") {
    const loan = await one(
      e,
      "SELECT l.*,o.terms_json FROM bank_loan_contracts l JOIN bank_loan_offers o ON o.id=l.offer_id WHERE l.id=? AND l.state='active'",
      str(b.id),
    );
    if (!loan) return { state: "already_resolved" };
    await accrueLoan(c, loan);
    return { id: loan.id, state: "accrued" };
  }
  if (action === "loan.repay") {
    const loan = await one(
      e,
      "SELECT l.*,o.customer_id,o.terms_json FROM bank_loan_contracts l JOIN bank_loan_offers o ON o.id=l.offer_id WHERE l.id=? AND o.customer_id=? AND l.state='active'",
      str(b.id),
      c.actor.id,
    );
    if (!loan) fail("Your active loan was not found.");
    const accrued = await accrueLoan(c, loan!),
      amount = integer(
        b.amountCents,
        "repayment",
        1,
        loan!.principal_outstanding_cents + accrued.interest,
      ),
      interest = Math.min(amount, accrued.interest),
      principal = amount - interest,
      a = await account(e, c.actor.id);
    const lines = [
      { account: a.id, amount: -amount },
      { account: "economy-reserve", amount },
    ];
    if (principal)
      lines.push(
        { account: loan!.receivable_account_id, amount: -principal },
        { account: loan!.obligation_account_id, amount: principal },
      );
    const ledger = post(
      c,
      "repayment",
      "loan_repayment",
      "Bank loan repayment",
      lines,
    );
    add(
      c,
      "INSERT INTO bank_loan_payments(id,loan_id,principal_cents,interest_cents,ledger_transaction_id) VALUES(?,?,?,?,?)",
      c.id,
      loan!.id,
      principal,
      interest,
      ledger,
    );
    const remaining = loan!.principal_outstanding_cents - principal,
      interestRemaining = accrued.interest - interest;
    add(
      c,
      "UPDATE bank_loan_contracts SET principal_outstanding_cents=?,interest_due_cents=?,state=? WHERE id=?",
      remaining,
      interestRemaining,
      remaining === 0 && interestRemaining === 0 ? "repaid" : "active",
      loan!.id,
    );
    return { id: c.id, principalCents: principal, interestCents: interest };
  }
  return undefined;
}
async function applyRate(c: Context, op: Row) {
  for (const loan of await all(
    c.e,
    "SELECT l.*,o.terms_json FROM bank_loan_contracts l JOIN bank_loan_offers o ON o.id=l.offer_id WHERE l.state='active'",
  ))
    await accrueLoan(c, loan);
  add(
    c,
    "UPDATE bank_rate_operations SET state='applied',actual_effective_at=?,version=version+1 WHERE id=?",
    c.now,
    op.id,
  );
  add(
    c,
    "UPDATE economy_runtime SET rate_ppm=?,rate_version=rate_version+1,rate_checkpoint=? WHERE singleton=1",
    op.next_rate_ppm,
    c.now,
  );
  add(
    c,
    "INSERT INTO economy_rate_history(version,operation_id,rate_ppm,effective_at) VALUES(?,?,?,?)",
    c.state.rate_version + 1,
    op.id,
    op.next_rate_ppm,
    c.now,
  );
  await outbox(
    c,
    "rate.applied",
    {
      operationId: op.id,
      previousRatePpm: op.previous_rate_ppm,
      nextRatePpm: op.next_rate_ppm,
      deltaPpm: op.delta_ppm,
      effectiveAt: c.now,
      scheduledFor: op.requested_effective_at,
      direction: op.delta_ppm < 0 ? "bullish" : "bearish",
      explanation: op.explanation,
      reasonCategory: op.reason_category,
    },
    op.id,
  );
}
export async function accrueLoan(c: Context, loan: Row) {
  if (loan.accrual_checkpoint >= c.now)
    return { interest: loan.interest_due_cents };
  const terms = JSON.parse(loan.terms_json),
    history = await all(
      c.e,
      "SELECT * FROM economy_rate_history WHERE effective_at<=? ORDER BY effective_at,version",
      c.now,
    );
  const changes = terms.variable
    ? history.filter((r) => r.effective_at > loan.accrual_checkpoint)
    : [];
  let cursor = loan.accrual_checkpoint,
    numerator = BigInt(loan.remainder_numerator),
    rate = terms.variable
      ? (history.filter((r) => r.effective_at <= cursor).at(-1)?.rate_ppm ??
          terms.weeklyRatePpm - terms.spreadPpm) + terms.spreadPpm
      : terms.weeklyRatePpm;
  for (const point of [
    ...changes,
    { effective_at: c.now, rate_ppm: rate - terms.spreadPpm },
  ]) {
    numerator +=
      BigInt(loan.principal_outstanding_cents) *
      BigInt(rate) *
      BigInt(point.effective_at - cursor);
    cursor = point.effective_at;
    rate = point.rate_ppm + terms.spreadPpm;
  }
  const denominator = 604800000000n,
    amount = Number(numerator / denominator),
    remainder = String(numerator % denominator);
  add(
    c,
    "INSERT INTO bank_loan_accruals(id,loan_id,from_at,to_at,amount_cents,rate_version,remainder_numerator) VALUES(?,?,?,?,?,?,?)",
    `${c.id}:accrual:${loan.id}`,
    loan.id,
    loan.accrual_checkpoint,
    c.now,
    amount,
    c.state.rate_version,
    remainder,
  );
  add(
    c,
    "UPDATE bank_loan_contracts SET interest_due_cents=interest_due_cents+?,accrual_checkpoint=?,remainder_numerator=? WHERE id=?",
    amount,
    c.now,
    remainder,
    loan.id,
  );
  return { interest: loan.interest_due_cents + amount };
}
