CREATE SEQUENCE IF NOT EXISTS employee_number_seq START 1;
CREATE TABLE IF NOT EXISTS employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_number varchar(24) NOT NULL UNIQUE,
 user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
 full_name varchar(160) NOT NULL,
 email varchar(254) UNIQUE,
 phone varchar(40),
 department varchar(120),
 job_title varchar(120),
 hire_date date,
 status varchar(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_leave','suspended','terminated')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_department_status_idx ON employees(department,status);
CREATE TABLE IF NOT EXISTS leave_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 leave_type varchar(20) NOT NULL CHECK(leave_type IN ('annual','sick','unpaid','emergency','other')),
 start_date date NOT NULL,
 end_date date NOT NULL,
 reason varchar(1000),
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS leave_requests_user_created_idx ON leave_requests(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS leave_requests_status_created_idx ON leave_requests(status,created_at DESC);
