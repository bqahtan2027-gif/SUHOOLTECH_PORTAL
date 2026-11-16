-- SUHOOLTECH W500-compatible project management extension
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(180) NOT NULL,
  description text,
  status varchar(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','on_hold','completed','cancelled')),
  start_date date,
  due_date date,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_status_due_idx ON projects(status,due_date);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);
