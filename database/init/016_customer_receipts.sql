ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS journal_entry_id uuid UNIQUE REFERENCES journal_entries(id);
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS payment_account_id uuid REFERENCES finance_accounts(id);
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS finance_receipts_invoice_idx ON finance_receipts(invoice_id,received_at DESC);
