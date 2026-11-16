-- Sales invoice accounting and inventory fulfillment links.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS journal_entry_id uuid UNIQUE REFERENCES journal_entries(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS receivable_account_id uuid REFERENCES finance_accounts(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS revenue_account_id uuid REFERENCES finance_accounts(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS output_tax_account_id uuid REFERENCES finance_accounts(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS stock_document_id uuid UNIQUE REFERENCES stock_documents(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS posted_at timestamptz;
CREATE SEQUENCE IF NOT EXISTS sales_stock_issue_number_seq START 1;
CREATE TABLE IF NOT EXISTS sales_receipt_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id uuid NOT NULL REFERENCES finance_receipts(id),
 invoice_id uuid NOT NULL REFERENCES sales_invoices(id),
 amount numeric(16,2) NOT NULL CHECK(amount>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(receipt_id,invoice_id)
);
CREATE INDEX IF NOT EXISTS sales_receipt_alloc_invoice_idx ON sales_receipt_allocations(invoice_id);
