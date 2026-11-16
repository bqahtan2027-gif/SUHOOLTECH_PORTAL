-- Core work-management, CRM, quotation, document, notification and audit tables.
-- Every company-owned row is scoped by organization_id and protected by RLS.
create table public.customers (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, email text, phone text, tax_number text, address text, notes text,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now()
);

create table public.projects (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 customer_id uuid references public.customers(id) on delete set null,
 name text not null, description text,
 status text not null default 'planning' check(status in ('planning','active','on_hold','completed','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 start_date date, due_date date,
 owner_id uuid references public.profiles(id) on delete set null,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.tasks (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid references public.projects(id) on delete cascade,
 title text not null, description text,
 status text not null default 'todo' check(status in ('todo','in_progress','review','done','blocked')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 assignee_id uuid references public.profiles(id) on delete set null,
 due_at timestamptz,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.quotes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 customer_id uuid references public.customers(id) on delete set null,
 quote_number text not null, title text not null,
 status text not null default 'draft' check(status in ('draft','sent','viewed','accepted','rejected','expired','cancelled')),
 currency char(3) not null default 'SAR',
 subtotal numeric(14,2) not null default 0 check(subtotal>=0),
 tax_total numeric(14,2) not null default 0 check(tax_total>=0),
 total numeric(14,2) not null default 0 check(total>=0),
 valid_until date, notes text,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,quote_number)
);

create table public.quote_items (
 id uuid primary key default gen_random_uuid(),
 quote_id uuid not null references public.quotes(id) on delete cascade,
 description text not null,
 quantity numeric(12,3) not null default 1 check(quantity>0),
 unit_price numeric(14,2) not null default 0 check(unit_price>=0),
 tax_rate numeric(5,2) not null default 0 check(tax_rate between 0 and 100),
 line_total numeric(14,2) not null default 0 check(line_total>=0)
);

create table public.employees (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete set null,
 employee_number text not null, full_name text not null,
 work_email text, department text, job_title text,
 status text not null default 'active' check(status in ('active','on_leave','terminated')),
 hire_date date,
 created_at timestamptz not null default now(),
 unique(organization_id,employee_number)
);

create table public.documents (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 title text not null, category text, storage_path text not null,
 mime_type text, size_bytes bigint check(size_bytes is null or size_bytes>=0),
 access_level text not null default 'internal' check(access_level in ('private','internal','restricted')),
 uploaded_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now()
);

create table public.service_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 requester_id uuid references public.profiles(id) on delete set null,
 request_type text not null, title text not null, details text,
 status text not null default 'submitted' check(status in ('submitted','in_review','approved','rejected','completed')),
 assigned_to uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.assets (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 asset_tag text not null, name text not null, category text, serial_number text,
 assigned_to uuid references public.profiles(id) on delete set null,
 status text not null default 'available' check(status in ('available','assigned','maintenance','retired')),
 purchased_at date, created_at timestamptz not null default now(),
 unique(organization_id,asset_tag)
);

create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 title text not null, body text, action_url text, read_at timestamptz,
 created_at timestamptz not null default now()
);

create table public.audit_logs (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 action text not null, entity_type text not null, entity_id text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

-- Encrypted payload only. Encryption keys and plaintext secrets must never enter PostgreSQL.
create table public.vault_items (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 title text not null, username_hint text,
 encrypted_payload text not null, encryption_version text not null,
 owner_id uuid references public.profiles(id) on delete set null,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.employees enable row level security;
alter table public.documents enable row level security;
alter table public.service_requests enable row level security;
alter table public.assets enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.vault_items enable row level security;

-- Read policies are tenant-scoped. Write policies require an explicit module permission.
create policy customers_read on public.customers for select to authenticated using(public.is_org_member(organization_id));
create policy customers_write on public.customers for all to authenticated using(public.has_org_permission(organization_id,'crm.manage')) with check(public.has_org_permission(organization_id,'crm.manage'));

create policy projects_read on public.projects for select to authenticated using(public.is_org_member(organization_id));
create policy projects_write on public.projects for all to authenticated using(public.has_org_permission(organization_id,'projects.manage')) with check(public.has_org_permission(organization_id,'projects.manage'));
create policy tasks_read on public.tasks for select to authenticated using(public.is_org_member(organization_id));
create policy tasks_write on public.tasks for all to authenticated using(public.has_org_permission(organization_id,'projects.manage')) with check(public.has_org_permission(organization_id,'projects.manage'));

create policy quotes_read on public.quotes for select to authenticated using(public.is_org_member(organization_id));
create policy quotes_write on public.quotes for all to authenticated using(public.has_org_permission(organization_id,'quotes.manage')) with check(public.has_org_permission(organization_id,'quotes.manage'));
create policy quote_items_read on public.quote_items for select to authenticated using(exists(select 1 from public.quotes q where q.id=quote_id and public.is_org_member(q.organization_id)));
create policy quote_items_write on public.quote_items for all to authenticated using(exists(select 1 from public.quotes q where q.id=quote_id and public.has_org_permission(q.organization_id,'quotes.manage'))) with check(exists(select 1 from public.quotes q where q.id=quote_id and public.has_org_permission(q.organization_id,'quotes.manage')));

create policy employees_read on public.employees for select to authenticated using(public.has_org_permission(organization_id,'hr.manage'));
create policy employees_write on public.employees for all to authenticated using(public.has_org_permission(organization_id,'hr.manage')) with check(public.has_org_permission(organization_id,'hr.manage'));
create policy documents_read on public.documents for select to authenticated using(public.is_org_member(organization_id));
create policy documents_write on public.documents for all to authenticated using(public.has_org_permission(organization_id,'documents.manage')) with check(public.has_org_permission(organization_id,'documents.manage'));
create policy requests_read on public.service_requests for select to authenticated using(public.is_org_member(organization_id) and (requester_id=auth.uid() or assigned_to=auth.uid() or public.has_org_permission(organization_id,'requests.manage')));
create policy requests_write on public.service_requests for all to authenticated using(public.has_org_permission(organization_id,'requests.manage')) with check(public.has_org_permission(organization_id,'requests.manage'));
create policy assets_read on public.assets for select to authenticated using(public.is_org_member(organization_id));
create policy assets_write on public.assets for all to authenticated using(public.has_org_permission(organization_id,'assets.manage')) with check(public.has_org_permission(organization_id,'assets.manage'));

create policy notifications_read on public.notifications for select to authenticated using(user_id=auth.uid() and public.is_org_member(organization_id));
create policy notifications_update on public.notifications for update to authenticated using(user_id=auth.uid() and public.is_org_member(organization_id)) with check(user_id=auth.uid() and public.is_org_member(organization_id));
create policy audit_read on public.audit_logs for select to authenticated using(public.has_org_permission(organization_id,'audit.read'));
create policy vault_read on public.vault_items for select to authenticated using(public.is_org_member(organization_id) and (owner_id=auth.uid() or public.has_org_permission(organization_id,'vault.manage')));
create policy vault_insert on public.vault_items for insert to authenticated with check(public.is_org_member(organization_id) and (owner_id=auth.uid() or public.has_org_permission(organization_id,'vault.manage')));
create policy vault_update on public.vault_items for update to authenticated using(public.is_org_member(organization_id) and (owner_id=auth.uid() or public.has_org_permission(organization_id,'vault.manage'))) with check(public.is_org_member(organization_id) and (owner_id=auth.uid() or public.has_org_permission(organization_id,'vault.manage')));

create index projects_org_status_idx on public.projects(organization_id,status);
create index tasks_org_assignee_status_idx on public.tasks(organization_id,assignee_id,status);
create index quotes_org_status_idx on public.quotes(organization_id,status);
create index notifications_unread_idx on public.notifications(user_id,created_at desc) where read_at is null;
create index audit_org_created_idx on public.audit_logs(organization_id,created_at desc);
create index vault_org_owner_idx on public.vault_items(organization_id,owner_id);

-- Before enabling production: provision roles/grants server-side, add storage policies,
-- add audit-writing triggers/RPCs, and test cross-tenant denial and role boundaries.
