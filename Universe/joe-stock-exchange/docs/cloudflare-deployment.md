# Cloudflare deployment

These are deployment preparations for the connected JoeTrade version. No remote
service or DNS record was changed during local implementation. Use staging
first; live JoeAuth and bank service-token checks still need verification.

## Services and access

| Service          | Address                       | Configuration                              |
| ---------------- | ----------------------------- | ------------------------------------------ |
| Member exchange  | `stock.joe-univer.se`         | `apps/exchange-web/wrangler.jsonc`         |
| Exchange console | `stock-console.joe-univer.se` | `apps/operations-console/wrangler.jsonc`   |
| Exchange API     | `stock-api.joe-univer.se`     | `workers/exchange-api/wrangler.jsonc`      |
| Joe Banking      | `bank.joe-univer.se`          | `../joe-banking/wrangler.production.jsonc` |
| Market engine    | Private scheduled Worker      | `workers/market-engine/wrangler.jsonc`     |

Ask the domain owner for an invitation to the Cloudflare account that owns the
`joe-univer.se` zone, with permission to manage the assigned DNS/custom domains,
Workers and D1 resources. Agree who owns deployments, secrets and recovery.
Do not share the owner's password or Global API Key. A scoped deployment token
can be created after the account/zone and required resource permissions are
known. The existing `auth.joe-univer.se` stays managed by its maintainer.
The homepage does not need to be online for these subdomains to work.

All production configs disable `workers.dev`. The member and console Workers
serve static assets and proxy `/v1/*` through their `EXCHANGE_API` service binding.
Build both apps with `VITE_API_BASE_URL=/v1`, `VITE_IDENTITY_MODE=joeauth`, and
`VITE_DEMO_MODE=false`; examples are included per app. Do not use the visual-only
static demo build or expose the local test configs.

## JoeAuth registration

Register separate confidential apps for banking members, exchange members and
exchange staff, plus an application service identity for exchange settlement.
Use scopes `openid profile email` for member/staff sign-in and `app:service`
for the service token. Confirm these exact deployed endpoints with the JoeAuth
maintainer and rehearse them on distinct staging origins first.

| App              | Callback                                                      | Signed webhook                                               |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Banking members  | `https://bank.joe-univer.se/v1/auth/callback`                 | `https://bank.joe-univer.se/v1/auth/webhook`                 |
| Exchange members | `https://stock.joe-univer.se/v1/sso/member/callback`          | `https://stock.joe-univer.se/v1/sso/member/webhook`          |
| Exchange staff   | `https://stock-console.joe-univer.se/v1/sso/console/callback` | `https://stock-console.joe-univer.se/v1/sso/console/webhook` |

Configure the exact issuer `https://auth.joe-univer.se`. The service's `client_id`
and internal `app_id` must match the bank allowlist. The service token verifier
requires an EdDSA application JWT with the expected subject, issuer, audience,
client and app claims. Test key rotation, suspension, consent revocation and
webhook replay. Do not equate JoeAuth staff status with exchange permissions.

## Secrets and environment

Use `wrangler secret put NAME --config CONFIG_PATH` for each value; never put
values in source files, shell history or frontend variables. Configure separate
secrets per environment.

| Worker        | Required values                                                                                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exchange API  | `SESSION_SECRET` (random, at least 32 characters), `JOEAUTH_CLIENT_ID`, `JOEAUTH_CLIENT_SECRET`, `JOEAUTH_APP_ID`, `JOEAUTH_WEBHOOK_SECRET`, `JOEAUTH_CONSOLE_CLIENT_ID`, `JOEAUTH_CONSOLE_CLIENT_SECRET`, `JOEAUTH_CONSOLE_APP_ID`, `JOEAUTH_CONSOLE_WEBHOOK_SECRET`, `JOEAUTH_SERVICE_CLIENT_ID`, `JOEAUTH_SERVICE_CLIENT_SECRET` |
| Banking       | `SESSION_SECRET` (independent random value), `JOEAUTH_CLIENT_ID`, `JOEAUTH_CLIENT_SECRET`, `JOEAUTH_APP_ID`, `JOEAUTH_WEBHOOK_SECRET`, `JOESE_CLIENT_ID`, `JOESE_APP_ID`                                                                                                                                                            |
| Market engine | `INTERNAL_API_KEY` for its optional protected internal endpoint                                                                                                                                                                                                                                                                     |

The exchange and engine must use `BANKING_MODE=connected`; the API requires
`LOCAL_DEMO=false`, production origins and HTTPS `BANKING_API_URL`. Banking uses
`ENVIRONMENT=production` and `ALLOW_LOCAL_DEMO=false`. Never configure
`LOCAL_SERVICE_SECRET` or `JOESE_LOCAL_SERVICE_SECRET` in production. Legacy
exchange password/email/loan variables are retained for historical code only;
Turnstile/Resend are not prerequisites for JoeAuth sign-in in connected mode.

## Database and release order

1. Authenticate Wrangler to the agreed account and create separate banking and
   exchange D1 databases. Replace all all-zero IDs with the reviewed database IDs.
   The exchange API and market engine share the exchange DB, not the bank DB.
2. Back up any existing deployment and record its exact migration state. Rehearse
   all migrations on staging before remote use. Do not replay or edit old
   migrations. An existing exchange wallet needs a reviewed one-time migration
   into Banking, not a second opening grant or unverified balance copy.
3. Apply banking migrations using `--config ../joe-banking/wrangler.production.jsonc`
   and the production bank database name. Apply exchange migrations using
   `npm run db:migrate:remote`. These commands change the selected remote DB;
   inspect the selected account and IDs before running them.
4. A fresh exchange may load `database/seed/0001_reference_data.sql` once. Never
   load `local-members.sql` or the banking demo seed remotely.
5. Provision approved product users and staff with unique JoeAuth subjects;
   member links must point to bank customers with that same subject. The old
   password bootstrap endpoint is disabled. Automated enrollment and legacy
   account linking tools are not implemented yet.
6. Set the secrets and frontend production variables. Run both projects'
   `npm run check`, then deploy Banking, exchange API, private market engine,
   member site and console in that order. Banking's deployment must explicitly
   use `wrangler.production.jsonc`; its default config is local-only.
7. Attach the four reviewed custom domains in the existing Cloudflare zone and
   verify TLS, DNS and service bindings. The frontend deploy commands use their
   checked-in `joe-univer.se` domain routes.
8. Verify health and same-origin `/v1` on both sites, separate member/staff
   sessions, founder confirmation, bank holds, partial fills, cancellation,
   share offers, wires, outage recovery and signed identity revocation in staging.
   Reconcile both ledgers and share totals before opening production access.

The engine Cron Trigger runs hourly and checks New York time, preserving the
existing market schedule and daylight-saving rules. The API recovery cron runs
every five minutes and performs bounded settlement/release/queued matching work.
Ten active members is a small test audience, but free-plan capacity still depends
on traffic, tick size and database queries. Measure these in staging; a small
member count alone is not a production capacity check.
