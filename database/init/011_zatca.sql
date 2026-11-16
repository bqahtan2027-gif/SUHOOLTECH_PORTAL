CREATE TABLE IF NOT EXISTS zatca_config (
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
 environment varchar(20) NOT NULL DEFAULT 'simulation' CHECK(environment IN ('simulation','production')),
 seller_name varchar(200) NOT NULL,
 vat_number varchar(30) NOT NULL,
 commercial_registration varchar(40),
 building_number varchar(10),
 street varchar(200),
 district varchar(120),
 city varchar(120) NOT NULL,
 postal_code varchar(20),
 country_code char(2) NOT NULL DEFAULT 'SA',
 device_serial_number varchar(100),
 onboarding_status varchar(30) NOT NULL DEFAULT 'not_configured' CHECK(onboarding_status IN ('not_configured','pending','configured','revoked')),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zatca_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL REFERENCES sales_invoices(id),
 invoice_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 invoice_hash text,
 signed_xml text,
 request_payload jsonb,
 response_payload jsonb,
 submission_type varchar(20) NOT NULL CHECK(submission_type IN ('reporting','clearance')),
 status varchar(24) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','prepared','submitted','accepted','rejected','failed')),
 zatca_status_code varchar(40),
 zatca_message text,
 submitted_at timestamptz,
 responded_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(invoice_id,submission_type)
);
CREATE INDEX IF NOT EXISTS zatca_submissions_status_idx ON zatca_submissions(status,created_at);
