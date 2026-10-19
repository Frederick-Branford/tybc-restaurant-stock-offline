-- ============================================================
-- Restaurant Stock System
-- Migration 003: Immutable Stock Ledger
-- ============================================================


-- ============================================================
-- 1. Additional permissions
-- ============================================================

insert into public.permissions (
  code,
  name,
  description
)
values
  (
    'inventory.stock_in',
    'Record Stock In',
    'Record inventory entering stock.'
  ),
  (
    'inventory.stock_out',
    'Record Stock Out',
    'Record inventory leaving available stock.'
  ),
  (
    'purchase.receive',
    'Receive Purchases',
    'Receive purchased goods into inventory.'
  );


-- OWNER
insert into public.role_permissions (
  role_id,
  permission_id
)
select
  r.id,
  p.id
from public.roles r
cross join public.permissions p
where r.code = 'OWNER'
  and p.code in (
    'inventory.stock_in',
    'inventory.stock_out',
    'purchase.receive'
  )
on conflict do nothing;


-- MANAGER
insert into public.role_permissions (
  role_id,
  permission_id
)
select
  r.id,
  p.id
from public.roles r
cross join public.permissions p
where r.code = 'MANAGER'
  and p.code in (
    'inventory.stock_in',
    'inventory.stock_out',
    'purchase.receive'
  )
on conflict do nothing;


-- PURCHASING
insert into public.role_permissions (
  role_id,
  permission_id
)
select
  r.id,
  p.id
from public.roles r
cross join public.permissions p
where r.code = 'PURCHASING'
  and p.code = 'purchase.receive'
on conflict do nothing;


-- STAFF
insert into public.role_permissions (
  role_id,
  permission_id
)
select
  r.id,
  p.id
from public.roles r
cross join public.permissions p
where r.code = 'STAFF'
  and p.code in (
    'inventory.stock_in',
    'inventory.stock_out'
  )
on conflict do nothing;


-- ============================================================
-- 2. Stock Movements
--
-- IMPORTANT:
-- This table is the source of truth for stock.
--
-- Positive base_quantity = stock increase
-- Negative base_quantity = stock decrease
-- ============================================================

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),

  item_id uuid not null
    references public.items(id)
    on delete restrict,

  movement_type text not null,

  -- Quantity entered by the user.
  input_quantity numeric(18,4) not null,

  input_unit_id uuid not null
    references public.units(id)
    on delete restrict,

  -- Snapshot of conversion rate at transaction time.
  conversion_to_base numeric(18,6) not null,

  -- Item base unit at transaction time.
  base_unit_id uuid not null
    references public.units(id)
    on delete restrict,

  -- Signed effect on inventory.
  base_quantity numeric(18,4) not null,

  reason_code text,
  note text,

  -- Link to future records such as PO / Waste / Count / POS.
  reference_type text,
  reference_id uuid,

  -- Protects against retries / double submit / duplicate webhook.
  idempotency_key text,

  occurred_at timestamptz not null default now(),

  created_by uuid
    references auth.users(id)
    on delete set null,

  created_at timestamptz not null default now(),

  constraint stock_movements_type_valid
    check (
      movement_type in (
        'OPENING_BALANCE',
        'STOCK_IN',
        'STOCK_OUT',
        'WASTE',
        'COUNT_ADJUSTMENT',
        'MANUAL_ADJUSTMENT',
        'PO_RECEIVE',
        'POS_DEDUCTION',
        'RETURN_IN',
        'RETURN_OUT'
      )
    ),

  constraint stock_movements_input_quantity_positive
    check (
      input_quantity > 0
    ),

  constraint stock_movements_conversion_positive
    check (
      conversion_to_base > 0
    ),

  constraint stock_movements_base_quantity_nonzero
    check (
      base_quantity <> 0
    ),

  constraint stock_movements_quantity_matches_conversion
    check (
      abs(base_quantity)
      =
      round(
        input_quantity * conversion_to_base,
        4
      )
    ),

  constraint stock_movements_direction_valid
    check (
      (
        movement_type in (
          'OPENING_BALANCE',
          'STOCK_IN',
          'PO_RECEIVE',
          'RETURN_IN'
        )
        and base_quantity > 0
      )
      or
      (
        movement_type in (
          'STOCK_OUT',
          'WASTE',
          'POS_DEDUCTION',
          'RETURN_OUT'
        )
        and base_quantity < 0
      )
      or
      (
        movement_type in (
          'COUNT_ADJUSTMENT',
          'MANUAL_ADJUSTMENT'
        )
        and base_quantity <> 0
      )
    ),

  constraint stock_movements_reference_pair
    check (
      (
        reference_type is null
        and reference_id is null
      )
      or
      (
        reference_type is not null
        and reference_id is not null
      )
    ),

  constraint stock_movements_reason_not_blank
    check (
      reason_code is null
      or length(trim(reason_code)) > 0
    ),

  constraint stock_movements_idempotency_not_blank
    check (
      idempotency_key is null
      or length(trim(idempotency_key)) > 0
    )
);


-- ============================================================
-- 3. Indexes
-- ============================================================

create index stock_movements_item_created_idx
  on public.stock_movements (
    item_id,
    occurred_at desc
  );

create index stock_movements_type_idx
  on public.stock_movements (
    movement_type
  );

create index stock_movements_created_at_idx
  on public.stock_movements (
    created_at desc
  );

create index stock_movements_reference_idx
  on public.stock_movements (
    reference_type,
    reference_id
  )
  where reference_id is not null;

create unique index stock_movements_idempotency_uidx
  on public.stock_movements (
    idempotency_key
  )
  where idempotency_key is not null;


-- ============================================================
-- 4. Validate movement against Inventory Master
--
-- Ensures:
-- - Item exists and is active
-- - base_unit matches the item
-- - input unit is configured for the item
-- - conversion snapshot matches item_units
-- ============================================================

create or replace function public.validate_stock_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_base_unit uuid;
  expected_conversion numeric(18,6);
begin

  select i.base_unit_id
  into expected_base_unit
  from public.items i
  where i.id = new.item_id
    and i.is_active = true;

  if expected_base_unit is null then
    raise exception
      'Inventory item does not exist or is inactive.';
  end if;

  if new.base_unit_id <> expected_base_unit then
    raise exception
      'Movement base unit does not match the item base unit.';
  end if;

  select iu.conversion_to_base
  into expected_conversion
  from public.item_units iu
  where iu.item_id = new.item_id
    and iu.unit_id = new.input_unit_id
    and iu.is_active = true;

  if expected_conversion is null then
    raise exception
      'Input unit is not configured for this inventory item.';
  end if;

  if new.conversion_to_base <> expected_conversion then
    raise exception
      'Movement conversion does not match the configured item unit.';
  end if;

  return new;
end;
$$;


create trigger stock_movements_validate
before insert on public.stock_movements
for each row
execute function public.validate_stock_movement();


-- ============================================================
-- 5. Immutable Ledger
--
-- Once inserted, a stock movement cannot be edited or deleted.
--
-- Correction = create another movement.
-- ============================================================

create or replace function public.prevent_stock_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin

  raise exception
    'Confirmed stock movements are immutable. Create a correction movement instead.';

end;
$$;


create trigger stock_movements_prevent_update
before update on public.stock_movements
for each row
execute function public.prevent_stock_movement_mutation();


create trigger stock_movements_prevent_delete
before delete on public.stock_movements
for each row
execute function public.prevent_stock_movement_mutation();


-- ============================================================
-- 6. Base Unit Protection
--
-- V1 rule:
-- Once an item is created, its base unit is immutable.
--
-- This protects historical stock mathematics and unit mappings.
-- ============================================================

create or replace function public.prevent_item_base_unit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin

  if new.base_unit_id is distinct from old.base_unit_id then
    raise exception
      'Base unit cannot be changed after an inventory item is created.';
  end if;

  return new;

end;
$$;


create trigger items_prevent_base_unit_change
before update of base_unit_id
on public.items
for each row
execute function public.prevent_item_base_unit_change();


-- ============================================================
-- 7. Inventory Balances
--
-- This VIEW is only a projection.
--
-- Source of truth:
-- public.stock_movements
--
-- Current stock:
-- SUM(base_quantity)
-- ============================================================

create view public.inventory_balances
with (security_invoker = true)
as
select
  i.id as item_id,
  i.sku,
  i.name,

  i.category_id,

  i.base_unit_id,
  u.code as base_unit_code,
  u.symbol as base_unit_symbol,

  coalesce(
    sum(sm.base_quantity),
    0::numeric
  )::numeric(18,4) as current_quantity,

  i.minimum_stock,
  i.reorder_point,

  case
    when coalesce(sum(sm.base_quantity), 0) <= 0
      then 'OUT_OF_STOCK'

    when coalesce(sum(sm.base_quantity), 0) <= i.reorder_point
      then 'LOW_STOCK'

    else 'NORMAL'
  end as stock_status,

  (
    coalesce(sum(sm.base_quantity), 0)
    <= i.minimum_stock
  ) as below_minimum,

  i.is_active

from public.items i

join public.units u
  on u.id = i.base_unit_id

left join public.stock_movements sm
  on sm.item_id = i.id

group by
  i.id,
  i.sku,
  i.name,
  i.category_id,
  i.base_unit_id,
  u.code,
  u.symbol,
  i.minimum_stock,
  i.reorder_point,
  i.is_active;


-- ============================================================
-- 8. RLS
-- ============================================================

alter table public.stock_movements
enable row level security;


create policy "inventory users can read stock movements"
on public.stock_movements
for select
to authenticated
using (
  public.has_permission('inventory.view')
);


-- ============================================================
-- 9. Explicit privileges
--
-- Browser/authenticated clients:
-- READ ONLY
--
-- Controlled server operations:
-- INSERT
--
-- UPDATE / DELETE are not granted.
-- ============================================================

revoke all
on public.stock_movements
from anon;

revoke all
on public.stock_movements
from authenticated;

grant select
on public.stock_movements
to authenticated;


revoke all
on public.stock_movements
from service_role;

grant select, insert
on public.stock_movements
to service_role;


revoke all
on public.inventory_balances
from anon;

grant select
on public.inventory_balances
to authenticated;

grant select
on public.inventory_balances
to service_role;


-- ============================================================
-- Final rule
--
-- NEVER:
-- update current_stock
--
-- ALWAYS:
-- create stock movement
--
-- Current stock =
-- SUM(stock_movements.base_quantity)
-- ============================================================
