CREATE SEQUENCE IF NOT EXISTS warehouse_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS stock_document_number_seq START 1;

CREATE TABLE IF NOT EXISTS warehouses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 warehouse_code varchar(32) NOT NULL UNIQUE,
 name varchar(160) NOT NULL,
 location text,
 is_active boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sku varchar(80) NOT NULL UNIQUE,
 barcode varchar(120) UNIQUE,
 name varchar(200) NOT NULL,
 description text,
 unit varchar(30) NOT NULL DEFAULT 'piece',
 cost_price numeric(14,4) NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
 sale_price numeric(14,4) NOT NULL DEFAULT 0 CHECK(sale_price >= 0),
 reorder_level numeric(14,3) NOT NULL DEFAULT 0 CHECK(reorder_level >= 0),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_number varchar(40) NOT NULL UNIQUE,
 document_type varchar(20) NOT NULL CHECK(document_type IN ('receipt','issue','transfer','adjustment')),
 status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','cancelled')),
 source_warehouse_id uuid REFERENCES warehouses(id),
 destination_warehouse_id uuid REFERENCES warehouses(id),
 reference_number varchar(100),
 notes text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 posted_by uuid REFERENCES users(id) ON DELETE SET NULL,
 posted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_warehouse_id IS DISTINCT FROM destination_warehouse_id),
 CHECK((document_type='receipt' AND source_warehouse_id IS NULL AND destination_warehouse_id IS NOT NULL)
    OR (document_type='issue' AND source_warehouse_id IS NOT NULL AND destination_warehouse_id IS NULL)
    OR (document_type='transfer' AND source_warehouse_id IS NOT NULL AND destination_warehouse_id IS NOT NULL)
    OR (document_type='adjustment' AND (source_warehouse_id IS NOT NULL OR destination_warehouse_id IS NOT NULL)))
);

CREATE TABLE IF NOT EXISTS stock_document_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
 item_id uuid NOT NULL REFERENCES inventory_items(id),
 quantity numeric(14,3) NOT NULL CHECK(quantity > 0),
 unit_cost numeric(14,4) NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_balances (
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 item_id uuid NOT NULL REFERENCES inventory_items(id),
 quantity numeric(14,3) NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(warehouse_id,item_id),
 CHECK(quantity >= 0)
);

CREATE INDEX IF NOT EXISTS stock_documents_created_idx ON stock_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS stock_lines_item_idx ON stock_document_lines(item_id);
CREATE INDEX IF NOT EXISTS inventory_items_name_idx ON inventory_items(name);
