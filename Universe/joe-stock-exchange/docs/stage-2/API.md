# Economy API and actions

Member/console endpoints use the existing JoeAuth product sessions, live identity
checks on writes, exact product origin, CSRF token and `Idempotency-Key`.
Always keep the same key and exact body after an uncertain response. JSON results
are in `data`; conflicts include a stable `error.code`. No frontend role flag is
an authorization boundary. Banking rechecks its own linked roles and company scope.

## Member endpoints

| Method/path under `/v1`                  | Behavior                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET `/companies`                         | Own developer/settled-shareholder reports and shareholder display names. Manager fields are scoped at Banking.           |
| POST `/companies/register`               | `{companyId}`; registered developer initializes operating metadata and proven locked-capital attribution. No cash grant. |
| GET `/posts`                             | Published posts plus own removed entries.                                                                                |
| POST `/posts`                            | `{companyId,title,body}`; current ownership checked at insertion.                                                        |
| POST `/posts/{id}/withdraw` or `/delete` | `{version}`; author or scoped moderator. Deleted title/body are null.                                                    |
| GET `/economy/me`                        | Own loans, subscriptions, employee agreements and latest tax statements.                                                 |
| GET `/economy/plans/{id}`                | Server-priced merchant, immutable exact terms/hash and recurrence.                                                       |
| POST `/economy/commands`                 | `{action,input}` from the member action table below.                                                                     |

## Operator endpoints

GET `/console/economy` returns the current approved policy, all recent drafts,
reserve/rate, pending rate operations, latest noon snapshot/revision, assumptions
for recommendations, recent loan/tax/service queues and unresolved income reviews.
GET `/console/posts` and POST `/console/posts/{id}/{withdraw|delete}` moderate posts;
removal requires `{version,reason}`. No deleted body is copied into action logs.

POST `/console/economy/commands` accepts an operator action below.
POST `/console/economy/sync` retries durable income and bank-event delivery.
POST `/console/economy/snapshot` takes `{revise:boolean}` and acquires the market
mutex, compares bank checkpoints/member sets and records a guarded snapshot or
revision. It refuses a pre-noon capture. Scheduler-only bank captures are provisional
until this shared capture reconciles them.

GET `/console/economy/cost-lots` lists unknown remaining cost lots.
POST `/console/economy/cost-lots/{id}/verify` takes `expectedRemainingUnits`,
`originalBasisCents`, `remainingBasisCents` and `evidence`. This records an attributed
review under the market mutex. Past unresolved sales require their own income
correction; verifying remaining costs does not rewrite previous tax evidence.

## Member/company action inputs

| action                                      | input                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `checkout.accept`                           | `planId,termsHash,consent:true`                                                                                               |
| `subscription.cancel`, `subscription.retry` | Own subscription `id`                                                                                                         |
| `loan.accept`                               | Own offer `id,termsHash`                                                                                                      |
| `loan.decline`                              | Own offer `id`                                                                                                                |
| `loan.repay`                                | Own contract `id,amountCents`                                                                                                 |
| `employee.accept`                           | Own agreement `id,termsHash`                                                                                                  |
| `employee.end`                              | Own agreement `id`, or manager of that company                                                                                |
| `service.request`                           | Manager `companyId,appId,name`; app ID is JoeAuth's stable app identifier                                                     |
| `plan.create`                               | Manager `serviceId,title,terms,kind,amountCents,intervalDays`; purchase interval is null, subscription is 1–366 calendar days |
| `company.pool`                              | Manager `companyId,poolBps`; 0–10000. End current agreements before changing their pool.                                      |
| `employee.invite`                           | Manager `companyId,employeeId,allocationBps`; exact member ID or username, weight 1–10000                                     |
| `payroll.run`                               | Manager `companyId,week` (closed Monday key)                                                                                  |
| `payment.refund`                            | Manager's original settled payment `id`; full refund only; pending when underfunded                                           |

## Operator action inputs

| action                               | input                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy.draft`                       | `rules` matching `Universe/shared/economy/runtime.ts` BankingPolicy                                                                                                 |
| `policy.approve`                     | Reviewed draft `id`                                                                                                                                                 |
| `reserve.initialize`                 | `{}`; posts the approved J$100,000 reserve once                                                                                                                     |
| `member.eligibility`                 | `customerId,subject,evidence`; exact existing JoeAuth link required                                                                                                 |
| `grant.reconcile`                    | `customerId,ledgerId`; proves an existing J$10,000 opening journal                                                                                                  |
| `grant.issue`                        | Reviewed eligible `customerId`; no previous account journal and grants must be enabled                                                                              |
| `service.approve`, `service.suspend` | Service `id`                                                                                                                                                        |
| `rate.schedule`                      | `policyVersion,effectiveLocal,deltaPpm,reasonCategory,explanation,internalNote`; New York `YYYY-MM-DDTHH:mm`, signed integer ppm (50 ppm = 0.005 percentage points) |
| `rate.cancel`                        | Pending operation `id`                                                                                                                                              |
| `loan.offer`                         | `customerId,productId,principalCents,expiresAt` (UTC seconds, up to 30 days)                                                                                        |
| `loan.withdraw`                      | Unaccepted offer `id`                                                                                                                                               |
| `tax.assess`                         | `customerId,week`; revisions add current `supersedesId,evidence`                                                                                                    |
| `tax.collect`, `tax.refund`          | Latest complete assessment `id`                                                                                                                                     |
| `income.resolve`                     | `customerId,reference,week,occurredAt,category,gainCents,evidence`; attributed original-period sale review                                                          |
| `redistribution.run`                 | Closed `week,amountCents`; approved budget, received funding, eligibility and reserve/refund obligations checked atomically                                         |

All money is safe integer J$ cents, quantity evidence uses 100 units per whole
stock/frozen share (one unit per 0.01 crypto), percentages use bps or ppm as labeled.
A loan product specifies explicit min/max principal, term weeks, fixed or variable
weekly rate and spread. Variable acceptance snapshots the current Joe Rate plus
that spread. No default penalties or automatic liquidation are added.

## Banking and service boundaries

Banking's own member site exposes `/v1/economy/me`, `/economy/plans/{id}`,
`/economy/commands`, `/rates/current`, `/rates/history` and public `/openapi.json`.
The banking site Loans section supports exact offer acceptance/decline, repayment
and subscription cancellation/retry. Company checkout and employment acceptance
are presented in JoeSE Account Overview.

The exchange's `/internal/joese/economy/*` transport reuses its exact JoeAuth app
identity or the existing local-loopback-only shared secret. These paths have no
browser origin and are never forwarded as arbitrary member commands. Internal
rate jobs, income imports/checkpoints, company registration and reconciled snapshots
cannot be invoked through Banking's browser command endpoint.

An approved merchant app uses a JoeAuth EdDSA app token with exact issuer/audience,
`sub == client_id`, app identity and jti/expiry. GET `/internal/services/entitlements`
returns only that service's payment/refund/subscription events, ordered by `sequence`.
Each receipt contains the exact JSON `body`, `signature` (HMAC-SHA256 hex), and
`receiptHash`. Identity is the member's JoeAuth subject, not a private bank ID.
The consumer validates the signature, service ID, subject and monotonic sequence,
commits a deduplicated entitlement, then POSTs `{eventId,receiptHash}` to
`/internal/services/ack` using the same service identity. Retry delivery until ack;
never treat a merchant link or a pending operation as proof of payment.

Signing requires an operator-provisioned `ECONOMY_DELIVERY_SECRET` of at least
32 characters on Banking. Never distribute this master secret. Each service's raw
verification key is HMAC-SHA256(master, UTF-8 `joetrade-service:<service ID>:<app ID>`),
provisioned securely to that service. Receipt signature is HMAC-SHA256(service key,
exact UTF-8 body). No key is returned to members, printed in logs or committed.
The exchange acknowledgment is separate from each merchant acknowledgment.
