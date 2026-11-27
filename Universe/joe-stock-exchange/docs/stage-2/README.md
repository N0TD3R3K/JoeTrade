# Stage 2 implementation

Completed November 26, 2026. Owner requirements remain in `Dev_Note.txt` and
`Universe/staged_dev_note.txt`; employees receive company revenue allocations.
Stage 1 documents preserve the design record. This directory describes the
implemented services. Final owner review belongs to Stage 3.

Stage 3 integration and checks completed November 26, 2026. The working databases
are now backed up and migrated through Banking `0004` and exchange `0009`, with
original financial/share records preserved. See the [completion report](../../../../STAGE_3_REPORT_AND_TEST_GUIDE.txt)
and [current local review procedure](STAGE_3.md). At Stage 3 handoff the policy
and reserve remained unconfigured. The subsequent owner-requested local setup
initializes J$100,000 reserves and a 1.000% weekly Joe Rate; loan products and
lending/redistribution budgets remain disabled pending review.

The implementation adds company Posts and removal/moderation, My Company reports,
company operating accounts, service approval and immutable billing plans, member
checkout, subscriptions and full refunds, accepted employee agreements and funded
payroll, exact cost lots, weekly income tax and corrections, approved redistribution,
reserve initialization, noon snapshots, weekly rate operations and bank-owned loans.
All J$ is fictional and nonredeemable for external money or goods/services.

New numbered migrations are additive: Banking `0003_economy.sql` and exchange
`0008_company_economy.sql`. They create no approved policy, bank reserve, opening
grant or company cash. Existing monetary/share records are preserved. Imported
legacy lots and sales stay unresolved until exact evidence is reviewed. Source
TXT files and old migrations were not rewritten.

Start with [the API/action reference](API.md), [accounting and recovery](ACCOUNTING.md)
and [Stage 3 procedure](STAGE_3.md). The root `STAGE_2_REPORT_AND_STAGE_3_HANDOFF.txt`
records the final checks and local preview teardown.

## Configuration and scope

An operator creates a complete policy draft, reviews it and approves that version.
The initial rate, lending budget, loan catalog and redistribution budget are explicit
configuration. Existing accepted contracts keep their terms after policy replacement.
Approving a policy initializes the rate index, while opening reserve cash requires
a separate once-only operation. A zero lending/distribution budget disables that use.
No sample commercial policy was approved in the owner's working database.

Developers initialize company banking from My Company. Matched founding journals
are attributed to the company without moving cash out of locked `joese-capital`.
The developer receives company Banking management scope. Frozen company shareholders can see
aggregate revenue and the shareholder table; customer receipts, employee agreements
and service configuration are returned only to the company manager.
Ordinary stock-market purchases do not grant My Company reports. Posts has a
separate minimal publishing-choice endpoint, so its ordinary-stock eligibility
does not expose company statistics or Banking data.

Managers propose an app/service; a bank operator approves the JoeAuth app mapping.
Managers then create immutable purchase/subscription plans, configure the employee
revenue pool and invite employees. Employees must accept their exact allocation.
The service can link to `/account?plan=<plan ID>`. A link alone cannot debit cash.

Company Posts require current settled stock/frozen shares or the developer link.
The author retains removal rights after selling their shares. A console operator
can remove inappropriate posts. Withdrawal hides content; deletion removes the
stored title/body and keeps attributed audit metadata. No attachments or rich HTML.
Discussion remains a planned destination; its detailed behavior is still deferred.

## Current deliberate limits

Deposit funding, term-deposit contracts and deposit interest posting remain disabled.
Existing positive deposit balances prevent redistribution and rate recommendations
until their obligations are reconciled. Loan interest accrual is implemented,
including fixed terms and variable rate boundaries; no new deposit product was
invented as part of this stage. Revenue never directly rewrites stock prices.

The service-side entitlement protocol is implemented and tested locally with signed
JoeAuth app identities. A real service such as ChatJoePT still needs its own receipt
consumer, approved app mapping and securely provisioned service-specific verification
key. No third-party project was edited or deployed by this task.

Production JoeAuth role provisioning, live staging, Cloudflare resources, secrets,
DNS, production migrations and deployment remain separate release work.
