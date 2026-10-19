-- ============================================================
-- Restaurant Stock System
-- Migration 005: Atomic Stock Out
-- ============================================================

create or replace function public.record_stock_out(
  p_item_id uuid,
  p_input_quantity numeric,
  p_input_unit_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_note text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement_id uuid;
  v_base_unit_id uuid;
  v_conversion numeric(18,6);
  v_base_quantity numeric(18,4);
  v_current_quantity numeric(18,4);
begin

  if not public.user_has_permission(
    p_actor_id,
    'inventory.stock_out'
  ) then
    raise exception
      'Actor does not have inventory.stock_out permission.';
  end if;


  if p_input_quantity is null
     or p_input_quantity <= 0 then
    raise exception
      'Stock out quantity must be greater than zero.';
  end if;

  if p_idempotency_key is null
     or length(trim(p_idempotency_key)) = 0 then
    raise exception
      'Idempotency key is required.';
  end if;


  -- Serialize concurrent Stock Out operations
  -- for the same inventory item.
  select i.base_unit_id
  into v_base_unit_id
  from public.items i
  where i.id = p_item_id
    and i.is_active = true
  for update;

  if v_base_unit_id is null then
    raise exception
      'Inventory item does not exist or is inactive.';
  end if;


  select iu.conversion_to_base
  into v_conversion
  from public.item_units iu
  where iu.item_id = p_item_id
    and iu.unit_id = p_input_unit_id
    and iu.is_active = true;

  if v_conversion is null then
    raise exception
      'Selected unit is not configured for this item.';
  end if;


  v_base_quantity :=
    round(
      p_input_quantity * v_conversion,
      4
    );

  if v_base_quantity <= 0 then
    raise exception
      'Stock out quantity is too small after conversion.';
  end if;


  -- Current inventory comes only from immutable ledger.
  select
    coalesce(
      sum(sm.base_quantity),
      0
    )::numeric(18,4)
  into v_current_quantity
  from public.stock_movements sm
  where sm.item_id = p_item_id;


  -- Normal Stock Out may never make inventory negative.
  if v_current_quantity < v_base_quantity then
    raise exception
      'INSUFFICIENT_STOCK: available %, requested %',
      v_current_quantity,
      v_base_quantity
      using errcode = 'P0001';
  end if;


  insert into public.stock_movements (
    item_id,
    movement_type,
    input_quantity,
    input_unit_id,
    conversion_to_base,
    base_unit_id,
    base_quantity,
    reason_code,
    note,
    idempotency_key,
    occurred_at,
    created_by
  )
  values (
    p_item_id,
    'STOCK_OUT',
    p_input_quantity,
    p_input_unit_id,
    v_conversion,
    v_base_unit_id,
    -v_base_quantity,
    'MANUAL_STOCK_OUT',
    nullif(trim(p_note), ''),
    trim(p_idempotency_key),
    p_occurred_at,
    p_actor_id
  )
  returning id
  into v_movement_id;


  return v_movement_id;

end;
$$;


-- Browser cannot call this directly.
revoke all
on function public.record_stock_out(
  uuid,
  numeric,
  uuid,
  uuid,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;


-- Trusted Next.js server may call via service role.
grant execute
on function public.record_stock_out(
  uuid,
  numeric,
  uuid,
  uuid,
  text,
  text,
  timestamptz
)
to service_role;
