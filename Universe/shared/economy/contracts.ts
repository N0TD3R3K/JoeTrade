import type { Cents, RateChangePpm, UtcInstant, WeeklyRatePpm } from "./policy";
export type OperationState = "pending" | "applied" | "canceled" | "failed";
export type IncomeCategory =
  | "employee_wage"
  | "deposit_interest"
  | "realized_stock_gain"
  | "realized_crypto_gain"
  | "realized_frozen_share_gain"
  | "refund_adjustment"
  | "redistribution"
  | "opening_grant"
  | "loan_principal"
  | "member_wire"
  | "company_revenue"
  | "capital_contribution";
export type EconomyPermission =
  | "bank.rate_policy"
  | "bank.loan_offers"
  | "bank.reserve_policy"
  | "bank.tax_review"
  | "company.manage"
  | "company.post"
  | "company.moderate";
export interface OperationRequest {
  operationId: string;
  policyVersion: string;
  expectedVersion: number;
}
export interface ScheduledRateRequest extends OperationRequest {
  requestedEffectiveAt: UtcInstant;
  deltaPpm: RateChangePpm;
  reasonCategory: "news_event" | "normal_fluctuation";
  explanation: string;
  internalNote: string;
}
export interface RateOperation {
  id: string;
  state: OperationState;
  previousRatePpm: WeeklyRatePpm;
  nextRatePpm: WeeklyRatePpm;
  requestedEffectiveAt: UtcInstant;
  actualEffectiveAt: UtcInstant | null;
  marketEventId: string | null;
  version: number;
}
export type ReserveRecommendation =
  | { kind: "hold" | "insufficient_data"; deltaPpm: null; explanation: string }
  | {
      kind: "review_change";
      deltaPpm: RateChangePpm;
      explanation: string;
      projectedNetInterestCents: number;
      requiresOperatorApproval: true;
    };
export interface CheckoutConsent extends OperationRequest {
  companyId: string;
  serviceId: string;
  planVersion: string;
  amountCents: Cents;
  kind: "purchase" | "subscription";
  intervalDays: number | null;
  termsHash: string;
  returnDestinationId: string;
}
export interface EmployeeAgreement {
  id: string;
  companyId: string;
  employeeCustomerId: string;
  state: "invited" | "accepted" | "ended";
  allocationBps: number;
  acceptedTermsHash: string | null;
}
export interface IncomeEvent {
  id: string;
  customerId: string;
  category: IncomeCategory;
  amountCents: number;
  ledgerTransactionId: string;
  occurredAt: UtcInstant;
  originalEventId: string | null;
}
export interface TaxAssessment {
  id: string;
  customerId: string;
  weekKey: string;
  revision: number;
  taxableIncomeCents: Cents;
  rateBps: number;
  assessedCents: Cents;
  paidCents: Cents;
  state: "assessed" | "partly_paid" | "paid" | "superseded";
  basisComplete: boolean;
}
export interface CompanyReport {
  companyId: string;
  asOf: UtcInstant;
  weekKey: string;
  weeklyRevenueCents: Cents;
  lifetimeRevenueCents: Cents;
  refundsCents: Cents;
  employeePaymentsCents: Cents;
  operatingCashCents: Cents;
  lockedCapitalCents: Cents;
  marketCapitalizationCents: Cents;
  weeklyStockChangePercent: number | null;
  shareholders: Array<{
    memberId: string;
    displayName: string;
    quantityUnits: number;
    ownershipBps: number;
  }>;
}
export interface EconomySnapshot {
  dateKey: string;
  scheduledFor: UtcInstant;
  bankAsOf: UtcInstant;
  exchangeAsOf: UtcInstant;
  status: "provisional" | "reconciled";
  memberCount: number;
  memberPostedCents: Cents;
  memberHeldCents: Cents;
  memberAvailableCents: Cents;
  companyOperatingCents: Cents;
  lockedCapitalCents: Cents;
  feeClearingCents: Cents;
  bankReserveCents: Cents;
  memberAssetValueCents: Cents;
  averageMemberAssetCents: number | null;
  averageMemberPortfolioCents: number | null;
  averageAssetVsOpeningPercent: number | null;
  weeklyTaxReceiptsCents: Cents;
  loanInterestReceivedCents: Cents;
  depositInterestPaidCents: Cents;
}
export interface LoanOfferRequest extends OperationRequest {
  customerId: string;
  principalCents: Cents;
  catalogProductId: string;
  rateKind: "fixed" | "variable";
  weeklyRatePpm: WeeklyRatePpm;
  termDays: number;
  expiresAt: UtcInstant;
  purpose: string;
  termsHash: string;
}
export interface CompanyPost {
  id: string;
  companyId: string;
  authorMemberId: string;
  title: string | null;
  body: string | null;
  state: "published" | "withdrawn" | "deleted";
  createdAt: UtcInstant;
  version: number;
}
/** Proposed future endpoint contract; no Stage 1 routes implement these commands. */
export interface EconomyCommandMap {
  "bank.rate.schedule": ScheduledRateRequest;
  "bank.rate.cancel": OperationRequest & { rateOperationId: string };
  "bank.loan.offer": LoanOfferRequest;
  "bank.checkout.authorize": CheckoutConsent;
  "bank.subscription.cancel": OperationRequest & { subscriptionId: string };
  "bank.payroll.execute": OperationRequest & {
    companyId: string;
    periodKey: string;
  };
  "bank.tax.collect": OperationRequest & {
    assessmentId: string;
    maximumCents: Cents;
  };
  "bank.redistribution.execute": OperationRequest & {
    periodKey: string;
    approvedBudgetCents: Cents;
  };
  "exchange.post.publish": OperationRequest & {
    companyId: string;
    title: string;
    body: string;
  };
  "exchange.post.withdraw": OperationRequest & { postId: string };
  "exchange.post.delete": OperationRequest & { postId: string };
}
export interface EconomyDelivery {
  eventId: string;
  sourceOperationId: string;
  kind:
    "rate.applied" | "commerce.settled" | "commerce.refunded" | "income.posted";
  occurredAt: UtcInstant;
  payload: Record<string, unknown>;
}
