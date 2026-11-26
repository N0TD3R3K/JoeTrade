# Connected economy implementation

> Current development status (November 26, 2026): Stage 2 services and UI are implemented. See [Stage 2 service and recovery reference](stage-2/ACCOUNTING.md) and the root Stage 2 TXT report. Earlier Stage 1/foundation descriptions below are historical. Policies stay unconfigured until reviewed approval; deposits remain unavailable. Final owner review is Stage 3.

Local implementation, November 24, 2026. Product requirements include
[Joelib issue 16](https://github.com/N0TD3R3K/Joelib/issues/16) and the banking
design documents. Everything described here concerns fictional J$.

## Identity and ownership

JoeAuth's immutable `sub` links an existing exchange user to a banking customer.
Email equality does not link accounts or issue a second J$10,000 opening grant.
The bank's returned subject must match the exchange subject. Existing members
need a reviewed migration; automated enrollment and proof-based linking remain
future work. Never copy the exchange's old wallet amount into the bank blindly.

Member and console apps have separate JoeAuth clients, callbacks, host-scoped
HttpOnly cookies, sessions and product roles. JoeAuth administrator status grants
no exchange role. The server verifies EdDSA signatures, `kid`, exact issuer and
audience, state/browser binding, PKCE, nonce and verified identity. Access tokens
are encrypted server-side. Sensitive writes require CSRF, exact origin and a
live identity check. Sessions last at most 15 minutes; refresh grants are not
used. Signed, timestamped lifecycle events revoke sessions and are deduplicated.
Live registration and staging verification still require the JoeAuth maintainer.

## Cash and recovery

The exchange calls only Joe Banking's authenticated `/internal/joese` service
routes. Production accepts the explicitly allowlisted JoeAuth application
identity; browsers cannot use these endpoints. Local testing uses a generated
shared secret only on loopback with both local demo flags enabled.

- `GET /members/{customer}/summary`: available/posted/held cash and subject.
- `GET /members/{customer}/inbox`: the bank's incoming wires.
- `GET /members/{customer}/recipient?query=…`: exact recipient lookup.
- `POST /wires`: create, accept, decline or cancel a receiver-approved wire.
- `POST /operations`: reserve, release, settle a hold, pay a member, fund capital
  or record a no-cash operation. No capital-redemption operation exists.

Bank migration `0002_exchange_integration.sql` includes exchange holds in the
same available-balance view used by bank wires. Balanced journal postings and
bank operation IDs prevent duplicate debit/credit. Capital can only enter the
internal company-capital account; it cannot be paid back by an exchange action.
Exchange-local wallet updates are rejected for bank-linked users.

Two databases cannot commit one transaction together. Before contacting the
bank, the exchange stores an immutable financial plan and takes a market-wide
mutex. The bank commits an idempotent operation; the exchange then commits
holdings, orders and audit effects with a unique receipt. Lost responses or a
failed exchange finalization leave the operation pending and block conflicting
market changes until replay completes. The same operation key must be retained.
Definitive bank rejection fails the operation without moving shares. Avoid
manually deleting pending operations, holds or mutexes.

Portfolio reads, an authorized recovery endpoint and a five-minute API Cron
Trigger replay pending work. Fully filled/delisted orders enqueue repeatable
bank hold releases. A request matches at most two fills; the scheduled recovery
runs one queued fill at a time within market hours. Larger queues and the target
Cloudflare plan need staging load tests before launch. Expired preparation locks
can fail safely before funds move; hourly engine locks have bounded recovery.

## Launch a company

1. A member submits their own proposal, or staff prepares one for a linked
   member through **Listings & details → + Add Listing**.
2. A proposal specifies a unique three-letter stock ticker, company information,
   HTTPS project URL, at least J$5,000 and a positive whole share count.
3. Staff review makes a member submission eligible for founder confirmation.
   Staff preparation or review never debits the founder.
4. The named founder explicitly confirms **Fund & launch**. The bank moves the
   exact contribution from available cash to capital; the exchange creates the
   listing and the specified number of frozen founder shares exactly once.
5. The seller chooses a named member, an exact number of frozen shares and a
   total asking price. Creating the offer reserves shares only. On buyer
   acceptance, the bank settles cash and the exact shares move to the buyer.
   Acquired company shares remain frozen. Decline/cancel returns the reservation.

The current published private-sale fee is 0.25% on each side, using the shared
integer-cent rounding rule. The confirmation shows the buyer's full debit and
the seller's net proceeds. The sale price is negotiated; it need not equal the
original contribution or current market valuation. Unsold shares remain frozen,
and there is no promise of a buyer or bank repayment.

This version starts with one consenting founder and no extra public-float
issuance. Multi-founder launches need separate participant consent and are not
implemented. Stock tickers have three letters; existing four-letter simulated
crypto assets retain the imported market rules. Three consecutive daily closes
below J$1 delist a stock at zero value; pending orders/offers are released without
inventing cash refunds for worthless shares.

The console edits attributed company information. Prices, ownership, and
listing status follow market rules rather than this metadata form. Old local
password registration, invitations and exchange loan writes are disabled in
connected mode; unfinished banking deposits/loans are not presented as available.

## Verification and remaining work

Tests run against the actual bank and exchange SQLite migrations with two
synthetic member accounts, and mocked transport between the actual Workers.
They cover capital consent, exact shares, fees, holds, matching, wires, role
isolation, duplicate retries, outages, bank commit recovery and market locks.
They do not establish live JoeAuth compatibility or production resource limits.
The local browser review used both accounts and an example TST company.

Before launch: register JoeAuth apps/service credentials, review identity links,
rehearse migration and failure recovery, provision D1/domains, test the deployed
edge proxies and lifecycle callbacks, and measure request/CPU/database usage.
The old loan contracts require a separate migration decision. Banking deposits,
interest, lending, a full bank staff console and universe-wide logout UI remain
future work.

## Stage 1 development update — November 25, 2026

The member shell now has six shareable routes and reuses the existing read-only balance/news and financial actions. Posts, Discussion and company reports have honest planned states. Read [Stage 1 status and design](stage-1/README.md) before implementing new circulation services; existing trade/settlement rules remain intact.
