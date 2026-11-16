-- Supplier invoices linked to received purchase-order quantities and journal posting.
CREATE SEQUENCE IF NOT EXISTS supplier_invoice_number_seq START 1;

CREATE TABLE IF NOT EXISTS supplier_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 internal_number varchar(40) NOT NULL UNIQUE,
 supplier_invoice_number varchar(100) NOT NULL,
 supplier_id uuid NOT NULL REFERENCES finance_parties(id),
 purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
 invoice_date date NOT NULL DEFAULT current_date,
 due_date date,
 status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','cancelled')),
 subtotal numeric(16,2) NOT NULL CHECK(subtotal>=0),
 tax_amount numeric(16,2) NOT NULL CHECK(tax_amount>=0),
 total numeric(16,2) NOT NULL CHECK(total>=0),
 payable_account_id uuid REFERENCES finance_accounts(id),
 inventory_account_id uuid REFERENCES finance_accounts(id),
 input_tax_account_id uuid REFERENCES finance_accounts(id),
 journal_entry_id uuid UNIQUE REFERENCES journal_entries(id),
 notes text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 posted_by uuid REFERENCES users(id) ON DELETE SET NULL,
 posted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(supplier_id,supplier_invoice_number),
 CHECK(abs(total-(subtotal+tax_amount))<=0.02)
);

CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
 purchase_order_line_id uuid NOT NULL REFERENCES purchase_order_lines(id),
 description varchar(500) NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK(quantity>0),
 unit_price numeric(14,4) NOT NULL CHECK(unit_price>=0),
 tax_rate numeric(5,2) NOT NULL DEFAULT 15 CHECK(tax_rate>=0 AND tax_rate<=100),
 line_subtotal numeric(16,2) NOT NULL CHECK(line_subtotal>=0),
 line_tax numeric(16,2) NOT NULL CHECK(line_tax>=0),
 line_total numeric(16,2) NOT NULL CHECK(line_total>=0)
);

CREATE INDEX IF NOT EXISTS supplier_invoices_date_idx ON supplier_invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS supplier_invoice_lines_po_line_idx ON supplier_invoice_lines(purchase_order_line_id);
