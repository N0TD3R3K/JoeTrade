# JoeTrade

JoeTrade is the planned home of the Joe Universe's fictional economy: **Joe
Banking**, **JOE Stock Exchange (JOESE)**, and their developer APIs. It connects
these products through [JoeAuth](https://github.com/Histar4522/JoeAuth) while
keeping identity, banking, and market responsibilities separate.

**Joellars (J$) are fictional and have no real-world value.** They cannot be
purchased with, exchanged for, or redeemed as real money, goods, services,
prizes, or cryptocurrency. JoeTrade is a closed simulation for entertainment
and collaborative world-building.

## Project status

JoeTrade is in the planning stage. This repository currently contains the
README, development plan, and license. The existing JOESE implementation and
banking design documents have not yet been imported here. Banking is currently
a design, and the features below are development goals rather than available
services.

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

There are no application install, run, test, or deployment commands yet.
Those instructions will be added as the corresponding components are imported
or implemented. The intended platform is Cloudflare Workers, static assets,
D1, and scheduled Workers, following the existing JOESE architecture.

The [development plan](DEVELOPMENT_PLAN.md#proposed-repository-layout) describes
the proposed layout; those application directories do not exist yet.

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
