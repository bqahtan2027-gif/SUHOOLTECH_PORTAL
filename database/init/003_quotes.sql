CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1;
CREATE TABLE IF NOT EXISTS quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 quote_number varchar(32) NOT NULL UNIQUE,
 client_name varchar(180) NOT NULL,
 client_email varchar(254),
 client_phone varchar(40),
 status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','approved','rejected','expired')),
 subtotal numeric(14,2) NOT NULL CHECK(subtotal >= 0),
 discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
 tax_rate numeric(5,2) NOT NULL DEFAULT 15 CHECK(tax_rate >= 0 AND tax_rate <= 100),
 tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
 total numeric(14,2) NOT NULL CHECK(total >= 0),
 valid_until date,
 notes text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(discount_amount <= subtotal)
);
CREATE TABLE IF NOT EXISTS quote_items (
 id bigserial PRIMARY KEY,
 quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
 description varchar(500) NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK(quantity > 0),
 unit_price numeric(14,2) NOT NULL CHECK(unit_price >= 0),
 line_total numeric(14,2) NOT NULL CHECK(line_total >= 0)
);
CREATE INDEX IF NOT EXISTS quotes_status_created_idx ON quotes(status,created_at DESC);
CREATE INDEX IF NOT EXISTS quote_items_quote_idx ON quote_items(quote_id);
