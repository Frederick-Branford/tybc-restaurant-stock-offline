-- ============================================================
-- Restaurant Stock System
-- Migration 002: Inventory Master
-- ============================================================


-- ============================================================
-- 1. Categories
-- ============================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),

  code text not null unique,
  name text not null,
  description text,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint categories_code_format
    check (code ~ '^[A-Z][A-Z0-9_]*$'),

  constraint categories_name_not_blank
    check (length(trim(name)) > 0)
);

create unique index categories_name_ci_uidx
  on public.categories (lower(trim(name)));

create trigger categories_set_updated_at
before update on public.categories
for each row
execute function public.set_updated_at();


-- ============================================================
-- 2. Units
-- ============================================================

create table public.units (
  id uuid primary key default gen_random_uuid(),

  code text not null unique,
  name text not null,
  symbol text not null,

  unit_type text not null,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint units_code_format
    check (code ~ '^[A-Z][A-Z0-9_]*$'),

  constraint units_name_not_blank
    check (length(trim(name)) > 0),

  constraint units_symbol_not_blank
    check (length(trim(symbol)) > 0),

  constraint units_type_valid
    check (
      unit_type in (
        'WEIGHT',
        'VOLUME',
        'COUNT',
        'PACKAGE',
        'OTHER'
      )
    )
);

create unique index units_name_ci_uidx
  on public.units (lower(trim(name)));

create trigger units_set_updated_at
before update on public.units
for each row
execute function public.set_updated_at();


-- ============================================================
-- 3. Items
--
-- base_unit_id is the canonical unit used internally.
--
-- Example:
-- Chicken:
--   UI       = 5 kg
--   Database = 5000 g
--
-- ============================================================

create table public.items (
  id uuid primary key default gen_random_uuid(),

  sku text not null unique,
  name text not null,

  category_id uuid not null
    references public.categories(id)
    on delete restrict,

  base_unit_id uuid not null
    references public.units(id)
    on delete restrict,

  minimum_stock numeric(18,4) not null default 0,
  reorder_point numeric(18,4) not null default 0,

  notes text,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint items_sku_format
    check (
      sku ~ '^[A-Z0-9][A-Z0-9_-]*$'
    ),

  constraint items_name_not_blank
    check (length(trim(name)) > 0),

  constraint items_minimum_stock_nonnegative
    check (minimum_stock >= 0),

  constraint items_reorder_point_nonnegative
    check (reorder_point >= 0),

  constraint items_reorder_not_below_minimum
    check (reorder_point >= minimum_stock)
);

create unique index items_name_ci_uidx
  on public.items (lower(trim(name)));

create index items_category_id_idx
  on public.items(category_id);

create index items_base_unit_id_idx
  on public.items(base_unit_id);

create index items_active_idx
  on public.items(is_active);

create trigger items_set_updated_at
before update on public.items
for each row
execute function public.set_updated_at();


-- ============================================================
-- 4. Item Units
--
-- Defines how alternative units convert to the item's base unit.
--
-- Example:
--
-- Sauce
-- Base unit = ml
--
-- Bottle:
-- conversion_to_base = 1000
--
-- Carton:
-- conversion_to_base = 12000
--
-- ============================================================

create table public.item_units (
  id uuid primary key default gen_random_uuid(),

  item_id uuid not null
    references public.items(id)
    on delete cascade,

  unit_id uuid not null
    references public.units(id)
    on delete restrict,

  conversion_to_base numeric(18,6) not null,

  is_purchase_unit boolean not null default false,
  is_default_display_unit boolean not null default false,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint item_units_conversion_positive
    check (conversion_to_base > 0),

  constraint item_units_item_unit_unique
    unique (item_id, unit_id)
);

create index item_units_item_id_idx
  on public.item_units(item_id);

create index item_units_unit_id_idx
  on public.item_units(unit_id);

create unique index item_units_one_default_display_per_item_idx
  on public.item_units(item_id)
  where is_default_display_unit = true
    and is_active = true;

create trigger item_units_set_updated_at
before update on public.item_units
for each row
execute function public.set_updated_at();


-- ============================================================
-- 5. Automatically create base-unit mapping
--
-- Every new item receives:
--
-- conversion_to_base = 1
-- default display unit = base unit
--
-- ============================================================

create or replace function public.create_item_base_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin

  insert into public.item_units (
    item_id,
    unit_id,
    conversion_to_base,
    is_purchase_unit,
    is_default_display_unit
  )
  values (
    new.id,
    new.base_unit_id,
    1,
    false,
    true
  );

  return new;

end;
$$;

revoke all
on function public.create_item_base_unit()
from public;

create trigger items_create_base_unit
after insert on public.items
for each row
execute function public.create_item_base_unit();


-- ============================================================
-- 6. Seed standard categories
-- ============================================================

insert into public.categories (
  code,
  name,
  description
)
values
  (
    'INGREDIENT',
    'Ingredient',
    'Food ingredients and raw materials.'
  ),
  (
    'BEVERAGE',
    'Beverage',
    'Drinks and beverage inventory.'
  ),
  (
    'PACKAGING',
    'Packaging',
    'Boxes, bags, cups, containers, and packaging.'
  ),
  (
    'CLEANING',
    'Cleaning',
    'Cleaning and sanitation supplies.'
  ),
  (
    'GENERAL',
    'General Supply',
    'General restaurant supplies.'
  );


-- ============================================================
-- 7. Seed standard units
-- ============================================================

insert into public.units (
  code,
  name,
  symbol,
  unit_type
)
values
  (
    'G',
    'Gram',
    'g',
    'WEIGHT'
  ),
  (
    'KG',
    'Kilogram',
    'kg',
    'WEIGHT'
  ),
  (
    'ML',
    'Milliliter',
    'ml',
    'VOLUME'
  ),
  (
    'L',
    'Liter',
    'L',
    'VOLUME'
  ),
  (
    'PCS',
    'Piece',
    'pcs',
    'COUNT'
  ),
  (
    'PACK',
    'Pack',
    'pack',
    'PACKAGE'
  ),
  (
    'BAG',
    'Bag',
    'bag',
    'PACKAGE'
  ),
  (
    'BOX',
    'Box',
    'box',
    'PACKAGE'
  ),
  (
    'BOTTLE',
    'Bottle',
    'bottle',
    'PACKAGE'
  ),
  (
    'CARTON',
    'Carton',
    'carton',
    'PACKAGE'
  );


-- ============================================================
-- 8. RLS
-- ============================================================

alter table public.categories
enable row level security;

alter table public.units
enable row level security;

alter table public.items
enable row level security;

alter table public.item_units
enable row level security;


-- ============================================================
-- 9. Read Policies
-- ============================================================

create policy "inventory users can read categories"
on public.categories
for select
to authenticated
using (
  public.has_permission('inventory.view')
);

create policy "inventory users can read units"
on public.units
for select
to authenticated
using (
  public.has_permission('inventory.view')
);

create policy "inventory users can read items"
on public.items
for select
to authenticated
using (
  public.has_permission('inventory.view')
);

create policy "inventory users can read item units"
on public.item_units
for select
to authenticated
using (
  public.has_permission('inventory.view')
);


-- ============================================================
-- 10. Explicit API privileges
--
-- The Supabase project is configured not to automatically expose
-- new tables. Therefore privileges are granted intentionally.
--
-- Authenticated users receive read-only access here.
-- Mutations remain server-controlled.
-- ============================================================

revoke all
on public.categories,
   public.units,
   public.items,
   public.item_units
from anon;

grant select
on public.categories,
   public.units,
   public.items,
   public.item_units
to authenticated;

revoke insert, update, delete
on public.categories,
   public.units,
   public.items,
   public.item_units
from authenticated;

grant all
on public.categories,
   public.units,
   public.items,
   public.item_units
to service_role;


-- ============================================================
-- 11. Identity API privilege hardening
--
-- Migration 001 intentionally focused on identity schema/RLS.
-- Explicit table privileges are declared here so Cloud and Local
-- behave consistently even when auto-expose is disabled.
-- ============================================================

revoke all
on public.roles,
   public.permissions,
   public.role_permissions,
   public.profiles
from anon;

grant select
on public.roles,
   public.permissions,
   public.role_permissions,
   public.profiles
to authenticated;

revoke insert, update, delete
on public.roles,
   public.permissions,
   public.role_permissions,
   public.profiles
from authenticated;

grant all
on public.roles,
   public.permissions,
   public.role_permissions,
   public.profiles
to service_role;


-- ============================================================
-- NOTE
--
-- No authenticated INSERT / UPDATE / DELETE policies are created.
--
-- Inventory mutations will go through controlled server-side
-- business operations.
--
-- Stock quantities are NOT stored in these tables.
--
-- Current stock will be derived from the immutable stock ledger
-- introduced in Migration 003.
-- ============================================================
