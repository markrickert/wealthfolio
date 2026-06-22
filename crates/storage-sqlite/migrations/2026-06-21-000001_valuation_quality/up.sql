ALTER TABLE daily_account_valuation
ADD COLUMN value_status TEXT NOT NULL DEFAULT 'COMPLETE';

ALTER TABLE daily_account_valuation
ADD COLUMN basis_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE';

-- Daily valuations are generated read models. Rebuild them with explicit value
-- and basis coverage instead of relying on implicit zero-valued missing quotes.
DELETE FROM daily_account_valuation;
