-- Supplier invoice settlements with a balanced payable-to-cash journal.
CREATE SEQUENCE IF NOT EXISTS supplier_payment_number_seq START 1;
CREATE TABLE IF NOT EXISTS supplier_invoice_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_number varchar(40) NOT NULL UNIQUE,
 supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id),
 amount numeric(16,2) NOT NULL CHECK(amount>0),
 payment_method varchar(30) NOT NULL CHECK(payment_method IN ('cash','bank_transfer','card','other')),
 payment_account_id uuid NOT NULL REFERENCES finance_accounts(id),
 reference_number varchar(100),
 journal_entry_id uuid NOT NULL UNIQUE REFERENCES journal_entries(id),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 paid_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_invoice_payments_invoice_idx ON supplier_invoice_payments(supplier_invoice_id,paid_at DESC);
