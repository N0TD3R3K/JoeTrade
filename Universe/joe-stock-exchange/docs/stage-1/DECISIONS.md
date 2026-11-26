# Stage 1 design decisions

Date: November 25, 2026. Owner source: `../../../../Dev_Note.txt` in the repository
root, with employees confirmed as the revenue recipients. The consolidated
plan is `../../../staged_dev_note.txt`. These references identify the priority documents; use the links in the [Stage 1 index](README.md).

These are versioned implementation designs, not an approved live financial
policy. Stage 1 adds navigation, read-only views, a calculation preview, shared
contracts and schema drafts. It does not initialize reserves, grant funds,
collect taxes, charge subscriptions, run payroll, issue loans or set the Joe Rate.

## Decisions selected without changing the owner's rules

| Area | Design v1 |
| --- | --- |
| Member navigation | Account Overview, Stock Listings, News, Posts, Discussion, My Company, in that order. `/` aliases Account Overview. Crypto stays grouped under Stock Listings. |
| Posts | Developer link or positive settled stock/frozen shares in the company qualifies for publishing. A pending offer gives the buyer no permission. All checks are server-side in Stage 2. |
| Moderation | Author or scoped operator can withdraw or delete. Withdrawal hides the post. Deletion removes public body/title, leaves an attributed tombstone and action log without retaining deleted text in the event. Former shareholders retain removal rights on their own posts but cannot publish new ones. |
| My Company | Developers/shareholders get aggregate revenue and shareholder display names/quantities. Manager grants control billing/employees. No customer identities or employee pay details in the shareholder report. |
| Time | UTC instants in storage; New York calendar keys. Weeks are Monday 00:00 to the next Monday 00:00, half-open. The daily snapshot is at New York noon. No fixed UTC offset across DST. |
| Member opening grant | J$10,000 once per verified eligible JoeAuth subject, using a separately authorized issuance account, not the J$100,000 reserve. Existing grants must be reconciled before enrollment is enabled. |
| Bank reserve | J$100,000 once, booked against explicit opening equity/issuance. Warn strictly below J$90,000; J$90,000 is not dangerous. No initial posting occurs in Stage 1. |
| Rate changes | Weekly rate 0.300%–2.000%; signed 0.005–0.200 percentage-point changes in 0.005 steps; two effective changes per New York week. Reserve future week slots transactionally, release pending slots on failure/cancel, and revalidate the sequence at execution. |
| Delayed rate jobs | Apply at actual execution time, never backdate. Record scheduled and actual times and use the actual New York week for the final quota. Requeue/fail explicitly if that week's quota or policy changed. |
| Rate market event | Proposed `monetary_policy` category; all active stocks at execution, excluding crypto; mild severity, one eligible tick. Publish once after rate application, through the existing news model and price caps. This is a design default, not a live engine change. |
| Loans | Reserve-funded disbursement, recorded receivable and explicit member acceptance. No independently minted loan cash. A reviewed catalog is mandatory; it is empty/unavailable in Stage 1. |
| Billing | Explicit member consent to a server-defined plan version. One-time and recurring charges debit available member cash and credit company operating cash. Cancellations stop future charges; no raw merchant URL may debit or choose a recipient. |
| Recurrence | Calendar-day intervals at the consented New York wall time, with UTC next-charge instants; nonexistent spring-forward times advance to the first valid instant, repeated fall-back times use the earlier instant. One renewal per contractual period. No catch-up pile of missed automatic charges. |
| Failed renewals | No debit or entitlement on insufficient funds. Mark past due, notify and require a member retry/renewal; no automatic overdraft or liquidation. |
| Refunds | A manager may propose a full linked refund from available company operating funds. No partial refund automation initially. No automatic clawback of an employee's already posted wages. An underfunded refund remains unpaid with a clear status. |
| Employee pay | Accepted employee agreements, company-selected employee-pool percentage and weights totaling 100%. No platform-wide percentage invented. Weekly funded payroll uses settled receipts minus refunds/previous allocations; no founding capital or shareholder funds. |
| Payroll timing | Close company revenue at Monday 00:00 New York, then pay a funded run. Employee taxable income belongs to the week money actually posts; do not backdate it into the revenue week. |
| Rounding | Integer cents; half-up monetary rounding. Allocate payroll/distribution cent remainders deterministically by largest remainder then stable recipient ID, preserving the total. |
| Tax | Whole-income brackets from Dev_Note, not marginal rates: up to 500 is 0%; over 500–2,000 2%; over 2,000–3,500 3%; over 3,500–5,000 5%; above 5,000 10%. J$1,600 gives J$32. Preview warns about bracket jumps. |
| Income basis | Posted wages and deposit interest plus realized stock/crypto/frozen-share gains net of trading fees. Losses offset trading gains within that week only, not wages/interest; no carryforward in v1. Exclude grants, redistribution, transfers, principal, capital and unrealized gains. Future dividends need a separate policy before posting. |
| Cost basis | FIFO by owner/asset/holding kind. Acquisition basis includes buyer fees; proceeds exclude seller fees. Founder basis is the actual contribution. Allocate exact cents proportionally and give the final disposal the remaining cents. Never reconstruct unknown legacy basis from today's quote or rounded average. |
| Unresolved basis | Permit existing trading to continue; mark the affected tax period incomplete and hold its assessment for reviewed reconciliation. Do not invent a gain or tax unknown proceeds. |
| Tax collection | Assess once per closed week with explicit revisions. Collect up to available transaction funds; retain any unpaid assessment for subsequent authorized collection. Do not spend holds, capitalize unpaid tax interest, or sell assets automatically. Refund/correction events revise the original period through an attributed adjustment. |
| Redistribution | Equal amounts to active, verified, eligible members in a recorded week-close snapshot. Fund only from received taxes/loan interest after obligations, within an approved budget and reserve headroom above J$90,000. Initial budget is unconfigured, not an invented allowance. |
| Revenue and valuation | Retained revenue is company-owned operating cash. Report book assets, locked capital and market capitalization separately. No direct price writes or duplicate cash credits. Any new fundamentals signal remains disabled pending a bounded versioned model. |

## Money and snapshot definitions

Member available = posted transaction cash minus wire/order holds. Holds are a
subset of posted cash, not another source of money. Company operating cash,
bank reserve, fee clearing and locked company capital are separate buckets.
Member market assets include ordinary and frozen holdings, valued once at the
reference price. Issuer inventory is excluded from member assets.

The dashboard publishes both average **assets** and average **portfolio value**.
Portfolio value includes posted cash (therefore held cash), holdings and frozen
holdings, less liabilities. Compare average assets to J$10,000 with
`(average - 10,000) / 10,000 × 100`. A zero-member denominator or missing valuation
returns `null`/unavailable, never a fabricated zero. Weekly stock change uses
the prior week's last reference close; show unavailable when no valid base exists.

At New York noon, request bank and exchange components at a common checkpoint.
Publish `provisional` while they disagree or are captured at different cutoffs;
only verified totals become `reconciled`. Record actual capture times when late.
A once-only daily snapshot can have explicit audited revisions; do not silently
rewrite a published observation or pretend late balances were captured at noon.

Average value near J$10,000 is a monitoring target, not a stock-price peg. Taxes,
wages and purchases redistribute existing J$. Opening grants and reserve equity
are separately authorized issuance; show them explicitly in money-supply history.
Loan principal repayment is not income; only received loan interest is distributable.
Deposit interest is a reserve expense, not bank profit.

## Recommendation model boundary

The future recommendation compares eligible `+50 ppm` and `-50 ppm` candidates
against the approved seven-day reserve cash-flow projection: scheduled collectible
variable-loan interest minus variable-deposit interest obligations. Reject candidates
outside bounds/quota or lacking complete product/checkpoint data. Below the initial
reserve target, propose a candidate only if it improves the projected net reserve
cash flow; show the assumptions and require operator approval. Otherwise recommend
hold or insufficient data. A low reserve alone does not prove a rate increase helps.
This projection/recommendation service is Stage 2, not the Stage 1 rate calculator.

## Required policy configuration, not questions during development

The first implementation must require a versioned banking-policy approval record
before enabling new cash actions. Stage 1 leaves it draft. Values not supplied
by the owner remain explicit configuration: initial Joe Rate, loan product
principal/term/rate limits, reserve-funded lending budget, payroll pool per company,
subscription intervals/service plan prices, refund funding policy and redistribution
budget. The draft contains no sample value that can become a real approved policy.
Rates/loans/payroll/taxes stay unavailable until the responsible service validates
its policy and permissions. Frontend capability constants are not authorization.

## Legacy migration and recovery

Existing `joese-capital` is aggregated locked capital. Reconcile each founder
operation, posted journal and launch proposal into per-company attribution records;
this is evidence, not a new deposit, wage or redemption. Never move capital into an
operating account to make the company look funded. Reconcile opening grants by
stable identity before enabling new enrollment, and mark unprovable cost basis
unresolved. Preserve DRK/TST and all balances/holdings.

A command has one stable operation ID and hash bound to actor, company, amount,
terms version and payload. Banking's balanced post is authoritative. A durable
outbox repeats the same event until the receiver commits a matching receipt and
its projection atomically. Receipt IDs and source-operation/kind pairs are unique.
Matching IDs with different hashes are conflicts. Retry pending operations; do
not issue replacement payments because the first response was lost. Reuse the
existing market mutex/settlement recovery for changes touching holdings or prices.
