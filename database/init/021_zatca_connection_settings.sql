CREATE TABLE IF NOT EXISTS zatca_connection_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  integration_mode varchar(20) NOT NULL DEFAULT 'manual' CHECK (integration_mode IN ('manual','api')),
  portal_url text,
  api_base_url text,
  api_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT zatca_portal_url_https CHECK (portal_url IS NULL OR portal_url ~ '^https://'),
  CONSTRAINT zatca_api_url_https CHECK (api_base_url IS NULL OR api_base_url ~ '^https://')
);

INSERT INTO zatca_connection_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
