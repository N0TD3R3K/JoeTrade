# JoeTrade

JoeTrade is the home of the Joe Universe's fictional economy: **Joe
Banking**, **JOE Stock Exchange (JOESE)**, and their developer APIs. It connects
these products through [JoeAuth](https://github.com/Histar4522/JoeAuth) while
keeping identity, banking, and market responsibilities separate.

**Joellars (J$) are fictional and have no real-world value.** They cannot be
purchased with, exchanged for, or redeemed as real money, goods, services,
prizes, or cryptocurrency. JoeTrade is a closed simulation for entertainment
and collaborative world-building.

## Project status

The existing Universe projects are now under [`Universe/`](Universe/).
[`Joe Banking`](Universe/joe-banking/README.md) has a working local foundation:
member balances, an append-only double-entry ledger, held funds, receiver-approved
wires, transaction history, and a responsive member website. JoeAuth integration
code is present and tested with synthetic identity responses; live app registration
and account linking are still required. JOESE now uses Banking for order holds, fills, wires and
member share sales, with a founder-confirmed listing launch. It remains an independent
project in [`joe-stock-exchange`](Universe/joe-stock-exchange/README.md).

Stage 3 implementation and local validation are complete. The console now manages
reviewed banking policy, weekly rates and loan offers; company services, employee
payments, tax, Posts and company reports are implemented. Cash features require
an operator-approved policy and, where applicable, an initialized reserve.
Deposit funding, Discussion, production migration and live SSO verification remain
separate work. See the [Stage 3 report and test guide](STAGE_3_REPORT_AND_TEST_GUIDE.txt).
No production data has been migrated and no websites have been deployed.

Start with the [development plan](DEVELOPMENT_PLAN.md) for milestones, open
decisions, migration requirements, and launch checks.

## Planned products

| Product             | Responsibility                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Joe Banking         | Available J$, holds, receiver-approved wires, savings, term deposits, loans, and ledger history |
| JOESE               | Fictional listings, portfolios, orders, matched trades, scheduled prices, and Joe Wire news     |
| Operations consoles | Product-specific administration, investigations, reconciliation, and audit                      |
| Developer APIs      | Documented, versioned integration with market data and authorized account operations            |

## Connection to the Joe Universe

JoeAuth provides sign-in, verified identity, and account recovery. JoeTrade
retains its own product membership and permissions. A JoeAuth account does not
automatically grant trading access, administrator access, or a starting balance.

| Address               | Purpose                                                      | Status                                   |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `joe-univer.se`       | Joe Universe homepage, maintained separately by the Joe team | Not online at planning time              |
| `auth.joe-univer.se`  | Central JoeAuth identity provider                            | Live discovery checked November 24, 2026 |
| `stock.joe-univer.se` | JOESE member website                                         | Planned                                  |
| `bank.joe-univer.se`  | Joe Banking member website                                   | Planned                                  |

The prepared exchange console and API hostnames are `stock-console.joe-univer.se`
and `stock-api.joe-univer.se`; confirm these with the domain owner. The member
sites can launch before the homepage. The Back to Universe control stays
disabled until its destination is available.

## Architecture principles

- **One spendable balance:** Banking owns the authoritative liquid J$ balance.
  JOESE reserves and settles funds through Banking; portfolio value is not
  spendable J$.
- **One identity, separate permissions:** Link each product's immutable member
  ID to JoeAuth's stable subject identifier (`sub`). Email is a display and
  eligibility field, not proof of account ownership.
- **Auditable operations:** Use append-only balanced banking entries, attributed
  corrections, and retry protection for every balance-changing operation.
- **Independent services:** Deploy banking and exchange services independently,
  with separate databases and narrowly authorized service calls.
- **Protected sessions:** Use server-side Authorization Code with PKCE and
  product-scoped HttpOnly sessions. Keep reusable identity tokens and secrets
  out of browser storage.
- **Open integration:** Publish API contracts and examples while enforcing
  member, operator, and internal-service access boundaries.

## Development

### Continue the prepared local review

The existing local databases have been backed up and migrated through Banking
`0004` and JOESE `0009`. From this repository root, start all three websites,
their APIs and the local scheduled-job runner:

```sh
npm run dev:all
```

- [JOESE](http://127.0.0.1:4173/account): switch Alice/Bob with **Test member**.
- [Operations console](http://127.0.0.1:4174/): separate local operator.
- [Joe Banking](http://127.0.0.1:4180/): switch members in the account menu.

No sign-in is required in this loopback-only test mode. Records persist across
restarts. Keep the terminal running; `npm run stop:local` stops this preview group.
The runner reuses an existing group and never migrates, seeds or approves a policy.
Do not rerun bank seeds against these existing working stores.

Scheduled jobs run every minute during this local preview. Price changes still
follow the engine's New York afternoon/evening session and do not force a tick.
In **Console → Joe Bank → Bank policy configuration**, review an initial rate,
budgets and loan catalog, save a draft and approve the exact version. Reserve
initialization is a separate once-only action. No sample QA policy was approved
in the working databases. The [test guide](STAGE_3_REPORT_AND_TEST_GUIDE.txt)
explains the remaining setup and suggested test flows.

### Set up a fresh checkout

Clone this repository and open its folder in your editor:

```sh
git clone https://github.com/N0TD3R3K/JoeTrade.git
cd JoeTrade
```

Use Node.js 24 or newer. Set up the bank from the repository root:

```sh
npm --prefix Universe/joe-banking ci
npm --prefix Universe/joe-banking run build
npm run db:bank:local
npm run db:bank:demo
```

The last command creates two synthetic local accounts. Run it once per fresh
local database; it deliberately rejects duplicate seed balances.

Then run these in two terminals:

```sh
npm run dev:bank:api
```

```sh
npm run dev:bank
```

Open [the local banking site](http://127.0.0.1:4180/). Choose Alice's account,
send a wire to the exact username `bob`, then switch members through the account
menu and receive it as Bob. All demonstration records stay in the local database.

Run `npm run check:bank` for banking type checks, integration tests, the frontend
build, and a Worker deployment dry run. For the imported exchange, install its
dependencies with `npm --prefix Universe/joe-stock-exchange ci`, then run
`npm run check:exchange`. These checks do not deploy services. For the connected exchange and console with
Alice and Bob, follow the [exchange quick start](Universe/joe-stock-exchange/README.md#run-with-the-two-test-accounts).
See the [current integration notes](Universe/joe-stock-exchange/docs/connected-economy.md)
and [Cloudflare deployment guide](Universe/joe-stock-exchange/docs/cloudflare-deployment.md).

The current layout keeps both projects under `Universe/`. The
[development plan](DEVELOPMENT_PLAN.md#2-proposed-repository-layout) describes a
possible later reorganization. See [import notes](Universe/IMPORT_NOTES.md) for
provenance, exclusions, and the boundary between old and new deployment settings.

## Contributing

Discuss policy and architecture changes in an issue before implementation.
Use a focused branch and pull request, explain the behavior being changed, and
include appropriate validation. Update the relevant documentation alongside
code changes.

Never commit credentials, local secret files, member records, database exports,
or production session data. Use synthetic accounts and isolated test databases.
Imported code and artwork must retain applicable third-party license notices.

## License

JoeTrade is licensed under the [MIT License](LICENSE), copyright 2026 Derek Li.
Imported third-party material retains its applicable license and notices.
When importing CC0 material from Joelib, document its source and existing CC0
status rather than implying that its original permissions have changed.

## Staged economy development

The owner plan is [staged_dev_note.txt](Universe/staged_dev_note.txt), based on
Dev_Note with priority over the older handoff. Stage 1 designs and foundations
are indexed [here](Universe/joe-stock-exchange/docs/stage-1/README.md).
They prepare the new member routes and company economy without enabling new
cash operations. Follow the [Stage 1 completion report](STAGE_1_REPORT_AND_STAGE_2_HANDOFF.txt) before starting Stage 2.

### Stage 2 economy development

Company Posts, scoped My Company reports, company checkout/subscriptions, employee
payroll, weekly tax/corrections, reserve/rate operations and accepted bank loans are
implemented. See [Stage 2 features and API](Universe/joe-stock-exchange/docs/stage-2/README.md)
and [completion report / Stage 3 handoff](STAGE_2_REPORT_AND_STAGE_3_HANDOFF.txt).
During Stage 2 the original working databases remained unchanged; migration
rehearsals and UI checks used isolated copies. Discussion and deposit funding
remain unavailable.

### Stage 3 integration and local review

Both working stores are now backed up and migrated without reseeding. Historical
cost evidence and company capital attribution are reconciled without moving member
cash or shares. Delivery recovery, job fairness, automatic noon snapshots, checkout
refresh and loan-liability display are corrected. All 117 automated tests and the
build checks pass; 11 isolated HTTP scenarios and desktop/mobile browser checks
also passed. See the [completion report](STAGE_3_REPORT_AND_TEST_GUIDE.txt) and
[restart procedure](Universe/joe-stock-exchange/docs/stage-2/STAGE_3.md).
