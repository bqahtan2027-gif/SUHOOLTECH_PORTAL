-- Customer sales credit notes and returns.
CREATE SEQUENCE IF NOT EXISTS sales_credit_note_number_seq START 1;
CREATE TABLE IF NOT EXISTS sales_credit_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 credit_note_number varchar(40) NOT NULL UNIQUE,
 original_invoice_id uuid NOT NULL REFERENCES sales_invoices(id),
 party_id uuid NOT NULL REFERENCES finance_parties(id),
 credit_date date NOT NULL DEFAULT current_date,
 status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','cancelled')),
 subtotal numeric(16,2) NOT NULL CHECK(subtotal>=0),
 tax_amount numeric(16,2) NOT NULL CHECK(tax_amount>=0),
 total numeric(16,2) NOT NULL CHECK(total>=0),
 journal_entry_id uuid UNIQUE REFERENCES journal_entries(id),
 stock_document_id uuid UNIQUE REFERENCES stock_documents(id),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 posted_by uuid REFERENCES users(id) ON DELETE SET NULL,
 posted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sales_credit_note_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 credit_note_id uuid NOT NULL REFERENCES sales_credit_notes(id) ON DELETE CASCADE,
 original_invoice_line_id uuid NOT NULL REFERENCES sales_invoice_lines(id),
 item_id uuid REFERENCES inventory_items(id),
 description varchar(500) NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK(quantity>0),
 unit_price numeric(14,4) NOT NULL CHECK(unit_price>=0),
 tax_rate numeric(5,2) NOT NULL CHECK(tax_rate>=0 AND tax_rate<=100),
 line_subtotal numeric(16,2) NOT NULL CHECK(line_subtotal>=0),
 line_tax numeric(16,2) NOT NULL CHECK(line_tax>=0),
 line_total numeric(16,2) NOT NULL CHECK(line_total>=0)
);
CREATE INDEX IF NOT EXISTS sales_credit_notes_original_idx ON sales_credit_notes(original_invoice_id,status);
CREATE INDEX IF NOT EXISTS sales_credit_note_lines_note_idx ON sales_credit_note_lines(credit_note_id);
