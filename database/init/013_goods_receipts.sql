-- Purchase order goods-receipt tracking; inventory posting remains transactional in the API.
CREATE SEQUENCE IF NOT EXISTS goods_receipt_number_seq START 1;

CREATE TABLE IF NOT EXISTS goods_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_number varchar(40) NOT NULL UNIQUE,
 purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 stock_document_id uuid NOT NULL UNIQUE REFERENCES stock_documents(id),
 received_by uuid REFERENCES users(id) ON DELETE SET NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 notes text
);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
 purchase_order_line_id uuid NOT NULL REFERENCES purchase_order_lines(id),
 item_id uuid NOT NULL REFERENCES inventory_items(id),
 quantity numeric(14,3) NOT NULL CHECK(quantity > 0),
 unit_cost numeric(14,4) NOT NULL DEFAULT 0 CHECK(unit_cost >= 0)
);

CREATE INDEX IF NOT EXISTS goods_receipts_order_idx ON goods_receipts(purchase_order_id, received_at DESC);
CREATE INDEX IF NOT EXISTS goods_receipt_lines_order_line_idx ON goods_receipt_lines(purchase_order_line_id);
