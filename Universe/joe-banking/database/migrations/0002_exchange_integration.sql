CREATE TABLE exchange_holds (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES bank_customers(id), account_id TEXT NOT NULL REFERENCES bank_accounts(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
 remaining_cents INTEGER NOT NULL CHECK(typeof(remaining_cents)='integer' AND remaining_cents>=0 AND remaining_cents<=amount_cents),
 status TEXT NOT NULL CHECK(status IN ('active','settled','released')), created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX exchange_holds_account ON exchange_holds(account_id,status);
DROP VIEW account_balances;
CREATE VIEW account_balances AS SELECT a.*,
 COALESCE((SELECT SUM(amount_cents) FROM fund_holds WHERE account_id=a.id AND status='active'),0)+COALESCE((SELECT SUM(remaining_cents) FROM exchange_holds WHERE account_id=a.id AND status='active'),0) AS held_cents,
 a.posted_cents-COALESCE((SELECT SUM(amount_cents) FROM fund_holds WHERE account_id=a.id AND status='active'),0)-COALESCE((SELECT SUM(remaining_cents) FROM exchange_holds WHERE account_id=a.id AND status='active'),0) AS available_cents
 FROM bank_accounts a;
CREATE TRIGGER exchange_hold_validate BEFORE INSERT ON exchange_holds BEGIN
 SELECT CASE WHEN NEW.status!='active' OR NEW.remaining_cents!=NEW.amount_cents OR NOT EXISTS (
 SELECT 1 FROM account_balances a JOIN bank_customers c ON c.id=a.customer_id WHERE a.id=NEW.account_id AND c.id=NEW.customer_id AND c.role='member' AND c.status='active' AND a.account_kind='transaction' AND a.available_cents>=NEW.amount_cents
 ) THEN RAISE(ABORT,'INSUFFICIENT_FUNDS') END;
END;
CREATE TRIGGER exchange_hold_transition BEFORE UPDATE ON exchange_holds BEGIN
 SELECT CASE WHEN OLD.status!='active' OR NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.customer_id IS NOT OLD.customer_id OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.remaining_cents>OLD.remaining_cents OR NEW.created_at IS NOT OLD.created_at OR (NEW.status!='active' AND NEW.remaining_cents!=0) OR (NEW.status='active' AND NEW.remaining_cents=0) THEN RAISE(ABORT,'HOLD_CONFLICT') END;
END;
CREATE TABLE exchange_operations(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,response_json TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT(unixepoch()));
INSERT INTO bank_accounts(id,account_kind) VALUES('joese-clearing','internal_clearing'),('joese-capital','internal_clearing');
CREATE TRIGGER active_member_post BEFORE UPDATE OF state ON ledger_transactions WHEN NEW.state='posted' AND NEW.transaction_type IN ('exchange_payment','exchange_capital','exchange_settlement') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM ledger_lines l JOIN bank_accounts a ON a.id=l.account_id JOIN bank_customers c ON c.id=a.customer_id WHERE l.transaction_id=NEW.id AND (c.status!='active' OR c.role!='member')) THEN RAISE(ABORT,'MEMBER_UNAVAILABLE') END;
END;
