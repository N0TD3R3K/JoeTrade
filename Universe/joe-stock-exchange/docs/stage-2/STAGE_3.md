# Stage 3 local review and restart

Implementation and local checks completed November 26, 2026. Read the root
[Stage 3 report and test guide](../../../../STAGE_3_REPORT_AND_TEST_GUIDE.txt)
for the completed checks, preserved balances and owner test flows. The original
`Dev_Note.txt` and `Universe/staged_dev_note.txt` remain the design authority.

## Prepared working stores

Both local D1 stores were backed up before migration in the root ignored folder
`.wrangler/backups/stage3-20261126T173759Z/`. Banking migrations `0003`/`0004`
and exchange `0008`/`0009` are applied. Original ledger entries, balances, holds,
holdings, orders, share offers and listings were compared with the backup.
Do not reset or reseed these stores. Preserve the sibling original Universe folder.

Five remaining imported cost lots and both historical share sales were reviewed
using the original prepared settlements and posted bank journals. DRK/TST company
accounts are initialized with attributed locked capital and zero operating cash.
Member cash and share quantities were not changed by reconciliation. Unknown
costs and unresolved income reviews are both zero at handoff.

## Start or stop all three websites

From the JoeTrade root:

```sh
npm run dev:all
```

| Website | Local address | Test identity |
| --- | --- | --- |
| JOESE | http://127.0.0.1:4173/account | Alice/Bob in Test member |
| Console | http://127.0.0.1:4174/ | Separate local operator |
| Joe Banking | http://127.0.0.1:4180/ | Alice/Bob in account menu |

The runner starts the bank API (`8788`), exchange API (`8787`) and market engine
(`8791`) as well as the three frontends. It uses the existing ignored local
service credentials and refuses occupied ports. It neither migrates nor seeds
nor approves policy. Keep its terminal running. Use the exact `127.0.0.1` links.

Every minute the runner invokes local bank/exchange scheduled work and asks the
engine for the current hourly tick. Market ticks still respect the engine's
New York 14:00–22:00 session and stable hourly keys; there are no forced prices.
The local order-entry schedule remains relaxed for member testing. Production
configuration retains its normal trading schedule and disables demo sessions.

Stop only this owned preview group with:

```sh
npm run stop:local
```

Logs and process status are ignored under `.wrangler/local/`. The runner does
not kill unrelated processes or overwrite live JoeAuth credentials.

## Configuration to review in the console

At the original Stage 3 handoff, the policy and reserve were uninitialized.
The owner's subsequent request authorized local initialization: policy version 1
now has a 1.000% weekly Joe Rate, a once-only J$100,000 reserve, no loan products,
zero lending/redistribution budgets and no duplicate opening grants. Rate
scheduling and cancellation are available in **Joe Bank**. Review the separate
[loan proposal](../../../joe-banking/docs/loan-system-proposal.md) before approving
a lending catalog. Do not repeat reserve initialization.

Rates, service billing, bank offers, employee payroll, tax and redistribution have
been tested on an isolated copy. Eligibility grants need a real, reviewed JoeAuth
subject link; do not fabricate links for Alice or Bob or grant duplicate seed cash.

## Validation completed

- 71 banking and 46 exchange tests pass, including real SQLite migrations.
- Type checks, three frontend builds and three Worker dry runs pass.
- Eleven scenarios pass through actual local Worker HTTP APIs on an isolated copy.
- Browser tests cover exact loan acceptance, repayment on both sites, consented
  checkout, immediate portfolio refresh, both members, company reports, the public
  guide and responsive member/banking/console layouts.
- Migration comparison preserves every original financial/share row; both foreign
  key checks are clean, all posted journals balance, and recovery queues are empty.

The isolated HTTP script is `scripts/stage3-isolated-smoke.mjs`. It is intentionally
fixed to QA API ports `8789`/`8790`. Run only on a fresh disposable copy migrated
through the current schema, with matching ignored credentials and the member/console
origins `4173`/`4174` and bank origin `4180`. It approves a test policy and moves
fictional test cash on that copy. Recreate the disposable copy before a full rerun.
Do not point it at working or remote data. Temporary QA servers are stopped.

## Separate release work

Live JoeAuth app/role provisioning, reviewed account links, real service receipt
consumers, Cloudflare resources, secrets, staging sign-in, resource-limit review,
production migration rehearsal, DNS and deployment remain separate release work.
No production deployment or DNS action was performed. Discussion and bank deposit
funding/interest posting remain explicitly deferred. The three local previews are
left running for owner testing.
