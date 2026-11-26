-- STAGE 1 DRAFT ONLY. No startup migration, seed or live financial operation.
PRAGMA foreign_keys = ON;
CREATE TABLE company_product_roles (
 asset_id TEXT NOT NULL REFERENCES assets(id), user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('manager','moderator')), granted_by TEXT NOT NULL REFERENCES users(id),
 revoked_at INTEGER, PRIMARY KEY(asset_id,user_id,role)
);
CREATE TABLE company_posts (
 id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), author_id TEXT NOT NULL REFERENCES users(id),
 title TEXT, body TEXT, state TEXT NOT NULL CHECK(state IN ('published','withdrawn','deleted')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((state='deleted' AND title IS NULL AND body IS NULL) OR (state!='deleted' AND title IS NOT NULL AND body IS NOT NULL AND length(title) BETWEEN 1 AND 180 AND length(body) BETWEEN 1 AND 10000))
);
CREATE INDEX company_posts_feed ON company_posts(state,created_at);
CREATE TABLE company_post_events (
 id TEXT PRIMARY KEY NOT NULL, post_id TEXT NOT NULL REFERENCES company_posts(id), actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN ('publish','withdraw','delete')), reason TEXT,
 occurred_at INTEGER NOT NULL, resulting_version INTEGER NOT NULL, UNIQUE(post_id,resulting_version)
);
CREATE TRIGGER company_post_events_no_update BEFORE UPDATE ON company_post_events BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER company_post_events_no_delete BEFORE DELETE ON company_post_events BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
-- Exact units: 100 per whole stock share, 1 per 0.01 crypto unit. The holding
-- kind stays separate so ordinary and frozen shares never share the same lot.
CREATE TABLE trade_cost_lots (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), asset_id TEXT NOT NULL REFERENCES assets(id),
 holding_kind TEXT NOT NULL CHECK(holding_kind IN ('stock','shareholding','crypto')),
 source_reference TEXT NOT NULL UNIQUE, acquired_at INTEGER NOT NULL,
 quantity_units INTEGER NOT NULL CHECK(typeof(quantity_units)='integer' AND quantity_units>0),
 remaining_units INTEGER NOT NULL CHECK(typeof(remaining_units)='integer' AND remaining_units BETWEEN 0 AND quantity_units),
 total_basis_cents INTEGER CHECK(typeof(total_basis_cents)='integer' AND total_basis_cents>=0),
 remaining_basis_cents INTEGER CHECK(typeof(remaining_basis_cents)='integer' AND remaining_basis_cents BETWEEN 0 AND total_basis_cents),
 state TEXT NOT NULL CHECK(state IN ('verified','unresolved')),
 CHECK((state='unresolved' AND total_basis_cents IS NULL AND remaining_basis_cents IS NULL) OR (state='verified' AND total_basis_cents IS NOT NULL AND remaining_basis_cents IS NOT NULL))
);
CREATE TABLE trade_basis_disposals (
 id TEXT PRIMARY KEY NOT NULL, lot_id TEXT NOT NULL REFERENCES trade_cost_lots(id), sale_reference TEXT NOT NULL,
 quantity_units INTEGER NOT NULL CHECK(typeof(quantity_units)='integer' AND quantity_units>0),
 allocated_basis_cents INTEGER NOT NULL CHECK(typeof(allocated_basis_cents)='integer' AND allocated_basis_cents>=0),
 net_proceeds_cents INTEGER NOT NULL CHECK(typeof(net_proceeds_cents)='integer' AND net_proceeds_cents>=0),
 realized_gain_cents INTEGER NOT NULL CHECK(typeof(realized_gain_cents)='integer'),
 CHECK(realized_gain_cents=net_proceeds_cents-allocated_basis_cents), UNIQUE(lot_id,sale_reference)
);
CREATE TABLE bank_economy_receipts (
 event_id TEXT PRIMARY KEY NOT NULL, payload_hash TEXT NOT NULL, received_at INTEGER NOT NULL,
 source_operation_id TEXT NOT NULL, kind TEXT NOT NULL, UNIQUE(source_operation_id,kind)
);
CREATE TABLE rate_market_event_links (
 bank_operation_id TEXT PRIMARY KEY NOT NULL, receipt_id TEXT NOT NULL UNIQUE REFERENCES bank_economy_receipts(event_id),
 news_event_id TEXT NOT NULL UNIQUE REFERENCES news_events(id), actual_effective_at INTEGER NOT NULL
);
CREATE TABLE company_revenue_projection (
 asset_id TEXT PRIMARY KEY REFERENCES assets(id), bank_company_id TEXT NOT NULL UNIQUE,
 as_of INTEGER NOT NULL, week_key TEXT NOT NULL, checkpoint TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('provisional','reconciled')), report_json TEXT NOT NULL CHECK(json_valid(report_json))
);
