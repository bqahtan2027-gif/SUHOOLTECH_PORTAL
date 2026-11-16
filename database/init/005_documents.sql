-- SUHOOL TECH document lifecycle and contract archive
CREATE SEQUENCE IF NOT EXISTS document_number_seq START 1;

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number varchar(32) NOT NULL UNIQUE,
  title varchar(200) NOT NULL,
  document_type varchar(30) NOT NULL CHECK (document_type IN ('contract','policy','letter','nda','other')),
  party_name varchar(180),
  content text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','approved','rejected','archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_status_created_idx
  ON documents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_creator_created_idx
  ON documents(created_by, created_at DESC);
