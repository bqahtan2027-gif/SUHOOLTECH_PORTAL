-- Track customer credit created by overpaid sales returns and settle refunds safely.
ALTER TABLE sales_credit_notes
 ADD COLUMN IF NOT EXISTS customer_credit_amount numeric(16,2) NOT NULL DEFAULT 0 CHECK(customer_credit_amount>=0),
 ADD COLUMN IF NOT EXISTS customer_credit_account_id uuid REFERENCES finance_accounts(id);

CREATE TABLE IF NOT EXISTS sales_credit_note_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 refund_number varchar(40) NOT NULL UNIQUE,
 credit_note_id uuid NOT NULL REFERENCES sales_credit_notes(id),
 amount numeric(16,2) NOT NULL CHECK(amount>0),
 payment_method varchar(30) NOT NULL CHECK(payment_method IN ('cash','bank_transfer','card','other')),
 payment_account_id uuid NOT NULL REFERENCES finance_accounts(id),
 reference_number varchar(100),
 journal_entry_id uuid NOT NULL UNIQUE REFERENCES journal_entries(id),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 refunded_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS customer_refund_number_seq START 1;
CREATE INDEX IF NOT EXISTS sales_credit_refunds_note_idx ON sales_credit_note_refunds(credit_note_id,refunded_at DESC);
