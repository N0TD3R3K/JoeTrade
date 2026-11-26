# Stage 1 foundation

Owner requirements: [Dev_Note.txt](../../../../Dev_Note.txt), prioritized over
[the older handoff](../../../../HANDOFF_NEXT_SESSION.txt). Consolidated plan:
[staged_dev_note.txt](../../../staged_dev_note.txt). Employee revenue recipients
were clarified by the owner.

Read in order:
1. [Design decisions and policy defaults](DECISIONS.md).
2. [UI layout, routes and state plan](UI_PLAN.md).
3. [Proposed service contracts, ledger flows and schema promotion](SERVICE_CONTRACTS.md).

Implemented in Stage 1: six-route member navigation; Overview with existing
financial actions and held/post balances; published News page; honest planned
Posts/Discussion/company-report states; console economy cards and a pure rate
calculation popup; shared typed contracts and exact unit/calendar/tax-preview
helpers. Additive SQL drafts remain outside startup migration folders.

Not implemented: actual new subscriptions, payroll, tax collection, reserve
initialization, redistribution, rate scheduling/news delivery, bank loan services,
company post publishing or revenue reports. Capability labels are UI messaging,
not server authorization. All new financial services remain unavailable.

Stage 2 implements services and promotes reviewed additive schemas. Stage 3
finishes integrations, tests full workflows, fixes bugs and leaves real local
Alice/Bob previews running for owner review. No production deployment is implied.

Completion and Stage 2 continuation: [Stage 1 TXT report](../../../../STAGE_1_REPORT_AND_STAGE_2_HANDOFF.txt).
