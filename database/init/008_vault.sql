-- Encrypted internal credentials vault. Secrets are ciphertext only.
CREATE TABLE IF NOT EXISTS vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(160) NOT NULL,
  username varchar(254),
  secret_ciphertext text NOT NULL,
  secret_iv varchar(32) NOT NULL,
  secret_tag varchar(32) NOT NULL,
  notes varchar(2000),
  scope varchar(16) NOT NULL DEFAULT 'private' CHECK (scope IN ('private','shared')),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vault_items_owner_idx ON vault_items(owner_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS vault_items_scope_idx ON vault_items(scope,updated_at DESC);
