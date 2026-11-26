# Stage 3 restart and validation

Read the root `STAGE_2_REPORT_AND_STAGE_3_HANDOFF.txt` first, then the owner’s
Dev_Note and consolidated staged note. Preserve the original sibling Universe
folder and owner DRK/TST, balances, holds, shares and authentication configuration.

Stage 2 tested the new migrations on isolated copies of the existing local databases.
The normal `.wrangler/state` stores were not migrated, reseeded or used for new cash
operations. The Stage 2 QA policy exists only in the isolated copy and is not an
owner-approved operating policy. Temporary QA servers are stopped at handoff.

Before the real local review, back up both working D1 stores, compare reconciliation
and share totals, then apply only the new additive numbered migrations using the
existing local migration scripts. Never run the demonstration seeds against those
working stores. Review imported unknown cost lots/historical sale evidence; do not
make up exact bases or approve production policy to make reports look populated.

Run focused checks, then full integration/browser tests for the owner’s Stage 3 list:
rate scheduling/cancel and execution races, weekly quota/delay/changed-policy cases,
loan exact acceptance/fixed/variable accrual and repayment, grant/reserve retries,
checkout/renewal/cancel/refund recovery, employee acceptance and funded payroll,
tax corrections/partial collection/refunds and funded redistribution, noon/DST/common
cutoffs, company ownership changes/moderation and data scope. Exercise legacy migration
and provider/service outages. Check combined payroll/tax periods and queued jobs with
more than one batch. Keep production resource limits and pagination on the release list.

Real merchant integration remains external work: ChatJoePT must consume and deduplicate
its signed payment results using the member’s JoeAuth subject, then acknowledge them.
Provision the approved app identity and service-specific verification key securely.
Bank deposits remain unavailable; do not infer new deposit interest from the loan engine.

After any remaining integration/bug fixes, start the existing local services:

```sh
# Universe/joe-banking
npm run dev:api
# Universe/joe-stock-exchange, separate terminals
npm run dev:api:local
npm run dev:exchange:test
npm run dev:console:test
# Optional separate bank member site, Universe/joe-banking
npm run dev:test
```

Member http://127.0.0.1:4173; console http://127.0.0.1:4174;
bank member site http://127.0.0.1:4180. Use Alice and Bob and the separate operator,
not a shared staff/member identity. Leave these real local previews running for
owner testing at the end of Stage 3, with clearly labeled remaining configuration.
No production deployment or DNS action is authorized by these stages.
