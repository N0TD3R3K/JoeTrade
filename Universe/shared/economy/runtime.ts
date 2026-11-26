import {
  newYorkCalendar,
  previewRate,
  previewWeeklyTax,
  weeklyRate,
} from "./policy";
export { previewRate, previewWeeklyTax, weeklyRate };
export const seconds = () => Math.floor(Date.now() / 1000);
const wallFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function newYorkWall(at: number): string {
  return wallFormat.format(new Date(at * 1000)).replace(" ", "T");
}
/** Earlier occurrence on a repeated autumn hour. Gaps advance only for recurrence. */
export function wallToSeconds(wall: string, advanceGap = false): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall))
    throw new RangeError("Use a New York date and time.");
  const nominal = Date.parse(wall + ":00Z") / 1000;
  if (
    !Number.isFinite(nominal) ||
    new Date(nominal * 1000).toISOString().slice(0, 16) !== wall
  )
    throw new RangeError("Invalid calendar date.");
  const candidates = new Set<number>();
  for (const shift of [-86400, 0, 86400]) {
    const sample = nominal + shift;
    const offset =
      Date.parse(newYorkWall(sample) + ":00Z") / 1000 -
      Math.floor(sample / 60) * 60;
    const candidate = nominal - offset;
    if (newYorkWall(candidate) === wall) candidates.add(candidate);
  }
  if (candidates.size) return Math.min(...candidates);
  if (advanceGap)
    for (let minute = 1; minute <= 180; minute++) {
      try {
        return wallToSeconds(
          new Date((nominal + minute * 60) * 1000).toISOString().slice(0, 16),
        );
      } catch {
        /* Try the next wall minute. */
      }
    }
  throw new RangeError(
    "This New York time does not exist because of daylight saving. Choose a valid time.",
  );
}
export function calendar(at = seconds()) {
  return newYorkCalendar(new Date(at * 1000).toISOString());
}
export function addCalendarDays(wall: string, days: number): string {
  return new Date(Date.parse(wall + ":00Z") + days * 86400000)
    .toISOString()
    .slice(0, 16);
}
export function weekBounds(week: string): [number, number] {
  const start = wallToSeconds(week + "T00:00");
  if (calendar(start).weekKey !== week)
    throw new RangeError("Use a Monday week key.");
  return [start, wallToSeconds(addCalendarDays(week + "T00:00", 7))];
}
export function roundRatio(
  value: number,
  numerator: number,
  denominator: number,
): number {
  if (
    ![value, numerator, denominator].every(Number.isSafeInteger) ||
    value < 0 ||
    numerator < 0 ||
    denominator <= 0
  )
    throw new RangeError("Invalid integer ratio.");
  const result = Number(
    (BigInt(value) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) /
      BigInt(denominator),
  );
  if (!Number.isSafeInteger(result))
    throw new RangeError("Amount exceeds supported precision.");
  return result;
}
export function allocate(
  total: number,
  recipients: { id: string; weight: number }[],
): { id: string; amount: number }[] {
  const weight = recipients.reduce((n, r) => n + r.weight, 0);
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !recipients.length ||
    !Number.isSafeInteger(weight) ||
    weight <= 0 ||
    recipients.some((r) => !Number.isSafeInteger(r.weight) || r.weight <= 0) ||
    new Set(recipients.map((r) => r.id)).size !== recipients.length
  )
    throw new RangeError("Invalid allocation.");
  const parts = recipients.map((r) => ({
    id: r.id,
    amount: Number((BigInt(total) * BigInt(r.weight)) / BigInt(weight)),
    remainder: (BigInt(total) * BigInt(r.weight)) % BigInt(weight),
  }));
  parts.sort((a, b) =>
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  const remaining = total - parts.reduce((n, r) => n + r.amount, 0);
  for (let i = 0; i < remaining; i++) parts[i].amount++;
  return parts.map(({ id, amount }) => ({ id, amount }));
}
export interface LoanProduct {
  id: string;
  title: string;
  minimumCents: number;
  maximumCents: number;
  termWeeks: number;
  weeklyRatePpm: number;
  variable: boolean;
  spreadPpm: number;
}
export interface BankingPolicy {
  designVersion: "economy-v2";
  initialRatePpm: number;
  lendingBudgetCents: number;
  redistributionBudgetCents: number;
  openingGrantsEnabled: boolean;
  loans: LoanProduct[];
}
export interface EconomyPolicyRecord {
  id: string;
  version: number;
  state: string;
  rules: BankingPolicy;
}
export interface RateRecord {
  id: string;
  state: string;
  version: number;
  previous_rate_ppm: number;
  next_rate_ppm: number;
  delta_ppm: number;
  requested_effective_at: number;
  actual_effective_at: number | null;
  explanation: string;
  reason_category: string;
}
export interface EconomyStatus {
  revision: number;
  policy: EconomyPolicyRecord | null;
  policies: EconomyPolicyRecord[];
  ratePpm: number | null;
  rateVersion: number;
  reserveCents: number | null;
  reserveCondition: "normal" | "danger" | "uninitialized";
  rateOperations: RateRecord[];
  snapshot: {
    dateKey: string;
    state: string;
    metrics: Record<string, number | string | null>;
    capturedAt: number;
  } | null;
  recommendation: {
    action: "hold" | "insufficient_data" | "increase" | "decrease";
    deltaPpm: number;
    explanation: string;
    assumptions: string[];
  };
  loans: LoanOfferView[];
  assessments: TaxView[];
  members: { id: string; name: string }[];
  outboxPending: number;
}
export interface LoanOfferView {
  id: string;
  customer_id: string;
  state: string;
  principal_cents: number;
  terms_hash: string;
  terms: LoanProduct;
  expires_at: number;
  contract?: {
    id: string;
    principal_outstanding_cents: number;
    interest_due_cents: number;
    state: string;
    dueAt: number;
  };
}
export interface TaxView {
  id: string;
  customer_id: string;
  week_key: string;
  revision: number;
  taxable_cents: number;
  assessed_cents: number;
  basis_complete: number;
  paid_cents: number;
}
export interface MemberEconomy {
  offers: LoanOfferView[];
  subscriptions: {
    id: string;
    title: string;
    state: string;
    next_charge_at: number | null;
    amount_cents: number;
  }[];
  employees: {
    id: string;
    company_name: string;
    allocation_bps: number;
    terms_hash: string;
    state: string;
    employee_pool_bps: number | null;
  }[];
  taxes: TaxView[];
}
export interface CompanyBankReport {
  companyId: string;
  name: string;
  asOf: number;
  checkpoint: string;
  weeklyRevenueCents: number;
  totalRevenueCents: number;
  refundsCents: number;
  wagesCents: number;
  retainedRevenueCents: number;
  operatingCents: number;
  lockedCapitalCents: number;
  manager: boolean;
  employeePoolBps: number | null;
  services?: {
    id: string;
    display_name: string;
    joe_auth_app_id: string;
    state: string;
  }[];
  plans?: {
    id: string;
    title: string;
    amount_cents: number;
    kind: string;
    interval_days: number | null;
    terms_hash: string;
  }[];
  employees?: {
    id: string;
    employee_id: string;
    display_name: string;
    allocation_bps: number;
    state: string;
  }[];
  payments?: {
    id: string;
    amount_cents: number;
    kind: string;
    state: string;
    created_at: number;
    customer_name: string;
  }[];
}
export interface CompanyView {
  id: string;
  ticker: string;
  name: string;
  canPublish: boolean;
  canManage: boolean;
  shareholders: { name: string; quantity: number; percent: number }[];
  marketCapCents: number;
  weeklyChangePercent: number | null;
  bank: CompanyBankReport | null;
  bankError?: string;
}
export interface CompanyPostView {
  id: string;
  asset_id: string;
  author_id: string;
  title: string | null;
  body: string | null;
  state: string;
  version: number;
  created_at: number;
  author_name: string;
  ticker: string;
  canRemove: boolean;
}
