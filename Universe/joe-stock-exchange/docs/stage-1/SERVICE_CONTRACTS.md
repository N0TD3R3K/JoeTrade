# Proposed Stage 2 service and database contracts

**No endpoints in this page are enabled by Stage 1.** The current supported API
remains the running `/v1/openapi.json`. Shared request/response types are in
`Universe/shared/economy/`; the `EconomyCommandMap` defines planned command bodies.
Do not add draft commands to live OpenAPI as though they already work.

## Boundaries and authorization

The member and staff sites retain same-origin `/v1` proxies, separate JoeAuth
clients/sessions, exact Origin and CSRF checks. Banking must validate its own
entitlement for rate, loan, reserve, tax and company actions. Exchange/global
operator status is not proof of Banking authority. A company app credential can
request only approved plans of its own company; it cannot choose a debtor,
recipient account, amount or unconsented recurrence from browser fields.

| Planned surface | Method/path | Required authority and effect |
| --- | --- | --- |
| Member company reports | GET `/v1/me/companies`, `/v1/companies/{id}/report` | Current developer/shareholder; aggregate payload with no private customer details. |
| Company posts | GET/POST `/v1/company-posts` | Member read; publish checks actual developer/current settled holding for supplied company. |
| Remove post | POST `/v1/company-posts/{id}/withdraw` or `/delete` | Author or scoped moderator; expected version, reason/audit; body tombstone on deletion. |
| Company management | GET/POST `/v1/companies/{id}/employees` and `/services` | Explicit manager scope; accepted employee agreement required for payroll. |
| Checkout | POST `/v1/commerce/authorizations` | Member consent to immutable plan/terms; no cash on mere merchant link. |
| Payment/renewal | Internal Banking commerce command | Active consent, exact plan version, period ID, available funds; ledger post then outbox. |
| Cancel subscription | POST `/v1/subscriptions/{id}/cancel` | Owning member, expected version; no charge for later periods. |
| Banking overview | GET `/v1/console/bank/snapshot` | Banking reporting entitlement; cutoff/status and separate money buckets. |
| Rates | GET/POST `/v1/console/bank/rate-operations` | Rate-policy entitlement, approved policy, quota/version/sequence checks. |
| Cancel rate | POST `/v1/console/bank/rate-operations/{id}/cancel` | Rate-policy entitlement; pending state transition only. |
| Loan offers | POST `/v1/console/bank/loan-offers` | Banking lender entitlement and approved catalog; no money yet. |
| Loan acceptance | POST `/v1/bank/loan-offers/{id}/accept` | Named member accepts exact terms hash/version; one reserve-funded balanced disbursement. |
| Tax/payroll/distribution | Restricted Banking commands | Versioned funded policy; stable run/assessment/period and recipient IDs. |
| Economy event | Internal exchange receipt route | Allowlisted service identity, signature/hash, source operation and event deduplication. |

Writes carry stable `Idempotency-Key`, expected version and policy version.
Identity and monetary amounts are validated server-side, not accepted from UI
capability flags. Use 401/403 for identity/authority, 409 for state/version/terms
conflicts, and 503 with a stable pending reference when recovery is required.
An incomplete report is a provisional/unavailable result, not a zero balance.

## Journal map

| Business event | Debit cash bucket | Credit cash bucket / other evidence |
| --- | --- | --- |
| Opening grant | Authorized issuance/equity | Member transaction; unique reviewed identity grant |
| Initial reserve | Opening equity/issuance | Bank reserve; one singleton initialization |
| Service purchase | Member available transaction funds | Company operating; delivery waits for posted receipt |
| Refund | Company available operating cash | Original payer; link original payment and reverse recognized revenue |
| Employee wage | Company available operating cash | Employee transaction; one income source and payroll line |
| Tax collection | Member available transaction funds | Bank reserve; assessed unpaid amount remains separate |
| Redistribution | Available bank reserve within funded budget | Eligible member transactions; deterministic cent allocation |
| Loan disbursement | Bank reserve | Member cash; balanced separate receivable/equity accounting according to reviewed chart |
| Loan repayment | Member cash | Principal to reserve/receivable settlement, collected interest categorized separately |

This table describes funds flow, not traditional debit/credit sign conventions:
the existing ledger uses negative amount for the source and positive for the
recipient. A loan needs a complete receivable/obligation chart, not a synthetic
cash credit with an untracked liability. Loan approval/catalog remains unavailable.
Locked founding capital cannot fund wages/refunds/loans or become disposable
cash through a new endpoint. Ordinary private sales continue to pay the seller.

## Exact gain and tax evidence

Use hundredth-unit integers for quantities: 100 units = one stock/frozen share,
1 unit = 0.01 crypto. Stock quantities must still be divisible by 100.
Each owner/asset/holding-kind acquisition has an exact total basis and remaining
units/basis. FIFO allocation uses integer division with a deterministic remainder;
final disposal consumes all remaining basis. Sum of allocated basis must equal
the original exact basis. Buyer fees enter acquisition basis; seller fees reduce
proceeds. Record each sale-lot disposal once and link its realized gain to the
Banking income event. Unknown legacy basis stays unresolved, not inferred from
rounded average cost. Assessments include the evidence watermark and policy.

## Delivery/recovery

1. Prepare immutable command terms and stable ID before any journal request.
2. Banking posts balanced entries and the event-outbox record atomically.
3. Delivery repeats the same ID/hash until exchange receipt plus projection/news
   commit atomically. A mismatched hash is an idempotency conflict.
4. Members see pending/settled/failed states. Retrying must not create new billing,
   payroll, tax, rate or entitlement IDs. Do not infer success from an HTTP timeout.
5. Rate application and outbox commit together. Exchange validates the event,
   resolves active stock scope and creates one Joe Wire record linked to the rate
   operation. Reuse market locks and scheduled event semantics; no direct price writes.
6. Use per-service checkpoints to compose snapshots. Cross-database data is
   provisional until reconciled at an agreed cutoff. Revisions are explicit.

## Draft schema inventory

- Bank: `joe-banking/database/drafts/stage1_economy.sql` covers policy versions,
  company/treasury account metadata, locked-capital evidence, grants/reserve init,
  services/plans/consent/subscriptions/commerce, employee agreements/payroll,
  income/tax/redistribution, rates/week slots, loan offers/contracts/payments,
  snapshots, outbox and immutable audit events.
- Exchange: `joe-stock-exchange/database/drafts/stage1_company_economy.sql` covers
  manager/moderator grants, company posts/removal logs, cost lots/disposals,
  economy receipts, rate-to-news linkage and a read-only revenue projection.
- Both are deliberately **outside** `migrations/`; normal migration/seed commands
  do not load them. Stage 1 tests apply them only to fresh in-memory databases.
- They add no initial funds, approvals or production data. The additional draft
  bank posting guard prevents negative company/reserve cash and capital debits.

These are schema foundations, not a complete security implementation. Stage 2
must add/review all domain transitions, approved-policy immutability, terms/version
snapshots, counterpart evidence, sum-of-allocation/basis checks, loan repayment
chart, period locks, income append-only/revision rules, account immutability,
refund constraints and source-specific authorization before promoting a draft.
An idempotency key stored in a table alone does not make a handler atomic.

## Migration procedure for Stage 2

Inventory actual schema and back up/reconcile locally and in staging. Promote
reviewed drafts as new numbered migrations without changing historical files.
Import capital attribution from matched journal/launch evidence without moving
money. Map preexisting opening grants once; classify legacy cost lots unresolved
where evidence is insufficient. Compare balances, holds, share totals and journal
reconciliation before and after. Never rerun demo seeds or silently merge users by
email. Production migration and domain deployment need separate release work.
