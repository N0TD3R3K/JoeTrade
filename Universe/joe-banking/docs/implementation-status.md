# Banking implementation status

First local foundation, November 24, 2026. The original design documents remain
the target specification; this file distinguishes working behavior from plans.

## Implemented

- Independently buildable React member site and Cloudflare Worker with D1.
- Account Balance, Transaction, Interest Rate, Deposits, Loans, and Inbox pages.
  Back to Universe stays disabled while its homepage is offline.
- Exact integer-cent amount entry, posted/held/available balances, and transaction
  history from posted ledger entries.
- Atomic sender holds and receiver-approved wires, with pending cancellation,
  no wire fees, no automatic expiry, and no request-payment route.
- Exact recipient lookup with a masked email, scoped history/inbox data, and
  per-member lookup/write limits.
- Balanced ledger posting, immutable ledger lines and posted transactions,
  one-time state transitions, idempotency conflict detection, an audit trail,
  notification records, and a reconciliation query.
- JoeAuth PKCE/state/nonce flow, strict EdDSA issuer/audience verification using
  `jose`, exact subject-based existing-membership lookup, encrypted server-side
  access tokens, and opaque host-scoped HttpOnly sessions.
- Current identity rechecks before writes, local freezes, role isolation, and
  verified/deduplicated signed lifecycle notifications that revoke sessions.
- Loopback-only demo sessions and synthetic accounts with once-only seed entries.
  Demo sessions are rejected on non-loopback hosts or non-local environments.
- Deposit catalog previews and variable-rate bounds, without inventing an
  approved initial rate or enabling unfinished funding/interest operations.

Ledger lines balance in the database before projections change. Wire creation
and its hold commit together in a D1 batch. Resolution performs its hold,
ledger, audit, and notification changes through database triggers in the same
transaction. Cross-database JOESE settlement is not implemented or simulated.

## Verification

The first release has 37 automated tests covering the actual SQLite migration,
balances, hold races, resolution races, retries, failed-operation rollback,
immutability, member isolation, role/freeze/session controls, CSRF/origin checks,
amount validation, and mocked JoeAuth callback/token/webhook behavior.

The migration and synthetic seed have also run under Wrangler's local D1
emulator. Browser smoke testing completed a J$125.50 Alice-to-Bob wire, checked
the held amount before acceptance, received it as Bob, and verified the new
balance after reloading. Mobile navigation and desktop layouts were inspected.
The imported exchange passes its existing 16 tests, type checks, and builds.

## Not ready for production

- Live JoeAuth app registration, end-to-end staging sign-in, reviewed member
  provisioning, eligibility, and proof-based legacy account linking.
- Separate staff application and console entitlements, role administration,
  audited freeze/correction tools, and cross-product operator restrictions.
- Approved initial Joe Rate, rate-adjustment enforcement/history, interest
  accrual/posting, flexible funding, term contracts, and scheduled maturity.
- Approved loan policy and lending implementation; preserve legacy terms during
  any future conversion.
- Internal service-token allowlists, order holds, partial settlements, outbox/
  inbox delivery, and reconciliation with JOESE.
- Rehearsed production migration and recovery, production resource provisioning,
  secret management, domain attachment, and monitoring of free-tier limits.
- Cursor pagination beyond the first 100 activity/wire results, notification
  delivery/acknowledgment UI, and scheduled pruning of expired authentication
  records and rate-limit buckets.
- A full versioned OpenAPI contract, broader security review, and deployment
  validation against the target environment's CPU and database limits.

No remote deployment, production database mutation, or DNS change was performed.
Use the local configuration only until the items above are addressed. Never
reuse the demonstration seed for real member migration.

## Current JoeAuth evidence

The old adaptation documents refer to November 12 behavior. The current source
and discovery expose logout and lifecycle webhooks. In particular,
[the webhook implementation](https://github.com/Histar4522/JoeAuth/blob/master/src/lib/webhooks.ts)
signs a body containing `id`, `event`, `timestamp`, and nested `data.app_id` /
`data.user_id`. Banking checks that signed envelope and deduplicates by app and
event ID. Confirm the deployed source revision and internal app identifier
during staging; public documentation alone is not an end-to-end verification.
