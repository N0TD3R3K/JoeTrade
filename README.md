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
and account linking are still required. The exchange is preserved as an independent
project in [`joe-stock-exchange`](Universe/joe-stock-exchange/README.md).

This is a local development release. Banking deposits, interest jobs, lending,
the full operations console, and live JOESE settlement remain future work. No
production data has been migrated and no new websites have been deployed.

Start with the [development plan](DEVELOPMENT_PLAN.md) for milestones, open
decisions, migration requirements, and launch checks.

## Planned products

| Product | Responsibility |
| --- | --- |
| Joe Banking | Available J$, holds, receiver-approved wires, savings, term deposits, loans, and ledger history |
| JOESE | Fictional listings, portfolios, orders, matched trades, scheduled prices, and Joe Wire news |
| Operations consoles | Product-specific administration, investigations, reconciliation, and audit |
| Developer APIs | Documented, versioned integration with market data and authorized account operations |

## Connection to the Joe Universe

JoeAuth provides sign-in, verified identity, and account recovery. JoeTrade
retains its own product membership and permissions. A JoeAuth account does not
automatically grant trading access, administrator access, or a starting balance.

| Address | Purpose | Status |
| --- | --- | --- |
| `joe-univer.se` | Joe Universe homepage, maintained separately by the Joe team | Not online at planning time |
| `auth.joe-univer.se` | Central JoeAuth identity provider | Live discovery checked November 24, 2026 |
| `stock.joe-univer.se` | JOESE member website | Planned |
| `bank.joe-univer.se` | Joe Banking member website | Planned |

Console and API hostnames will be confirmed with the domain owner. The member
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
`npm run check:exchange`. These checks do not deploy services.

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
