-- SUHOOL TECH ERP expansion: CRM, procurement, payroll, assets, helpdesk and BI.
CREATE SEQUENCE IF NOT EXISTS crm_lead_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS purchase_request_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS payroll_run_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS asset_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START 1;

CREATE TABLE IF NOT EXISTS crm_leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_number varchar(32) NOT NULL UNIQUE,
 company_name varchar(180) NOT NULL,
 contact_name varchar(160),
 email varchar(254),
 phone varchar(40),
 source varchar(60),
 status varchar(24) NOT NULL DEFAULT 'new' CHECK(status IN ('new','qualified','proposal','won','lost')),
 estimated_value numeric(16,2) NOT NULL DEFAULT 0 CHECK(estimated_value>=0),
 assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
 notes text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_leads_status_idx ON crm_leads(status,created_at DESC);
CREATE TABLE IF NOT EXISTS crm_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id uuid REFERENCES crm_leads(id) ON DELETE CASCADE,
 party_id uuid REFERENCES finance_parties(id) ON DELETE SET NULL,
 activity_type varchar(24) NOT NULL CHECK(activity_type IN ('call','meeting','email','task','note')),
 subject varchar(200) NOT NULL,
 details text,
 due_at timestamptz,
 completed_at timestamptz,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_activities_due_idx ON crm_activities(due_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS purchase_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_number varchar(32) NOT NULL UNIQUE,
 requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
 department varchar(120),
 purpose text NOT NULL,
 required_date date,
 status varchar(24) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','ordered','cancelled')),
 approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_request_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
 item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
 description varchar(500) NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK(quantity>0),
 estimated_unit_price numeric(14,4) NOT NULL DEFAULT 0 CHECK(estimated_unit_price>=0)
);
CREATE TABLE IF NOT EXISTS purchase_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_number varchar(32) NOT NULL UNIQUE,
 request_id uuid REFERENCES purchase_requests(id) ON DELETE SET NULL,
 supplier_id uuid REFERENCES finance_parties(id) ON DELETE SET NULL,
 supplier_name varchar(180) NOT NULL,
 order_date date NOT NULL DEFAULT current_date,
 expected_date date,
 status varchar(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','partially_received','received','cancelled')),
 subtotal numeric(16,2) NOT NULL DEFAULT 0 CHECK(subtotal>=0),
 tax_amount numeric(16,2) NOT NULL DEFAULT 0 CHECK(tax_amount>=0),
 total numeric(16,2) NOT NULL DEFAULT 0 CHECK(total>=0),
 notes text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
 item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
 description varchar(500) NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK(quantity>0),
 received_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=quantity),
 unit_price numeric(14,4) NOT NULL CHECK(unit_price>=0),
 tax_rate numeric(5,2) NOT NULL DEFAULT 15 CHECK(tax_rate>=0 AND tax_rate<=100)
);
CREATE INDEX IF NOT EXISTS purchase_orders_date_idx ON purchase_orders(order_date DESC);

CREATE TABLE IF NOT EXISTS payroll_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_number varchar(32) NOT NULL UNIQUE,
 period_start date NOT NULL,
 period_end date NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','paid','cancelled')),
 total_gross numeric(16,2) NOT NULL DEFAULT 0 CHECK(total_gross>=0),
 total_deductions numeric(16,2) NOT NULL DEFAULT 0 CHECK(total_deductions>=0),
 total_net numeric(16,2) NOT NULL DEFAULT 0 CHECK(total_net>=0),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
 approved_at timestamptz,
 paid_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(period_end>=period_start)
);
CREATE TABLE IF NOT EXISTS payroll_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL REFERENCES employees(id),
 basic_salary numeric(14,2) NOT NULL CHECK(basic_salary>=0),
 allowances numeric(14,2) NOT NULL DEFAULT 0 CHECK(allowances>=0),
 deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK(deductions>=0),
 gross_salary numeric(14,2) NOT NULL CHECK(gross_salary>=0),
 net_salary numeric(14,2) NOT NULL CHECK(net_salary>=0),
 notes text,
 UNIQUE(run_id,employee_id),
 CHECK(net_salary=gross_salary-deductions)
);
CREATE INDEX IF NOT EXISTS payroll_runs_period_idx ON payroll_runs(period_start DESC);

CREATE TABLE IF NOT EXISTS fixed_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_number varchar(32) NOT NULL UNIQUE,
 asset_name varchar(180) NOT NULL,
 category varchar(100) NOT NULL,
 serial_number varchar(120),
 purchase_date date,
 purchase_cost numeric(16,2) NOT NULL DEFAULT 0 CHECK(purchase_cost>=0),
 useful_life_months integer NOT NULL DEFAULT 60 CHECK(useful_life_months>0),
 salvage_value numeric(16,2) NOT NULL DEFAULT 0 CHECK(salvage_value>=0 AND salvage_value<=purchase_cost),
 depreciation_method varchar(20) NOT NULL DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line')),
 location varchar(180),
 assigned_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
 status varchar(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','disposed','retired')),
 notes text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asset_maintenance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_id uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
 maintenance_date date NOT NULL,
 description text NOT NULL,
 cost numeric(14,2) NOT NULL DEFAULT 0 CHECK(cost>=0),
 next_due_date date,
 status varchar(20) NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_number varchar(32) NOT NULL UNIQUE,
 requester_id uuid REFERENCES users(id) ON DELETE SET NULL,
 requester_name varchar(160) NOT NULL,
 requester_email varchar(254),
 subject varchar(240) NOT NULL,
 description text NOT NULL,
 category varchar(60) NOT NULL DEFAULT 'general',
 priority varchar(16) NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 status varchar(20) NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting','resolved','closed')),
 assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS support_ticket_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 author_id uuid REFERENCES users(id) ON DELETE SET NULL,
 message text NOT NULL,
 is_internal boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets(status,priority,created_at DESC);

CREATE OR REPLACE VIEW bi_finance_summary AS
 SELECT (SELECT count(*) FROM sales_invoices WHERE status<>'cancelled')::int AS invoice_count,
        (SELECT coalesce(sum(total),0) FROM sales_invoices WHERE status<>'cancelled')::numeric(16,2) AS invoiced_total,
        (SELECT coalesce(sum(amount),0) FROM finance_receipts)::numeric(16,2) AS receipts_total,
        (SELECT count(*) FROM journal_entries WHERE status='posted')::int AS posted_journals;
CREATE OR REPLACE VIEW bi_operations_summary AS
 SELECT (SELECT count(*) FROM employees WHERE status='active')::int AS active_employees,
        (SELECT count(*) FROM inventory_items WHERE is_active) ::int AS active_items,
        (SELECT count(*) FROM support_tickets WHERE status NOT IN ('resolved','closed'))::int AS open_tickets,
        (SELECT count(*) FROM purchase_requests WHERE status='pending')::int AS pending_purchase_requests;
