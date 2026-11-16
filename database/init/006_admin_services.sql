-- Administrative requests, purchasing approvals and company custody register
CREATE SEQUENCE IF NOT EXISTS custody_asset_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS admin_request_number_seq START 1;

CREATE TABLE IF NOT EXISTS admin_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number varchar(32) NOT NULL UNIQUE,
  request_type varchar(20) NOT NULL CHECK (request_type IN ('purchase','administrative')),
  title varchar(200) NOT NULL,
  description text,
  supplier_name varchar(180),
  estimated_amount numeric(14,2) CHECK (estimated_amount IS NULL OR estimated_amount >= 0),
  priority varchar(16) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','fulfilled')),
  requester_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  decision_note varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_requests_status_created_idx
  ON admin_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_requests_requester_created_idx
  ON admin_requests(requester_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custody_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_number varchar(32) NOT NULL UNIQUE,
  asset_name varchar(180) NOT NULL,
  serial_number varchar(120),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  condition_note varchar(1000),
  status varchar(20) NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','returned','damaged')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz
);

CREATE INDEX IF NOT EXISTS custody_assets_assignee_status_idx
  ON custody_assets(assigned_to, status);
