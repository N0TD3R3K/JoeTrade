# Accounting, calendar and recovery

Banking is the sole posted/held/available J$ authority. New economy commands use
an actor-bound stable reference and a canonical request hash. Each complete command,
audit event, balanced journal, domain transition and outbox entry commits in one
D1 batch. A database revision guard serializes competing economy plans; failed
batches roll back entirely. Original wire/order hold and active-member posting
checks still run at the actual posting boundary.

## Cash sources and accounts

The separately approved opening bank reserve is J$100,000 against explicit issuance,
recorded once. Opening member grants are J$10,000 against issuance, never reserve
funds. Eligibility requires the exact verified JoeAuth subject, review evidence and
an existing bank identity. Existing grants must be recorded against their actual
opening journals; nonempty accounts cannot receive a new grant through enrollment.
Unique member/subject constraints survive retries and replacement operation keys.

Company operating cash is separate from `joese-capital`. Founding contributions
remain locked in that aggregate account; per-company records attribute matching
posted journals without changing cash. A full refund debits operating cash and
credits the original payer. An underfunded refund stays pending and can be retried;
its source payment can have only one refund. Existing wages are never clawed back.

Loans debit the initialized reserve and credit member cash only after exact offer
acceptance. An additional balanced receivable/obligation pair records principal.
Repayment settles received interest first, then principal and that pair. Interest
uses simple outstanding-principal accrual with rational fractional-cent carry.
Weekly means elapsed 604800 seconds for this loan accrual; due time is accepted
instant plus the agreed term weeks. Fractional cents remain recorded, and only
whole cents are collected. No automatic late fee, compounding or forced sale.
Fixed terms remain fixed. Variable contracts follow applied Joe Rate history plus
the accepted spread; accrual splits at each actual effective boundary. A variable
offer whose starting rate changes before acceptance must be refreshed.

## Service revenue and employment

Prices, recipient accounts and recurrence are server-defined immutable plan terms.
Consent authorizes that version and amount. Calendar-day subscriptions keep the
consented New York wall time, advancing nonexistent spring times to the first valid
minute and choosing the earlier repeated autumn time. A delayed job charges one
period, skips missed intervals and never stacks automatic catch-up charges. A failed
renewal becomes past due and needs an explicit member retry; cancellation stops
future renewals. Canceled and past-due delivery events are durable.

Company weekly/lifetime reporting separates gross receipts, linked refunds, wages,
retained revenue, operating cash, verified locked capital and market capitalization.
Refunds adjust the original revenue period. Employee payroll uses the company’s
configured pool and accepted allocation weights totaling 100%. A closed revenue
week has one funded run, capped by settled net revenue, previous allocations and
available operating cash. Cent remainders go by largest remainder then stable ID.
Wages are taxable in the week they actually post, not the earlier revenue week.

No company revenue is added twice as cash or written directly into a share quote.
The existing price engine remains authoritative for reference prices.

## Exact gains and tax

FIFO lots separate owner, asset and ordinary/frozen/crypto holding type. Acquisitions
record exact total cash including buyer fees, and disposals use net seller proceeds.
Proportional integer allocation consumes all remaining basis on the final disposal.
Legacy quantities/sales become explicit unresolved records, never today’s price or
rounded average cost. Operators can verify exact remaining basis and record separate
attributed original-period gain corrections. Partial evidence cannot silently become
zero gain. Historical sales imported by the migration hold their affected tax week.

Gain evidence is delivered under the exchange market mutex after settlement/recovery.
New sale income uses the bank journal’s actual posting instant and matching seller
credit. An exchange checkpoint advances only after all earlier income outbox rows
are durably recorded, while settlement cannot interleave that cutoff.

Tax uses Monday-midnight New York weeks and whole-income brackets from Dev_Note:
0–500: 0%; over 500–2000: 2%; over 2000–3500: 3%; over 3500–5000: 5%; above 5000: 10%.
Losses offset that week’s trading gains only, not wages/interest; no carryforward.
The selected rate applies to the whole total, so J$1600 gives J$32. Wires, grants,
capital, principal, redistribution and unrealized value are excluded.

A closed-week assessment records policy, source watermark, revision and evidence.
Unknown basis or a missing exchange cutoff holds collection. Corrections explicitly
supersede the latest assessment; prior versions remain immutable. Collection uses
only available transaction cash and retains unpaid tax. Paid amounts are calculated
across the assessment chain; excess after a reviewed correction can be refunded
once from reserve cash. No hold consumption, overdraft or forced liquidation.

Redistribution requires an operator amount within the approved budget, one closed
week, actually received tax/loan-interest funding, eligible active verified members,
and reserve headroom of at least J$90,000 after pending tax-refund obligations.
Unreviewed deposit obligations block redistribution. It is equal, deterministic and
conserves total cents. It is not a new fixed allowance or money grant.

## Rates, news and jobs

Joe Rate is 0.300–2.000% weekly. Signed changes are 0.005–0.200 percentage points
in 0.005 steps, with two operations per New York week. Scheduling transactionally
reserves a week slot. Cancel releases only a pending slot. Pending operations must
be appended in time order; execution rechecks policy, expected rate version, previous
rate and the actual execution week’s quota. Invalidated sequences fail explicitly;
they are never silently rebased or backdated.

Applied rate changes and their outbox entry commit together. Exchange validates the
operation, stores a receipt and one linked `monetary_policy` article in one batch.
Cuts produce a mild bullish signal; increases a mild bearish signal. The event affects
eligible active stock tickers, excludes crypto, lasts one eligible tick even after
an overnight delivery, and commits its consumed-tick marker with the market tick.
Ordinary hourly/daily price caps still apply. Outcomes are not guaranteed returns.
Internal notes never enter the published event. Scheduling/canceling creates no news.

Banking’s five-minute worker handles bounded due rate operations, renewals, loan
accrual/offer expiry, prior closed-week payroll, assessments/available-funds collection,
and noon captures. Each action has a durable key. Expected insufficient-funds or
configuration conditions do not block unrelated jobs. Payroll can be retried after
funding; past-due renewals require the member. Redistribution stays operator-initiated.
Exchange’s existing five-minute recovery job also delivers pending income/news.

## Snapshots and recommendations

New York noon is DST-aware. A late capture reports its actual capture time, never a
fabricated historic noon balance. Bank-only captures are provisional. A reconciled
capture holds the exchange mutex, compares bank financial checkpoints and member
identity sets, and validates unchanged bank account balances in the committing D1
batch. Later reconciliation is an attributed revision of the daily observation.

Member posted cash includes holds; available and held are separate subsets.
Company operating cash, reserve, locked capital and fee clearing are separate buckets.
Market posted money is member posted plus company operating cash. Member asset
value excludes issuer holdings and company treasury double counting. Average assets
and average portfolio (posted cash plus assets minus loan liabilities) are separately
labeled; no members or missing evidence gives unavailable averages. Compare average
assets with J$10,000 as a monitoring target, never a price peg.

Recommendations are operator-only seven-day cash-flow comparisons, with explicit
collectibility assumptions. Missing rate/reserve/product data or unreviewed deposits
gives insufficient data. Below the opening target, an eligible 50-ppm increase can
be proposed only when funded variable-loan interest improves the projection, current
borrower cash supports it and quota/bounds permit it. Otherwise hold. No recommendation
applies itself, and a low reserve alone never proves an increase will help.
