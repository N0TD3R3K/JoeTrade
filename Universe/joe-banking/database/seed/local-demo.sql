-- SYNTHETIC LOCAL FIXTURES ONLY. Never apply to a remote database.
-- No passwords, JoeAuth identities, or production-account links are created.
INSERT INTO bank_customers (id, display_name, username, email) VALUES
  ('demo-alice', 'Alice Joe', 'alice', 'alice@example.test'),
  ('demo-bob', 'Bob Joe', 'bob', 'bob@example.test');
INSERT INTO bank_accounts (id, customer_id, account_kind) VALUES
  ('demo-alice-transaction', 'demo-alice', 'transaction'),
  ('demo-alice-savings', 'demo-alice', 'flexible_deposit'),
  ('demo-bob-transaction', 'demo-bob', 'transaction'),
  ('demo-bob-savings', 'demo-bob', 'flexible_deposit'),
  ('demo-opening-clearing', NULL, 'internal_clearing');
INSERT INTO ledger_transactions (id, transaction_type, business_reference, description) VALUES
  ('demo-opening-alice', 'demo_opening', 'demo:alice', 'Local demonstration opening balance'),
  ('demo-opening-bob', 'demo_opening', 'demo:bob', 'Local demonstration opening balance');
INSERT INTO ledger_lines (id, transaction_id, account_id, amount_cents) VALUES
  ('demo-alice-opening-credit', 'demo-opening-alice', 'demo-alice-transaction', 1000000),
  ('demo-alice-opening-offset', 'demo-opening-alice', 'demo-opening-clearing', -1000000),
  ('demo-bob-opening-credit', 'demo-opening-bob', 'demo-bob-transaction', 1000000),
  ('demo-bob-opening-offset', 'demo-opening-bob', 'demo-opening-clearing', -1000000);
UPDATE ledger_transactions SET state = 'posted' WHERE id IN ('demo-opening-alice', 'demo-opening-bob');
