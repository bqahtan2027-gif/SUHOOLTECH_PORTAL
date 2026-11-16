CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 full_name varchar(120) NOT NULL,
 email varchar(254) NOT NULL UNIQUE,
 password_hash text NOT NULL,
 role varchar(20) NOT NULL DEFAULT 'employee' CHECK(role IN ('admin','manager','employee')),
 active boolean NOT NULL DEFAULT true,
 last_login_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title varchar(180) NOT NULL,
 description text,
 status varchar(20) NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','review','done','blocked')),
 priority varchar(20) NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 due_date date,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_status_due_idx ON tasks(status,due_date);
CREATE TABLE IF NOT EXISTS audit_logs (
 id bigserial PRIMARY KEY,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action varchar(100) NOT NULL,
 entity_type varchar(80) NOT NULL,
 entity_id text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
