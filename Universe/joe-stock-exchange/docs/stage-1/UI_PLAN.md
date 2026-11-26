# Stage 1 UI and state plan

The shell and read-only pages are implemented foundations. Features labeled
Stage 2 are planned services, not functioning forms that pretend to succeed.

## Member workspace

```text
Desktop
+----------------------+---------------------------------------------+
| JoeSE                | identity / market status / Guide / Inbox    |
| Account Overview     +---------------------------------------------+
| Stock Listings       | selected member page                        |
| News                 |                                             |
| Posts                | trading: asset list | ticket | portfolio    |
| Discussion           | overview: balances, actions, all holdings   |
| My Company           | news: published articles, dates, direction |
| Member guide         |                                             |
+----------------------+---------------------------------------------+

Mobile
+----------------------------------------------------+
| Navigation | JoeSE | Guide | Inbox | Account        |
+----------------------------------------------------+
| selected page; menu is a dismissible drawer         |
| listings: Browse listings / View portfolio drawers  |
+----------------------------------------------------+
```

| Destination | Route | Stage 1 | Stage 2 |
| --- | --- | --- | --- |
| Account Overview | `/account`, `/` | Existing Banking balance, held J$, ordinary/frozen values, holdings and live existing transaction/Inbox/share-offer actions. Bank link. | Loan and income history integration after service readiness. |
| Stock Listings | `/market`, optional `?ticker=...` | Existing stock/crypto groups, profile, charts, order ticket, company launch, listing comments and portfolio drawers. | Revenue/fundamental metadata only after a versioned signal exists. |
| News | `/news` | Published Joe Wire articles from the existing snapshot, no drafts. | Effective rate bulletins with operation link and source/effective times. |
| Posts | `/posts` | Honest unavailable state explaining company eligibility and removal rights. | Authorized company selector, title/body, Publish; author/operator Withdraw/Delete with reasons/version checks. |
| Discussion | `/discussion` | Planned state; existing per-listing comments remain under listings. | Still deferred; a separate design is required before enabling a forum. |
| My Company | `/company` | Own current company holdings and clearly unavailable aggregate reports. No invented revenue or complete shareholder list. | Developer/shareholder selector; weekly/lifetime revenue, refunds, wages, retained cash, locked capital, market cap, weekly reference change, shareholder display names/quantities/percentages. Manager-only service/employee controls. |
| Guide | `/guide` | Public handbook loads without a bank/JoeAuth session. | Update instructions alongside newly working features. |
| Settings | `/settings` | Existing preferences; Back returns to overview. | Keep stable. |

Navigation supports direct paths and browser back/forward. Unknown paths show a
useful not-found state; `/verify` retains the legacy verification entry flow.
Use real anchors with interception only for ordinary same-tab clicks. Modified
clicks can open another tab. No global role automatically confers company rights.

### State and interaction rules

- Loading, failure, empty and unavailable are different states. Keep failed data
  distinct from an empty result. Missing amounts show unavailable rather than J$0.
- Read-only fields identify their source/as-of time when the new services exist.
- Existing actions remain available from Overview or the trading portfolio.
- Do not hide crypto, company launch or private share offers during navigation.
- No data from the old exchange wallet substitutes for a failing Banking call.
- Posts must recheck server eligibility at publish; self-removal remains possible
  after sale of shares. Deletion requires an intentional action and attributed
  moderation record; no irreversible client-only deletion.
- My Company managers and shareholders get different payloads, not hidden CSS
  over the same sensitive customer/employee response.

## Console → Joe Bank

```text
Joe Banking / source and availability notice
Economy snapshot             Rate operations
  captured/as-of/status        current policy/history (future)
  money and asset buckets      Preview adjustment (Stage 1 calculator)
  reserve ratio/warning        schedule/cancel list (Stage 2)
Loan offers                  Income / tax / redistribution
  catalog/acceptance status    assessment and collection are separate
  approved offer form         budgets, sources, receipts, unpaid amounts
Company services / employees / revenue (manager scoping)
```

Stage 1 implements layout cards with honest unavailable labels. The rate popup
is a pure calculation preview: example current weekly rate, signed change and
proposed New York date/time. It does not claim to load the current rate, convert
a date to an effective instant, schedule, cancel, save or publish an event.
`Calculate example` is the only enabled new action. Errors cover rate bounds,
precision and step rules. The selected time is UI planning data only.

Stage 2 replaces example input with the server's current policy/version and a
DST-aware effective-time preview. Require date/time, signed movement, reason,
member explanation, internal note, affected products and remaining weekly slots.
Show pending/applied/canceled/failed rows. Cancel only pending rows; show a
version-conflict message when execution wins. A successful rate change creates
one linked published news record; a cancellation changes no rate or market price.

Loan-offer creation remains disabled until an approved catalog and Banking role
exist. Final form includes member, product/principal, weekly rate kind, term,
payment dates, expiration and exact terms; creating an offer does not disburse.
Payroll, taxes and reserve actions need their own permission and confirmation,
not a generic exchange-operator switch.

## Accessibility and visual checks

Use labeled controls, visible focus, keyboard-operable dialogs and drawer close
buttons. Keep body copy at least 16px and regular labels at least 14px. Validate
at desktop, intermediate and phone widths; tables may scroll inside a labeled
region without horizontal page overflow. Stage 3 must test complete real-account
workflows; Stage 1 preview checks do not establish production readiness.
