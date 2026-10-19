-- ============================================================
-- Restaurant Stock System
-- Migration 008: Atomic Purchase Receiving
-- ============================================================

-- ============================================================
-- 1. PURCHASE RECEIPTS
-- ============================================================

create or replace function public.generate_purchase_receipt_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select
    'RCV-' ||
    to_char(timezone('Asia/Bangkok', now()), 'YYYYMMDD') ||
    '-' ||
    upper(
      substr(
        replace(gen_random_uuid()::text, '-', ''),
        1,
        8
      )
    );
$$;

revoke all
on function public.generate_purchase_receipt_number()
from public, anon, authenticated;

grant execute
on function public.generate_purchase_receipt_number()
to service_role;


create table public.purchase_receipts (
  id uuid primary key
    default gen_random_uuid(),

  receipt_number text not null
    default public.generate_purchase_receipt_number(),

  purchase_order_id uuid not null
    references public.purchase_orders(id)
    on delete restrict,

  idempotency_key text not null,

  note text,

  received_at timestamptz not null
    default now(),

  received_by uuid not null
    references auth.users(id)
    on delete restrict,

  created_at timestamptz not null
    default now(),

  constraint purchase_receipts_number_unique
    unique (receipt_number),

  constraint purchase_receipts_idempotency_unique
    unique (idempotency_key),

  constraint purchase_receipts_number_not_blank
    check (
      length(trim(receipt_number)) > 0
    ),

  constraint purchase_receipts_idempotency_not_blank
    check (
      length(trim(idempotency_key)) > 0
    )
);


create index purchase_receipts_po_idx
on public.purchase_receipts (
  purchase_order_id,
  received_at desc
);


create index purchase_receipts_received_at_idx
on public.purchase_receipts (
  received_at desc
);


-- ============================================================
-- 2. RECEIPT ITEMS
-- ============================================================

create table public.purchase_receipt_items (
  id uuid primary key
    default gen_random_uuid(),

  purchase_receipt_id uuid not null
    references public.purchase_receipts(id)
    on delete restrict,

  purchase_order_item_id uuid not null
    references public.purchase_order_items(id)
    on delete restrict,

  item_id uuid not null
    references public.items(id)
    on delete restrict,

  received_quantity numeric(18,4)
    not null,

  receive_unit_id uuid not null
    references public.units(id)
    on delete restrict,

  conversion_to_base numeric(18,6)
    not null,

  base_quantity numeric(18,4)
    not null,

  stock_movement_id uuid not null
    references public.stock_movements(id)
    on delete restrict,

  created_at timestamptz not null
    default now(),

  constraint purchase_receipt_items_receipt_po_line_unique
    unique (
      purchase_receipt_id,
      purchase_order_item_id
    ),

  constraint purchase_receipt_items_movement_unique
    unique (stock_movement_id),

  constraint purchase_receipt_items_quantity_positive
    check (
      received_quantity > 0
    ),

  constraint purchase_receipt_items_conversion_positive
    check (
      conversion_to_base > 0
    ),

  constraint purchase_receipt_items_base_positive
    check (
      base_quantity > 0
    ),

  constraint purchase_receipt_items_quantity_matches_conversion
    check (
      base_quantity =
      round(
        received_quantity * conversion_to_base,
        4
      )
    )
);


create index purchase_receipt_items_receipt_idx
on public.purchase_receipt_items (
  purchase_receipt_id
);


create index purchase_receipt_items_po_item_idx
on public.purchase_receipt_items (
  purchase_order_item_id
);


-- ============================================================
-- 3. PO RECEIVED TOTAL CONSISTENCY
-- ============================================================

alter table public.purchase_order_items
  add constraint purchase_order_items_received_matches_conversion
  check (
    received_base_quantity =
    round(
      received_quantity * conversion_to_base,
      4
    )
  );


-- ============================================================
-- 4. RECEIPTS ARE IMMUTABLE
-- ============================================================

create or replace function public.prevent_purchase_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'Purchase receiving history is immutable.';
end;
$$;


create trigger purchase_receipts_prevent_update
before update
on public.purchase_receipts
for each row
execute function public.prevent_purchase_receipt_mutation();


create trigger purchase_receipts_prevent_delete
before delete
on public.purchase_receipts
for each row
execute function public.prevent_purchase_receipt_mutation();


create trigger purchase_receipt_items_prevent_update
before update
on public.purchase_receipt_items
for each row
execute function public.prevent_purchase_receipt_mutation();


create trigger purchase_receipt_items_prevent_delete
before delete
on public.purchase_receipt_items
for each row
execute function public.prevent_purchase_receipt_mutation();


-- ============================================================
-- 5. VALIDATE RECEIPT ITEM / LEDGER LINK
-- ============================================================

create or replace function public.validate_purchase_receipt_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_receipt_po_id uuid;
  v_received_by uuid;
  v_received_at timestamptz;
  v_po_status public.purchase_order_status;

  v_line_po_id uuid;
  v_line_item_id uuid;
  v_line_unit_id uuid;
  v_line_conversion numeric(18,6);

  v_base_unit_id uuid;

  v_movement public.stock_movements%rowtype;
begin

  select
    pr.purchase_order_id,
    pr.received_by,
    pr.received_at,
    po.status
  into
    v_receipt_po_id,
    v_received_by,
    v_received_at,
    v_po_status
  from public.purchase_receipts pr
  join public.purchase_orders po
    on po.id = pr.purchase_order_id
  where pr.id = new.purchase_receipt_id;


  if v_receipt_po_id is null then
    raise exception
      'Purchase receipt does not exist.';
  end if;


  if v_po_status not in (
    'ORDERED',
    'PARTIALLY_RECEIVED'
  ) then
    raise exception
      'Purchase Order cannot receive inventory in status %.',
      v_po_status;
  end if;


  select
    poi.purchase_order_id,
    poi.item_id,
    poi.order_unit_id,
    poi.conversion_to_base
  into
    v_line_po_id,
    v_line_item_id,
    v_line_unit_id,
    v_line_conversion
  from public.purchase_order_items poi
  where poi.id = new.purchase_order_item_id;


  if v_line_po_id is null then
    raise exception
      'Purchase Order item does not exist.';
  end if;


  if v_line_po_id <> v_receipt_po_id then
    raise exception
      'Receipt item does not belong to the receipt Purchase Order.';
  end if;


  if new.item_id <> v_line_item_id then
    raise exception
      'Receipt inventory item does not match Purchase Order item.';
  end if;


  if new.receive_unit_id <> v_line_unit_id then
    raise exception
      'Receipt unit must match the Purchase Order unit.';
  end if;


  if new.conversion_to_base <> v_line_conversion then
    raise exception
      'Receipt conversion must match the Purchase Order snapshot.';
  end if;


  select i.base_unit_id
  into v_base_unit_id
  from public.items i
  where i.id = new.item_id;


  select *
  into v_movement
  from public.stock_movements sm
  where sm.id = new.stock_movement_id;


  if v_movement.id is null then
    raise exception
      'PO receipt Stock Movement does not exist.';
  end if;


  if v_movement.item_id <> new.item_id
     or v_movement.movement_type <> 'PO_RECEIVE'
     or v_movement.base_unit_id <> v_base_unit_id
     or v_movement.input_unit_id <> v_base_unit_id
     or v_movement.conversion_to_base <> 1
     or v_movement.input_quantity <> new.base_quantity
     or v_movement.base_quantity <> new.base_quantity
     or v_movement.reason_code <> 'PURCHASE_RECEIVE'
     or v_movement.reference_type <> 'PO_RECEIPT'
     or v_movement.reference_id <> new.purchase_receipt_id
     or v_movement.created_by <> v_received_by
     or v_movement.occurred_at <> v_received_at
  then
    raise exception
      'PO receipt Stock Movement does not match receipt data.';
  end if;


  return new;
end;
$$;


create trigger validate_purchase_receipt_item
before insert
on public.purchase_receipt_items
for each row
execute function public.validate_purchase_receipt_item();


-- ============================================================
-- 6. HARDEN PURCHASE ORDER ITEM RECEIVED TOTALS
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

  v_receipt_quantity numeric(18,4);
  v_receipt_base_quantity numeric(18,4);
begin

  select po.status
  into v_po_status
  from public.purchase_orders po
  where po.id = new.purchase_order_id;


  if v_po_status is null then
    raise exception
      'Purchase Order does not exist.';
  end if;


  if tg_op = 'INSERT' then

    if v_po_status <> 'DRAFT' then
      raise exception
        'Purchase Order items may only be added while PO is DRAFT.';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- DRAFT: commercial fields may be edited and conversion
  -- snapshot is refreshed from current item_units.
  -- ----------------------------------------------------------

  if v_po_status = 'DRAFT' then

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


    new.conversion_to_base :=
      v_conversion;


    if tg_op = 'INSERT' then

      new.received_quantity := 0;
      new.received_base_quantity := 0;

    else

      if old.received_quantity <> 0
         or old.received_base_quantity <> 0 then
        raise exception
          'DRAFT PO item cannot already contain received quantities.';
      end if;

      new.received_quantity := 0;
      new.received_base_quantity := 0;

    end if;


    return new;

  end if;


  -- ----------------------------------------------------------
  -- After DRAFT:
  -- ordered commercial terms are immutable.
  -- ----------------------------------------------------------

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


  if new.received_quantity < old.received_quantity
     or new.received_base_quantity < old.received_base_quantity
  then
    raise exception
      'Received quantities cannot decrease.';
  end if;


  -- Immutable receipt lines are the source of truth for totals.
  select
    coalesce(
      sum(pri.received_quantity),
      0
    )::numeric(18,4),

    coalesce(
      sum(pri.base_quantity),
      0
    )::numeric(18,4)

  into
    v_receipt_quantity,
    v_receipt_base_quantity

  from public.purchase_receipt_items pri

  where pri.purchase_order_item_id = new.id;


  if new.received_quantity <> v_receipt_quantity
     or new.received_base_quantity <> v_receipt_base_quantity
  then
    raise exception
      'PO received totals must match immutable Purchase Receipt history.';
  end if;


  return new;
end;
$$;


-- Existing trigger remains attached to this replaced function.


-- ============================================================
-- 7. HARDEN PO STATUS TRANSITIONS AGAINST RECEIPT TOTALS
-- ============================================================

create or replace function public.validate_purchase_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item_count integer;
  v_received_item_count integer;
  v_incomplete_item_count integer;
begin

  if new.status = old.status then
    return new;
  end if;


  -- ----------------------------------------------------------
  -- DRAFT
  -- ----------------------------------------------------------

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

    else

      new.cancelled_at :=
        coalesce(
          new.cancelled_at,
          now()
        );

    end if;


    return new;

  end if;


  -- Current receipt completion state.
  select
    count(*) filter (
      where poi.received_base_quantity > 0
    ),
    count(*) filter (
      where poi.received_base_quantity <
            poi.ordered_base_quantity
    )
  into
    v_received_item_count,
    v_incomplete_item_count
  from public.purchase_order_items poi
  where poi.purchase_order_id = old.id;


  -- ----------------------------------------------------------
  -- ORDERED
  -- ----------------------------------------------------------

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


    if new.status = 'PARTIALLY_RECEIVED' then

      if v_received_item_count = 0
         or v_incomplete_item_count = 0 then
        raise exception
          'PARTIALLY_RECEIVED requires received inventory with remaining quantity.';
      end if;

    elsif new.status = 'RECEIVED' then

      if v_incomplete_item_count <> 0 then
        raise exception
          'Purchase Order cannot become RECEIVED until every item is fully received.';
      end if;

    elsif new.status = 'CANCELLED' then

      new.cancelled_at :=
        coalesce(
          new.cancelled_at,
          now()
        );

    end if;


    return new;

  end if;


  -- ----------------------------------------------------------
  -- PARTIALLY_RECEIVED
  -- ----------------------------------------------------------

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


    if new.status = 'RECEIVED'
       and v_incomplete_item_count <> 0 then
      raise exception
        'Purchase Order cannot become RECEIVED until every item is fully received.';
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


  -- ----------------------------------------------------------
  -- TERMINAL
  -- ----------------------------------------------------------

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


-- ============================================================
-- 8. ATOMIC RECEIVE COMMAND
-- ============================================================

create or replace function public.receive_purchase_order_item(
  p_purchase_order_item_id uuid,
  p_received_quantity numeric,
  p_actor_id uuid,
  p_idempotency_key text,
  p_note text default null,
  p_received_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt_id uuid;
  v_existing_po_item_id uuid;
  v_existing_quantity numeric(18,4);

  v_po_id uuid;
  v_po_number text;
  v_po_status public.purchase_order_status;

  v_item_id uuid;
  v_order_unit_id uuid;
  v_base_unit_id uuid;

  v_conversion numeric(18,6);
  v_ordered_quantity numeric(18,4);
  v_ordered_base_quantity numeric(18,4);
  v_received_quantity numeric(18,4);
  v_received_base_quantity numeric(18,4);

  v_receive_base_quantity numeric(18,4);
  v_base_unit_conversion numeric(18,6);

  v_movement_id uuid;

  v_incomplete_count integer;
begin

  -- ----------------------------------------------------------
  -- Permission
  -- ----------------------------------------------------------

  if not public.user_has_permission(
    p_actor_id,
    'purchase.receive'
  ) then
    raise exception
      'Actor does not have purchase.receive permission.';
  end if;


  -- ----------------------------------------------------------
  -- Input validation
  -- ----------------------------------------------------------

  if p_received_quantity is null
     or p_received_quantity <= 0 then
    raise exception
      'Received quantity must be greater than zero.';
  end if;


  if p_idempotency_key is null
     or length(trim(p_idempotency_key)) = 0 then
    raise exception
      'Idempotency key is required.';
  end if;


  if p_received_at is null then
    raise exception
      'Received timestamp is required.';
  end if;


  -- ----------------------------------------------------------
  -- Fast idempotent replay check
  -- ----------------------------------------------------------

  select
    pr.id,
    pri.purchase_order_item_id,
    pri.received_quantity
  into
    v_receipt_id,
    v_existing_po_item_id,
    v_existing_quantity
  from public.purchase_receipts pr
  join public.purchase_receipt_items pri
    on pri.purchase_receipt_id = pr.id
  where pr.idempotency_key =
    trim(p_idempotency_key)
  limit 1;


  if v_receipt_id is not null then

    if v_existing_po_item_id =
         p_purchase_order_item_id
       and v_existing_quantity =
         p_received_quantity then

      return v_receipt_id;

    end if;


    raise exception
      'IDEMPOTENCY_KEY_CONFLICT: key already belongs to another receiving operation.'
      using errcode = 'P0001';

  end if;


  -- ----------------------------------------------------------
  -- Serialize receiving for the same Purchase Order.
  -- Lock both PO and line.
  -- ----------------------------------------------------------

  select
    po.id,
    po.po_number,
    po.status,

    poi.item_id,
    poi.order_unit_id,
    poi.conversion_to_base,

    poi.ordered_quantity,
    poi.ordered_base_quantity,

    poi.received_quantity,
    poi.received_base_quantity

  into
    v_po_id,
    v_po_number,
    v_po_status,

    v_item_id,
    v_order_unit_id,
    v_conversion,

    v_ordered_quantity,
    v_ordered_base_quantity,

    v_received_quantity,
    v_received_base_quantity

  from public.purchase_order_items poi

  join public.purchase_orders po
    on po.id = poi.purchase_order_id

  where poi.id =
    p_purchase_order_item_id

  for update of po, poi;


  if v_po_id is null then
    raise exception
      'Purchase Order item does not exist.';
  end if;


  -- ----------------------------------------------------------
  -- Re-check idempotency after waiting for PO lock.
  -- Handles simultaneous duplicate requests safely.
  -- ----------------------------------------------------------

  v_receipt_id := null;
  v_existing_po_item_id := null;
  v_existing_quantity := null;


  select
    pr.id,
    pri.purchase_order_item_id,
    pri.received_quantity
  into
    v_receipt_id,
    v_existing_po_item_id,
    v_existing_quantity
  from public.purchase_receipts pr
  join public.purchase_receipt_items pri
    on pri.purchase_receipt_id = pr.id
  where pr.idempotency_key =
    trim(p_idempotency_key)
  limit 1;


  if v_receipt_id is not null then

    if v_existing_po_item_id =
         p_purchase_order_item_id
       and v_existing_quantity =
         p_received_quantity then

      return v_receipt_id;

    end if;


    raise exception
      'IDEMPOTENCY_KEY_CONFLICT: key already belongs to another receiving operation.'
      using errcode = 'P0001';

  end if;


  -- ----------------------------------------------------------
  -- Status guard
  -- ----------------------------------------------------------

  if v_po_status not in (
    'ORDERED',
    'PARTIALLY_RECEIVED'
  ) then
    raise exception
      'Purchase Order cannot receive inventory in status %.',
      v_po_status;
  end if;


  -- ----------------------------------------------------------
  -- Serialize against Stock Out / Waste for same item.
  -- ----------------------------------------------------------

  select i.base_unit_id
  into v_base_unit_id
  from public.items i
  where i.id = v_item_id
    and i.is_active = true
  for update;


  if v_base_unit_id is null then
    raise exception
      'Inventory item does not exist or is inactive.';
  end if;


  select iu.conversion_to_base
  into v_base_unit_conversion
  from public.item_units iu
  where iu.item_id = v_item_id
    and iu.unit_id = v_base_unit_id
    and iu.is_active = true;


  if v_base_unit_conversion is null
     or v_base_unit_conversion <> 1 then
    raise exception
      'Inventory base unit mapping must be active with conversion 1.';
  end if;


  -- ----------------------------------------------------------
  -- Snapshot conversion from PO line
  -- ----------------------------------------------------------

  v_receive_base_quantity :=
    round(
      p_received_quantity *
      v_conversion,
      4
    );


  if v_receive_base_quantity <= 0 then
    raise exception
      'Received quantity is too small after conversion.';
  end if;


  -- ----------------------------------------------------------
  -- Over-receive protection
  -- ----------------------------------------------------------

  if
    v_received_quantity +
    p_received_quantity >
    v_ordered_quantity
  then
    raise exception
      'OVER_RECEIVE: ordered %, already received %, requested %',
      v_ordered_quantity,
      v_received_quantity,
      p_received_quantity
      using errcode = 'P0001';
  end if;


  if
    v_received_base_quantity +
    v_receive_base_quantity >
    v_ordered_base_quantity
  then
    raise exception
      'OVER_RECEIVE_BASE: ordered %, already received %, requested %',
      v_ordered_base_quantity,
      v_received_base_quantity,
      v_receive_base_quantity
      using errcode = 'P0001';
  end if;


  -- ----------------------------------------------------------
  -- Receipt header
  -- ----------------------------------------------------------

  insert into public.purchase_receipts (
    purchase_order_id,
    idempotency_key,
    note,
    received_at,
    received_by
  )
  values (
    v_po_id,
    trim(p_idempotency_key),
    nullif(trim(p_note), ''),
    p_received_at,
    p_actor_id
  )
  returning id
  into v_receipt_id;


  -- ----------------------------------------------------------
  -- Immutable Stock Ledger
  --
  -- Ledger uses BASE UNIT deliberately.
  -- PO/receipt retain original ordered unit + conversion snapshot.
  -- ----------------------------------------------------------

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
    v_item_id,
    'PO_RECEIVE',

    v_receive_base_quantity,
    v_base_unit_id,
    1,

    v_base_unit_id,
    v_receive_base_quantity,

    'PURCHASE_RECEIVE',

    nullif(
      trim(
        concat(
          'PO ',
          v_po_number,
          case
            when nullif(trim(p_note), '') is not null
              then ': ' || trim(p_note)
            else ''
          end
        )
      ),
      ''
    ),

    'PO_RECEIPT',
    v_receipt_id,

    trim(p_idempotency_key),

    p_received_at,
    p_actor_id
  )
  returning id
  into v_movement_id;


  -- ----------------------------------------------------------
  -- Immutable Receipt Line
  -- ----------------------------------------------------------

  insert into public.purchase_receipt_items (
    purchase_receipt_id,
    purchase_order_item_id,
    item_id,

    received_quantity,
    receive_unit_id,
    conversion_to_base,
    base_quantity,

    stock_movement_id
  )
  values (
    v_receipt_id,
    p_purchase_order_item_id,
    v_item_id,

    p_received_quantity,
    v_order_unit_id,
    v_conversion,
    v_receive_base_quantity,

    v_movement_id
  );


  -- ----------------------------------------------------------
  -- Update cached PO received totals.
  -- Trigger verifies totals against immutable receipt lines.
  -- ----------------------------------------------------------

  update public.purchase_order_items
  set
    received_quantity =
      received_quantity +
      p_received_quantity,

    received_base_quantity =
      received_base_quantity +
      v_receive_base_quantity

  where id =
    p_purchase_order_item_id;


  -- ----------------------------------------------------------
  -- Resolve PO state
  -- ----------------------------------------------------------

  select count(*)
  into v_incomplete_count
  from public.purchase_order_items poi
  where poi.purchase_order_id = v_po_id
    and poi.received_base_quantity <
        poi.ordered_base_quantity;


  if v_incomplete_count = 0 then

    update public.purchase_orders
    set status = 'RECEIVED'
    where id = v_po_id;

  elsif v_po_status = 'ORDERED' then

    update public.purchase_orders
    set status = 'PARTIALLY_RECEIVED'
    where id = v_po_id;

  end if;


  return v_receipt_id;
end;
$$;


revoke all
on function public.receive_purchase_order_item(
  uuid,
  numeric,
  uuid,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;


grant execute
on function public.receive_purchase_order_item(
  uuid,
  numeric,
  uuid,
  text,
  text,
  timestamptz
)
to service_role;


-- ============================================================
-- 9. RLS
-- ============================================================

alter table public.purchase_receipts
  enable row level security;

alter table public.purchase_receipt_items
  enable row level security;


create policy purchase_receipts_select_policy
on public.purchase_receipts
for select
to authenticated
using (
  public.has_permission(
    'purchase.view'
  )
);


create policy purchase_receipt_items_select_policy
on public.purchase_receipt_items
for select
to authenticated
using (
  public.has_permission(
    'purchase.view'
  )
);


-- ============================================================
-- 10. PRIVILEGES
-- ============================================================

revoke all
on public.purchase_receipts
from anon, authenticated;

revoke all
on public.purchase_receipt_items
from anon, authenticated;


grant select
on public.purchase_receipts
to authenticated;

grant select
on public.purchase_receipt_items
to authenticated;


grant all
on public.purchase_receipts
to service_role;

grant all
on public.purchase_receipt_items
to service_role;


-- ============================================================
-- END MIGRATION 008
-- ============================================================
