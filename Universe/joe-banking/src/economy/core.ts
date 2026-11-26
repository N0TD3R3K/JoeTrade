import type { Customer, Env } from "../env";
import { ApiError, sha256, textField } from "../http";
import type {
  BankingPolicy,
  LoanProduct,
} from "../../../shared/economy/runtime";
import { seconds, weeklyRate } from "../../../shared/economy/runtime";
export type Row = Record<string, any>;
export type Input = Record<string, unknown>;
export type Sql = D1PreparedStatement;
export interface State {
  revision: number;
  active_policy_id: string | null;
  rate_ppm: number | null;
  rate_version: number;
  rate_checkpoint: number | null;
}
export interface Context {
  e: Env;
  actor: Customer;
  id: string;
  now: number;
  state: State;
  sql: Sql[];
}
export const q = (e: Env, sql: string, ...params: (string | number | null)[]) =>
  e.DB.prepare(sql).bind(...params);
export async function all<T = Row>(
  e: Env,
  sql: string,
  ...params: (string | number | null)[]
): Promise<T[]> {
  return (await q(e, sql, ...params).all<T>()).results;
}
export async function one<T = Row>(
  e: Env,
  sql: string,
  ...params: (string | number | null)[]
): Promise<T | null> {
  return q(e, sql, ...params).first<T>();
}
export function fail(
  message: string,
  code = "ECONOMY_NOT_ALLOWED",
  status = 409,
): never {
  throw new ApiError(status, code, message);
}
export function integer(
  v: unknown,
  name: string,
  min = 0,
  max = 1_000_000_000_000,
): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    fail(`Provide valid ${name}.`, "INVALID_FIELD", 400);
  return v;
}
export const str = (v: unknown, name = "reference", max = 128) =>
  textField(v, name, max);
export function operator(a: Customer) {
  if (!["operator", "administrator"].includes(a.role) || a.status !== "active")
    fail("An active banking operator is required.", "OPERATOR_REQUIRED", 403);
}
export async function member(e: Env, id: string): Promise<Customer> {
  const a = await one<Customer>(
    e,
    "SELECT * FROM bank_customers WHERE id=? AND role='member' AND status='active'",
    id,
  );
  if (!a) fail("The active banking member is unavailable.");
  return a;
}
export async function account(e: Env, customerId: string) {
  await member(e, customerId);
  const a = await one(
    e,
    "SELECT * FROM account_balances WHERE customer_id=? AND account_kind='transaction'",
    customerId,
  );
  if (!a) fail("The member transaction account is unavailable.");
  return a!;
}
export function add(c: Context, sql: string, ...p: (string | number | null)[]) {
  c.sql.push(q(c.e, sql, ...p));
}
export function audit(c: Context, action: string, details: unknown = {}) {
  add(
    c,
    "INSERT INTO economy_audit_events(id,operation_id,actor_id,action,occurred_at,details_json) VALUES(?,?,?,?,?,?)",
    `${c.id}:audit:${c.sql.length}`,
    c.id,
    c.actor.id,
    action,
    c.now,
    JSON.stringify(details),
  );
}
export function internalAccount(
  c: Context,
  id: string,
  purpose?: string,
  companyId: string | null = null,
) {
  add(
    c,
    "INSERT OR IGNORE INTO bank_accounts(id,account_kind) VALUES(?,'internal_clearing')",
    id,
  );
  if (purpose)
    add(
      c,
      "INSERT OR IGNORE INTO economy_accounts(account_id,company_id,purpose) VALUES(?,?,?)",
      id,
      companyId,
      purpose,
    );
}
export function post(
  c: Context,
  reference: string,
  type: string,
  description: string,
  lines: { account: string; amount: number }[],
): string {
  const id = `${c.id}:${reference}`;
  if (
    lines.length < 2 ||
    lines.reduce((s, l) => s + l.amount, 0) !== 0 ||
    lines.some(
      (l) =>
        !Number.isSafeInteger(l.amount) ||
        l.amount === 0 ||
        Math.abs(l.amount) > 1e12,
    )
  )
    fail("The journal must balance.", "INVALID_JOURNAL");
  add(
    c,
    "INSERT INTO ledger_transactions(id,transaction_type,business_reference,description,actor_id,created_at) VALUES(?,?,?,?,?,?)",
    id,
    `economy_${type}`,
    id,
    description,
    c.actor.id,
    c.now,
  );
  lines.forEach((l, i) =>
    add(
      c,
      "INSERT INTO ledger_lines(id,transaction_id,account_id,amount_cents) VALUES(?,?,?,?)",
      `${id}:${i}`,
      id,
      l.account,
      l.amount,
    ),
  );
  add(c, "UPDATE ledger_transactions SET state='posted' WHERE id=?", id);
  return id;
}
export async function outbox(
  c: Context,
  kind: string,
  payload: Row,
  reference = c.id,
) {
  const value = JSON.stringify(payload);
  add(
    c,
    "INSERT INTO economy_outbox(event_id,source_operation_id,kind,payload_json,payload_hash,created_at) VALUES(?,?,?,?,?,?)",
    `${reference}:${kind}`,
    reference,
    kind,
    value,
    await sha256(value),
    c.now,
  );
}
export function income(
  c: Context,
  customer: string,
  category: string,
  amount: number,
  reference: string,
  evidence: unknown = {},
  occurredAt = c.now,
  source = "bank",
) {
  add(
    c,
    "INSERT INTO economy_income_events(id,customer_id,source_system,source_reference,category,amount_cents,occurred_at,evidence_json) VALUES(?,?,?,?,?,?,?,?)",
    `${reference}:${customer}:${category}`,
    customer,
    source,
    reference,
    category,
    amount,
    occurredAt,
    JSON.stringify(evidence),
  );
}
export async function policy(c: Context) {
  const p = await one(
    c.e,
    "SELECT * FROM economy_policy_versions WHERE id=? AND state='approved'",
    c.state.active_policy_id,
  );
  if (!p)
    fail(
      "Approve a banking policy before enabling this feature.",
      "POLICY_REQUIRED",
    );
  return {
    id: p!.id as string,
    version: p!.version as number,
    rules: JSON.parse(p!.rules_json) as BankingPolicy,
  };
}
export async function requireManager(c: Context, companyId: string) {
  const company = await one(
    c.e,
    "SELECT * FROM economy_companies WHERE id=? AND state='active'",
    companyId,
  );
  if (!company) fail("The company is not active.");
  if (
    !(await one(
      c.e,
      "SELECT 1 FROM economy_company_roles WHERE company_id=? AND customer_id=?",
      companyId,
      c.actor.id,
    ))
  )
    fail("A company manager permission is required.", "MANAGER_REQUIRED", 403);
  return company!;
}
export function validatePolicy(v: unknown): BankingPolicy {
  if (!v || typeof v !== "object")
    fail("Provide a policy configuration.", "INVALID_POLICY", 400);
  const p = v as Row;
  if (
    p.designVersion !== "economy-v2" ||
    typeof p.openingGrantsEnabled !== "boolean" ||
    !Array.isArray(p.loans) ||
    p.loans.length > 20
  )
    fail("Use the supported economy-v2 policy.", "INVALID_POLICY", 400);
  try {
    weeklyRate(p.initialRatePpm);
  } catch (e) {
    fail(String(e), "INVALID_POLICY", 400);
  }
  const ids = new Set<string>();
  const loans: LoanProduct[] = p.loans.map((v: Row) => {
    const id = str(v.id, "product ID", 60);
    if (ids.has(id))
      fail("Loan product IDs must be unique.", "INVALID_POLICY", 400);
    ids.add(id);
    const minimumCents = integer(v.minimumCents, "minimum principal", 1),
      maximumCents = integer(v.maximumCents, "maximum principal", minimumCents);
    if (typeof v.variable !== "boolean")
      fail("Specify fixed or variable interest.", "INVALID_POLICY", 400);
    const spreadPpm = integer(v.spreadPpm, "rate spread", 0, 100000),
      weeklyRatePpm = integer(
        v.weeklyRatePpm,
        "weekly product rate",
        0,
        100000,
      );
    if (v.variable && weeklyRatePpm !== p.initialRatePpm + spreadPpm)
      fail(
        "A variable rate must equal the Joe Rate plus its spread.",
        "INVALID_POLICY",
        400,
      );
    return {
      id,
      title: str(v.title, "product title", 120),
      minimumCents,
      maximumCents,
      termWeeks: integer(v.termWeeks, "term weeks", 1, 52),
      weeklyRatePpm,
      variable: v.variable,
      spreadPpm,
    };
  });
  return {
    designVersion: "economy-v2",
    initialRatePpm: p.initialRatePpm,
    lendingBudgetCents: integer(p.lendingBudgetCents, "lending budget"),
    redistributionBudgetCents: integer(
      p.redistributionBudgetCents,
      "redistribution budget",
    ),
    openingGrantsEnabled: p.openingGrantsEnabled,
    loans,
  };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const o = value as Input;
  return (
    "{" +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
      .join(",") +
    "}"
  );
}
export async function command(
  e: Env,
  actor: Customer,
  key: string,
  action: string,
  input: Input,
  plan: (c: Context) => Promise<unknown>,
  now = seconds(),
) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key))
    fail("Provide a stable operation reference.", "IDEMPOTENCY_REQUIRED", 400);
  const id = `economy_${await sha256(actor.id + ":" + key)}`,
    hash = await sha256(canonical({ action, input }));
  const replay = async () => {
    const old = await one(e, "SELECT * FROM economy_commands WHERE id=?", id);
    if (old) {
      if (old.request_hash !== hash)
        fail(
          "This operation reference was used with different terms.",
          "IDEMPOTENCY_CONFLICT",
        );
      return { found: true, value: JSON.parse(old.response_json) };
    }
    return { found: false, value: null };
  };
  const previous = await replay();
  if (previous.found) return previous.value;
  const state = (await one<State>(
    e,
    "SELECT * FROM economy_runtime WHERE singleton=1",
  ))!;
  const c: Context = { e, actor, id, now, state, sql: [] };
  let result: unknown;
  try {
    result = await plan(c);
  } catch (error) {
    if (error instanceof RangeError) fail(error.message, "INVALID_FIELD", 400);
    throw error;
  }
  audit(c, action, { reference: id });
  try {
    await e.DB.batch([
      q(
        e,
        "INSERT INTO economy_commands(id,actor_id,request_hash,revision,response_json,created_at) VALUES(?,?,?,?,?,?)",
        id,
        actor.id,
        hash,
        state.revision + 1,
        JSON.stringify(result ?? {}),
        now,
      ),
      ...c.sql,
    ]);
  } catch (error) {
    const saved = await replay();
    if (saved.found) return saved.value;
    const text = String(error);
    if (/INSUFFICIENT/.test(text))
      fail(
        "Available funds are too low. Existing holds and locked capital cannot be spent.",
        "INSUFFICIENT_FUNDS",
      );
    if (/MEMBER_UNAVAILABLE/.test(text))
      fail("A banking member is frozen or unavailable.", "MEMBER_UNAVAILABLE");
    if (/CAPITAL_LOCKED/.test(text))
      fail("Company founding capital remains locked.", "CAPITAL_LOCKED");
    if (/ECONOMY_CONFLICT|UNIQUE|unchanged=1/.test(text))
      fail(
        "Another operation changed these records. Refresh and try again.",
        "ECONOMY_CONFLICT",
      );
    throw error;
  }
  return result;
}

export async function requireReserve(c: Context) {
  if (
    !(await one(
      c.e,
      "SELECT 1 FROM bank_reserve_initializations WHERE singleton=1",
    ))
  )
    fail(
      "Initialize the approved bank reserve before this operation.",
      "RESERVE_REQUIRED",
    );
}
