import {
  addCalendarDays,
  allocate,
  calendar,
  newYorkWall,
  roundRatio,
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
  internalAccount,
  one,
  operator,
  outbox,
  policy,
  post,
  requireManager,
  str,
  type Context,
  type Input,
  type Row,
} from "./core";
export async function registerCompany(c: Context, b: Input) {
  const id = str(b.assetId),
    owner = await account(c.e, str(b.ownerId)),
    name = str(b.name, "company name", 180);
  const existing = await one(
    c.e,
    "SELECT * FROM economy_companies WHERE exchange_asset_id=?",
    id,
  );
  if (existing) return { id: existing.id, state: existing.state };
  add(
    c,
    "INSERT INTO economy_companies(id,exchange_asset_id,state,display_name) VALUES(?,?,'active',?)",
    id,
    id,
    name,
  );
  internalAccount(c, `company:${id}:operating`, "company_operating", id);
  add(
    c,
    "INSERT INTO economy_company_roles(company_id,customer_id,role) VALUES(?,?,'manager')",
    id,
    owner.customer_id,
  );
  if (typeof b.capitalLedgerId === "string") {
    const capital = await one(
      c.e,
      "SELECT t.id,SUM(l.amount_cents) AS amount FROM ledger_transactions t JOIN ledger_lines l ON l.transaction_id=t.id WHERE t.id=? AND t.transaction_type='exchange_capital' AND t.state='posted' AND l.account_id='joese-capital' GROUP BY t.id",
      b.capitalLedgerId,
    );
    if (!capital || capital.amount <= 0)
      fail("A posted founding-capital journal is required for attribution.");
    add(
      c,
      "INSERT INTO company_capital_attributions(company_id,ledger_transaction_id,contribution_cents,evidence_reference) VALUES(?,?,?,?)",
      id,
      capital.id,
      capital.amount,
      `exchange:${id}`,
    );
  }
  return { id, state: "active" };
}
export async function commerceAction(
  c: Context,
  action: string,
  b: Input,
): Promise<unknown> {
  const { e } = c;
  if (action === "company.register") return registerCompany(c, b);
  const p = await policy(c);
  if (action === "service.request") {
    const companyId = str(b.companyId);
    await requireManager(c, companyId);
    add(
      c,
      "INSERT INTO company_services(id,company_id,joe_auth_app_id,state,callback_destination_id,display_name) VALUES(?,?,?,'pending','authenticated-pull',?)",
      c.id,
      companyId,
      str(b.appId, "JoeAuth service app ID", 180),
      str(b.name, "service name", 120),
    );
    return { id: c.id, state: "pending" };
  }
  if (action === "service.approve" || action === "service.suspend") {
    operator(c.actor);
    const id = str(b.id);
    if (!(await one(e, "SELECT 1 FROM company_services WHERE id=?", id)))
      fail("The requested service was not found.");
    const state = action === "service.approve" ? "active" : "suspended";
    add(c, "UPDATE company_services SET state=? WHERE id=?", state, id);
    return { id, state };
  }
  if (action === "plan.create") {
    const service = await one(
      e,
      "SELECT * FROM company_services WHERE id=? AND state='active'",
      str(b.serviceId),
    );
    if (!service) fail("An approved active service is required.");
    await requireManager(c, service!.company_id);
    const amount = integer(b.amountCents, "plan price", 1),
      kind =
        b.kind === "subscription"
          ? "subscription"
          : b.kind === "purchase"
            ? "purchase"
            : fail("Select purchase or subscription."),
      interval =
        kind === "subscription"
          ? integer(b.intervalDays, "calendar-day interval", 1, 366)
          : null;
    const title = str(b.title, "plan title", 120),
      terms = str(b.terms, "checkout terms", 3000),
      version = (await one(
        e,
        "SELECT COALESCE(MAX(version),0)+1 AS v FROM company_plan_versions WHERE service_id=?",
        service!.id,
      ))!.v;
    const hash = await sha256(
      JSON.stringify({
        serviceId: service!.id,
        title,
        terms,
        amount,
        kind,
        interval,
        version,
        policyId: p.id,
      }),
    );
    add(
      c,
      "INSERT INTO company_plan_versions(id,service_id,version,kind,amount_cents,interval_days,terms_hash,policy_id,title,terms) VALUES(?,?,?,?,?,?,?,?,?,?)",
      c.id,
      service!.id,
      version,
      kind,
      amount,
      interval,
      hash,
      p.id,
      title,
      terms,
    );
    return { id: c.id, termsHash: hash };
  }
  if (action === "checkout.accept") {
    await account(e, c.actor.id);
    const plan = await activePlan(e, str(b.planId));
    if (!plan || plan.policy_id !== p.id)
      fail("This plan is unavailable under the current policy.");
    if (b.termsHash !== plan.terms_hash || b.consent !== true)
      fail(
        "Read and accept the exact displayed payment terms.",
        "CONSENT_REQUIRED",
        400,
      );
    const available = await account(e, c.actor.id);
    if (available.available_cents < plan.amount_cents)
      fail("Available funds are too low.", "INSUFFICIENT_FUNDS");
    add(
      c,
      "INSERT INTO checkout_authorizations(id,customer_id,plan_version_id,terms_hash,consent_at,expires_at,state) VALUES(?,?,?,?,?,?,'consumed')",
      c.id,
      c.actor.id,
      plan.id,
      plan.terms_hash,
      c.now,
      c.now + 3600,
    );
    const subscription =
        plan.kind === "subscription" ? `${c.id}:subscription` : null,
      anchor = newYorkWall(c.now),
      next = plan.interval_days
        ? addCalendarDays(anchor, plan.interval_days)
        : null;
    if (subscription)
      add(
        c,
        "INSERT INTO company_subscriptions(id,authorization_id,state,next_charge_at,anchor_local,next_period_key) VALUES(?,?,'active',?,?,?)",
        subscription,
        c.id,
        wallToSeconds(next!, true),
        anchor,
        next!,
      );
    await charge(c, plan, c.id, subscription, "initial", "purchase");
    return { id: c.id, state: "posted", subscriptionId: subscription };
  }
  if (action === "subscription.cancel") {
    const sub = await one(
      e,
      "SELECT s.* FROM company_subscriptions s JOIN checkout_authorizations a ON a.id=s.authorization_id WHERE s.id=? AND a.customer_id=?",
      str(b.id),
      c.actor.id,
    );
    if (!sub) fail("Your subscription was not found.");
    if (sub!.state === "canceled") return { id: sub!.id, state: "canceled" };
    add(
      c,
      "UPDATE company_subscriptions SET state='canceled',canceled_at=?,next_charge_at=NULL,version=version+1 WHERE id=?",
      c.now,
      sub!.id,
    );
    const terms = await one(
      e,
      "SELECT p.service_id FROM checkout_authorizations a JOIN company_plan_versions p ON p.id=a.plan_version_id WHERE a.id=?",
      sub!.authorization_id,
    );
    await outbox(c, "subscription.canceled", {
      subscriptionId: sub!.id,
      customerId: c.actor.id,
      serviceId: terms!.service_id,
    });
    return { id: sub!.id, state: "canceled" };
  }
  if (action === "subscription.renew" || action === "subscription.retry") {
    const sub = await one(
      e,
      "SELECT s.*,a.customer_id,a.plan_version_id FROM company_subscriptions s JOIN checkout_authorizations a ON a.id=s.authorization_id WHERE s.id=?",
      str(b.id),
    );
    if (!sub || !["active", "past_due"].includes(sub.state))
      fail("This subscription is not active.");
    if (action === "subscription.retry" && sub!.customer_id !== c.actor.id)
      fail("This subscription belongs to another member.", "FORBIDDEN", 403);
    if (
      action === "subscription.renew" &&
      (sub!.state !== "active" || sub!.next_charge_at > c.now)
    )
      fail("The subscription is not due.");
    if (sub!.state === "past_due" && action !== "subscription.retry")
      fail("An explicit member retry is required.");
    const plan = await activePlan(e, sub!.plan_version_id),
      payer = await account(e, sub!.customer_id);
    if (
      !plan ||
      plan.policy_id !== p.id ||
      payer.available_cents < plan.amount_cents
    ) {
      add(
        c,
        "UPDATE company_subscriptions SET state='past_due',version=version+1 WHERE id=?",
        sub!.id,
      );
      await outbox(
        c,
        "subscription.past_due",
        {
          subscriptionId: sub!.id,
          customerId: sub!.customer_id,
          serviceId: plan?.service_id ?? null,
          period: sub!.next_period_key,
        },
        `${sub!.id}:${sub!.next_period_key}`,
      );
      return { id: sub!.id, state: "past_due" };
    }
    await charge(
      c,
      plan,
      sub!.authorization_id,
      sub!.id,
      sub!.next_period_key,
      "renewal",
      sub!.customer_id,
    );
    const anchor =
      action === "subscription.retry"
        ? newYorkWall(c.now)
        : sub!.next_period_key;
    let next = addCalendarDays(anchor, plan.interval_days!);
    // Delayed jobs charge one contractual period; skip missed periods instead of catch-up billing.
    while (wallToSeconds(next, true) <= c.now)
      next = addCalendarDays(next, plan.interval_days!);
    add(
      c,
      "UPDATE company_subscriptions SET state='active',next_charge_at=?,next_period_key=?,version=version+1 WHERE id=?",
      wallToSeconds(next, true),
      next,
      sub!.id,
    );
    return { id: sub!.id, state: "active" };
  }
  if (action === "payment.refund") {
    const original = await one(
      e,
      "SELECT o.*,a.customer_id,p.amount_cents,p.service_id,s.company_id FROM commerce_operations o JOIN checkout_authorizations a ON a.id=o.authorization_id JOIN company_plan_versions p ON p.id=a.plan_version_id JOIN company_services s ON s.id=p.service_id WHERE o.id=? AND o.kind!='refund' AND o.state='posted'",
      str(b.id),
    );
    if (!original) fail("Select a settled payment.");
    await requireManager(c, original!.company_id);
    const refund = await one(
      e,
      "SELECT * FROM commerce_operations WHERE original_operation_id=? AND kind='refund'",
      original!.id,
    );
    if (refund?.state === "posted") return { id: refund.id, state: "posted" };
    const cash = await one(
        e,
        "SELECT * FROM account_balances WHERE id=?",
        `company:${original!.company_id}:operating`,
      ),
      id = refund?.id ?? `${original!.id}:refund`,
      a = await account(e, original!.customer_id);
    if (!refund)
      add(
        c,
        "INSERT INTO commerce_operations(id,authorization_id,period_key,kind,original_operation_id,request_hash,state) VALUES(?,?,?,'refund',?,?,'pending')",
        id,
        original!.authorization_id,
        original!.period_key,
        original!.id,
        await sha256(original!.id),
      );
    if (cash!.available_cents < original!.amount_cents)
      return {
        id,
        state: "pending",
        reason:
          "The company needs sufficient operating funds; no employee wage is clawed back.",
      };
    const ledger = post(
      c,
      "refund",
      "commerce_refund",
      "Company service full refund",
      [
        { account: cash!.id, amount: -original!.amount_cents },
        { account: a.id, amount: original!.amount_cents },
      ],
    );
    add(
      c,
      "UPDATE commerce_operations SET state='posted',ledger_transaction_id=? WHERE id=?",
      ledger,
      id,
    );
    await outbox(
      c,
      "payment.refunded",
      {
        operationId: id,
        originalOperationId: original!.id,
        serviceId: original!.service_id,
        customerId: original!.customer_id,
        amountCents: original!.amount_cents,
      },
      id,
    );
    return { id, state: "posted" };
  }
  if (action === "company.pool") {
    const companyId = str(b.companyId);
    await requireManager(c, companyId);
    if (
      await one(
        e,
        "SELECT 1 FROM company_employee_agreements WHERE company_id=? AND state IN ('invited','accepted') LIMIT 1",
        companyId,
      )
    )
      fail(
        "End existing agreements before changing the employee pool; employees must accept new terms.",
      );
    const pool = integer(b.poolBps, "employee revenue pool", 0, 10000);
    add(
      c,
      "UPDATE economy_companies SET employee_pool_bps=? WHERE id=?",
      pool,
      companyId,
    );
    return { id: companyId, poolBps: pool };
  }
  if (action === "employee.invite") {
    const company = await requireManager(c, str(b.companyId)),
      requested = str(b.employeeId),
      target = await one(
        e,
        "SELECT id FROM bank_customers WHERE (id=? OR username=? COLLATE NOCASE) AND role='member' AND status='active'",
        requested,
        requested,
      );
    if (!target) fail("The employee member was not found.");
    const employee = await account(e, target!.id);
    if (company.employee_pool_bps === null)
      fail("Configure the company employee pool first.");
    const allocation = integer(
        b.allocationBps,
        "employee allocation weight",
        1,
        10000,
      ),
      version = (await one(
        e,
        "SELECT COALESCE(MAX(version),0)+1 AS v FROM company_employee_agreements WHERE company_id=? AND employee_id=?",
        company.id,
        employee.customer_id,
      ))!.v;
    const hash = await sha256(
      JSON.stringify({
        companyId: company.id,
        employeeId: employee.customer_id,
        poolBps: company.employee_pool_bps,
        allocationBps: allocation,
        version,
      }),
    );
    add(
      c,
      "INSERT INTO company_employee_agreements(id,company_id,employee_id,version,allocation_bps,terms_hash,state) VALUES(?,?,?,?,?,?,'invited')",
      c.id,
      company.id,
      employee.customer_id,
      version,
      allocation,
      hash,
    );
    return { id: c.id, termsHash: hash };
  }
  if (action === "employee.accept" || action === "employee.end") {
    const agreement = await one(
      e,
      "SELECT * FROM company_employee_agreements WHERE id=?",
      str(b.id),
    );
    if (!agreement) fail("The employee agreement was not found.");
    if (action === "employee.accept") {
      if (
        agreement!.employee_id !== c.actor.id ||
        agreement!.state !== "invited" ||
        b.termsHash !== agreement!.terms_hash
      )
        fail(
          "Accept your own current agreement and exact terms.",
          "FORBIDDEN",
          403,
        );
      add(
        c,
        "UPDATE company_employee_agreements SET state='accepted',accepted_at=? WHERE id=?",
        c.now,
        agreement!.id,
      );
    } else {
      if (agreement!.employee_id !== c.actor.id)
        await requireManager(c, agreement!.company_id);
      add(
        c,
        "UPDATE company_employee_agreements SET state='ended' WHERE id=?",
        agreement!.id,
      );
    }
    return {
      id: agreement!.id,
      state: action === "employee.accept" ? "accepted" : "ended",
    };
  }
  if (action === "payroll.run") {
    const companyId = str(b.companyId),
      company = await one(
        e,
        "SELECT * FROM economy_companies WHERE id=? AND state='active'",
        companyId,
      );
    if (!company) fail("The company is not active.");
    if (c.actor.role === "member") await requireManager(c, companyId);
    else operator(c.actor);
    const period = str(b.week, "closed revenue week", 10),
      [start, end] = weekBounds(period);
    if (end > c.now) fail("Payroll requires a closed revenue week.");
    if (
      await one(
        e,
        "SELECT id FROM company_payroll_runs WHERE company_id=? AND period_key=?",
        companyId,
        period,
      )
    )
      fail("This revenue week already has a payroll run.");
    const employees = await all(
      e,
      "SELECT a.*,b.id AS account_id FROM company_employee_agreements a JOIN bank_accounts b ON b.customer_id=a.employee_id AND b.account_kind='transaction' JOIN bank_customers m ON m.id=a.employee_id WHERE a.company_id=? AND a.state='accepted' AND m.status='active'",
      companyId,
    );
    if (
      company!.employee_pool_bps === null ||
      employees.reduce((n, a) => n + a.allocation_bps, 0) !== 10000
    )
      fail(
        "Accepted employee weights must total 100%; configure the employee pool.",
      );
    const revenue = await companyRevenue(e, companyId, start, end),
      lifetime = await companyRevenue(e, companyId),
      prior = (await one(
        e,
        "SELECT COALESCE(SUM(budget_cents),0) AS amount FROM company_payroll_runs WHERE company_id=? AND state='posted'",
        companyId,
      ))!.amount;
    const budget = Math.min(
        roundRatio(Math.max(0, revenue.net), company!.employee_pool_bps, 10000),
        Math.max(0, lifetime.net - prior),
      ),
      cash = await one(
        e,
        "SELECT * FROM account_balances WHERE id=?",
        `company:${companyId}:operating`,
      );
    if (cash!.available_cents < budget)
      fail(
        "The company cannot currently fund its employee allocation.",
        "INSUFFICIENT_FUNDS",
      );
    add(
      c,
      "INSERT INTO company_payroll_runs(id,company_id,period_key,policy_id,revenue_cutoff_at,employee_pool_bps,budget_cents,state,gross_revenue_cents) VALUES(?,?,?,?,?,?,?,'posted',?)",
      c.id,
      companyId,
      period,
      p.id,
      end,
      company!.employee_pool_bps,
      budget,
      revenue.net,
    );
    const allocation = budget
      ? allocate(
          budget,
          employees.map((a) => ({ id: a.id, weight: a.allocation_bps })),
        )
      : [];
    for (const line of allocation.filter((x) => x.amount > 0)) {
      const employee = employees.find((a) => a.id === line.id)!;
      const ledger = post(
        c,
        `wage:${employee.id}`,
        "employee_wage",
        "Company employee revenue payment",
        [
          { account: cash!.id, amount: -line.amount },
          { account: employee.account_id, amount: line.amount },
        ],
      );
      add(
        c,
        "INSERT INTO company_payroll_lines(run_id,agreement_id,amount_cents,ledger_transaction_id) VALUES(?,?,?,?)",
        c.id,
        employee.id,
        line.amount,
        ledger,
      );
      income(c, employee.employee_id, "employee_wage", line.amount, ledger, {
        companyId,
        revenueWeek: period,
      });
    }
    await outbox(c, "payroll.posted", {
      companyId,
      runId: c.id,
      amountCents: budget,
    });
    return { id: c.id, state: "posted", amountCents: budget };
  }
  return undefined;
}
export async function activePlan(e: Context["e"], id: string) {
  return one(
    e,
    "SELECT p.*,s.company_id,s.state AS service_state,s.display_name AS merchant_name,c.display_name AS company_name FROM company_plan_versions p JOIN company_services s ON s.id=p.service_id JOIN economy_companies c ON c.id=s.company_id WHERE p.id=? AND s.state='active' AND c.state='active'",
    id,
  );
}
async function charge(
  c: Context,
  plan: Row,
  authorizationId: string,
  subscriptionId: string | null,
  period: string,
  kind: string,
  customer = c.actor.id,
) {
  const payer = await account(c.e, customer),
    ledger = post(
      c,
      "payment",
      "commerce_payment",
      `${plan.company_name}: ${plan.title}`,
      [
        { account: payer.id, amount: -plan.amount_cents },
        {
          account: `company:${plan.company_id}:operating`,
          amount: plan.amount_cents,
        },
      ],
    );
  add(
    c,
    "INSERT INTO commerce_operations(id,authorization_id,subscription_id,period_key,kind,request_hash,state,ledger_transaction_id) VALUES(?,?,?,?,?,?,'posted',?)",
    c.id,
    authorizationId,
    subscriptionId,
    period,
    kind,
    await sha256(`${authorizationId}:${period}:${plan.terms_hash}`),
    ledger,
  );
  await outbox(c, "payment.posted", {
    operationId: c.id,
    serviceId: plan.service_id,
    customerId: customer,
    planId: plan.id,
    subscriptionId,
    period,
    amountCents: plan.amount_cents,
    paidAt: c.now,
  });
}
export async function companyRevenue(
  e: Context["e"],
  companyId: string,
  start = 0,
  end = Number.MAX_SAFE_INTEGER,
) {
  const rows = await all(
    e,
    `SELECT o.kind,p.amount_cents,t.created_at,original_t.created_at AS original_at FROM commerce_operations o JOIN checkout_authorizations a ON a.id=o.authorization_id JOIN company_plan_versions p ON p.id=a.plan_version_id JOIN company_services s ON s.id=p.service_id JOIN ledger_transactions t ON t.id=o.ledger_transaction_id LEFT JOIN commerce_operations original ON original.id=o.original_operation_id LEFT JOIN ledger_transactions original_t ON original_t.id=original.ledger_transaction_id WHERE s.company_id=? AND o.state='posted'`,
    companyId,
  );
  let gross = 0,
    refunds = 0;
  for (const r of rows) {
    const at = r.kind === "refund" ? r.original_at : r.created_at;
    if (at >= start && at < end) {
      if (r.kind === "refund") refunds += r.amount_cents;
      else gross += r.amount_cents;
    }
  }
  return { gross, refunds, net: gross - refunds };
}
