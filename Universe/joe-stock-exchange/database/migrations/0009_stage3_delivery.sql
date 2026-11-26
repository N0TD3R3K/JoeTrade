-- Settlement evidence is immutable; only delivery acknowledgment may change.
CREATE TRIGGER trade_income_evidence_immutable BEFORE UPDATE ON trade_income_outbox WHEN
 NEW.id IS NOT OLD.id OR NEW.customer_id IS NOT OLD.customer_id OR NEW.sale_reference IS NOT OLD.sale_reference OR
 NEW.category IS NOT OLD.category OR NEW.occurred_at IS NOT OLD.occurred_at OR NEW.gain_cents IS NOT OLD.gain_cents OR
 NEW.basis_complete IS NOT OLD.basis_complete OR NEW.evidence_json IS NOT OLD.evidence_json
 BEGIN SELECT RAISE(ABORT,'INCOME_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER trade_income_evidence_no_delete BEFORE DELETE ON trade_income_outbox
 BEGIN SELECT RAISE(ABORT,'INCOME_EVIDENCE_IMMUTABLE'); END;
