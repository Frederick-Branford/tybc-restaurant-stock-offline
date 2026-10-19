-- ============================================================
-- Restaurant Stock System
-- Migration 007: Purchasing Foundation
-- ============================================================
--
-- Scope:
--   - Suppliers
--   - Purchase Orders
--   - Purchase Order Items
--   - PO number generation
--   - Status transition protection
--   - Ordered quantity / unit conversion snapshots
--   - RLS + grants
--
-- IMPORTANT:
--   This migration DOES NOT increase inventory.
--   Stock increases only during Receiving in Migration 008.
-- ============================================================


-- ============================================================
-- 1. ENUM-LIKE STATUS DOMAIN
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'purchase_order_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.purchase_order_status as enum (
      'DRAFT',
      'ORDERED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED'
    );
  end if;
end
$$;


-- ============================================================
-- 2. PURCHASE ORDER NUMBER SEQUENCE
-- ============================================================

create sequence if not exists public.purchase_order_number_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1;


create or replace function public.generate_purchase_order_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select
    'PO-' ||
    to_char(
      timezone('Asia/Bangkok', now()),
      'YYYYMMDD'
    ) ||
    '-' ||
    lpad(
      nextval(
        'public.purchase_order_number_seq'
      )::text,
      6,
      '0'
    );
$$;


revoke all
on function public.generate_purchase_order_number()
from public, anon, authenticated;

grant execute
on function public.generate_purchase_order_number()
to service_role;


-- ============================================================
-- 3. SUPPLIERS
-- ============================================================

create table if not exists public.suppliers (
  id uuid primary key
    default gen_random_uuid(),

  name text not null,

  contact_name text,
  phone text,
  email text,
  tax_id text,
  address text,
  note text,

  is_active boolean not null
    default true,

  created_by uuid
    references auth.users(id)
    on delete set null,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  constraint suppliers_name_not_blank
    check (
      length(trim(name)) > 0
    ),

  constraint suppliers_email_not_blank
    check (
      email is null
      or length(trim(email)) > 0
    ),

  constraint suppliers_phone_not_blank
    check (
      phone is null
      or length(trim(phone)) > 0
    )
);


create index if not exists
  suppliers_name_idx
on public.suppliers (
  lower(name)
);


create index if not exists
  suppliers_active_idx
on public.suppliers (
  is_active
);


drop trigger if exists
  suppliers_set_updated_at
on public.suppliers;

create trigger
  suppliers_set_updated_at
before update
on public.suppliers
for each row
execute function public.set_updated_at();


-- ============================================================
-- 4. PURCHASE ORDERS
-- ============================================================

create table if not exists public.purchase_orders (
  id uuid primary key
    default gen_random_uuid(),

  po_number text not null
    default public.generate_purchase_order_number(),

  supplier_id uuid not null
    references public.suppliers(id)
    on delete restrict,

  status public.purchase_order_status
    not null
    default 'DRAFT',

  ordered_at timestamptz,

  expected_at timestamptz,

  notes text,

  created_by uuid not null
    references auth.users(id)
    on delete restrict,

  approved_by uuid
    references auth.users(id)
    on delete set null,

  approved_at timestamptz,

  cancelled_by uuid
    references auth.users(id)
    on delete set null,

  cancelled_at timestamptz,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  constraint purchase_orders_po_number_unique
    unique (po_number),

  constraint purchase_orders_po_number_not_blank
    check (
      length(trim(po_number)) > 0
    ),

  constraint purchase_orders_ordered_timestamp
    check (
      status = 'DRAFT'
      or ordered_at is not null
    ),

  constraint purchase_orders_cancel_timestamp
    check (
      status <> 'CANCELLED'
      or cancelled_at is not null
    )
);


create index if not exists
  purchase_orders_supplier_idx
on public.purchase_orders (
  supplier_id
);


create index if not exists
  purchase_orders_status_idx
on public.purchase_orders (
  status
);


create index if not exists
  purchase_orders_created_at_idx
on public.purchase_orders (
  created_at desc
);


create index if not exists
  purchase_orders_ordered_at_idx
on public.purchase_orders (
  ordered_at desc
)
where ordered_at is not null;


drop trigger if exists
  purchase_orders_set_updated_at
on public.purchase_orders;

create trigger
  purchase_orders_set_updated_at
before update
on public.purchase_orders
for each row
execute function public.set_updated_at();


-- ============================================================
-- 5. PURCHASE ORDER ITEMS
-- ============================================================

create table if not exists public.purchase_order_items (
  id uuid primary key
    default gen_random_uuid(),

  purchase_order_id uuid not null
    references public.purchase_orders(id)
    on delete cascade,

  item_id uuid not null
    references public.items(id)
    on delete restrict,

  ordered_quantity numeric(18,4)
    not null,

  order_unit_id uuid not null
    references public.units(id)
    on delete restrict,

  conversion_to_base numeric(18,6)
    not null,

  ordered_base_quantity numeric(18,4)
    generated always as (
      round(
        ordered_quantity *
        conversion_to_base,
        4
      )
    ) stored,

  unit_cost numeric(18,4),

  received_quantity numeric(18,4)
    not null
    default 0,

  received_base_quantity numeric(18,4)
    not null
    default 0,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  constraint purchase_order_items_unique_item
    unique (
      purchase_order_id,
      item_id
    ),

  constraint purchase_order_items_ordered_quantity_positive
    check (
      ordered_quantity > 0
    ),

  constraint purchase_order_items_conversion_positive
    check (
      conversion_to_base > 0
    ),

  constraint purchase_order_items_unit_cost_nonnegative
    check (
      unit_cost is null
      or unit_cost >= 0
    ),

  constraint purchase_order_items_received_quantity_nonnegative
    check (
      received_quantity >= 0
    ),

  constraint purchase_order_items_received_base_nonnegative
    check (
      received_base_quantity >= 0
    ),

  constraint purchase_order_items_received_not_over_ordered
    check (
      received_base_quantity <=
      round(
        ordered_quantity *
        conversion_to_base,
        4
      )
    )
);


create index if not exists
  purchase_order_items_po_idx
on public.purchase_order_items (
  purchase_order_id
);


create index if not exists
  purchase_order_items_item_idx
on public.purchase_order_items (
  item_id
);


drop trigger if exists
  purchase_order_items_set_updated_at
on public.purchase_order_items;

create trigger
  purchase_order_items_set_updated_at
before update
on public.purchase_order_items
for each row
execute function public.set_updated_at();


-- ============================================================
-- 6. VALIDATE PO ITEM
--
-- Snapshot the item-unit conversion at the time the PO line is
-- created. The conversion cannot silently change later.
-- ============================================================

create or replace function public.validate_purchase_order_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_po_status public.purchase_order_status;
  v_conversion numeric(18,6);
  v_item_active boolean;
begin

  select po.status
  into v_po_status
  from public.purchase_orders po
  where po.id = new.purchase_order_id;

  if v_po_status is null then
    raise exception
      'Purchase Order does not exist.';
  end if;


  if tg_op = 'INSERT'
     and v_po_status <> 'DRAFT' then
    raise exception
      'Purchase Order items may only be added while PO is DRAFT.';
  end if;


  select i.is_active
  into v_item_active
  from public.items i
  where i.id = new.item_id;

  if v_item_active is distinct from true then
    raise exception
      'Inventory item does not exist or is inactive.';
  end if;


  select iu.conversion_to_base
  into v_conversion
  from public.item_units iu
  where iu.item_id = new.item_id
    and iu.unit_id = new.order_unit_id
    and iu.is_active = true;

  if v_conversion is null then
    raise exception
      'Selected purchase unit is not configured for this item.';
  end if;


  if tg_op = 'INSERT' then

    new.conversion_to_base :=
      v_conversion;

    new.received_quantity :=
      0;

    new.received_base_quantity :=
      0;

  elsif tg_op = 'UPDATE' then

    -- Before Receiving exists, commercial fields can only
    -- change while the PO is still DRAFT.
    if v_po_status <> 'DRAFT' then

      if
        new.purchase_order_id is distinct from old.purchase_order_id
        or new.item_id is distinct from old.item_id
        or new.ordered_quantity is distinct from old.ordered_quantity
        or new.order_unit_id is distinct from old.order_unit_id
        or new.conversion_to_base is distinct from old.conversion_to_base
        or new.unit_cost is distinct from old.unit_cost
      then
        raise exception
          'Ordered PO item fields are immutable after PO leaves DRAFT.';
      end if;

    else

      -- If item/unit is changed while still DRAFT,
      -- refresh the conversion snapshot.
      new.conversion_to_base :=
        v_conversion;

      if
        old.received_quantity <> 0
        or old.received_base_quantity <> 0
      then
        raise exception
          'DRAFT PO item cannot already contain received quantities.';
      end if;

      new.received_quantity :=
        0;

      new.received_base_quantity :=
        0;

    end if;

  end if;


  return new;
end;
$$;


drop trigger if exists
  validate_purchase_order_item
on public.purchase_order_items;

create trigger
  validate_purchase_order_item
before insert or update
on public.purchase_order_items
for each row
execute function public.validate_purchase_order_item();


-- ============================================================
-- 7. PROTECT DELETE / COMMERCIAL EDITS AFTER DRAFT
-- ============================================================

create or replace function public.protect_purchase_order_item_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.purchase_order_status;
begin

  select po.status
  into v_status
  from public.purchase_orders po
  where po.id = old.purchase_order_id;

  if v_status <> 'DRAFT' then
    raise exception
      'Purchase Order items cannot be deleted after PO leaves DRAFT.';
  end if;

  return old;
end;
$$;


drop trigger if exists
  protect_purchase_order_item_delete
on public.purchase_order_items;

create trigger
  protect_purchase_order_item_delete
before delete
on public.purchase_order_items
for each row
execute function public.protect_purchase_order_item_delete();


-- ============================================================
-- 8. PO STATUS TRANSITION PROTECTION
-- ============================================================

create or replace function public.validate_purchase_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item_count integer;
begin

  if new.status = old.status then
    return new;
  end if;


  -- DRAFT -> ORDERED / CANCELLED
  if old.status = 'DRAFT' then

    if new.status not in (
      'ORDERED',
      'CANCELLED'
    ) then
      raise exception
        'Invalid PO transition: % -> %',
        old.status,
        new.status;
    end if;


    if new.status = 'ORDERED' then

      select count(*)
      into v_item_count
      from public.purchase_order_items poi
      where poi.purchase_order_id = old.id;

      if v_item_count = 0 then
        raise exception
          'Purchase Order must contain at least one item before ordering.';
      end if;

      new.ordered_at :=
        coalesce(
          new.ordered_at,
          now()
        );

    end if;


    if new.status = 'CANCELLED' then
      new.cancelled_at :=
        coalesce(
          new.cancelled_at,
          now()
        );
    end if;


    return new;
  end if;


  -- ORDERED -> PARTIALLY_RECEIVED / RECEIVED / CANCELLED
  if old.status = 'ORDERED' then

    if new.status not in (
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED'
    ) then
      raise exception
        'Invalid PO transition: % -> %',
        old.status,
        new.status;
    end if;

    if new.status = 'CANCELLED' then
      new.cancelled_at :=
        coalesce(
          new.cancelled_at,
          now()
        );
    end if;

    return new;
  end if;


  -- PARTIALLY_RECEIVED -> RECEIVED / CANCELLED
  if old.status = 'PARTIALLY_RECEIVED' then

    if new.status not in (
      'RECEIVED',
      'CANCELLED'
    ) then
      raise exception
        'Invalid PO transition: % -> %',
        old.status,
        new.status;
    end if;

    if new.status = 'CANCELLED' then
      new.cancelled_at :=
        coalesce(
          new.cancelled_at,
          now()
        );
    end if;

    return new;
  end if;


  -- Terminal statuses cannot transition.
  if old.status in (
    'RECEIVED',
    'CANCELLED'
  ) then
    raise exception
      'Purchase Order is already in terminal state: %',
      old.status;
  end if;


  raise exception
    'Invalid PO transition: % -> %',
    old.status,
    new.status;
end;
$$;


drop trigger if exists
  validate_purchase_order_transition
on public.purchase_orders;

create trigger
  validate_purchase_order_transition
before update of status
on public.purchase_orders
for each row
execute function public.validate_purchase_order_transition();


-- ============================================================
-- 9. PROTECT TERMINAL PURCHASE ORDERS
-- ============================================================

create or replace function public.protect_terminal_purchase_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin

  if old.status in (
    'RECEIVED',
    'CANCELLED'
  ) then

    if
      new.po_number is distinct from old.po_number
      or new.supplier_id is distinct from old.supplier_id
      or new.expected_at is distinct from old.expected_at
      or new.notes is distinct from old.notes
      or new.created_by is distinct from old.created_by
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.cancelled_by is distinct from old.cancelled_by
      or new.cancelled_at is distinct from old.cancelled_at
    then
      raise exception
        'Terminal Purchase Order cannot be edited.';
    end if;

  end if;


  return new;
end;
$$;


drop trigger if exists
  protect_terminal_purchase_order
on public.purchase_orders;

create trigger
  protect_terminal_purchase_order
before update
on public.purchase_orders
for each row
execute function public.protect_terminal_purchase_order();


-- ============================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================

alter table public.suppliers
  enable row level security;

alter table public.purchase_orders
  enable row level security;

alter table public.purchase_order_items
  enable row level security;


drop policy if exists
  suppliers_select_policy
on public.suppliers;

create policy
  suppliers_select_policy
on public.suppliers
for select
to authenticated
using (
  public.has_permission(
    'purchase.view'
  )
  or
  public.has_permission(
    'supplier.manage'
  )
);


drop policy if exists
  purchase_orders_select_policy
on public.purchase_orders;

create policy
  purchase_orders_select_policy
on public.purchase_orders
for select
to authenticated
using (
  public.has_permission(
    'purchase.view'
  )
);


drop policy if exists
  purchase_order_items_select_policy
on public.purchase_order_items;

create policy
  purchase_order_items_select_policy
on public.purchase_order_items
for select
to authenticated
using (
  public.has_permission(
    'purchase.view'
  )
);


-- ============================================================
-- 11. TABLE PRIVILEGES
--
-- Browser/authenticated clients are read-only.
-- Mutations will be performed through permission-checked
-- server-side commands using service_role.
-- ============================================================

revoke all
on public.suppliers
from anon, authenticated;

revoke all
on public.purchase_orders
from anon, authenticated;

revoke all
on public.purchase_order_items
from anon, authenticated;


grant select
on public.suppliers
to authenticated;

grant select
on public.purchase_orders
to authenticated;

grant select
on public.purchase_order_items
to authenticated;


grant all
on public.suppliers
to service_role;

grant all
on public.purchase_orders
to service_role;

grant all
on public.purchase_order_items
to service_role;


grant usage, select
on sequence public.purchase_order_number_seq
to service_role;


-- ============================================================
-- END MIGRATION 007
-- ============================================================
