-- STAGE 1 DRAFT ONLY. Not in migrations_dir, never applied by normal startup.
-- No seeds, grants, debits, policy approvals or reserve initialization.
-- Promote to a new numbered migration only after Stage 2 review and rehearsal.
PRAGMA foreign_keys = ON;
CREATE TABLE economy_policy_versions (
 id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL UNIQUE CHECK(version>0),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','retired')),
 rules_json TEXT NOT NULL CHECK(json_valid(rules_json)), approved_by TEXT REFERENCES bank_customers(id),
 approved_at INTEGER, CHECK(state!='approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE economy_companies (
 id TEXT PRIMARY KEY NOT NULL, exchange_asset_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','suspended','closed'))
);
CREATE TABLE economy_accounts (
 account_id TEXT PRIMARY KEY REFERENCES bank_accounts(id), company_id TEXT REFERENCES economy_companies(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('bank_reserve','company_operating','company_capital','legacy_capital','issuance','loan_receivable')),
 CHECK((purpose IN ('company_operating','company_capital') AND company_id IS NOT NULL) OR (purpose NOT IN ('company_operating','company_capital') AND company_id IS NULL)),
 UNIQUE(company_id,purpose)
);
CREATE UNIQUE INDEX economy_one_reserve ON economy_accounts(purpose) WHERE purpose='bank_reserve';
CREATE TRIGGER economy_internal_accounts BEFORE INSERT ON economy_accounts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bank_accounts a WHERE a.id=NEW.account_id AND a.customer_id IS NULL AND a.account_kind='internal_clearing') THEN RAISE(ABORT,'INTERNAL_ACCOUNT_REQUIRED') END;
END;
-- Banking's original overdraft guard covers customers; future company/reserve
-- accounts also need protection. This is an additive, draft posting guard.
CREATE TRIGGER economy_validate_post BEFORE UPDATE OF state ON ledger_transactions WHEN NEW.state='posted' BEGIN
 SELECT CASE WHEN EXISTS(
   SELECT 1 FROM ledger_lines l JOIN economy_accounts e ON e.account_id=l.account_id JOIN account_balances a ON a.id=e.account_id
   WHERE l.transaction_id=NEW.id AND e.purpose IN ('bank_reserve','company_operating','company_capital','legacy_capital')
   GROUP BY a.id HAVING a.available_cents+SUM(l.amount_cents)<0
 ) THEN RAISE(ABORT,'INSUFFICIENT_ECONOMY_FUNDS') END;
 SELECT CASE WHEN EXISTS(
   SELECT 1 FROM ledger_lines l JOIN economy_accounts e ON e.account_id=l.account_id
   WHERE l.transaction_id=NEW.id AND e.purpose IN ('company_capital','legacy_capital')
   GROUP BY e.account_id HAVING SUM(l.amount_cents)<0
 ) THEN RAISE(ABORT,'CAPITAL_LOCKED') END;
END;
CREATE TABLE company_capital_attributions (
 company_id TEXT NOT NULL REFERENCES economy_companies(id), ledger_transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions(id),
 contribution_cents INTEGER NOT NULL CHECK(typeof(contribution_cents)='integer' AND contribution_cents>0),
 evidence_reference TEXT NOT NULL, reviewed_by TEXT REFERENCES bank_customers(id), PRIMARY KEY(company_id,ledger_transaction_id)
);
CREATE TABLE economy_grants (
 joe_auth_subject TEXT PRIMARY KEY NOT NULL, customer_id TEXT NOT NULL UNIQUE REFERENCES bank_customers(id),
 grant_kind TEXT NOT NULL CHECK(grant_kind='opening_member'), policy_id TEXT NOT NULL REFERENCES economy_policy_versions(id),
 ledger_transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions(id)
);
CREATE TABLE bank_reserve_initializations (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), initial_cents INTEGER NOT NULL CHECK(initial_cents=10000000),
 policy_id TEXT NOT NULL REFERENCES economy_policy_versions(id), ledger_transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions(id)
);
CREATE TABLE company_services (
 id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL REFERENCES economy_companies(id), joe_auth_app_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','suspended')), callback_destination_id TEXT NOT NULL
);
CREATE TABLE company_plan_versions (
 id TEXT PRIMARY KEY NOT NULL, service_id TEXT NOT NULL REFERENCES company_services(id), version INTEGER NOT NULL CHECK(version>0),
 kind TEXT NOT NULL CHECK(kind IN ('purchase','subscription')), amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
 interval_days INTEGER, terms_hash TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES economy_policy_versions(id),
 CHECK((kind='purchase' AND interval_days IS NULL) OR (kind='subscription' AND interval_days BETWEEN 1 AND 366)), UNIQUE(service_id,version)
);
CREATE TABLE checkout_authorizations (
 id TEXT PRIMARY KEY NOT NULL, customer_id TEXT NOT NULL REFERENCES bank_customers(id), plan_version_id TEXT NOT NULL REFERENCES company_plan_versions(id),
 terms_hash TEXT NOT NULL, consent_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'authorized' CHECK(state IN ('authorized','consumed','canceled','expired')), CHECK(expires_at>consent_at)
);
CREATE TABLE company_subscriptions (
 id TEXT PRIMARY KEY NOT NULL, authorization_id TEXT NOT NULL UNIQUE REFERENCES checkout_authorizations(id), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 state TEXT NOT NULL CHECK(state IN ('active','canceled','past_due','ended')), next_charge_at INTEGER, canceled_at INTEGER
);
CREATE TABLE commerce_operations (
 id TEXT PRIMARY KEY NOT NULL, authorization_id TEXT NOT NULL REFERENCES checkout_authorizations(id), subscription_id TEXT REFERENCES company_subscriptions(id),
 period_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('purchase','renewal','refund')),
 original_operation_id TEXT REFERENCES commerce_operations(id), request_hash TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','posted','failed')),
 ledger_transaction_id TEXT UNIQUE REFERENCES ledger_transactions(id), UNIQUE(authorization_id,period_key,kind),
 CHECK((kind='refund' AND original_operation_id IS NOT NULL) OR (kind!='refund' AND original_operation_id IS NULL)),
 CHECK(state!='posted' OR ledger_transaction_id IS NOT NULL)
);
CREATE TABLE company_employee_agreements (
 id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL REFERENCES economy_companies(id), employee_id TEXT NOT NULL REFERENCES bank_customers(id),
 version INTEGER NOT NULL CHECK(version>0), allocation_bps INTEGER NOT NULL CHECK(allocation_bps BETWEEN 1 AND 10000),
 terms_hash TEXT NOT NULL, accepted_at INTEGER, state TEXT NOT NULL CHECK(state IN ('invited','accepted','ended')),
 CHECK(state!='accepted' OR accepted_at IS NOT NULL), UNIQUE(company_id,employee_id,version)
);
CREATE TABLE company_payroll_runs (
 id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL REFERENCES economy_companies(id), period_key TEXT NOT NULL,
 policy_id TEXT NOT NULL REFERENCES economy_policy_versions(id), revenue_cutoff_at INTEGER NOT NULL,
 employee_pool_bps INTEGER NOT NULL CHECK(employee_pool_bps BETWEEN 0 AND 10000),
 budget_cents INTEGER NOT NULL CHECK(typeof(budget_cents)='integer' AND budget_cents>=0),
 state TEXT NOT NULL CHECK(state IN ('pending','posted','failed')), UNIQUE(company_id,period_key)
);
CREATE TABLE company_payroll_lines (
 run_id TEXT NOT NULL REFERENCES company_payroll_runs(id), agreement_id TEXT NOT NULL REFERENCES company_employee_agreements(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0), ledger_transaction_id TEXT UNIQUE REFERENCES ledger_transactions(id),
 PRIMARY KEY(run_id,agreement_id)
);
CREATE TABLE economy_income_events (
 id TEXT PRIMARY KEY NOT NULL, customer_id TEXT NOT NULL REFERENCES bank_customers(id), source_system TEXT NOT NULL CHECK(source_system IN ('bank','exchange')),
 source_reference TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('employee_wage','deposit_interest','realized_stock_gain','realized_crypto_gain','realized_frozen_share_gain','refund_adjustment','redistribution','opening_grant','loan_principal','member_wire','company_revenue','capital_contribution')),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer'), occurred_at INTEGER NOT NULL,
 original_event_id TEXT REFERENCES economy_income_events(id), evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 UNIQUE(source_system,source_reference,customer_id,category)
);
CREATE TABLE weekly_tax_assessments (
 id TEXT PRIMARY KEY NOT NULL, customer_id TEXT NOT NULL REFERENCES bank_customers(id), week_key TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), policy_id TEXT NOT NULL REFERENCES economy_policy_versions(id),
 taxable_cents INTEGER NOT NULL CHECK(typeof(taxable_cents)='integer' AND taxable_cents>=0),
 rate_bps INTEGER NOT NULL CHECK(rate_bps IN (0,200,300,500,1000)),
 assessed_cents INTEGER NOT NULL CHECK(typeof(assessed_cents)='integer' AND assessed_cents>=0),
 basis_complete INTEGER NOT NULL CHECK(basis_complete IN (0,1)), supersedes_id TEXT UNIQUE REFERENCES weekly_tax_assessments(id),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), UNIQUE(customer_id,week_key,revision)
);
CREATE TABLE tax_collections (
 id TEXT PRIMARY KEY NOT NULL, assessment_id TEXT NOT NULL REFERENCES weekly_tax_assessments(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
 ledger_transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions(id)
);
CREATE TABLE redistribution_runs (
 id TEXT PRIMARY KEY NOT NULL, period_key TEXT NOT NULL UNIQUE, policy_id TEXT NOT NULL REFERENCES economy_policy_versions(id),
 approved_by TEXT NOT NULL REFERENCES bank_customers(id), budget_cents INTEGER NOT NULL CHECK(typeof(budget_cents)='integer' AND budget_cents>=0),
 state TEXT NOT NULL CHECK(state IN ('pending','posted','failed')), eligibility_json TEXT NOT NULL CHECK(json_valid(eligibility_json))
);
CREATE TABLE redistribution_lines (
 run_id TEXT NOT NULL REFERENCES redistribution_runs(id), customer_id TEXT NOT NULL REFERENCES bank_customers(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0), ledger_transaction_id TEXT UNIQUE REFERENCES ledger_transactions(id),
 PRIMARY KEY(run_id,customer_id)
);
CREATE TABLE bank_rate_operations (
 id TEXT PRIMARY KEY NOT NULL, policy_id TEXT NOT NULL REFERENCES economy_policy_versions(id), actor_id TEXT NOT NULL REFERENCES bank_customers(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), expected_policy_version INTEGER NOT NULL,
 delta_ppm INTEGER NOT NULL CHECK(typeof(delta_ppm)='integer' AND delta_ppm!=0 AND abs(delta_ppm)<=2000 AND delta_ppm%50=0),
 previous_rate_ppm INTEGER NOT NULL CHECK(previous_rate_ppm BETWEEN 3000 AND 20000), next_rate_ppm INTEGER NOT NULL CHECK(next_rate_ppm BETWEEN 3000 AND 20000),
 requested_effective_at INTEGER NOT NULL, actual_effective_at INTEGER,
 state TEXT NOT NULL CHECK(state IN ('pending','applied','canceled','failed')),
 reason_category TEXT NOT NULL CHECK(reason_category IN ('news_event','normal_fluctuation')), explanation TEXT NOT NULL, internal_note TEXT NOT NULL,
 CHECK(next_rate_ppm=previous_rate_ppm+delta_ppm), CHECK(state!='applied' OR actual_effective_at IS NOT NULL)
);
CREATE TABLE bank_rate_week_slots (
 week_key TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot IN (1,2)), operation_id TEXT NOT NULL UNIQUE REFERENCES bank_rate_operations(id),
 PRIMARY KEY(week_key,slot)
);
CREATE TABLE bank_loan_offers (
 id TEXT PRIMARY KEY NOT NULL, customer_id TEXT NOT NULL REFERENCES bank_customers(id), policy_id TEXT NOT NULL REFERENCES economy_policy_versions(id),
 product_id TEXT NOT NULL, principal_cents INTEGER NOT NULL CHECK(typeof(principal_cents)='integer' AND principal_cents>0),
 terms_json TEXT NOT NULL CHECK(json_valid(terms_json)), terms_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), state TEXT NOT NULL CHECK(state IN ('offered','accepted','declined','expired','withdrawn'))
);
CREATE TABLE bank_loan_contracts (
 id TEXT PRIMARY KEY NOT NULL, offer_id TEXT NOT NULL UNIQUE REFERENCES bank_loan_offers(id), accepted_terms_hash TEXT NOT NULL,
 accepted_at INTEGER NOT NULL, disbursement_transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions(id),
 state TEXT NOT NULL CHECK(state IN ('active','repaid')), accrual_checkpoint INTEGER NOT NULL, remainder_numerator TEXT NOT NULL DEFAULT '0'
);
CREATE TABLE bank_loan_payments (
 id TEXT PRIMARY KEY NOT NULL, loan_id TEXT NOT NULL REFERENCES bank_loan_contracts(id), principal_cents INTEGER NOT NULL CHECK(principal_cents>=0),
 interest_cents INTEGER NOT NULL CHECK(interest_cents>=0), ledger_transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions(id),
 CHECK(principal_cents+interest_cents>0)
);
CREATE TABLE economy_snapshots (
 date_key TEXT PRIMARY KEY NOT NULL, scheduled_for INTEGER NOT NULL, bank_as_of INTEGER NOT NULL, exchange_as_of INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('provisional','reconciled')), metrics_json TEXT NOT NULL CHECK(json_valid(metrics_json)),
 bank_checkpoint TEXT NOT NULL, exchange_checkpoint TEXT NOT NULL
);
CREATE TABLE economy_outbox (
 event_id TEXT PRIMARY KEY NOT NULL, source_operation_id TEXT NOT NULL, kind TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
 delivered_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), UNIQUE(source_operation_id,kind)
);
CREATE TABLE economy_audit_events (
 id TEXT PRIMARY KEY NOT NULL, operation_id TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL,
 occurred_at INTEGER NOT NULL, details_json TEXT NOT NULL CHECK(json_valid(details_json))
);
CREATE TRIGGER economy_audit_no_update BEFORE UPDATE ON economy_audit_events BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER economy_audit_no_delete BEFORE DELETE ON economy_audit_events BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
