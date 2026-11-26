# Implemented banking API

This foundation reference is supplemented by the implemented
[economy actions](../../joe-stock-exchange/docs/stage-2/API.md).
The larger [API design](data-model-and-api.md) also describes future deposit work.
Every response is JSON `{ "data": ... }` or
`{ "error": { "code", "message", "request_id" } }`. API responses are never
cached. Amounts are integer cents in fictional `J$`.

## Authentication

| Route | Behavior |
| --- | --- |
| `GET /v1/health` | Database connectivity and foundation status |
| `GET /v1/auth/session` | Current member, session CSRF token, and environment capabilities |
| `GET /v1/auth/login` | Browser-bound JoeAuth Authorization Code + PKCE redirect |
| `GET /v1/auth/callback` | One-use code exchange and linked-member session creation |
| `POST /v1/auth/logout` | Delete the current banking session |
| `POST /v1/auth/webhook` | Verify JoeAuth's signed lifecycle envelope and revoke affected sessions |
| `POST /v1/dev/session` | Explicit loopback-only demo login; body `customer_id` is `demo-alice` or `demo-bob` |

Member routes require a valid banking cookie. Member POSTs require the exact
configured `Origin`, the current session's `X-CSRF-Token`, and an active local
member. JoeAuth sessions additionally recheck the live identity before writes.
Demo login requires the exact origin but has no existing session to authenticate.
The webhook uses its HMAC signature, timestamp, app identifier, and event ID
instead of browser cookies or Origin.

## Member data

| Route | Response |
| --- | --- |
| `GET /v1/me/summary` | Posted, held, available, and flexible balances; active loan principal/interest/liability; hold categories; inbox count; feature availability |
| `GET /v1/me/activity` | Most recent 100 posted transactions belonging to this customer |
| `GET /v1/wires` | Most recent 100 wires where this customer is sender or receiver |
| `GET /v1/me/inbox` | Most recent 100 incoming wires still pending receiver approval |
| `GET /v1/recipients?query=...` | Exact eligible username/email lookup returning ID, display name, masked email |
| `GET /v1/rates/current` | Approved range and weekly rate; null until the initial policy is approved |
| `GET /v1/rates/history` | Approved initial rate and subsequently effective versions |
| `GET /v1/deposits/catalog` | Preview of the specified fixed-term products with `available: false` |

Recipient lookup is limited to 10 attempts per member per minute. Member wire
POSTs are limited to 20 per member per minute. Limits are enforced in D1 and do
not depend on browser controls. Member history does not expose another user's
email, balance, or unrelated transactions.

Summary fields `loan_principal_cents`, `loan_interest_due_cents` and
`loan_liability_cents` describe active bank contracts, with liability equal to
principal plus posted accrued interest. Connected JoeSE uses that liability in
its portfolio net-position estimate. An unaccepted offer adds no liability.

## Wires

All wire writes require an `Idempotency-Key`: 8–128 ASCII letters, digits,
hyphens, or underscores. Keep the same key when retrying the same operation,
including after a network timeout. Reusing it for a different operation returns
409 `IDEMPOTENCY_CONFLICT`. A replay returns the saved original response even
if the wire has since changed state; use GET to obtain current state.

`POST /v1/wires` takes:

```json
{
  "receiver_id": "ID returned by exact recipient lookup",
  "amount_cents": 12550,
  "memo": "For the Joe project"
}
```

It returns HTTP 201 with `{ "id", "amount_cents", "status": "pending_receiver" }`.
Memo is optional, plain text, and limited to 240 characters. Amounts must be
positive safe integers of no more than 1,000,000,000,000 cents and covered by
available funds. The creation does not credit the receiver.

| Route | Who can resolve it | Effect |
| --- | --- | --- |
| `POST /v1/wires/{id}/accept` | Named receiver | Settle once; debit sender and credit receiver |
| `POST /v1/wires/{id}/decline` | Named receiver | Release sender's hold |
| `POST /v1/wires/{id}/cancel` | Sender | Release hold while still pending |

Resolution returns `{ "id", "status" }`. Only one resolution can succeed. A
competing later action returns 409; an unrelated member receives 404. A freeze
blocks acceptance if either party is frozen. An active receiver may still
decline a pending wire from a frozen sender, releasing the hold without moving
funds. No automatic expiry or fee is applied.

## Internal visibility

`GET /v1/console/reconciliation` requires a locally assigned banking administrator
role and returns counts of unbalanced posted transactions, projection mismatches,
and negative member available balances. It does not authorize that administrator
to trade or wire funds. A staff UI and separate staff JoeAuth client are still
required before production.

There are no implemented deposit-funding, lending, arbitrary balance-edit,
payment-request, or JOESE settlement endpoints in this release.
