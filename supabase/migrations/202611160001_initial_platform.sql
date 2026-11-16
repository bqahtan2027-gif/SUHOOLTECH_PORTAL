-- SUHOOL TECH: initial PostgreSQL/Supabase foundation
-- Apply only to a new Supabase project after reviewing the deployment checklist.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  avatar_url text,
  preferred_locale text not null default 'ar' check (preferred_locale in ('ar','en')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_status text not null default 'active' check (membership_status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  role_key text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, role_key),
  unique (id, organization_id)
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,
  description text not null
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.membership_roles (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (membership_id, role_id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  tax_number text,
  address text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  name text not null,
  description text,
  status text not null default 'planning' check (status in ('planning','active','on_hold','completed','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  start_date date,
  due_date date,
  owner_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','review','done','blocked')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  quote_number text not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft','sent','viewed','accepted','rejected','expired','cancelled')),
  currency char(3) not null default 'SAR',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  valid_until date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quote_number)
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  line_total numeric(14,2) not null default 0 check (line_total >= 0)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  employee_number text not null,
  full_name text not null,
  work_email text,
  department text,
  job_title text,
  employment_status text not null default 'active' check (employment_status in ('active','on_leave','terminated')),
  hire_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_number)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  category text,
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  access_level text not null default 'internal' check (access_level in ('private','internal','restricted')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requester_id uuid references public.profiles(id) on delete set null,
  request_type text not null,
  title text not null,
  details text,
  status text not null default 'submitted' check (status in ('submitted','in_review','approved','rejected','completed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_tag text not null,
  name text not null,
  category text,
  serial_number text,
  assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'available' check (status in ('available','assigned','maintenance','retired')),
  purchased_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, asset_tag)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Store only client-encrypted ciphertext. Never store plaintext passwords or encryption keys.
create table public.vault_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  username_hint text,
  encrypted_payload text not null,
  encryption_version text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.membership_status = 'active'
      and p.is_active = true
  );
$$;

create or replace function public.has_org_permission(target_org uuid, target_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles r on r.id = mr.role_id and r.organization_id = m.organization_id
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    join public.profiles pr on pr.id = m.user_id
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.membership_status = 'active'
      and pr.is_active = true
      and p.permission_key = target_permission
  );
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.membership_roles enable row level security;
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

create policy "members can read their organizations" on public.organizations
for select to authenticated using (public.is_org_member(id));
create policy "users can read own profile" on public.profiles
for select to authenticated using (id = auth.uid());
create policy "users can update own profile" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "members can read memberships in their org" on public.memberships
for select to authenticated using (public.is_org_member(organization_id));
create policy "members can read roles in their org" on public.roles
for select to authenticated using (public.is_org_member(organization_id));
create policy "authenticated can read permission catalog" on public.permissions
for select to authenticated using (true);
create policy "members can read role permissions" on public.role_permissions
for select to authenticated using (
  exists (select 1 from public.roles r where r.id = role_id and public.is_org_member(r.organization_id))
);
create policy "members can read membership roles" on public.membership_roles
for select to authenticated using (
  exists (select 1 from public.memberships m where m.id = membership_id and public.is_org_member(m.organization_id))
);

-- Organization-scoped CRUD. Fine-grained permission checks are applied to writes.
do $$
declare t text;
begin
  foreach t in array array['customers','projects','tasks','quotes','employees','documents','service_requests','assets'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', t || '_read_org', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_org_permission(organization_id, %L))', t || '_insert_permission', t,
      case t when 'customers' then 'customers.manage' when 'projects' then 'projects.manage' when 'tasks' then 'tasks.manage' when 'quotes' then 'quotes.manage' when 'employees' then 'hr.manage' when 'documents' then 'documents.manage' when 'service_requests' then 'requests.manage' else 'assets.manage' end);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_org_permission(organization_id, %L)) with check (public.has_org_permission(organization_id, %L))', t || '_update_permission', t,
      case t when 'customers' then 'customers.manage' when 'projects' then 'projects.manage' when 'tasks' then 'tasks.manage' when 'quotes' then 'quotes.manage' when 'employees' then 'hr.manage' when 'documents' then 'documents.manage' when 'service_requests' then 'requests.manage' else 'assets.manage' end,
      case t when 'customers' then 'customers.manage' when 'projects' then 'projects.manage' when 'tasks' then 'tasks.manage' when 'quotes' then 'quotes.manage' when 'employees' then 'hr.manage' when 'documents' then 'documents.manage' when 'service_requests' then 'requests.manage' else 'assets.manage' end);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_org_permission(organization_id, %L))', t || '_delete_permission', t,
      case t when 'customers' then 'customers.manage' when 'projects' then 'projects.manage' when 'tasks' then 'tasks.manage' when 'quotes' then 'quotes.manage' when 'employees' then 'hr.manage' when 'documents' then 'documents.manage' when 'service_requests' then 'requests.manage' else 'assets.manage' end);
  end loop;
end $$;

create policy "users read own notifications" on public.notifications
for select to authenticated using (user_id = auth.uid() and public.is_org_member(organization_id));
create policy "users update own notifications" on public.notifications
for update to authenticated using (user_id = auth.uid() and public.is_org_member(organization_id))
with check (user_id = auth.uid() and public.is_org_member(organization_id));
create policy "auditors and admins read audit logs" on public.audit_logs
for select to authenticated using (public.has_org_permission(organization_id, 'audit.read'));
create policy "vault owner or vault manager read" on public.vault_items
for select to authenticated using (
  public.is_org_member(organization_id) and
  (owner_id = auth.uid() or public.has_org_permission(organization_id, 'vault.manage'))
);
create policy "vault owner or vault manager insert" on public.vault_items
for insert to authenticated with check (
  public.is_org_member(organization_id) and
  (owner_id = auth.uid() or public.has_org_permission(organization_id, 'vault.manage'))
);
create policy "vault owner or vault manager update" on public.vault_items
for update to authenticated using (
  public.is_org_member(organization_id) and
  (owner_id = auth.uid() or public.has_org_permission(organization_id, 'vault.manage'))
) with check (
  public.is_org_member(organization_id) and
  (owner_id = auth.uid() or public.has_org_permission(organization_id, 'vault.manage'))
);

create index memberships_user_idx on public.memberships(user_id, organization_id);
create index projects_org_status_idx on public.projects(organization_id, status);
create index tasks_org_assignee_status_idx on public.tasks(organization_id, assignee_id, status);
create index quotes_org_status_idx on public.quotes(organization_id, status);
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index audit_logs_org_created_idx on public.audit_logs(organization_id, created_at desc);
create index vault_items_org_owner_idx on public.vault_items(organization_id, owner_id);

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger quotes_updated_at before update on public.quotes for each row execute function public.set_updated_at();
create trigger employees_updated_at before update on public.employees for each row execute function public.set_updated_at();
create trigger service_requests_updated_at before update on public.service_requests for each row execute function public.set_updated_at();
create trigger assets_updated_at before update on public.assets for each row execute function public.set_updated_at();
create trigger vault_items_updated_at before update on public.vault_items for each row execute function public.set_updated_at();

-- Permission catalog; organization roles must be provisioned by a trusted admin workflow.
insert into public.permissions(permission_key, description) values
('customers.manage','Create and manage customer records'),
('projects.manage','Create and manage projects'),
('tasks.manage','Create and manage tasks'),
('quotes.manage','Create and manage quotations'),
('hr.manage','Manage employee records'),
('documents.manage','Manage company documents'),
('requests.manage','Manage internal service requests'),
('assets.manage','Manage company assets'),
('vault.manage','Manage shared password vault entries'),
('audit.read','Read organization audit logs')
on conflict (permission_key) do nothing;
