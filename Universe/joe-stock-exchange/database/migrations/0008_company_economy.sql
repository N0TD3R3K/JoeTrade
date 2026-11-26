-- Additive company and evidence schema. No balance/holding changes.
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
 total_basis_cents INTEGER CHECK(total_basis_cents IS NULL OR (typeof(total_basis_cents)='integer' AND total_basis_cents>=0)),
 remaining_basis_cents INTEGER CHECK(remaining_basis_cents IS NULL OR (typeof(remaining_basis_cents)='integer' AND remaining_basis_cents BETWEEN 0 AND total_basis_cents)),
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

CREATE TABLE trade_income_outbox (
 id TEXT PRIMARY KEY NOT NULL, customer_id TEXT NOT NULL, sale_reference TEXT NOT NULL, category TEXT NOT NULL,
 occurred_at INTEGER NOT NULL, gain_cents INTEGER, basis_complete INTEGER NOT NULL CHECK(basis_complete IN (0,1)),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), delivered_at INTEGER
);
CREATE TABLE company_commands (
 id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER cost_lot_transition BEFORE UPDATE ON trade_cost_lots WHEN
 NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.asset_id IS NOT OLD.asset_id OR NEW.holding_kind IS NOT OLD.holding_kind OR
 NEW.source_reference IS NOT OLD.source_reference OR NEW.acquired_at IS NOT OLD.acquired_at OR NEW.quantity_units IS NOT OLD.quantity_units OR
 NEW.remaining_units>OLD.remaining_units OR (OLD.state='verified' AND (NEW.total_basis_cents IS NOT OLD.total_basis_cents OR NEW.remaining_basis_cents>OLD.remaining_basis_cents))
 BEGIN SELECT RAISE(ABORT,'BASIS_IMMUTABLE'); END;
CREATE TRIGGER basis_disposals_no_update BEFORE UPDATE ON trade_basis_disposals BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER basis_disposals_no_delete BEFORE DELETE ON trade_basis_disposals BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER company_post_permission BEFORE INSERT ON company_posts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM assets a JOIN users u ON u.id=NEW.author_id
 WHERE a.id=NEW.asset_id AND a.asset_type='stock' AND a.active=1 AND u.role='member' AND u.status='active'
 AND (a.developer_user_id=NEW.author_id OR EXISTS(SELECT 1 FROM holdings h WHERE h.asset_id=a.id AND h.user_id=NEW.author_id AND h.holding_kind IN ('stock','shareholding') AND h.quantity>0)))
 THEN RAISE(ABORT,'COMPANY_OWNERSHIP_REQUIRED') END;
END;
CREATE TRIGGER company_post_transition BEFORE UPDATE ON company_posts WHEN
 NEW.id IS NOT OLD.id OR NEW.asset_id IS NOT OLD.asset_id OR NEW.author_id IS NOT OLD.author_id OR NEW.created_at IS NOT OLD.created_at OR
 NEW.version!=OLD.version+1 OR OLD.state='deleted' OR NEW.state NOT IN ('withdrawn','deleted')
 BEGIN SELECT RAISE(ABORT,'POST_VERSION_CONFLICT'); END;
CREATE TRIGGER company_post_event_matches BEFORE INSERT ON company_post_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM company_posts p WHERE p.id=NEW.post_id AND p.version=NEW.resulting_version AND
 ((NEW.action='publish' AND p.state='published') OR (NEW.action='withdraw' AND p.state='withdrawn') OR (NEW.action='delete' AND p.state='deleted')))
 THEN RAISE(ABORT,'POST_VERSION_CONFLICT') END;
END;
ALTER TABLE rate_market_event_links ADD COLUMN consumed_tick_id TEXT;
-- Historical sales cannot silently disappear from weekly tax evidence. Existing
-- acquisition history is not an exact FIFO basis, so these need attributed review.
INSERT INTO trade_income_outbox(id,customer_id,sale_reference,category,occurred_at,gain_cents,basis_complete,evidence_json)
 SELECT 'legacy-gain:'||t.id,u.bank_customer_id,'legacy-sale:'||t.id,
 CASE WHEN a.asset_type='crypto' THEN 'realized_crypto_gain' ELSE 'realized_stock_gain' END,
 unixepoch(t.executed_at),NULL,0,json_object('tradeId',t.id,'assetId',t.asset_id,'quantity',t.quantity,'reason','Pre-migration exact FIFO evidence requires review')
 FROM trades t JOIN users u ON u.id=t.seller_id JOIN assets a ON a.id=t.asset_id
 WHERE u.role='member' AND u.bank_customer_id IS NOT NULL;
INSERT INTO trade_income_outbox(id,customer_id,sale_reference,category,occurred_at,gain_cents,basis_complete,evidence_json)
 SELECT 'legacy-share-gain:'||o.id,u.bank_customer_id,'legacy-share-sale:'||o.id,'realized_frozen_share_gain',
 unixepoch(o.resolved_at),NULL,0,json_object('shareOfferId',o.id,'assetId',o.asset_id,'quantity',o.quantity,'reason','Pre-migration exact founding/transfer cost evidence requires review')
 FROM share_offers o JOIN users u ON u.id=o.seller_id WHERE o.status='accepted' AND u.role='member' AND u.bank_customer_id IS NOT NULL;
CREATE TABLE trade_basis_reviews (
 id TEXT PRIMARY KEY NOT NULL, lot_id TEXT NOT NULL UNIQUE REFERENCES trade_cost_lots(id),
 actor_id TEXT NOT NULL REFERENCES users(id), reviewed_at INTEGER NOT NULL, evidence_reference TEXT NOT NULL,
 original_basis_cents INTEGER NOT NULL CHECK(original_basis_cents>=0), remaining_basis_cents INTEGER NOT NULL CHECK(remaining_basis_cents>=0 AND remaining_basis_cents<=original_basis_cents)
);
CREATE TRIGGER basis_reviews_no_update BEFORE UPDATE ON trade_basis_reviews BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER basis_reviews_no_delete BEFORE DELETE ON trade_basis_reviews BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
INSERT INTO trade_cost_lots(id,user_id,asset_id,holding_kind,source_reference,acquired_at,quantity_units,remaining_units,state)
 SELECT 'legacy:'||h.user_id||':'||h.asset_id||':'||h.holding_kind,h.user_id,h.asset_id,h.holding_kind,
 'legacy:'||h.user_id||':'||h.asset_id||':'||h.holding_kind,0,CAST(ROUND(h.quantity*100) AS INTEGER),CAST(ROUND(h.quantity*100) AS INTEGER),'unresolved'
 FROM holdings h JOIN users u ON u.id=h.user_id WHERE u.role='member' AND h.quantity>0;
