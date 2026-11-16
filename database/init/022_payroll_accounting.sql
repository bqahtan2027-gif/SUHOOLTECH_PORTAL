-- Payroll accounting lifecycle: approved runs are posted and settled through balanced journals.
ALTER TABLE payroll_runs
 ADD COLUMN IF NOT EXISTS journal_entry_id uuid UNIQUE REFERENCES journal_entries(id),
 ADD COLUMN IF NOT EXISTS payment_journal_entry_id uuid UNIQUE REFERENCES journal_entries(id),
 ADD COLUMN IF NOT EXISTS payroll_payable_account_id uuid REFERENCES finance_accounts(id),
 ADD COLUMN IF NOT EXISTS payroll_deductions_account_id uuid REFERENCES finance_accounts(id),
 ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payroll_runs_journal_idx ON payroll_runs(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payroll_runs_payment_journal_idx ON payroll_runs(payment_journal_entry_id) WHERE payment_journal_entry_id IS NOT NULL;
