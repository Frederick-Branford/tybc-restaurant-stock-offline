-- ============================================================
-- Restaurant Stock System
-- Migration 006: Harden Waste Stock Guard
-- ============================================================

create or replace function public.record_waste(
  p_item_id uuid,
  p_input_quantity numeric,
  p_input_unit_id uuid,
  p_waste_reason_id uuid,
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
  v_waste_id uuid;
  v_movement_id uuid;

  v_base_unit_id uuid;
  v_conversion numeric(18,6);
  v_base_quantity numeric(18,4);
  v_current_quantity numeric(18,4);

  v_reason_code text;
begin

  if not public.user_has_permission(
    p_actor_id,
    'waste.create'
  ) then
    raise exception
      'Actor does not have waste.create permission.';
  end if;


  if p_input_quantity is null
     or p_input_quantity <= 0 then
    raise exception
      'Waste quantity must be greater than zero.';
  end if;


  if p_idempotency_key is null
     or length(trim(p_idempotency_key)) = 0 then
    raise exception
      'Idempotency key is required.';
  end if;


  -- ----------------------------------------------------------
  -- Lock inventory item.
  --
  -- Stock Out and Waste now serialize on the same item row.
  -- This prevents concurrent operations from overspending stock.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Validate unit conversion
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- Validate waste reason
  -- ----------------------------------------------------------

  select wr.code
  into v_reason_code
  from public.waste_reasons wr
  where wr.id = p_waste_reason_id
    and wr.is_active = true;

  if v_reason_code is null then
    raise exception
      'Waste reason does not exist or is inactive.';
  end if;


  v_base_quantity :=
    round(
      p_input_quantity * v_conversion,
      4
    );

  if v_base_quantity <= 0 then
    raise exception
      'Waste quantity is too small after conversion.';
  end if;


  -- ----------------------------------------------------------
  -- Current stock from immutable ledger
  -- ----------------------------------------------------------

  select
    coalesce(
      sum(sm.base_quantity),
      0
    )::numeric(18,4)
  into v_current_quantity
  from public.stock_movements sm
  where sm.item_id = p_item_id;


  -- ----------------------------------------------------------
  -- Waste must never create negative stock
  -- ----------------------------------------------------------

  if v_current_quantity < v_base_quantity then
    raise exception
      'INSUFFICIENT_STOCK: available %, requested %',
      v_current_quantity,
      v_base_quantity
      using errcode = 'P0001';
  end if;


  -- ----------------------------------------------------------
  -- Create business record + immutable ledger atomically
  -- ----------------------------------------------------------

  v_waste_id := gen_random_uuid();


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
    reference_type,
    reference_id,
    idempotency_key,
    occurred_at,
    created_by
  )
  values (
    p_item_id,
    'WASTE',
    p_input_quantity,
    p_input_unit_id,
    v_conversion,
    v_base_unit_id,
    -v_base_quantity,
    v_reason_code,
    nullif(trim(p_note), ''),
    'WASTE',
    v_waste_id,
    trim(p_idempotency_key),
    p_occurred_at,
    p_actor_id
  )
  returning id
  into v_movement_id;


  insert into public.waste_records (
    id,
    item_id,
    waste_reason_id,
    input_quantity,
    input_unit_id,
    conversion_to_base,
    base_quantity,
    note,
    occurred_at,
    created_by,
    stock_movement_id
  )
  values (
    v_waste_id,
    p_item_id,
    p_waste_reason_id,
    p_input_quantity,
    p_input_unit_id,
    v_conversion,
    v_base_quantity,
    nullif(trim(p_note), ''),
    p_occurred_at,
    p_actor_id,
    v_movement_id
  );


  return v_waste_id;

end;
$$;


revoke all
on function public.record_waste(
  uuid,
  numeric,
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;


grant execute
on function public.record_waste(
  uuid,
  numeric,
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
)
to service_role;
