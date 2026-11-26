import { dueItems, attemptJob } from "./jobs";
import type { Customer, Env } from "../env";
import { demoEnabled } from "../auth";
import { ApiError, idempotencyKey, json, readBody } from "../http";
import {
  calendar,
  seconds,
  weekBounds,
  type CompanyBankReport,
} from "../../../shared/economy/runtime";
import {
  bankComponent,
  circulationAction,
  netTaxPaid,
  taxEvidenceCurrent,
  recommendation,
} from "./circulation";
import { activePlan, commerceAction, companyRevenue } from "./commerce";
import {
  all,
  command,
  fail,
  one,
  operator,
  q,
  str,
  type Input,
  type Row,
} from "./core";
import { treasuryAction } from "./treasury";
const internalOnly = new Set([
  "snapshot.capture",
  "snapshot.revise",
  "company.register",
  "income.batch",
  "income.record",
  "income.checkpoint",
  "rate.execute",
  "subscription.renew",
  "loan.accrue",
  "loan.expire",
]);
export async function economyCommand(
  e: Env,
  actor: Customer,
  key: string,
  action: string,
  input: Input,
  now = seconds(),
  internal = false,
) {
  if (internalOnly.has(action) && !internal)
    fail(
      "This command requires a scoped service identity.",
      "SERVICE_ONLY",
      403,
    );
  return command(
    e,
    actor,
    key,
    action,
    input,
    async (c) => {
      if (
        action.startsWith("policy.") ||
        action.startsWith("reserve.") ||
        action.startsWith("grant.") ||
        action.startsWith("rate.") ||
        action.startsWith("loan.") ||
        action === "member.eligibility"
      )
        return treasuryAction(c, action, input).then((result) =>
          result === undefined
            ? fail("Unknown treasury command.", "NOT_FOUND", 404)
            : result,
        );
      if (
        action.startsWith("income.") ||
        action.startsWith("tax.") ||
        action.startsWith("snapshot.") ||
        action.startsWith("redistribution.")
      )
        return circulationAction(c, action, input).then((result) =>
          result === undefined
            ? fail("Unknown circulation command.", "NOT_FOUND", 404)
            : result,
        );
      const result = await commerceAction(c, action, input);
      if (result === undefined)
        fail("Unknown company command.", "NOT_FOUND", 404);
      return result;
    },
    now,
  );
}
async function actorFor(e: Env, id: string, local: boolean) {
  if (local && id === "demo-market-operator")
    await q(
      e,
      "INSERT OR IGNORE INTO bank_customers(id,display_name,username,email,role) VALUES('demo-market-operator','Local economy operator','local-economy-operator','local-economy-operator@example.test','operator')",
    ).run();
  const actor = await one<Customer>(
    e,
    "SELECT * FROM bank_customers WHERE id=? AND status='active'",
    id,
  );
  if (!actor)
    fail(
      "This JoeAuth identity needs a linked banking role.",
      "BANK_ROLE_REQUIRED",
      403,
    );
  return actor!;
}
export async function loanViews(e: Env, customer?: string) {
  const rows = await all(
    e,
    `SELECT o.*,l.id AS contract_id,l.accepted_at AS contract_accepted_at,l.state AS contract_state,l.principal_outstanding_cents,l.interest_due_cents FROM bank_loan_offers o LEFT JOIN bank_loan_contracts l ON l.offer_id=o.id ${customer ? "WHERE o.customer_id=?" : ""} ORDER BY o.rowid DESC LIMIT 100`,
    ...(customer ? [customer] : []),
  );
  return rows.map((o) => ({
    id: o.id,
    customer_id: o.customer_id,
    state: o.state,
    principal_cents: o.principal_cents,
    terms: JSON.parse(o.terms_json),
    terms_hash: o.terms_hash,
    expires_at: o.expires_at,
    ...(o.contract_id
      ? {
          contract: {
            id: o.contract_id,
            state: o.contract_state,
            principal_outstanding_cents: o.principal_outstanding_cents,
            interest_due_cents: o.interest_due_cents,
            dueAt:
              o.contract_accepted_at +
              JSON.parse(o.terms_json).termWeeks * 604800,
          },
        }
      : {}),
  }));
}
export async function taxViews(e: Env, customer?: string) {
  const rows = await all(
    e,
    `SELECT a.* FROM weekly_tax_assessments a WHERE NOT EXISTS(SELECT 1 FROM weekly_tax_assessments next WHERE next.supersedes_id=a.id) ${customer ? "AND a.customer_id=?" : ""} ORDER BY week_key DESC,customer_id LIMIT 100`,
    ...(customer ? [customer] : []),
  );
  return Promise.all(
    rows.map(async (a) => ({
      id: a.id,
      customer_id: a.customer_id,
      week_key: a.week_key,
      revision: a.revision,
      taxable_cents: a.taxable_cents,
      assessed_cents: a.assessed_cents,
      basis_complete: (await taxEvidenceCurrent(e, a)) ? 1 : 0,
      paid_cents: await netTaxPaid(e, a.customer_id, a.week_key),
    })),
  );
}
export async function memberEconomy(e: Env, customer: string) {
  const subscriptions = await all(
    e,
    "SELECT s.id,s.state,s.next_charge_at,p.title,p.amount_cents FROM company_subscriptions s JOIN checkout_authorizations a ON a.id=s.authorization_id JOIN company_plan_versions p ON p.id=a.plan_version_id WHERE a.customer_id=? ORDER BY s.rowid DESC LIMIT 100",
    customer,
  );
  const employees = await all(
    e,
    "SELECT a.id,c.display_name AS company_name,a.allocation_bps,a.terms_hash,a.state,c.employee_pool_bps FROM company_employee_agreements a JOIN economy_companies c ON c.id=a.company_id WHERE a.employee_id=? AND a.state!='ended'",
    customer,
  );
  return {
    offers: await loanViews(e, customer),
    subscriptions,
    employees,
    taxes: await taxViews(e, customer),
  };
}
export async function companyReport(
  e: Env,
  companyId: string,
  actorId: string,
): Promise<CompanyBankReport> {
  const company = await one(
    e,
    "SELECT * FROM economy_companies WHERE id=?",
    companyId,
  );
  if (!company)
    fail(
      "Company banking has not been registered.",
      "COMPANY_NOT_REGISTERED",
      404,
    );
  const manager = Boolean(
      await one(
        e,
        "SELECT 1 FROM economy_company_roles WHERE company_id=? AND customer_id=?",
        companyId,
        actorId,
      ),
    ),
    [start, end] = weekBounds(calendar().weekKey),
    total = await companyRevenue(e, companyId),
    week = await companyRevenue(e, companyId, start, end);
  const cash = await one(
      e,
      "SELECT posted_cents FROM bank_accounts WHERE id=?",
      `company:${companyId}:operating`,
    ),
    capital = await one(
      e,
      "SELECT COALESCE(SUM(contribution_cents),0) AS amount FROM company_capital_attributions WHERE company_id=?",
      companyId,
    ),
    wages = await one(
      e,
      "SELECT COALESCE(SUM(budget_cents),0) AS amount FROM company_payroll_runs WHERE company_id=? AND state='posted'",
      companyId,
    ),
    state = await one(
      e,
      "SELECT revision FROM economy_runtime WHERE singleton=1",
    );
  const report: CompanyBankReport = {
    companyId,
    name: company!.display_name,
    asOf: seconds(),
    checkpoint: String(state!.revision),
    weeklyRevenueCents: week.net,
    totalRevenueCents: total.gross,
    refundsCents: total.refunds,
    wagesCents: wages!.amount,
    retainedRevenueCents: total.net - wages!.amount,
    operatingCents: cash?.posted_cents ?? 0,
    lockedCapitalCents: capital!.amount,
    manager,
    employeePoolBps: manager ? company!.employee_pool_bps : null,
  };
  if (manager) {
    report.services = await all(
      e,
      "SELECT id,display_name,joe_auth_app_id,state FROM company_services WHERE company_id=?",
      companyId,
    );
    report.plans = await all(
      e,
      "SELECT p.id,p.title,p.amount_cents,p.kind,p.interval_days,p.terms_hash FROM company_plan_versions p JOIN company_services s ON s.id=p.service_id WHERE s.company_id=? ORDER BY p.version DESC",
      companyId,
    );
    report.employees = await all(
      e,
      "SELECT a.id,a.employee_id,c.display_name,a.allocation_bps,a.state FROM company_employee_agreements a JOIN bank_customers c ON c.id=a.employee_id WHERE a.company_id=?",
      companyId,
    );
  }
  if (manager)
    report.payments = await all(
      e,
      "SELECT o.id,p.amount_cents,o.kind,o.state,t.created_at,c.display_name AS customer_name FROM commerce_operations o JOIN checkout_authorizations a ON a.id=o.authorization_id JOIN company_plan_versions p ON p.id=a.plan_version_id JOIN company_services s ON s.id=p.service_id JOIN bank_customers c ON c.id=a.customer_id LEFT JOIN ledger_transactions t ON t.id=o.ledger_transaction_id WHERE s.company_id=? ORDER BY o.rowid DESC LIMIT 100",
      companyId,
    );
  return report;
}
export async function snapshotView(e: Env) {
  const snapshot = await one(
    e,
    "SELECT * FROM economy_snapshots ORDER BY date_key DESC LIMIT 1",
  );
  let view = null;
  if (snapshot) {
    const revision = await one(
        e,
        "SELECT * FROM economy_snapshot_revisions WHERE date_key=? ORDER BY revision DESC LIMIT 1",
        snapshot.date_key,
      ),
      value = revision ? JSON.parse(revision.metrics_json) : null;
    view = {
      dateKey: snapshot.date_key,
      state: value?.state ?? snapshot.state,
      metrics: value?.metrics ?? JSON.parse(snapshot.metrics_json),
      capturedAt: revision?.captured_at ?? snapshot.bank_as_of,
    };
  }
  return view;
}
export async function economyStatus(e: Env, actor: Customer) {
  operator(actor);
  const state = (await one(e, "SELECT * FROM economy_runtime"))!,
    policies = (
      await all(
        e,
        "SELECT * FROM economy_policy_versions ORDER BY version DESC LIMIT 20",
      )
    ).map((p) => ({
      id: p.id,
      version: p.version,
      state: p.state,
      rules: JSON.parse(p.rules_json),
    })),
    reserve = await one(
      e,
      "SELECT posted_cents FROM bank_accounts WHERE id='economy-reserve'",
    ),
    rateOperations = await all(
      e,
      "SELECT id,state,version,previous_rate_ppm,next_rate_ppm,delta_ppm,requested_effective_at,actual_effective_at,explanation,reason_category FROM bank_rate_operations ORDER BY requested_effective_at DESC LIMIT 50",
    ),
    snapshot = await one(
      e,
      "SELECT * FROM economy_snapshots ORDER BY date_key DESC LIMIT 1",
    );
  const view = await snapshotView(e);
  return {
    revision: state.revision,
    ratePpm: state.rate_ppm,
    rateVersion: state.rate_version,
    policy: policies.find((p) => p.id === state.active_policy_id) ?? null,
    policies,
    reserveCents: reserve?.posted_cents ?? null,
    reserveCondition: reserve
      ? reserve.posted_cents < 9000000
        ? "danger"
        : "normal"
      : "uninitialized",
    rateOperations,
    snapshot: view,
    recommendation: await recommendation(
      e,
      state.rate_ppm,
      reserve?.posted_cents ?? null,
      seconds(),
    ),
    loans: await loanViews(e),
    assessments: await taxViews(e),
    members: await all(
      e,
      "SELECT id,display_name AS name FROM bank_customers WHERE role='member' AND status='active' ORDER BY display_name",
    ),
    services: await all(
      e,
      "SELECT s.id,s.display_name,s.joe_auth_app_id,s.state,c.display_name AS company_name FROM company_services s JOIN economy_companies c ON c.id=s.company_id",
    ),
    basisHolds: await all(
      e,
      "SELECT h.customer_id,h.week_key,h.source_reference,c.display_name AS member_name FROM economy_basis_holds h JOIN bank_customers c ON c.id=h.customer_id WHERE h.resolved_at IS NULL ORDER BY h.week_key,h.customer_id LIMIT 100",
    ),
    outboxPending: (await one(
      e,
      "SELECT COUNT(*) AS n FROM economy_outbox WHERE delivered_at IS NULL",
    ))!.n,
  };
}
/** Called only after the existing JoeSE server identity has been verified. */
export async function handleEconomyService(r: Request, e: Env) {
  const u = new URL(r.url),
    path = u.pathname.replace("/internal/joese/economy", "");
  if (r.method === "GET") {
    if (path === "/snapshot") return json(await snapshotView(e));
    if (path === "/outbox")
      return json(
        await all(
          e,
          "SELECT * FROM economy_outbox WHERE delivered_at IS NULL ORDER BY created_at,event_id LIMIT 10",
        ),
      );
    if (path === "/component") return json(await bankComponent(e, seconds()));
    if (path === "/rate")
      return json(
        await one(
          e,
          "SELECT rate_ppm AS weekly_rate_ppm,rate_version AS version FROM economy_runtime",
        ),
      );
    if (path.startsWith("/members/"))
      return json(await memberEconomy(e, decodeURIComponent(path.slice(9))));
    if (path.startsWith("/plans/")) {
      const plan = await activePlan(e, decodeURIComponent(path.slice(7)));
      if (!plan) fail("This plan is unavailable.", "NOT_FOUND", 404);
      return json({
        id: plan!.id,
        title: plan!.title,
        terms: plan!.terms,
        terms_hash: plan!.terms_hash,
        kind: plan!.kind,
        amount_cents: plan!.amount_cents,
        interval_days: plan!.interval_days,
        merchant_name: plan!.company_name,
      });
    }
    const actor = await actorFor(
      e,
      str(u.searchParams.get("actor")),
      demoEnabled(r, e),
    );
    if (path === "/status") return json(await economyStatus(e, actor));
    if (path.startsWith("/companies/"))
      return json(
        await companyReport(e, decodeURIComponent(path.slice(11)), actor.id),
      );
  }
  if (r.method === "POST") {
    const b = await readBody(r);
    if (path === "/ack") {
      const event = await one(
        e,
        "SELECT payload_hash FROM economy_outbox WHERE event_id=?",
        str(b.eventId),
      );
      if (!event || event.payload_hash !== b.hash)
        fail("The delivery receipt does not match.");
      await q(
        e,
        "UPDATE economy_outbox SET delivered_at=COALESCE(delivered_at,?),attempts=attempts+1 WHERE event_id=?",
        seconds(),
        str(b.eventId),
      ).run();
      return json({ acknowledged: true });
    }
    const actor =
      b.actorId === "economy-service" &&
      ["income.record", "income.checkpoint"].includes(String(b.action))
        ? { ...schedulerActor, id: "economy-service" }
        : await actorFor(e, str(b.actorId), demoEnabled(r, e));
    if (path === "/commands")
      return json(
        await economyCommand(
          e,
          actor,
          str(b.key),
          str(b.action),
          b.input && typeof b.input === "object" && !Array.isArray(b.input)
            ? (b.input as Input)
            : {},
          seconds(),
          true,
        ),
      );
  }
  fail("Unknown economy service route.", "NOT_FOUND", 404);
}
export async function handleEconomyMember(
  r: Request,
  e: Env,
  actor: Customer,
): Promise<Response | null> {
  const u = new URL(r.url);
  if (!u.pathname.startsWith("/v1/economy")) return null;
  if (r.method === "GET" && u.pathname === "/v1/economy/me")
    return json(await memberEconomy(e, actor.id));
  if (r.method === "GET" && u.pathname === "/v1/economy/console")
    return json(await economyStatus(e, actor));
  if (r.method === "GET" && u.pathname.startsWith("/v1/economy/plans/")) {
    const plan = await activePlan(
      e,
      decodeURIComponent(u.pathname.slice("/v1/economy/plans/".length)),
    );
    if (!plan) fail("This plan is unavailable.", "NOT_FOUND", 404);
    return json({
      id: plan!.id,
      title: plan!.title,
      terms: plan!.terms,
      terms_hash: plan!.terms_hash,
      kind: plan!.kind,
      amount_cents: plan!.amount_cents,
      interval_days: plan!.interval_days,
      merchant_name: plan!.company_name,
    });
  }
  if (r.method === "POST" && u.pathname === "/v1/economy/commands") {
    const b = await readBody(r);
    return json(
      await economyCommand(
        e,
        actor,
        idempotencyKey(r),
        str(b.action),
        b.input && typeof b.input === "object" ? (b.input as Input) : {},
      ),
    );
  }
  throw new ApiError(404, "NOT_FOUND", "This economy route is unavailable.");
}
export const schedulerActor: Customer = {
  id: "economy-scheduler",
  joe_auth_user_id: null,
  display_name: "Economy scheduler",
  email: "",
  username: "",
  role: "administrator",
  status: "active",
};
export async function runEconomyJobs(e: Env, now = seconds()) {
  const run = (key: string, action: string, input: Input) =>
    economyCommand(e, schedulerActor, key, action, input, now, true);
  const hash = async (value: string) => (await import("../http")).sha256(value);
  const runtime = await one(e, "SELECT active_policy_id FROM economy_runtime");
  if (runtime?.active_policy_id) {
    for (const op of await all(
      e,
      "SELECT id AS item_id,id FROM bank_rate_operations WHERE state='pending' AND requested_effective_at<=? ORDER BY requested_effective_at,id LIMIT 2",
      now,
    ))
      await attemptJob(e, "rates", op, now, () =>
        run(`rate_due_${op.id}`, "rate.execute", { id: op.id }),
      );
    for (const sub of await dueItems(
      e,
      "renewals",
      "SELECT id AS item_id,id,next_period_key FROM company_subscriptions WHERE state='active' AND next_charge_at<=?",
      [now],
    ))
      await attemptJob(e, "renewals", sub, now, async () =>
        run(
          `renew_${await hash(sub.id + ":" + sub.next_period_key)}`,
          "subscription.renew",
          { id: sub.id },
        ),
      );
    for (const loan of await dueItems(
      e,
      "accruals",
      "SELECT id AS item_id,id,accrual_checkpoint FROM bank_loan_contracts WHERE state='active' AND accrual_checkpoint<?",
      [now - 3600],
    ))
      await attemptJob(e, "accruals", loan, now, async () =>
        run(
          `accrue_${await hash(loan.id + ":" + loan.accrual_checkpoint)}`,
          "loan.accrue",
          { id: loan.id },
        ),
      );
    for (const offer of await dueItems(
      e,
      "expiries",
      "SELECT id AS item_id,id FROM bank_loan_offers WHERE state='offered' AND expires_at<=?",
      [now],
    ))
      await attemptJob(e, "expiries", offer, now, () =>
        run(`expire_${offer.id}`, "loan.expire", { id: offer.id }),
      );
    const [weekStart] = weekBounds(calendar(now).weekKey),
      lastWeek = calendar(weekStart - 1).weekKey;
    for (const company of await dueItems(
      e,
      "payroll",
      "SELECT c.id AS item_id,c.id FROM economy_companies c WHERE c.state='active' AND c.employee_pool_bps IS NOT NULL AND NOT EXISTS(SELECT 1 FROM company_payroll_runs r WHERE r.company_id=c.id AND r.period_key=?)",
      [lastWeek],
    ))
      await attemptJob(e, "payroll", company, now, async () =>
        run(
          `payroll_${await hash(company.id + ":" + lastWeek)}`,
          "payroll.run",
          { companyId: company.id, week: lastWeek },
        ),
      );
    const checkpoint = await one(
      e,
      "SELECT complete_through FROM economy_exchange_checkpoint",
    );
    if (checkpoint && checkpoint.complete_through >= weekStart) {
      for (const member of await dueItems(
        e,
        "assessments",
        "SELECT c.id AS item_id,c.id FROM bank_customers c WHERE c.role='member' AND c.status='active' AND NOT EXISTS(SELECT 1 FROM weekly_tax_assessments a WHERE a.customer_id=c.id AND a.week_key=?)",
        [lastWeek],
      ))
        await attemptJob(e, "assessments", member, now, async () =>
          run(
            `assess_${await hash(member.id + ":" + lastWeek)}`,
            "tax.assess",
            { customerId: member.id, week: lastWeek },
          ),
        );
      const unpaid = await dueItems(
        e,
        "collections",
        `SELECT a.id AS item_id,a.id,a.customer_id,a.assessed_cents,
    (SELECT COALESCE(SUM(c.amount_cents),0) FROM tax_collections c JOIN weekly_tax_assessments x ON x.id=c.assessment_id WHERE x.customer_id=a.customer_id AND x.week_key=a.week_key)-(SELECT COALESCE(SUM(r.amount_cents),0) FROM tax_refunds r JOIN weekly_tax_assessments x ON x.id=r.assessment_id WHERE x.customer_id=a.customer_id AND x.week_key=a.week_key) AS paid_cents,
    b.available_cents FROM weekly_tax_assessments a JOIN account_balances b ON b.customer_id=a.customer_id AND b.account_kind='transaction' JOIN bank_customers c ON c.id=a.customer_id WHERE a.basis_complete=1 AND c.status='active' AND b.available_cents>0 AND NOT EXISTS(SELECT 1 FROM weekly_tax_assessments n WHERE n.supersedes_id=a.id) AND a.assessed_cents>paid_cents`,
      );
      for (const assessment of unpaid)
        await attemptJob(e, "collections", assessment, now, async () =>
          run(
            `collect_${await hash(assessment.id + ":" + assessment.paid_cents + ":" + assessment.available_cents)}`,
            "tax.collect",
            { id: assessment.id },
          ),
        );
    }
  }
  const today = calendar(now);
  if (
    today.hour >= 12 &&
    !(await one(
      e,
      "SELECT 1 FROM economy_snapshots WHERE date_key=?",
      today.dateKey,
    ))
  )
    await run(`noon_${today.dateKey}`, "snapshot.capture", {});
}

/** Prepared exchange plans deliver through their existing durable settlement path. */
export async function settleEconomyDelivery(r: Request, e: Env, b: Input) {
  const id = str(b.id),
    action = b.action;
  if (action === "income_batch")
    return economyCommand(
      e,
      { ...schedulerActor, id: "economy-service" },
      id,
      "income.batch",
      b.input as Input,
      seconds(),
      true,
    );
  if (action === "economy_snapshot") {
    const actor =
      b.actor_id === "economy-service"
        ? { ...schedulerActor, id: "economy-service" }
        : await actorFor(e, str(b.actor_id), demoEnabled(r, e));
    return economyCommand(
      e,
      actor,
      id,
      b.revise === true ? "snapshot.revise" : "snapshot.capture",
      b.input as Input,
      seconds(),
      true,
    );
  }
  fail("Unknown economy delivery.", "NOT_FOUND", 404);
}
