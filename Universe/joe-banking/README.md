# Joe Banking

Joe Banking is the fictional banking layer of the Joe Universe. It manages a
member's liquid Joellars (J$), person-to-person wires, savings deposits, term
deposits, and loans. It is being built around JoeAuth as its identity provider
and is intended to provide the authoritative liquid J$ balance used by JOE Stock
Exchange (JOESE). The live exchange is not connected to this new ledger yet.

Joe Banking is a closed simulation. J$ has no real-world value and cannot be
deposited from, withdrawn to, exchanged for, or redeemed as real currency,
goods, services, prizes, or cryptocurrency.

## Status

The first local implementation is available:

- Responsive white member website with the specified navigation and inbox.
- D1 schema with balanced, append-only ledger postings and rebuildable balances.
- Sender-initiated wires, held funds, receiver acceptance/decline, and cancellation.
- Atomic state transitions, request retry protection, audit records, and local
  notifications for both parties.
- JoeAuth Authorization Code with PKCE, scoped sessions, live identity checks,
  and signed lifecycle-event processing. Real JoeAuth credentials and linked
  banking memberships still need to be provisioned and tested in staging.
- A loopback-only local demonstration using synthetic Alice and Bob accounts.

Deposit plans and rate rules can be viewed, but funding, interest, lending,
the complete staff console, production linking/migration, and JOESE settlement
are not implemented. No real initial rate has been chosen. No new service has
been deployed.

See [implementation status](docs/implementation-status.md) and the
[implemented API](docs/implemented-api.md). The other documents below describe
the target system; they are not a claim that every feature exists.

## Run locally

Use Node.js 24 or newer. From this directory:

```sh
npm ci
npm run build
npm run db:migrate:local
npm run db:seed:local
```

Build first so Wrangler can find the static assets. These commands do not
deploy anything. The seed command is for a fresh local database only; a second
run fails rather than issue another starting balance.

Start the API in one terminal:

```sh
npm run dev:api
```

Start the member site in another terminal:

```sh
npm run dev
```

Open [http://127.0.0.1:4180/](http://127.0.0.1:4180/). Open Alice's account,
send a wire to the exact username `bob`, and switch to Bob through the account
menu to receive or decline it. The local sessions last one hour. Demonstration
balances and wires persist in ignored `.wrangler/state/` data across restarts.

Run `npm run check` for type checks, integration tests against the real migration,
the frontend build, and a Worker deployment dry run. Application data and ledger
records live in D1, not browser storage or KV.

The checked-in Wrangler configuration is deliberately local-only, has a placeholder
database ID, no public routes, and disabled `workers.dev` access. A separate reviewed
production configuration is required before deployment. Do not apply the local
seed to a remote database.

## JoeAuth setup for staging

1. Register a confidential banking member application in JoeAuth, with the exact
   callback `${APP_ORIGIN}/v1/auth/callback` and scopes `openid profile email`.
   For this local site the callback is `http://127.0.0.1:4180/v1/auth/callback`;
   JoeAuth must allow that local callback or a separate HTTPS staging origin.
2. Copy `.dev.vars.example` to ignored `.dev.vars` and set the client ID, client
   secret, and a randomly generated session-encryption secret of at least 32
   characters. Use the exact issuer `https://auth.joe-univer.se`.
3. Prepare an explicitly reviewed staging membership linked by JoeAuth `sub`.
   Automated enrollment, proof-based legacy linking, and migration tools are
   future work. Equal email addresses are never used to auto-link accounts.
4. On an HTTPS staging deployment, register `/v1/auth/webhook`, configure its
   secret and the internal JoeAuth app ID in `JOEAUTH_APP_ID`, and test a signed
   lifecycle event. The handler uses the actual nested `data.app_id` and
   `data.user_id` envelope, not the simplified camelCase documentation example.

JoeAuth sessions currently last at most 15 minutes, bounded by access-token
expiry. Refresh tokens and offline access are intentionally not requested in
this first release. Sign-out clears the banking session; a universe-wide logout
UI is future work. The global JoeAuth administrator role grants no banking role.

## Confirmed product rules

- A member may send a wire to another member. There is intentionally no payment
  request, invoice, pull-payment, or debit-request feature.
- An outgoing wire is reserved until the named receiver chooses **Receive** or
  **Decline**, following the existing JOESE inbox model.
- The variable Joe Rate is quoted as a weekly rate and must remain between
  **0.300% and 2.000% per week**.
- An authorized banking operator may adjust the variable rate no more than
  twice in one New York calendar week.
- One adjustment must move the rate by at least **0.005 percentage points** and
  no more than **0.200 percentage points**.
- Fixed-term deposits are unaffected by later variable-rate changes:

| Term | Fixed weekly rate |
| --- | ---: |
| 2 weeks | 1.000% |
| 4 weeks | 1.500% |
| 8 weeks | 2.250% |

- Fixed-rate loan contracts are also unaffected by later variable-rate
  changes. Their product terms and offered rates still require a separate
  decision.
- Rate changes may be explained by published news or ordinary fluctuations,
  but every change is visible, attributed, bounded, and audited.

## Core architecture decision

There must be one authoritative liquid J$ balance per member. Joe Banking owns
that balance. JOESE continues to own stock, crypto, shareholding, order, trade,
and market data, but reserves and settles liquid J$ through the banking ledger.
This prevents a member from spending the same J$ once in the bank and again in
the stock market.

Until JoeAuth is deployed and approved for central identity, a temporary
identity-link table maps an existing JOESE member ID to one banking customer.
JoeAuth will later replace that temporary identity source without changing
historical banking or JOESE financial record IDs.

## Document map

- [Product and architecture](docs/product-and-architecture.md)
- [Accounts, ledger, and JOESE integration](docs/accounts-ledger-and-joese.md)
- [Member wires and inbox settlement](docs/transfers.md)
- [Interest policy and news](docs/interest-policy-and-news.md)
- [Deposits and loans](docs/deposits-and-loans.md)
- [Member and console experience](docs/member-and-console-ux.md)
- [Data model and API](docs/data-model-and-api.md)
- [Security, migration, and delivery plan](docs/security-migration-and-delivery.md)
- [JoeAuth adaptation](docs/joeauth-adaptation.md)

## Decisions still required before implementation

1. The initial variable Joe Rate. A proposed starting value is 1.000% per week.
2. Fixed-loan products: permitted terms, rates, borrowing limits, weekly minimum
   payments, grace periods, and eligibility.
3. Whether a loan's disbursed J$ may be used for JOESE purchases. Preserving the
   current connected-account behavior would allow it; prohibiting it requires a
   separate restricted sub-balance.
4. Whether a fixed-term deposit can be broken early. The proposed first version
   keeps it locked until maturity and permits only an audited exceptional
   correction.
5. The final `joe-univer.se` issuer/hostnames and resolution of the JoeAuth
   readiness gates documented in `docs/joeauth-adaptation.md`.
6. Banking operator and administrator assignments, backup ownership, and the
   beta migration date.

