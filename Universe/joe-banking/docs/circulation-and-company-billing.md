# Circulation and company billing design

> Current development status (November 26, 2026): Stage 2 services and UI are implemented. See [Stage 2 accounting and billing](../../joe-stock-exchange/docs/stage-2/ACCOUNTING.md) and the root Stage 2 TXT report. Earlier Stage 1/foundation descriptions below are historical. Policies stay unconfigured until reviewed approval; deposits remain unavailable. Final owner review is Stage 3.

Stage 1, November 25, 2026. This is a design, not an implemented Banking product.
The owner's [Dev_Note](../../../Dev_Note.txt) is the priority source; employees
receive the designated revenue share. Read the shared [design decisions](../../joe-stock-exchange/docs/stage-1/DECISIONS.md)
and [service/ledger contracts](../../joe-stock-exchange/docs/stage-1/SERVICE_CONTRACTS.md).

Banking will own company operating accounts, reserve funding, buyer-authorized
checkout and recurring consent, payroll, tax collection and redistribution.
JoeSE will own publication, stock/share records, cost-lot evidence, news and
reference valuation. Each service validates its own permissions and policies.

Company founding capital stays locked. Subscriptions and purchases put new
revenue into a separate company operating account; accepted employee agreements
and a funded company-selected payout policy determine wages. Retained revenue
stays company-owned cash. No extra money is credited as a price increase.
Stock price still follows the scheduled market engine; a new fundamentals signal
is not enabled in Stage 1.

Weekly tax retains the owner's whole-income brackets; J$1,600 at 2% is J$32.
Costs/fees and exact FIFO basis determine realized trading gains. Wires, loans,
capital, opening grants and unrealized changes do not become taxable wages.
Unknown historical cost basis blocks the affected assessment for reconciliation,
not trading itself. Collection cannot consume existing holds or make cash negative.

Bank reserves are a separate bank-owned pot. Planned initial reserve is J$100,000
once; the warning is strictly below J$90,000. Opening J$10,000 member grants use
explicitly authorized separate issuance so enrollment cannot silently consume
that reserve. No grants or reserves are initialized by Stage 1.

Equal-member redistribution uses received taxes/loan interest, an approved budget
and headroom above the reserve warning threshold after obligations. No numeric
payout budget or employee-pool percentage has been invented. Rate recommendations
need explainable loan/deposit cash-flow data and always require operator action.

The noon New York dashboard distinguishes posted/available member funds, holds,
company operating cash, locked capital, fee clearing, reserves and reference-valued
assets. Common-cutoff reconciliation is required before a snapshot is labeled
reconciled. Unknown data is unavailable; it is not J$0.

Draft SQL lives at `database/drafts/stage1_economy.sql` in the Banking project. It is outside the migration loader and adds
no seeds. Stage 2 must review/promote additive migrations and implement atomic
posting, policy approval, period locks and durable event delivery before enabling
new features. Existing journal/identity records must survive unchanged.
