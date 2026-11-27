# JOE Stock Exchange

> Current development status (November 26, 2026): Stage 3 and local review fixes are implemented. My Company is restricted to founders/frozen shareholders, the guide is rewritten, and local Banking now has J$100,000 reserves with a 1.000% weekly Joe Rate. Loan products remain disabled pending the [loan proposal](../joe-banking/docs/loan-system-proposal.md). Deposit funding and Discussion remain unavailable. See the [restart procedure](docs/stage-2/STAGE_3.md); the [Stage 3 report](../../STAGE_3_REPORT_AND_TEST_GUIDE.txt) records the earlier handoff.

JOESE is the Joe Universe's fictional market. **J$ has no real-world value and
cannot be purchased, cashed out, or redeemed for goods, services or prizes.**
JoeAuth supplies identity, Joe Banking owns liquid J$, and this project owns
listings, shares, orders, market prices, Joe Wire news and exchange permissions.

## Working local version

- Shared Alice and Bob banking accounts; no second exchange opening balance.
- Bank-backed order holds, partial fills, cancellation and member sales.
- Receiver-approved wires use the same bank inbox and ledger.
- **+ Add Listing** opens a company proposal from the member site or console.
  An operator reviews a member's proposal; a staff-prepared proposal still
  requires the founder to confirm and fund it.
- At least J$5,000 of founding capital becomes frozen company shares.
  Only the named buyer accepting a private share offer releases sale proceeds
  to the seller. Neither the bank nor the exchange redeems frozen shares.
- Larger console text, responsive navigation and a reorganized listing editor.
- Durable cross-service recovery and once-only bank settlement references.

This first launch flow has one consenting founder who funds the full capital.
Multi-founder allocations need a separate invitation and consent workflow.
Real JoeAuth registration, reviewed account links, staging verification and
Cloudflare provisioning remain necessary before production use.

## Run with the two test accounts

For the prepared working stores, run `npm run dev:all` from the JoeTrade root.
It starts the three websites, their APIs, the market engine and a local job runner.
Use `npm run stop:local` in that root to stop this group. It does not reseed,
apply migrations or approve policies. Keep existing balances and DRK/TST records.

The manual setup below is for a fresh checkout/database.

Use Node.js 24 or newer. First prepare Joe Banking as described in
[its README](../joe-banking/README.md), including all numbered migrations.
Seed the bank only once on a fresh local database. Keep existing local balances.

From this directory:

```sh
npm ci
npm run prepare:local
npm run db:migrate:test
npm run db:seed:test
```

The preparation command creates matching ignored, local-only service secrets.
The exchange seed is repeatable and never grants bank money. It also installs a
separate local operator fixture which cannot trade. Never apply either demo
seed to a remote database.

Start the bank API from `../joe-banking` with `npm run dev:api`. Then run these
in three separate terminals in this directory:

```sh
npm run dev:api:local
```

```sh
npm run dev:exchange:test
```

```sh
npm run dev:console:test
```

Open the [exchange](http://127.0.0.1:4173/) and
[console](http://127.0.0.1:4174/). The exchange's **Test account** menu switches
between Alice and Bob. The console opens the isolated test operator. These pages
use the actual local APIs and SQLite migrations, with no JoeAuth login required.
The sample seed has no usable passwords. Demo sessions and the local service
secret are rejected outside the loopback-only local environment.

The local market remains open for testing. The hourly price engine is not
started by these individual commands; the root `dev:all` runner starts it and
honors the New York price-tick session. Production trading hours and scheduled pricing stay
enabled in the production configurations. Local records persist in ignored
`.wrangler/state/` folders.

## Repository layout

- `apps/exchange-web`: member site.
- `apps/operations-console`: separate staff site.
- `apps/shared`: JoeAuth client, launch form and shared styles.
- `workers/exchange-api`: product sessions, market and bank integration.
- `workers/market-engine`: scheduled market ticks and delisting.
- `packages`: contracts, market rules and UI helpers.
- `database`: append-only migration history and isolated reference/demo seeds.
- `tests`: pricing rules and cross-service integration tests.

Run `npm run check` for type checks, tests, both frontend builds and Worker dry
runs. This does not deploy anything. Banking has its own `npm run check`.

## Member guide

Members can open **Guide** in the exchange header, or visit `/guide` directly.
The guide is public and loads without a JoeAuth session or a working Banking
API. It covers stocks, simulated crypto, balance types, transactions, private
share offers and company launches, including a worked joint-venture example.

Local URL: [JoeSE member guide](http://127.0.0.1:4173/guide).
The same route will be `https://stock.joe-univer.se/guide` after deployment.
Content lives in `apps/exchange-web/src/features/guide/MemberGuide.tsx`.
It describes the implemented single-founder launch and later member share sales;
it does not promise automatic multi-founder funding or free share allocation.

## Deployment and APIs

The intended member and staff addresses are `stock.joe-univer.se` and
`stock-console.joe-univer.se`, with `stock-api.joe-univer.se` for the API.
Both sites proxy `/v1` to the API through a Cloudflare service binding, keeping
sessions on their respective hostnames. Banking uses `bank.joe-univer.se`.

Follow the [deployment guide](docs/cloudflare-deployment.md) and
[connected economy implementation notes](docs/connected-economy.md).
All production D1 identifiers remain explicit placeholders. No DNS changes or
remote deployments are part of this local version.

The running API's `GET /v1/openapi.json` is the contract for connected mode.
`docs/openapi.yaml` documents the imported legacy API; password and exchange
lending routes in that older file are disabled in connected mode. Older design
and JoeAuth adaptation documents describe historical decisions, not production
verification.

## Stage 1 economy foundation

The member shell now provides Account Overview, Stock Listings, News, Posts,
Discussion and My Company routes. Existing balance/trading/Inbox actions and
published news are reused; new Posts, company reports and financial services
are clearly unavailable until Stage 2. The console has an example-only rate
calculator. Read [the Stage 1 index](docs/stage-1/README.md) before continuing.
No draft SQL is loaded by migration commands, and no live funds are initialized.
