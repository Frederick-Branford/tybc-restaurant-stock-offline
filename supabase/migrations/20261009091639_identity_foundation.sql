-- ============================================================
-- Restaurant Stock System
-- Migration 001: Identity Foundation
-- ============================================================


-- ============================================================
-- 1. updated_at helper
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- 2. Roles
-- ============================================================

create table public.roles (
  id uuid primary key default gen_random_uuid(),

  code text not null unique,
  name text not null,
  description text,

  is_system boolean not null default true,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint roles_code_format
    check (code ~ '^[A-Z][A-Z0-9_]*$'),

  constraint roles_name_not_blank
    check (length(trim(name)) > 0)
);

create trigger roles_set_updated_at
before update on public.roles
for each row
execute function public.set_updated_at();


-- ============================================================
-- 3. Permissions
-- ============================================================

create table public.permissions (
  id uuid primary key default gen_random_uuid(),

  code text not null unique,
  name text not null,
  description text,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  constraint permissions_code_format
    check (
      code ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'
    ),

  constraint permissions_name_not_blank
    check (length(trim(name)) > 0)
);


-- ============================================================
-- 4. Profiles
-- ============================================================

create table public.profiles (
  id uuid primary key
    references auth.users(id)
    on delete cascade,

  full_name text,
  phone text,

  role_id uuid
    references public.roles(id)
    on delete restrict,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_full_name_not_blank
    check (
      full_name is null
      or length(trim(full_name)) > 0
    )
);

create index profiles_role_id_idx
  on public.profiles(role_id);

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


-- ============================================================
-- 5. Role Permissions
-- ============================================================

create table public.role_permissions (
  role_id uuid not null
    references public.roles(id)
    on delete cascade,

  permission_id uuid not null
    references public.permissions(id)
    on delete cascade,

  created_by uuid
    references auth.users(id)
    on delete set null,

  created_at timestamptz not null default now(),

  primary key (role_id, permission_id)
);

create index role_permissions_permission_id_idx
  on public.role_permissions(permission_id);


-- ============================================================
-- 6. Seed system roles
-- Essential application reference data belongs in migrations.
-- ============================================================

insert into public.roles (
  code,
  name,
  description,
  is_system
)
values
  (
    'OWNER',
    'Owner',
    'Full business and system access.',
    true
  ),
  (
    'MANAGER',
    'Manager',
    'Operational management access.',
    true
  ),
  (
    'PURCHASING',
    'Purchasing',
    'Purchasing and supplier management access.',
    true
  ),
  (
    'STAFF',
    'Staff',
    'Day-to-day inventory operation access.',
    true
  );


-- ============================================================
-- 7. Seed permissions
-- ============================================================

insert into public.permissions (
  code,
  name,
  description
)
values
  (
    'inventory.view',
    'View Inventory',
    'View inventory items and stock information.'
  ),
  (
    'inventory.create',
    'Create Inventory',
    'Create inventory master records.'
  ),
  (
    'inventory.adjust',
    'Adjust Inventory',
    'Perform authorized inventory adjustments.'
  ),
  (
    'inventory.count',
    'Count Inventory',
    'Perform physical stock counts.'
  ),
  (
    'waste.create',
    'Record Waste',
    'Record waste and inventory losses.'
  ),
  (
    'purchase.view',
    'View Purchasing',
    'View purchasing information.'
  ),
  (
    'purchase.create',
    'Create Purchase Orders',
    'Create purchase orders.'
  ),
  (
    'purchase.approve',
    'Approve Purchase Orders',
    'Approve purchasing operations.'
  ),
  (
    'supplier.manage',
    'Manage Suppliers',
    'Create and manage suppliers.'
  ),
  (
    'reports.view',
    'View Reports',
    'View inventory and operational reports.'
  ),
  (
    'users.manage',
    'Manage Users',
    'Manage application users and their access.'
  ),
  (
    'ai.use',
    'Use AI',
    'Use AI inventory analysis features.'
  );


-- ============================================================
-- 8. OWNER permissions
-- OWNER gets every currently defined permission.
-- ============================================================

insert into public.role_permissions (
  role_id,
  permission_id
)
select
  r.id,
  p.id
from public.roles r
cross join public.permissions p
where r.code = 'OWNER';


-- ============================================================
-- 9. MANAGER permissions
-- ============================================================

insert into public.role_permissions (
  role_id,
  permission_id
)
select
  r.id,
  p.id
from public.roles r
join public.permissions p
  on p.code in (
    'inventory.view',
    'inventory.create',
    'inventory.adjust',
    'inventory.count',
    'waste.create',
    'purchase.view',
    'purchase.create',
    'purchase.approve',
    'supplier.manage',
    'reports.view',
    'ai.use'
  )
where r.code = 'MANAGER';


-- ============================================================
-- 10. PURCHASING permissions
-- ============================================================

insert into public.role_permissions (
  role_id,
  permission_id
)
select
  r.id,
  p.id
from public.roles r
join public.permissions p
  on p.code in (
    'inventory.view',
    'purchase.view',
    'purchase.create',
    'supplier.manage',
    'reports.view'
  )
where r.code = 'PURCHASING';


-- ============================================================
-- 11. STAFF permissions
-- ============================================================

insert into public.role_permissions (
  role_id,
  permission_id
)
select
  r.id,
  p.id
from public.roles r
join public.permissions p
  on p.code in (
    'inventory.view',
    'inventory.count',
    'waste.create'
  )
where r.code = 'STAFF';


-- ============================================================
-- 12. Permission helper
--
-- Used by server/RLS policies later.
-- SECURITY DEFINER prevents recursive RLS problems while
-- checking the authenticated user's profile and role.
-- ============================================================

create or replace function public.has_permission(
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles pr
    join public.roles r
      on r.id = pr.role_id
    join public.role_permissions rp
      on rp.role_id = r.id
    join public.permissions p
      on p.id = rp.permission_id
    where pr.id = auth.uid()
      and pr.is_active = true
      and r.is_active = true
      and p.is_active = true
      and p.code = requested_permission
  );
$$;

revoke all
on function public.has_permission(text)
from public;

grant execute
on function public.has_permission(text)
to authenticated;


-- ============================================================
-- 13. Automatically create profile for new Auth users
--
-- New users receive STAFF by default.
-- Promotion to another role must be explicitly authorized.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_role_id uuid;
begin
  select id
  into default_role_id
  from public.roles
  where code = 'STAFF'
    and is_active = true
  limit 1;

  if default_role_id is null then
    raise exception 'Default STAFF role does not exist';
  end if;

  insert into public.profiles (
    id,
    full_name,
    role_id
  )
  values (
    new.id,
    nullif(
      trim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          ''
        )
      ),
      ''
    ),
    default_role_id
  );

  return new;
end;
$$;

revoke all
on function public.handle_new_user()
from public;

drop trigger if exists on_auth_user_created
on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();


-- ============================================================
-- 14. RLS
-- ============================================================

alter table public.roles
enable row level security;

alter table public.permissions
enable row level security;

alter table public.role_permissions
enable row level security;

alter table public.profiles
enable row level security;


-- ============================================================
-- 15. Roles / Permissions read policies
-- ============================================================

create policy "authenticated users can read active roles"
on public.roles
for select
to authenticated
using (is_active = true);

create policy "authenticated users can read active permissions"
on public.permissions
for select
to authenticated
using (is_active = true);


-- ============================================================
-- 16. Profiles read policy
--
-- A user may view their own profile.
-- Users with users.manage may view all profiles.
-- ============================================================

create policy "users can read permitted profiles"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.has_permission('users.manage')
);


-- ============================================================
-- NOTE
--
-- No direct INSERT / UPDATE / DELETE policies are intentionally
-- created yet.
--
-- Identity mutations will be performed through controlled
-- server-side business operations in Phase 2.
-- ============================================================
