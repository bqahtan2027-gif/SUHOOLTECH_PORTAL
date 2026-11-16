CREATE SEQUENCE IF NOT EXISTS journal_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sales_invoice_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 1;

CREATE TABLE IF NOT EXISTS finance_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_code varchar(30) NOT NULL UNIQUE,
 account_name varchar(180) NOT NULL,
 account_type varchar(20) NOT NULL CHECK(account_type IN ('asset','liability','equity','revenue','expense')),
 parent_id uuid REFERENCES finance_accounts(id),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_parties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 party_type varchar(20) NOT NULL CHECK(party_type IN ('customer','supplier','both')),
 name varchar(180) NOT NULL,
 tax_number varchar(30),
 email varchar(254),
 phone varchar(40),
 address text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_parties_name_idx ON finance_parties(name);

CREATE TABLE IF NOT EXISTS journal_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entry_number varchar(40) NOT NULL UNIQUE,
 entry_date date NOT NULL DEFAULT current_date,
 description text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','reversed')),
 source_type varchar(40),
 source_id uuid,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 posted_by uuid REFERENCES users(id) ON DELETE SET NULL,
 posted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES finance_accounts(id),
 party_id uuid REFERENCES finance_parties(id),
 description varchar(500),
 debit numeric(16,2) NOT NULL DEFAULT 0 CHECK(debit >= 0),
 credit numeric(16,2) NOT NULL DEFAULT 0 CHECK(credit >= 0),
 CHECK((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON journal_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines(account_id);

CREATE TABLE IF NOT EXISTS sales_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_number varchar(40) NOT NULL UNIQUE,
 party_id uuid REFERENCES finance_parties(id),
 customer_name varchar(180) NOT NULL,
 customer_tax_number varchar(30),
 issue_date date NOT NULL DEFAULT current_date,
 due_date date,
 invoice_type varchar(20) NOT NULL DEFAULT 'standard' CHECK(invoice_type IN ('standard','simplified','credit_note','debit_note')),
 status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','partially_paid','paid','cancelled')),
 currency char(3) NOT NULL DEFAULT 'SAR',
 subtotal numeric(16,2) NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
 discount_amount numeric(16,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
 tax_rate numeric(5,2) NOT NULL DEFAULT 15 CHECK(tax_rate >= 0 AND tax_rate <= 100),
 tax_amount numeric(16,2) NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
 total numeric(16,2) NOT NULL DEFAULT 0 CHECK(total >= 0),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(discount_amount <= subtotal)
);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
 item_id uuid REFERENCES inventory_items(id),
 description varchar(500) NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK(quantity > 0),
 unit_price numeric(14,4) NOT NULL CHECK(unit_price >= 0),
 tax_rate numeric(5,2) NOT NULL DEFAULT 15 CHECK(tax_rate >= 0 AND tax_rate <= 100),
 line_subtotal numeric(16,2) NOT NULL CHECK(line_subtotal >= 0),
 line_tax numeric(16,2) NOT NULL CHECK(line_tax >= 0),
 line_total numeric(16,2) NOT NULL CHECK(line_total >= 0)
);

CREATE TABLE IF NOT EXISTS finance_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_number varchar(40) NOT NULL UNIQUE,
 party_id uuid REFERENCES finance_parties(id),
 invoice_id uuid REFERENCES sales_invoices(id),
 amount numeric(16,2) NOT NULL CHECK(amount > 0),
 payment_method varchar(30) NOT NULL CHECK(payment_method IN ('cash','bank_transfer','card','other')),
 reference_number varchar(100),
 received_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sales_invoices_issue_date_idx ON sales_invoices(issue_date DESC);
