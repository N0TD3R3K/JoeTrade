# Universe import notes

Imported into JoeTrade on November 24, 2026 from the local sibling `Universe/`
folder. This is a copy of the local working tree, not a fresh remote checkout or
an assertion that all files match a published commit.

## Source and licensing

The banking documents and stock-exchange source originated in
[N0TD3R3K/Joelib](https://github.com/N0TD3R3K/Joelib). The local Joelib checkout
reported HEAD `dbe4672e7fc7e95d492f603b5eff3b03e6fa74e8` at import time; the
copied Universe tree may include subsequent local changes. Keep this distinction
when tracing a file to an upstream revision.

The source Joelib repository uses CC0 1.0 Universal. Its legal text is preserved
in [LICENSE-CC0](LICENSE-CC0). The pre-existing imported material retains that
status. New JoeTrade implementation work uses the root MIT license. Existing
third-party dependency and asset licenses continue to apply independently.

The pre-existing banking README's status section has been updated for the new
implementation; its product and engineering design documents remain alongside
the new implementation-status document. The exchange application source and
its historical migrations have been retained without behavior changes.

## Copy exclusions

Excluded installed `node_modules`, generated `dist` output, `.wrangler` runtime
state, local `.env` and `.dev.vars` files, Git metadata, build caches, and macOS
metadata. Example environment files are retained. Install dependencies from
each project's lockfile to recreate its development environment.

The original sibling Universe folder has not been edited.

## Deployment boundary

Copied exchange deployment files still describe their existing project names,
hostnames, and database bindings. They are historical configuration, not an
instruction to create or migrate production resources. Review them before any
later deployment, particularly before moving to the new stock hostname.

The new bank uses an independent local database with a placeholder remote ID.
Its only seed data is explicitly synthetic and local. No production accounts,
financial data, credentials, DNS records, or deployments have been changed by
this import.
