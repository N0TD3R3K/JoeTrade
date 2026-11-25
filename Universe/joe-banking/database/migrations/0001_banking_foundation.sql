PRAGMA foreign_keys = ON;

CREATE TABLE bank_customers (
  id TEXT PRIMARY KEY,
  joe_auth_user_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'operator', 'administrator')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'suspended', 'closed')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE legacy_identity_links (
  bank_customer_id TEXT NOT NULL REFERENCES bank_customers(id),
  system TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  migration_batch_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (system, external_user_id),
  UNIQUE (system, bank_customer_id)
);

-- posted_cents is a projection. Only posting a balanced ledger transaction
-- changes it through the posting trigger below. Reconcile against ledger_lines.
CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES bank_customers(id),
  account_kind TEXT NOT NULL CHECK (account_kind IN ('transaction', 'flexible_deposit', 'internal_clearing')),
  currency TEXT NOT NULL DEFAULT 'J$' CHECK (currency = 'J$'),
  posted_cents INTEGER NOT NULL DEFAULT 0 CHECK (typeof(posted_cents) = 'integer' AND abs(posted_cents) <= 9007199254740991),
  CHECK ((customer_id IS NULL AND account_kind = 'internal_clearing') OR (customer_id IS NOT NULL AND account_kind != 'internal_clearing' AND posted_cents >= 0)),
  UNIQUE (customer_id, account_kind)
);

CREATE TABLE ledger_transactions (
  id TEXT PRIMARY KEY,
  transaction_type TEXT NOT NULL,
  business_reference TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'posted')),
  actor_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE ledger_lines (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
  account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents != 0 AND abs(amount_cents) <= 1000000000000)
);
CREATE INDEX ledger_lines_account ON ledger_lines(account_id, transaction_id);
CREATE INDEX ledger_lines_transaction ON ledger_lines(transaction_id);

CREATE TABLE fund_holds (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('member_wire', 'joese_order')),
  external_reference TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0 AND amount_cents <= 1000000000000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'released')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER
);
CREATE INDEX active_holds_account ON fund_holds(account_id, status);

CREATE VIEW account_balances AS
SELECT a.*, COALESCE((SELECT SUM(h.amount_cents) FROM fund_holds h WHERE h.account_id = a.id AND h.status = 'active'), 0) AS held_cents,
  a.posted_cents - COALESCE((SELECT SUM(h.amount_cents) FROM fund_holds h WHERE h.account_id = a.id AND h.status = 'active'), 0) AS available_cents
FROM bank_accounts a;

CREATE TABLE member_wires (
  id TEXT PRIMARY KEY,
  sender_customer_id TEXT NOT NULL REFERENCES bank_customers(id),
  receiver_customer_id TEXT NOT NULL REFERENCES bank_customers(id),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 240),
  hold_id TEXT NOT NULL UNIQUE REFERENCES fund_holds(id),
  status TEXT NOT NULL DEFAULT 'pending_receiver' CHECK (status IN ('pending_receiver', 'accepted', 'declined', 'cancelled_by_sender')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES bank_customers(id),
  CHECK (sender_customer_id != receiver_customer_id)
);
CREATE INDEX wires_sender ON member_wires(sender_customer_id, created_at);
CREATE INDEX wires_receiver ON member_wires(receiver_customer_id, status, created_at);

CREATE TABLE idempotency_records (
  actor_id TEXT NOT NULL REFERENCES bank_customers(id),
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (actor_id, key)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE member_notifications (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES bank_customers(id),
  wire_id TEXT NOT NULL REFERENCES member_wires(id),
  event TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (customer_id, wire_id, event)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES bank_customers(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  access_token_cipher TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('demo', 'joeauth')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX sessions_customer ON sessions(customer_id);
CREATE TABLE login_transactions (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE webhook_receipts (
  digest TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TRIGGER webhook_revoke_sessions AFTER INSERT ON webhook_receipts BEGIN
  DELETE FROM sessions WHERE customer_id IN (SELECT id FROM bank_customers WHERE joe_auth_user_id = NEW.subject);
END;
CREATE TABLE rate_limits (
  subject_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(subject_hash, action, window_start)
);

-- A balanced post and its projections commit together in a D1 batch. The
-- database checks the current available funds, not a stale application read.
CREATE TRIGGER ledger_insert_draft BEFORE INSERT ON ledger_transactions
WHEN NEW.state != 'draft' BEGIN SELECT RAISE(ABORT, 'DRAFT_REQUIRED'); END;
CREATE TRIGGER lines_draft_only BEFORE INSERT ON ledger_lines BEGIN
  SELECT CASE WHEN (SELECT state FROM ledger_transactions WHERE id = NEW.transaction_id) != 'draft'
    THEN RAISE(ABORT, 'LEDGER_IMMUTABLE') END;
END;
CREATE TRIGGER lines_no_update BEFORE UPDATE ON ledger_lines BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER lines_no_delete BEFORE DELETE ON ledger_lines BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_transactions BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER ledger_validate_post BEFORE UPDATE ON ledger_transactions BEGIN
  SELECT CASE WHEN OLD.state != 'draft' OR NEW.state != 'posted'
    OR NEW.id IS NOT OLD.id OR NEW.transaction_type IS NOT OLD.transaction_type
    OR NEW.business_reference IS NOT OLD.business_reference OR NEW.description IS NOT OLD.description
    OR NEW.actor_id IS NOT OLD.actor_id OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT, 'LEDGER_IMMUTABLE') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_lines WHERE transaction_id = NEW.id) < 2
    OR (SELECT SUM(amount_cents) FROM ledger_lines WHERE transaction_id = NEW.id) != 0
    THEN RAISE(ABORT, 'UNBALANCED_LEDGER') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM account_balances a JOIN ledger_lines l ON l.account_id = a.id
    WHERE l.transaction_id = NEW.id AND a.customer_id IS NOT NULL
    GROUP BY a.id HAVING a.available_cents + SUM(l.amount_cents) < 0
  ) THEN RAISE(ABORT, 'INSUFFICIENT_FUNDS') END;
END;
CREATE TRIGGER ledger_apply_post AFTER UPDATE OF state ON ledger_transactions WHEN NEW.state = 'posted' BEGIN
  UPDATE bank_accounts SET posted_cents = posted_cents + (
    SELECT SUM(amount_cents) FROM ledger_lines WHERE transaction_id = NEW.id AND account_id = bank_accounts.id
  ) WHERE id IN (SELECT account_id FROM ledger_lines WHERE transaction_id = NEW.id);
END;

CREATE TRIGGER hold_validate BEFORE INSERT ON fund_holds BEGIN
  SELECT CASE WHEN NEW.status != 'active' OR NOT EXISTS (
    SELECT 1 FROM account_balances a JOIN bank_customers c ON c.id = a.customer_id
    WHERE a.id = NEW.account_id AND a.account_kind = 'transaction'
      AND c.status = 'active' AND c.role = 'member' AND a.available_cents >= NEW.amount_cents
  ) THEN RAISE(ABORT, 'INSUFFICIENT_FUNDS') END;
END;
CREATE TRIGGER hold_transition BEFORE UPDATE ON fund_holds BEGIN
  SELECT CASE WHEN OLD.status != 'active' OR NEW.status NOT IN ('settled', 'released') OR NEW.resolved_at IS NULL
    OR NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.purpose IS NOT OLD.purpose
    OR NEW.external_reference IS NOT OLD.external_reference OR NEW.amount_cents IS NOT OLD.amount_cents
    OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT, 'HOLD_CONFLICT') END;
END;
CREATE TRIGGER hold_no_delete BEFORE DELETE ON fund_holds BEGIN SELECT RAISE(ABORT, 'HOLD_IMMUTABLE'); END;

CREATE TRIGGER wire_validate BEFORE INSERT ON member_wires BEGIN
  SELECT CASE WHEN NEW.status != 'pending_receiver' OR NEW.resolved_at IS NOT NULL OR NEW.resolved_by IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM bank_customers WHERE id = NEW.sender_customer_id AND role = 'member' AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM bank_customers WHERE id = NEW.receiver_customer_id AND role = 'member' AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM bank_accounts WHERE customer_id = NEW.receiver_customer_id AND account_kind = 'transaction')
    OR NOT EXISTS (SELECT 1 FROM fund_holds h JOIN bank_accounts a ON a.id = h.account_id
      WHERE h.id = NEW.hold_id AND a.customer_id = NEW.sender_customer_id AND h.status = 'active'
        AND h.purpose = 'member_wire' AND h.external_reference = NEW.id AND h.amount_cents = NEW.amount_cents)
    THEN RAISE(ABORT, 'WIRE_NOT_ALLOWED') END;
END;
CREATE TRIGGER wire_created AFTER INSERT ON member_wires BEGIN
  INSERT INTO audit_log (id, actor_id, action, target_id, details_json)
    VALUES (NEW.id || ':created', NEW.sender_customer_id, 'wire.created', NEW.id, json_object('amount_cents', NEW.amount_cents));
  INSERT INTO member_notifications (id, customer_id, wire_id, event)
    VALUES (NEW.id || ':incoming', NEW.receiver_customer_id, NEW.id, 'pending_receiver');
END;
CREATE TRIGGER wire_validate_resolution BEFORE UPDATE ON member_wires BEGIN
  SELECT CASE WHEN OLD.status != 'pending_receiver' OR NEW.status NOT IN ('accepted', 'declined', 'cancelled_by_sender')
    OR NEW.id IS NOT OLD.id OR NEW.sender_customer_id IS NOT OLD.sender_customer_id
    OR NEW.receiver_customer_id IS NOT OLD.receiver_customer_id OR NEW.amount_cents IS NOT OLD.amount_cents
    OR NEW.memo IS NOT OLD.memo OR NEW.hold_id IS NOT OLD.hold_id OR NEW.created_at IS NOT OLD.created_at
    OR NEW.resolved_at IS NULL OR NEW.resolved_by IS NULL
    THEN RAISE(ABORT, 'WIRE_CONFLICT') END;
  SELECT CASE WHEN
    (NEW.status = 'cancelled_by_sender' AND NEW.resolved_by != OLD.sender_customer_id)
    OR (NEW.status IN ('accepted', 'declined') AND NEW.resolved_by != OLD.receiver_customer_id)
    OR NOT EXISTS (SELECT 1 FROM bank_customers WHERE id = NEW.resolved_by AND role = 'member' AND status = 'active')
    OR (NEW.status = 'accepted' AND (
      NOT EXISTS (SELECT 1 FROM bank_customers WHERE id = NEW.sender_customer_id AND role = 'member' AND status = 'active')
      OR NOT EXISTS (SELECT 1 FROM bank_customers WHERE id = NEW.receiver_customer_id AND role = 'member' AND status = 'active')))
    THEN RAISE(ABORT, 'WIRE_NOT_ALLOWED') END;
END;
CREATE TRIGGER wire_resolved AFTER UPDATE OF status ON member_wires BEGIN
  UPDATE fund_holds SET status = CASE WHEN NEW.status = 'accepted' THEN 'settled' ELSE 'released' END,
    resolved_at = NEW.resolved_at WHERE id = NEW.hold_id;
  INSERT INTO ledger_transactions (id, transaction_type, business_reference, description, actor_id, created_at)
    SELECT NEW.id || ':settlement', 'wire', 'wire:' || NEW.id, 'Member wire', NEW.resolved_by, NEW.resolved_at
    WHERE NEW.status = 'accepted';
  INSERT INTO ledger_lines (id, transaction_id, account_id, amount_cents)
    SELECT NEW.id || ':debit', NEW.id || ':settlement', id, -NEW.amount_cents
    FROM bank_accounts WHERE customer_id = NEW.sender_customer_id AND account_kind = 'transaction' AND NEW.status = 'accepted';
  INSERT INTO ledger_lines (id, transaction_id, account_id, amount_cents)
    SELECT NEW.id || ':credit', NEW.id || ':settlement', id, NEW.amount_cents
    FROM bank_accounts WHERE customer_id = NEW.receiver_customer_id AND account_kind = 'transaction' AND NEW.status = 'accepted';
  UPDATE ledger_transactions SET state = 'posted' WHERE id = NEW.id || ':settlement' AND NEW.status = 'accepted';
  INSERT INTO audit_log (id, actor_id, action, target_id, details_json, created_at)
    VALUES (NEW.id || ':resolved', NEW.resolved_by, 'wire.' || NEW.status, NEW.id, json_object('amount_cents', NEW.amount_cents), NEW.resolved_at);
  INSERT INTO member_notifications (id, customer_id, wire_id, event)
    VALUES (NEW.id || ':sender:resolved', NEW.sender_customer_id, NEW.id, NEW.status);
  INSERT INTO member_notifications (id, customer_id, wire_id, event)
    VALUES (NEW.id || ':receiver:resolved', NEW.receiver_customer_id, NEW.id, NEW.status);
END;
CREATE TRIGGER wire_no_delete BEFORE DELETE ON member_wires BEGIN SELECT RAISE(ABORT, 'WIRE_IMMUTABLE'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE'); END;
