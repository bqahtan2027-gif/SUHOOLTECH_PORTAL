-- Identity, tenant isolation, and role-based access foundation.
-- Review and apply only in a newly provisioned Supabase project.
create extension if not exists pgcrypto;

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
  preferred_locale text not null default 'ar' check (preferred_locale in ('ar','en')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  unique (organization_id,user_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  role_key text not null,
  is_system boolean not null default false,
  unique (organization_id,role_key),
  unique (id,organization_id)
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,
  description text not null
);

create table public.membership_roles (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (membership_id,role_id)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id,permission_id)
);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    join public.profiles p on p.id=m.user_id
    where m.organization_id=target_org and m.user_id=auth.uid()
      and m.status='active' and p.is_active
  );
$$;

create or replace function public.has_org_permission(target_org uuid, target_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    join public.profiles p on p.id=m.user_id
    join public.membership_roles mr on mr.membership_id=m.id
    join public.roles r on r.id=mr.role_id and r.organization_id=m.organization_id
    join public.role_permissions rp on rp.role_id=r.id
    join public.permissions pm on pm.id=rp.permission_id
    where m.organization_id=target_org and m.user_id=auth.uid()
      and m.status='active' and p.is_active and pm.permission_key=target_permission
  );
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.membership_roles enable row level security;
alter table public.role_permissions enable row level security;

create policy "organization members can view their org"
on public.organizations for select to authenticated
using (public.is_org_member(id));

create policy "users can view and edit own profile"
on public.profiles for select to authenticated using (id=auth.uid());
create policy "users can update own profile"
on public.profiles for update to authenticated
using (id=auth.uid()) with check (id=auth.uid());

create policy "members can view org memberships"
on public.memberships for select to authenticated
using (public.is_org_member(organization_id));
create policy "members can view org roles"
on public.roles for select to authenticated
using (public.is_org_member(organization_id));
create policy "authenticated can view permission catalog"
on public.permissions for select to authenticated using (true);
create policy "members can view role grants"
on public.role_permissions for select to authenticated
using (exists (select 1 from public.roles r where r.id=role_id and public.is_org_member(r.organization_id)));
create policy "members can view membership roles"
on public.membership_roles for select to authenticated
using (exists (select 1 from public.memberships m where m.id=membership_id and public.is_org_member(m.organization_id)));

insert into public.permissions(permission_key,description) values
('org.admin','Manage organization, users, roles and settings'),
('crm.manage','Manage customer records'),
('projects.manage','Manage projects and tasks'),
('quotes.manage','Manage quotations and sales'),
('hr.manage','Manage employee records'),
('documents.manage','Manage company documents'),
('requests.manage','Manage internal requests and approvals'),
('assets.manage','Manage company assets and inventory'),
('finance.manage','Manage finance records'),
('reports.read','View business reports'),
('vault.manage','Manage shared encrypted vault entries'),
('audit.read','Read organization audit logs')
on conflict (permission_key) do nothing;

-- Organization creation, membership invitations, and initial administrator assignment
-- must be performed by a trusted server-side provisioning workflow.
