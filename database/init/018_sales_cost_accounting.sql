-- Preserve the cost basis used when sales inventory is issued so returns can reverse COGS accurately.
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS cost_unit numeric(14,4) CHECK(cost_unit IS NULL OR cost_unit>=0);
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS cost_total numeric(16,2) CHECK(cost_total IS NULL OR cost_total>=0);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS cogs_account_id uuid REFERENCES finance_accounts(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS inventory_account_id uuid REFERENCES finance_accounts(id);
ALTER TABLE sales_credit_note_lines ADD COLUMN IF NOT EXISTS cost_total numeric(16,2) CHECK(cost_total IS NULL OR cost_total>=0);
