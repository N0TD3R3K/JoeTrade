/** Stage 1 pure contracts. No persistence, posting, scheduling or approval. */
export const ECONOMY_DESIGN_VERSION = "stage1-2026-11-25" as const;
export const MARKET_TIME_ZONE = "America/New_York" as const;
export const OPENING_GRANT_CENTS = 1_000_000;
export const BANK_RESERVE_INITIAL_CENTS = 10_000_000;
export const BANK_RESERVE_WARNING_CENTS = 9_000_000;
export const RATE_LIMITS = Object.freeze({
  minimumPpm: 3_000,
  maximumPpm: 20_000,
  stepPpm: 50,
  maximumChangePpm: 2_000,
  weeklyChanges: 2,
});
export type Cents = number & { readonly __unit: "J$ cents" };
export type WeeklyRatePpm = number & { readonly __unit: "weekly rate ppm" };
export type RateChangePpm = number & {
  readonly __unit: "signed rate change ppm";
};
export type UtcInstant = string & { readonly __unit: "UTC instant" };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Use non-negative safe integer cents.");
  return value as Cents;
}
export function weeklyRate(value: number): WeeklyRatePpm {
  if (
    !Number.isSafeInteger(value) ||
    value < RATE_LIMITS.minimumPpm ||
    value > RATE_LIMITS.maximumPpm
  )
    throw new RangeError("Weekly Joe Rate must be 0.300%–2.000%.");
  return value as WeeklyRatePpm;
}
export function rateChange(value: number): RateChangePpm {
  if (
    !Number.isSafeInteger(value) ||
    value === 0 ||
    Math.abs(value) > RATE_LIMITS.maximumChangePpm ||
    value % RATE_LIMITS.stepPpm !== 0
  )
    throw new RangeError(
      "Use nonzero signed 0.005 percentage-point steps, up to 0.200.",
    );
  return value as RateChangePpm;
}
export function previewRate(
  currentPpm: number,
  deltaPpm: number,
): WeeklyRatePpm {
  return weeklyRate(weeklyRate(currentPpm) + rateChange(deltaPpm));
}
export function utcInstant(value: string): UtcInstant {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new RangeError("Use a valid canonical UTC instant.");
  return value as UtcInstant;
}
/** Calendar keys only: never convert New York midnight using a fixed UTC offset. */
export function newYorkCalendar(instant: string): {
  dateKey: string;
  weekKey: string;
  hour: number;
  minute: number;
} {
  utcInstant(instant);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const [year, month, day] = [
    Number(part("year")),
    Number(part("month")),
    Number(part("day")),
  ];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  calendar.setUTCDate(calendar.getUTCDate() - ((calendar.getUTCDay() + 6) % 7));
  return {
    dateKey: `${part("year")}-${part("month")}-${part("day")}`,
    weekKey: calendar.toISOString().slice(0, 10),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}
/** Flat whole-income bracket, per Dev_Note. Preview only; not a tax assessment. */
export function previewWeeklyTax(taxableIncomeCents: number): {
  incomeCents: Cents;
  rateBps: number;
  taxCents: Cents;
} {
  const incomeCents = cents(taxableIncomeCents);
  const rateBps =
    incomeCents <= 50_000
      ? 0
      : incomeCents <= 200_000
        ? 200
        : incomeCents <= 350_000
          ? 300
          : incomeCents <= 500_000
            ? 500
            : 1_000;
  const taxCents = cents(
    Number((BigInt(incomeCents) * BigInt(rateBps) + 5_000n) / 10_000n),
  );
  return { incomeCents, rateBps, taxCents };
}
export function reserveCondition(reserveCents: number): "normal" | "danger" {
  return cents(reserveCents) < BANK_RESERVE_WARNING_CENTS ? "danger" : "normal";
}
export function valueChangePercent(
  current: number,
  reference: number,
): number | null {
  cents(current);
  cents(reference);
  return reference === 0 ? null : (current / reference - 1) * 100;
}

export type EconomyFeature =
  | "companyBilling"
  | "payroll"
  | "taxCollection"
  | "redistribution"
  | "rateOperations"
  | "loans"
  | "companyPosts"
  | "economySnapshots";
/** Not a security boundary: Stage 2 must enforce each entitlement on the server. */
export const STAGE_ONE_CAPABILITIES: Readonly<
  Record<EconomyFeature, { available: false; reason: string }>
> = Object.freeze({
  companyBilling: {
    available: false,
    reason:
      "Company accounts and member-authorized checkout are planned for Stage 2.",
  },
  payroll: {
    available: false,
    reason: "Employee agreements and funded payout policies are not connected.",
  },
  taxCollection: {
    available: false,
    reason:
      "Income events, exact cost basis and tax collection are not connected.",
  },
  redistribution: {
    available: false,
    reason:
      "Reserve initialization and a funded distribution policy are not connected.",
  },
  rateOperations: {
    available: false,
    reason:
      "Rate policy, entitlement and scheduled operations are not connected.",
  },
  loans: {
    available: false,
    reason:
      "A bank loan policy catalog and member acceptance are not connected.",
  },
  companyPosts: {
    available: false,
    reason:
      "Company eligibility and publishing/moderation APIs are planned for Stage 2.",
  },
  economySnapshots: {
    available: false,
    reason: "The shared-cutoff bank/exchange snapshot is not connected.",
  },
});
