# JoeTrade development plan

Planning baseline: November 24, 2026. This document records intended work;
unchecked tasks are not yet completed for production. Local implementation evidence
is recorded below and in the component status files.

## Current local delivery

The bank-backed JOESE implementation now includes shared test members, JoeAuth
member/staff session flows, service-authorized bank holds and settlement,
durable cross-database recovery, founder-confirmed company launches and exact
frozen-share sales. The console uses larger text and responsive navigation.
See [the connected economy notes](Universe/joe-stock-exchange/docs/connected-economy.md)
for implemented behavior and [deployment steps](Universe/joe-stock-exchange/docs/cloudflare-deployment.md)
for the new `joe-univer.se` configuration. Live SSO, migration and deployment
remain unverified; the production milestone checklists are not completion claims.

Next development steps:

1. Review the local exchange and console using Alice and Bob.
2. Add any corrections found in that review and retain cross-service tests.
3. Register separate JoeAuth member/staff/service apps with the maintainer.
4. Build reviewed provisioning and proof-based legacy account linking; rehearse
   once-only wallet migration into Banking without duplicate opening grants.
5. Provision staging D1, secrets and custom domains, then test real SSO, signed
   revocations, edge proxies, settlement recovery and resource limits.
6. Add multi-founder invitation/consent only after the allocation rules are
   approved. Complete banking interest/deposit/loan products separately.
7. Reconcile staging balances/holdings and arrange the production release.

## 1. Goal and starting point

Bring the existing JOESE project and Joe Banking design into one maintainable
repository, integrate both products with JoeAuth, publish supported developer
APIs, and deploy the member websites at `stock.joe-univer.se` and
`bank.joe-univer.se`.

The Universe projects have been copied into `Universe/` with their original
structure. The exchange implementation passes its existing checks. Banking now
has a local member website, a D1 ledger and held balances, receiver-approved
wires, transaction history, and JoeAuth integration code. See
[the implementation status](Universe/joe-banking/docs/implementation-status.md)
for the exact working scope and remaining requirements. No production migration
or deployment has taken place.

JoeAuth and the Joe Universe homepage remain separately maintained projects.
JoeTrade owns their integration, not every Joe Universe application's migration.
Coordinate changes to other websites with their respective maintainers.

All balances and assets remain fictional. No real-money funding, redemption,
payments, prizes, or externally valuable assets are in scope.

## 2. Proposed repository layout

```text
JoeTrade/
├── apps/
│   ├── stock-web/
│   ├── bank-web/
│   ├── stock-console/
│   └── bank-console/
├── workers/
│   ├── exchange-api/
│   ├── banking-api/
│   ├── market-engine/
│   └── banking-engine/
├── packages/
│   ├── auth-client/
│   ├── contracts/
│   ├── market-rules/
│   └── ui/
├── database/
│   ├── exchange/
│   └── banking/
├── docs/
│   ├── architecture/
│   ├── banking/
│   ├── exchange/
│   ├── api/
│   └── operations/
├── tests/
├── README.md
├── DEVELOPMENT_PLAN.md
└── LICENSE
```

This is a target structure. Preserve the existing exchange layout initially if
renaming would obscure the import or break deployment. Separate the import,
reorganization, and behavior changes into reviewable changes.

## 3. System ownership

| System                | Source of truth                                                          |
| --------------------- | ------------------------------------------------------------------------ |
| JoeAuth               | Identity, verified email, login, recovery, global account status         |
| Joe Banking           | Liquid J$, double-entry ledger, holds, wires, deposits, loans, interest  |
| JOESE                 | Product membership, assets, holdings, orders, trades, market ticks, news |
| Each product          | Local roles, eligibility, suspension, sessions, and audit history        |
| Joe Universe homepage | Product discovery and shared navigation                                  |

The identity chain is JoeAuth `sub` to an immutable JOESE member ID and an
immutable banking customer ID. Global JoeAuth administrator status must not
automatically grant banking or exchange privileges.

## 4. Milestones

### Milestone 0 — Import and reconcile the baseline

- [ ] Select the authoritative JOESE source revision and banking document set;
      record repository, commit, authorship, and license provenance.
- [x] Import application source, migrations, reference data, tests, and design
      documents without credentials, member data, dependencies, or generated builds.
- [ ] Preserve existing migration history and IDs; do not replay migrations
      against a live database merely because the repository moved.
- [ ] Keep one authoritative document set and repair internal links.
- [x] Record imported CC0 material and preserve dependency/asset license notices.
- [ ] Resolve the old decision prohibiting member transfers against the later
      receiver-approved wire rules.
- [ ] Reconcile existing annual-rate/daily-interest exchange loans with the new
      weekly-rate banking design. Preserve accepted legacy terms unless an explicit
      conversion policy is approved.
- [ ] Confirm how the no-leverage rule interacts with bank-funded trading.

**Completion:** the imported exchange passes its existing checks, the banking
design is traceable, and contradictions have explicit recorded decisions.

### Milestone 1 — Establish development and deployment foundations

- [ ] Configure workspaces, supported runtime versions, shared types, and
      component-specific development commands.
- [ ] Add ignored local secret files and examples containing placeholders only.
- [ ] Establish isolated local, staging, and production databases and settings.
- [ ] Add automated type checks, relevant tests, and builds for changed services.
- [ ] Define maintainers, review ownership, release procedure, and incident owner.
- [ ] Record Cloudflare account ownership, zone access, and deployment access.

**Completion:** a contributor can run the imported components locally using
documented commands and synthetic data; staging cannot mutate production data.

### Milestone 2 — Integrate JoeAuth and link existing accounts

- [ ] Review a pinned current JoeAuth revision and deployed discovery metadata.
      Update the November 12 adaptation documents before using them as a contract.
- [ ] Register separate clients for stock members, bank members, each console,
      and service settlement; separate staging credentials from production.
- [ ] Implement server-side Authorization Code with PKCE S256, one-use state,
      nonce, exact callbacks, and strict issuer/audience/signature/time validation.
- [ ] Select signing keys by `kid`; refresh on an unknown key and reject it if
      still unknown. Never fall back to an arbitrary signing key.
- [ ] Create host-scoped Secure HttpOnly product sessions; store refresh tokens
      encrypted on the server if offline access is needed.
- [ ] Link legacy users only after proof of both JoeAuth and legacy-account
      control. Enforce unique links and retain historical product IDs.
- [ ] Preserve school-domain/invitation eligibility independently of global
      JoeAuth registration. Linking cannot issue a second opening balance.
- [ ] Implement logout and verified lifecycle webhook handling, timestamp/replay
      checks, duplicate handling, and local session revocation.
- [ ] Retain live account checks for sensitive writes and a documented fallback
      for missed lifecycle notifications.
- [ ] Reassess password storage, privileged authentication, refresh grants,
      key rotation, service-token permissions, and recovery against current source.

**Completion:** wrong issuer/audience, replayed callbacks, duplicate links,
revoked/suspended users, and unauthorized console/service identities are rejected.

Current evidence: live discovery advertises `/oauth/logout`; current JoeAuth
documentation describes signed account lifecycle webhooks and overlapping keys.
These supersede some older planning assumptions, but documentation/discovery
alone do not prove correct end-to-end behavior.

### Milestone 3 — Implement the banking ledger and settlement contract

- [ ] Create the banking database, customer links, ledger accounts, balanced
      transactions, immutable business references, and rebuildable projections.
- [ ] Use integer cents for amounts and exact fixed-point rate calculations;
      carry sub-cent interest remainders until posting.
- [ ] Implement holds, available balances, local account freezes, attributed
      reversal/correction entries, and retry-safe state transitions.
- [ ] Implement internal JOESE hold, partial settlement, release, sale-credit,
      and reconciliation APIs with explicit service identity allowlists.
- [ ] Define matching/settlement recovery across the two databases: intermediate
      states, asset reservations, outbox/inbox delivery, retries, and reconciliation.
- [ ] Make trading fail closed when a required banking reservation is unavailable.

**Completion:** concurrent requests cannot overspend or duplicate a posting;
interrupted trade settlement recovers to a reconciled state without losing J$
or assets. A shared repository does not imply a cross-database transaction.

### Milestone 4 — Deliver the banking member site and console

- [ ] Build the white banking interface with Account Balance, Transaction,
      Interest Rate, Deposits, and Loans navigation, plus Inbox and account details.
- [ ] Distinguish available J$, held J$, deposits, investments, and liabilities.
- [ ] Implement sender-initiated wires with receiver acceptance/decline and
      cancellation of pending wires. Do not add payment requests or pull payments.
- [ ] Add exact-match recipient lookup without exposing the user directory.
- [ ] Implement rate history, flexible savings, term deposits, accrual, and
      once-only interest/maturity posting.
- [ ] Build role-protected console views for rates, wires, deposits, lending,
      freezes, corrections, reconciliation, and audit; no arbitrary set-balance field.
- [ ] Add loans only after the outstanding product decisions in section 5.
- [ ] Enforce operator/member separation across banking and exchange services.
- [ ] Verify keyboard access, mobile layouts, confirmation details, and errors.

**Completion:** supported member journeys work end to end, users cannot access
another member's records, and every money-changing operation is auditable.

### Milestone 5 — Publish and support developer APIs

- [ ] Inventory the existing JOESE OpenAPI contract and map every supported route
      to market-data, member, operator, or internal-service access.
- [ ] Publish versioned exchange and banking schemas, authentication instructions,
      pagination, rate limits, errors, idempotency rules, and synthetic examples.
- [ ] Define eligible external clients, credential issuance/revocation, and
      product-specific permissions independently of global login scopes.
- [ ] Decide whether any read-only market data should be anonymous; trading and
      personal data retain membership and authorization checks.
- [ ] Keep settlement, scheduled engine invocation, and privileged controls
      internal even when their contracts are documented.
- [ ] Verify the published contract against actual responses and denied access.

**Completion:** an authorized developer can integrate from documentation alone;
opening the API does not expose personal records or administrative authority.

### Milestone 6 — Migrate existing balances and obligations

- [ ] Inventory the actual deployed exchange version, accounts, balances, open
      orders, pending transfers, share offers, and legacy loans.
- [ ] Export a protected backup and test recovery; rehearse on an isolated copy.
- [ ] Define a controlled maintenance window and pause balance-changing writes.
- [ ] Reconcile source balances and post one attributed banking opening entry
      per migrated member, including outstanding holds and liabilities correctly.
- [ ] Switch exchange balance reads, reservations, and settlement to Banking.
- [ ] Reconcile member totals, system totals, obligations, and identity links
      before reopening writes. Remove independent exchange balance mutation.
- [ ] Define rollback before and after banking postings become authoritative.
      After new postings exist, freeze and reconcile or forward-repair; never restore
      an old database and silently discard completed activity.

**Completion:** migration neither creates another starting grant nor loses or
duplicates a balance, hold, asset, accepted transfer, or loan obligation.

### Milestone 7 — Deploy domains and launch a monitored beta

- [ ] Confirm the owner and active Cloudflare zone for `joe-univer.se`, the
      account hosting Workers, and Derek's authorized management access.
- [ ] Prefer the zone-owning account for the standard Workers Custom Domain
      setup. If separate accounts are required, agree and verify a supported routing
      arrangement before changing DNS; a DNS record alone grants no deployment access.
- [ ] Confirm `stock.joe-univer.se` and `bank.joe-univer.se`; finalize console/API
      hosts with the team. Do not replace the existing auth configuration.
- [ ] Configure independent Worker deployments, databases, scheduled jobs,
      protected secrets, Custom Domains, certificates, and release credentials.
- [ ] Verify final JoeAuth callbacks, issuer, logout redirects, webhook URLs,
      host-scoped cookies, CSRF controls, and exact-origin CORS together.
- [ ] Keep engines/settlement private and consoles protected by local roles;
      optional Cloudflare Access adds protection without replacing those roles.
- [ ] Confirm backups, restore procedures, monitoring, alerts, and incident roles.
- [ ] Canary with a small group, then expand after reconciliation stays clean.
- [ ] Enable Back to Universe only when the homepage is live and agreed with its
      maintainer. Its current absence does not block the two product sites.

**Completion:** Derek can deploy and manage both websites using his own
authorized access, and login, banking, trades, scheduled jobs, and recovery are
verified on the final hostnames.

## 5. Product decisions to record before affected features launch

| Decision                 | Existing baseline / action required                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Initial Joe Rate         | 1.000% per week is proposed, not approved                                                                           |
| Variable Joe Rate bounds | 0.300%–2.000% per week                                                                                              |
| Rate adjustments         | At most two per Monday-to-Monday New York calendar week; each moves 0.005–0.200 percentage points                   |
| Term deposits            | 2 weeks at 1.000%, 4 weeks at 1.500%, 8 weeks at 2.250%, all quoted weekly; fixed contracts ignore variable changes |
| Early term withdrawal    | Locked until maturity is proposed; confirm exceptional correction policy                                            |
| Loans                    | Decide limits, eligibility, fixed products, variable terms, due dates, repayment allocation, grace, and delinquency |
| Loan-funded trading      | Decide whether permitted and align the market's leverage rules                                                      |
| Legacy loans             | Preserve or explicitly convert annual-rate/daily-accrual contracts                                                  |
| Opening grants           | Preserve the existing once-only J$10,000 eligibility; decide future issuance ownership under Banking                |
| Pending wires            | No expiry until a duration/notification policy is approved                                                          |
| Market behavior          | Preserve existing scheduled prices and matched-trade rules during import; version changes separately                |
| Operations               | Name administrators, operators, backup owner, incident owner, and beta migration date                               |
| Developer access         | Decide data visibility, app approval, scopes/permissions, and usage limits                                          |

Store timestamps in UTC and derive business periods in `America/New_York`.
Rate limits apply to the variable Joe Rate, not the separately specified fixed
term-deposit catalog. Do not silently substitute annual rates for weekly rates.

## 6. Release checks

- [ ] Authentication, authorization, cross-member isolation, and revocation pass.
- [ ] Ledger sums balance and projections reconcile after retries and recovery.
- [ ] Concurrent orders and wires cannot spend the same available J$.
- [ ] Duplicate wires, fills, credits, rate jobs, and maturities have one effect.
- [ ] Rate bounds, concurrent third-adjustment rejection, fixed contracts,
      rounding, missed jobs, and daylight-saving transitions pass.
- [ ] Existing JOESE market schedule, role separation, and price integrity pass.
- [ ] Migration reconciles all identities, balances, holdings, and obligations.
- [ ] API documentation matches the release and unauthorized calls are denied.
- [ ] Final-domain login, logout, callbacks, certificates, and navigation pass.
- [ ] Production has no demo mode, placeholder bindings, committed credentials,
      or synthetic test accounts with unintended privileges.
- [ ] Backup restoration and incident freeze/recovery are rehearsed.

## 7. Planning sources

This plan is based on the `Universe/joe-banking` and
`Universe/joe-stock-exchange` Markdown documents, their corresponding source
copies under Joelib, the Joelib license and contribution guidance, and the sources
below. The Universe documents are now copied into JoeTrade. See
[import notes](Universe/IMPORT_NOTES.md) for source attribution; this is a local
working-tree snapshot, not an asserted exact upstream release.

- [JoeTrade repository](https://github.com/N0TD3R3K/JoeTrade)
- [JoeAuth repository and current documentation](https://github.com/Histar4522/JoeAuth)
- [JoeAuth integration and lifecycle webhooks](https://github.com/Histar4522/JoeAuth/blob/master/docs/webhooks-and-verification.md)
- [Live JoeAuth discovery](https://auth.joe-univer.se/.well-known/openid-configuration)
- [Cloudflare Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [JoeAuth MIT license](https://github.com/Histar4522/JoeAuth/blob/master/LICENSE)
- [CC0 permissions](https://creativecommons.org/publicdomain/zero/1.0/)
