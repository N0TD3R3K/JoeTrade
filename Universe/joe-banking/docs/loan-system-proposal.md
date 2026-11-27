# Proposed Joe Banking loans and overdue-payment rules

**Status: DRAFT — awaiting owner approval.** Prepared November 26, 2026.
This document proposes future behavior for fictional, nonredeemable J$. It does
not enable loan products, applications, fees, forced collection or penalties.
Approval should identify the exact version of this proposal and its settings.

## Purpose and present behavior

Give members a limited way to borrow existing bank cash for in-universe activity,
while preserving bank liquidity and making repayment obligations clear. Borrowing
does not increase a member's net position: cash and matching debt arrive together.

| Area | Implemented now | Proposed next |
| --- | --- | --- |
| Reserve | Once-only J$100,000 opening reserve; warning below J$90,000 | Protect a J$90,000 floor for every new loan and reserve capacity for offers |
| Access | Operator creates offers from an approved catalog | Member application, operator review and transparent capacity checks |
| Funding | Member accepts exact terms; cash moves from reserve to member | Same posting, with an atomic liquidity, concentration and installment check |
| Interest | Simple interest on outstanding principal; fixed or variable; fractional cents carried | Preserve those rules and show a full installment/repayment estimate |
| Repayment | Available cash; interest first, then principal; early repayment allowed | Weekly principal installments; capped late fee paid after principal |
| Overdue | Due date is displayed; normal contractual interest continues; no automatic penalties | Reminders, grace, borrowing restriction, one capped fee and manual recovery review |

The local reserve is initialized at J$100,000 and the base weekly Joe Rate at
1.000%. The current approved policy has **no loan products and a zero lending
budget**. This keeps new lending closed while the proposal is reviewed. Existing
accepted contracts, if any, keep their original terms. Deposit funding remains
unavailable and is not introduced by this proposal.

## Reserve capacity is the lending limit

Use posted, available bank reserve cash; never substitute share prices, locked
company capital, member deposits, uncollected tax or unpaid loan interest.

Define these amounts in integer cents:

- `R`: actual posted reserve cash.
- `F`: protected reserve floor, proposed J$90,000.
- `C`: reviewed cash commitments, such as refundable tax overpayments and due
  bank-funded obligations, excluding amounts already paid or counted in `P`.
- `P`: principal capacity reserved by all unexpired loan offers.
- `B`: approved total outstanding-principal budget, proposed J$10,000 initially.
- `L`: principal still outstanding on all active or overdue loans.

For a new offer, system capacity is:

```text
capacity = max(0, min(R - F - C - P, B - L - P))
```

The offer principal must fit that capacity and the member's remaining individual
limit. The same offer reservation is counted once, not both in `C` and `P`.
At acceptance, remove this offer's own reservation from `P` before evaluating
the proposed disbursement against all other reserved offers. Commit the release,
new receivable, member debt and cash transfer together.

An accepted J$1,000 loan takes a J$100,000 reserve to J$99,000. Its J$1,000
receivable is not reserve cash. A principal repayment returns the actual paid
principal to the reserve; interest adds cash only when paid. Neither accruing
interest nor marking a loan repaid can create a second cash credit.

If available headroom is zero, show **Lending paused: reserve capacity unavailable**.
Do not grant a smaller loan silently, use member cash, consume company capital,
increase the rate automatically or create replacement reserve money. Keep
repayment available. Below J$90,000, pause new offers and disbursements and show
the reason to operators. Only a reviewed funded change can restore capacity.

This floor protects new lending; it does not authorize refusing a correction or
refund the bank already owes. A valid refund may reduce reserves below the floor,
which keeps new lending paused. Review the complete cash commitments before
redistribution so the same reserve headroom is not promised twice.

## Initial product proposal

| Setting | Proposed first release |
| --- | --- |
| Applicant | Active member with a reviewed JoeAuth-linked bank account |
| Principal | J$100–J$1,000, within reserve capacity |
| Per-member limit | One outstanding loan, at most J$1,000 principal |
| System outstanding-principal budget | J$10,000, also limited by cash headroom |
| Term | 2 or 4 weeks |
| Default product | Fixed rate equal to the Joe Rate quoted in the offer |
| Variable product | Optional later catalog entry: Joe Rate plus an explicitly approved spread; proposed initial spread 0.000 percentage points |
| Offer expiry | 48 hours, with capacity released on expiry, decline or withdrawal |
| Repayment | Weekly principal installments plus accrued simple interest |
| Early repayment | Allowed without a fee |
| Collateral | None; shares and account identity are not pledged |

No real-world credit report, family finances, school performance or sensitive
personal information is required. The application asks only amount, term and a
short in-universe purpose/repayment plan. An estimate of future wages or a future
asset sale is not verified cash and does not expand the reserve limit.

The first release should favor a small fixed catalog. Variable products should
appear only after their bounds and member disclosures are approved. A low reserve
alone is not proof that higher rates would refill it: an adjustment can reduce
repayment capacity. Pause new lending and show the existing cash-flow recommendation
instead of applying a rate change automatically.

## Application and exact acceptance

1. In Joe Banking → Loans or JoeSE → Banking activity, choose **Request a loan**.
   Show current availability, rate type, amount bounds and estimated installments.
2. Submit amount, term and purpose. Submission creates an application, no debt,
   cash or interest. A member may withdraw it before acceptance.
3. An operator reviews membership, existing loans, overdue status, requested
   terms and current bank capacity. Record the decision and an understandable
   reason. Do not approve an automatic increase over the requested amount.
4. An approved offer reserves capacity and displays principal, fixed/variable
   weekly rate, maturity, each payment due date, estimated interest, late rule,
   grace period, expiry and total estimated cost. State which figures can change.
5. The member explicitly accepts that exact version. Fixed-rate offers retain
   their quote. If a variable starting rate or any other accepted term changes
   before acceptance, replace the offer and obtain fresh consent.
6. At disbursement, recheck membership, capacity, offer reservation and accepted
   terms. A stable reference and balanced posting create exactly one loan and
   exactly one cash transfer. If capacity changed, return a clear failure and
   require a reviewed replacement offer; do not debit or partially fund it.

Applications should have `submitted`, `under_review`, `offered`, `declined`,
`withdrawn` and `expired` states. Loan contracts should have `active`, `in_grace`,
`overdue`, `restructured`, `repaid` and `closed_with_writeoff` states. A terminal
application does not delete the contract or its history.

## Weekly repayment schedule and interest

Split principal into `termWeeks` integer-cent installments; distribute any extra
cents to the earliest installments. For example, J$1,000 over four weeks requires
J$250 principal per week plus accrued interest. Payment dates are exact elapsed
seven-day intervals after acceptance, stored in UTC and displayed in New York
time. A daylight-saving change may shift the local displayed hour; disclose the
stored schedule before consent. Payroll and tax still use New York calendar weeks.

Use the existing simple-interest method on actual outstanding principal and
elapsed time. Split variable intervals at actual effective rate changes. Carry
fractional cents, never round every scheduler invocation separately, and never
charge interest on unpaid interest or fees. Fixed accepted rates stay fixed.

Payments apply to:

1. Accrued normal contractual interest.
2. Outstanding principal, covering the oldest due installment first.
3. Any approved, capped late fee after principal is cleared.

Show the live payoff quote and the payment allocation before confirmation.
Partial payments are allowed; they do not mark an installment current until its
required principal is covered. Advance principal payments count toward later
installments and reduce future interest. Reject overpayments and amounts that
would spend held funds. Autopay is out of scope for the first release; reminders
do not authorize a debit.

At an unchanged 1.000% weekly fixed rate, a J$1,000 loan paid on time over four
weeks has weekly interest of J$10, J$7.50, J$5 and J$2.50: J$25 in total. Actual
early/late payment times change the accrued amount. This example assumes the
principal installment is paid at each exact seven-day due instant.

## Proposed overdue rules and penalties

The recommended penalty focuses on future borrowing and one small capped fee,
not forced sales or loss of access to the wider Joe Universe. **None is active.**

| Time from an unpaid installment's due date | Proposed behavior |
| --- | --- |
| One day before due | Private reminder with amount, due time and repayment link |
| Due instant | Mark required principal unpaid if it has not posted; send a receipt-style notice |
| Up to 7 days late | Grace period; normal simple interest continues, no late fee; pause new borrowing while an installment is unpaid |
| After 7 days | Mark overdue; assess at most one late fee for the entire loan; continue to allow repayments and hardship requests |
| 14 days late | Operator recovery review and an offered repayment arrangement; no automatic sale or new loan |
| 28 days late | Explicit restructure/writeoff review with notices and an audit trail; never silent debt deletion |

Proposed late fee: **1% of the overdue scheduled principal at the first grace
expiry, capped at J$10 for the entire loan**. No minimum, repeated weekly charge,
penalty interest, interest on the fee or fee for reminders. For a missed J$250
principal installment, that single fee is J$2.50. After it is recorded, later
missed installments do not create additional late fees for that loan.

Fee assessment needs a unique loan-level reference, the original due schedule,
payment evidence and the disclosed rule version. A delayed job must reconstruct
the relevant cutoff; it cannot charge a fee based only on a larger current debt.
If timely reminders failed because the service was unavailable, send the case
for review rather than silently backdating a fee. Collection uses only the
member's explicit repayment; no background sweep of later wages or transfers.

Pause only new borrowing. Do not block identity/sign-in, guide access, ordinary
repayments, refunds, wires or unrelated company activity merely because a loan
is overdue. Do not sell frozen or ordinary assets, take company money, cancel
service access, publish a member's debt, or alter JoeAuth roles. Existing fraud
or account-freeze controls remain a separate reviewed process.

## Hardship, corrections and closure

- A member may request a private extension or smaller repayment arrangement.
  Proposed first allowance: one extension of up to two weeks, with a documented
  reason and the member's acceptance of exact revised terms.
- An operator may waive the proposed late fee through a separate attributed
  adjustment. Already collected fees require an actual refund posting.
- Never rewrite posted cash entries, erase a loan, retroactively raise an
  accepted rate or apply new penalties to old contracts. Old contracts stay
  penalty-free unless the member accepts a new explicit agreement.
- A writeoff changes the receivable and member obligation through reviewed
  noncash journal entries. It does not restore reserve cash, issue a fresh grant
  or pretend that the missing principal was repaid. Show the lost principal
  separately to operators and keep repeat borrowing paused pending review.
- Only received normal loan interest and tax are currently eligible funding
  for redistribution. Penalty fees must not be relabeled as interest income or
  automatically increase the redistribution budget.
- A forgiven loan's future tax treatment needs an explicit policy decision;
  do not quietly insert it into the current taxable-income categories.

## UI and reporting to build after approval

Members need an application form, offer comparison/consent, full due schedule,
amount due now, principal, accrued interest, fee separately, live payoff quote,
partial repayment, receipts, private reminders and a hardship request.

Operators need reserve cash, protected floor, outstanding principal, reserved
offer capacity, cash commitments, available lending headroom, arrears aging,
actual interest received, noncash writeoffs, policy versions and review queues.
Definitions should be available through the same ? controls as current metrics.

The noon snapshot must retain a verified common cutoff. Keep reserve cash,
loan receivables, member posted cash and estimated portfolio values separate.
Outstanding loans do not justify minting money to hide a reserve shortage.

## Implementation and acceptance gates

After owner approval, add new numbered migrations for applications, offer
capacity reservations, immutable installment schedules, due/late assessments,
fee waivers/refunds, reminders and accepted restructures. Preserve current loan
tables and journal history. Add member/operator APIs with the existing exact
origin, session, role, freeze and retry checks; no new direct balance writes.

Required checks include:

- Concurrent offers and acceptances never promise the same reserve headroom.
- Expiry/decline/withdrawal releases capacity once; acceptance/expiry races and
  lost responses cannot create duplicate contracts or cash.
- Insufficient reserves, budgets, member caps, holds and refund obligations
  reject new borrowing without preventing a legitimate repayment.
- Fixed/variable boundaries, partial/early/late payments, fractional cents,
  time-zone changes and the live payoff quote reconcile with the ledger.
- Grace/repayment races apply at most one fee; timely repayment beats a stale
  penalty job. Failure to deliver reminders follows the review rule.
- Late fees never compound, exceed J$10, become principal or fund redistribution
  as interest. Waivers and refunds remain attributed and retry-safe.
- Old loans keep their terms, hardship needs consent, and a writeoff creates
  no reserve cash. Member and operator privacy boundaries stay intact.

## Decisions requested for approval

Approve or revise these concrete defaults before implementation: J$90,000 new-loan
floor; J$10,000 outstanding-principal budget; J$100–J$1,000 amount range; one active
loan per member; 2/4-week terms; fixed quote equal to the Joe Rate; weekly principal
installments; 48-hour reserved offers; 7-day grace; temporary new-borrowing restriction;
one 1% late fee capped at J$10; fee-last allocation; optional one two-week extension;
and manual 14/28-day recovery reviews. Variable catalog entries and any tax rule
for debt forgiveness also require an explicit choice.
