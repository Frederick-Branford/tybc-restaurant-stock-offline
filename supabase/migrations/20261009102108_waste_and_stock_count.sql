-- ============================================================
-- Restaurant Stock System
-- Migration 004: Waste and Physical Stock Count
-- ============================================================


-- ============================================================
-- 1. Permission helper for controlled server operations
--
-- Unlike has_permission(), this function checks a specific actor.
-- It is intended for server-side SECURITY DEFINER commands.
-- ============================================================

create or replace function public.user_has_permission(
  p_user_id uuid,
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
    where pr.id = p_user_id
      and pr.is_active = true
      and r.is_active = true
      and p.is_active = true
      and p.code = requested_permission
  );
$$;

revoke all
on function public.user_has_permission(uuid, text)
from public;

grant execute
on function public.user_has_permission(uuid, text)
to service_role;


-- ============================================================
-- 2. Waste Reasons
-- ============================================================

create table public.waste_reasons (
  id uuid primary key default gen_random_uuid(),

  code text not null unique,
  name text not null,
  description text,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint waste_reasons_code_format
    check (
      code ~ '^[A-Z][A-Z0-9_]*$'
    ),

  constraint waste_reasons_name_not_blank
    check (
      length(trim(name)) > 0
    )
);

create unique index waste_reasons_name_ci_uidx
  on public.waste_reasons (
    lower(trim(name))
  );

create trigger waste_reasons_set_updated_at
before update on public.waste_reasons
for each row
execute function public.set_updated_at();


-- ============================================================
-- 3. Waste Records
--
-- Business explanation of a WASTE stock movement.
--
-- Stock source of truth remains stock_movements.
-- ============================================================

create table public.waste_records (
  id uuid primary key default gen_random_uuid(),

  item_id uuid not null
    references public.items(id)
    on delete restrict,

  waste_reason_id uuid not null
    references public.waste_reasons(id)
    on delete restrict,

  input_quantity numeric(18,4) not null,

  input_unit_id uuid not null
    references public.units(id)
    on delete restrict,

  conversion_to_base numeric(18,6) not null,

  -- Positive magnitude of waste in base units.
  base_quantity numeric(18,4) not null,

  note text,

  occurred_at timestamptz not null default now(),

  created_by uuid not null
    references auth.users(id)
    on delete restrict,

  stock_movement_id uuid not null unique
    references public.stock_movements(id)
    on delete restrict,

  created_at timestamptz not null default now(),

  constraint waste_records_input_quantity_positive
    check (
      input_quantity > 0
    ),

  constraint waste_records_conversion_positive
    check (
      conversion_to_base > 0
    ),

  constraint waste_records_base_quantity_positive
    check (
      base_quantity > 0
    ),

  constraint waste_records_quantity_matches_conversion
    check (
      base_quantity
      =
      round(
        input_quantity * conversion_to_base,
        4
      )
    )
);

create index waste_records_item_occurred_idx
  on public.waste_records (
    item_id,
    occurred_at desc
  );

create index waste_records_reason_idx
  on public.waste_records (
    waste_reason_id
  );

create index waste_records_created_by_idx
  on public.waste_records (
    created_by
  );


-- ============================================================
-- 4. Waste records are immutable
-- ============================================================

create or replace function public.prevent_waste_record_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'Waste records are immutable. Create a correction stock movement instead.';
end;
$$;

create trigger waste_records_prevent_update
before update on public.waste_records
for each row
execute function public.prevent_waste_record_mutation();

create trigger waste_records_prevent_delete
before delete on public.waste_records
for each row
execute function public.prevent_waste_record_mutation();


-- ============================================================
-- 5. Stock Counts
-- ============================================================

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),

  count_code text not null unique,

  status text not null default 'DRAFT',

  notes text,

  started_by uuid not null
    references auth.users(id)
    on delete restrict,

  completed_by uuid
    references auth.users(id)
    on delete restrict,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stock_counts_status_valid
    check (
      status in (
        'DRAFT',
        'COMPLETED',
        'CANCELLED'
      )
    ),

  constraint stock_counts_completion_valid
    check (
      (
        status = 'COMPLETED'
        and completed_by is not null
        and completed_at is not null
      )
      or
      (
        status <> 'COMPLETED'
      )
    )
);

create index stock_counts_status_idx
  on public.stock_counts (
    status
  );

create index stock_counts_started_at_idx
  on public.stock_counts (
    started_at desc
  );

create trigger stock_counts_set_updated_at
before update on public.stock_counts
for each row
execute function public.set_updated_at();


-- ============================================================
-- 6. Stock Count Items
--
-- Snapshot is refreshed when the employee actually counts item.
--
-- variance =
-- actual physical quantity - system snapshot
-- ============================================================

create table public.stock_count_items (
  id uuid primary key default gen_random_uuid(),

  stock_count_id uuid not null
    references public.stock_counts(id)
    on delete cascade,

  item_id uuid not null
    references public.items(id)
    on delete restrict,

  base_unit_id uuid not null
    references public.units(id)
    on delete restrict,

  system_quantity_snapshot numeric(18,4),

  input_quantity numeric(18,4),

  input_unit_id uuid
    references public.units(id)
    on delete restrict,

  conversion_to_base numeric(18,6),

  actual_quantity_base numeric(18,4),

  variance_quantity numeric(18,4)
    generated always as (
      actual_quantity_base - system_quantity_snapshot
    ) stored,

  counted_by uuid
    references auth.users(id)
    on delete restrict,

  counted_at timestamptz,

  adjustment_movement_id uuid unique
    references public.stock_movements(id)
    on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stock_count_items_unique_item
    unique (
      stock_count_id,
      item_id
    ),

  constraint stock_count_items_input_nonnegative
    check (
      input_quantity is null
      or input_quantity >= 0
    ),

  constraint stock_count_items_actual_nonnegative
    check (
      actual_quantity_base is null
      or actual_quantity_base >= 0
    ),

  constraint stock_count_items_conversion_positive
    check (
      conversion_to_base is null
      or conversion_to_base > 0
    ),

  constraint stock_count_items_quantity_matches
    check (
      actual_quantity_base is null
      or actual_quantity_base
         =
         round(
           input_quantity * conversion_to_base,
           4
         )
    ),

  constraint stock_count_items_count_data_complete
    check (
      (
        system_quantity_snapshot is null
        and input_quantity is null
        and input_unit_id is null
        and conversion_to_base is null
        and actual_quantity_base is null
        and counted_by is null
        and counted_at is null
      )
      or
      (
        system_quantity_snapshot is not null
        and input_quantity is not null
        and input_unit_id is not null
        and conversion_to_base is not null
        and actual_quantity_base is not null
        and counted_by is not null
        and counted_at is not null
      )
    )
);

create index stock_count_items_count_idx
  on public.stock_count_items (
    stock_count_id
  );

create index stock_count_items_item_idx
  on public.stock_count_items (
    item_id
  );

create trigger stock_count_items_set_updated_at
before update on public.stock_count_items
for each row
execute function public.set_updated_at();


-- ============================================================
-- 7. Prevent editing a terminal Stock Count
-- ============================================================

create or replace function public.protect_stock_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin

  if old.status in (
    'COMPLETED',
    'CANCELLED'
  ) then
    raise exception
      'Completed or cancelled stock counts cannot be modified.';
  end if;

  return new;

end;
$$;

create trigger stock_counts_protect_terminal
before update or delete
on public.stock_counts
for each row
execute function public.protect_stock_count();


-- ============================================================
-- 8. Stock Count Item Protection
--
-- Count items can only change while parent count is DRAFT.
-- ============================================================

create or replace function public.protect_stock_count_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_count_id uuid;
  parent_status text;
begin

  if tg_op = 'DELETE' then
    parent_count_id := old.stock_count_id;
  else
    parent_count_id := new.stock_count_id;
  end if;

  select sc.status
  into parent_status
  from public.stock_counts sc
  where sc.id = parent_count_id;

  if parent_status is null then
    raise exception
      'Stock count does not exist.';
  end if;

  if parent_status <> 'DRAFT' then
    raise exception
      'Stock count items can only be modified while the count is DRAFT.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;

end;
$$;

create trigger stock_count_items_protect
before insert or update or delete
on public.stock_count_items
for each row
execute function public.protect_stock_count_item();


-- ============================================================
-- 9. Seed Waste Reasons
-- ============================================================

insert into public.waste_reasons (
  code,
  name,
  description
)
values
  (
    'EXPIRED',
    'Expired',
    'Product or ingredient passed its usable date.'
  ),
  (
    'SPOILED',
    'Spoiled',
    'Product or ingredient spoiled before use.'
  ),
  (
    'DAMAGED',
    'Damaged',
    'Inventory damaged during handling or storage.'
  ),
  (
    'PREP_LOSS',
    'Preparation Loss',
    'Loss during food preparation.'
  ),
  (
    'OVERPRODUCTION',
    'Overproduction',
    'Prepared more than required and could not be used.'
  ),
  (
    'SPILLAGE',
    'Spillage',
    'Inventory lost because of spilling or accidental handling.'
  ),
  (
    'OTHER',
    'Other',
    'Other documented waste reason.'
  );


-- ============================================================
-- 10. Atomic Waste Command
--
-- Creates:
--
-- WASTE stock movement
-- +
-- waste record
--
-- in one PostgreSQL transaction.
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


  select
    i.base_unit_id
  into
    v_base_unit_id
  from public.items i
  where i.id = p_item_id
    and i.is_active = true;

  if v_base_unit_id is null then
    raise exception
      'Inventory item does not exist or is inactive.';
  end if;


  select
    iu.conversion_to_base
  into
    v_conversion
  from public.item_units iu
  where iu.item_id = p_item_id
    and iu.unit_id = p_input_unit_id
    and iu.is_active = true;

  if v_conversion is null then
    raise exception
      'Selected unit is not configured for this item.';
  end if;


  select
    wr.code
  into
    v_reason_code
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


-- ============================================================
-- 11. Create Physical Stock Count
--
-- Creates one count item for every active inventory item.
--
-- System stock snapshot is taken later when each item
-- is actually counted.
-- ============================================================

create or replace function public.create_stock_count(
  p_actor_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count_id uuid;
  v_count_code text;
  v_item_count integer;
begin

  if not public.user_has_permission(
    p_actor_id,
    'inventory.count'
  ) then
    raise exception
      'Actor does not have inventory.count permission.';
  end if;


  v_count_id := gen_random_uuid();

  v_count_code :=
    'SC-'
    || to_char(
         clock_timestamp(),
         'YYYYMMDD-HH24MISS'
       )
    || '-'
    || upper(
         left(
           replace(
             v_count_id::text,
             '-',
             ''
           ),
           6
         )
       );


  insert into public.stock_counts (
    id,
    count_code,
    status,
    notes,
    started_by
  )
  values (
    v_count_id,
    v_count_code,
    'DRAFT',
    nullif(trim(p_notes), ''),
    p_actor_id
  );


  insert into public.stock_count_items (
    stock_count_id,
    item_id,
    base_unit_id
  )
  select
    v_count_id,
    i.id,
    i.base_unit_id
  from public.items i
  where i.is_active = true;


  get diagnostics
    v_item_count = row_count;


  if v_item_count = 0 then
    raise exception
      'Cannot create stock count because no active inventory items exist.';
  end if;


  return v_count_id;

end;
$$;


-- ============================================================
-- 12. Record Physical Quantity
--
-- System quantity is captured at the moment the item is counted.
--
-- User may count using any configured unit.
-- ============================================================

create or replace function public.record_stock_count_item(
  p_stock_count_id uuid,
  p_item_id uuid,
  p_input_quantity numeric,
  p_input_unit_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;

  v_system_quantity numeric(18,4);
  v_base_unit_id uuid;

  v_conversion numeric(18,6);
  v_actual_quantity numeric(18,4);
begin

  if not public.user_has_permission(
    p_actor_id,
    'inventory.count'
  ) then
    raise exception
      'Actor does not have inventory.count permission.';
  end if;


  if p_input_quantity is null
     or p_input_quantity < 0 then
    raise exception
      'Physical quantity cannot be negative.';
  end if;


  select sc.status
  into v_status
  from public.stock_counts sc
  where sc.id = p_stock_count_id
  for update;

  if v_status is null then
    raise exception
      'Stock count does not exist.';
  end if;

  if v_status <> 'DRAFT' then
    raise exception
      'Only DRAFT stock counts may be edited.';
  end if;


  select
    ib.current_quantity,
    ib.base_unit_id
  into
    v_system_quantity,
    v_base_unit_id
  from public.inventory_balances ib
  where ib.item_id = p_item_id;


  if v_base_unit_id is null then
    raise exception
      'Inventory item does not exist.';
  end if;


  if not exists (
    select 1
    from public.stock_count_items sci
    where sci.stock_count_id = p_stock_count_id
      and sci.item_id = p_item_id
  ) then
    raise exception
      'Item is not part of this stock count.';
  end if;


  select
    iu.conversion_to_base
  into
    v_conversion
  from public.item_units iu
  where iu.item_id = p_item_id
    and iu.unit_id = p_input_unit_id
    and iu.is_active = true;


  if v_conversion is null then
    raise exception
      'Selected unit is not configured for this item.';
  end if;


  v_actual_quantity :=
    round(
      p_input_quantity * v_conversion,
      4
    );


  update public.stock_count_items
  set
    system_quantity_snapshot = v_system_quantity,
    input_quantity = p_input_quantity,
    input_unit_id = p_input_unit_id,
    conversion_to_base = v_conversion,
    actual_quantity_base = v_actual_quantity,
    counted_by = p_actor_id,
    counted_at = now()
  where stock_count_id = p_stock_count_id
    and item_id = p_item_id;

end;
$$;


-- ============================================================
-- 13. Complete Stock Count
--
-- Critical atomic transaction.
--
-- Before completion:
-- - Every item must be counted.
-- - System stock must still equal the recorded snapshot.
--
-- For every variance:
-- create COUNT_ADJUSTMENT movement.
--
-- Current Stock after completion = Physical Count.
-- ============================================================

create or replace function public.complete_stock_count(
  p_stock_count_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_current_quantity numeric(18,4);
  v_movement_id uuid;

  rec record;
begin

  if not public.user_has_permission(
    p_actor_id,
    'inventory.count'
  ) then
    raise exception
      'Actor does not have inventory.count permission.';
  end if;


  select sc.status
  into v_status
  from public.stock_counts sc
  where sc.id = p_stock_count_id
  for update;

  if v_status is null then
    raise exception
      'Stock count does not exist.';
  end if;

  if v_status <> 'DRAFT' then
    raise exception
      'Only DRAFT stock counts can be completed.';
  end if;


  if exists (
    select 1
    from public.stock_count_items sci
    where sci.stock_count_id = p_stock_count_id
      and (
        sci.actual_quantity_base is null
        or sci.system_quantity_snapshot is null
        or sci.counted_at is null
      )
  ) then
    raise exception
      'Every item must be physically counted before completion.';
  end if;


  -- ----------------------------------------------------------
  -- Stale snapshot protection
  --
  -- If stock changed after the employee counted an item,
  -- completion is rejected and that item must be counted again.
  -- ----------------------------------------------------------

  for rec in
    select
      sci.*
    from public.stock_count_items sci
    where sci.stock_count_id = p_stock_count_id
    order by sci.item_id
  loop

    select ib.current_quantity
    into v_current_quantity
    from public.inventory_balances ib
    where ib.item_id = rec.item_id;


    if v_current_quantity
       is distinct from
       rec.system_quantity_snapshot then

      raise exception
        'Stock changed after counting item %. Recount the item before completing the stock count.',
        rec.item_id;

    end if;

  end loop;


  -- ----------------------------------------------------------
  -- Create adjustment movements.
  -- ----------------------------------------------------------

  for rec in
    select
      sci.*
    from public.stock_count_items sci
    where sci.stock_count_id = p_stock_count_id
      and sci.variance_quantity <> 0
    order by sci.item_id
  loop

    insert into public.stock_movements (
      item_id,
      movement_type,
      input_quantity,
      input_unit_id,
      conversion_to_base,
      base_unit_id,
      base_quantity,
      reason_code,
      reference_type,
      reference_id,
      idempotency_key,
      occurred_at,
      created_by
    )
    values (
      rec.item_id,
      'COUNT_ADJUSTMENT',
      abs(rec.variance_quantity),
      rec.base_unit_id,
      1,
      rec.base_unit_id,
      rec.variance_quantity,
      'PHYSICAL_COUNT',
      'STOCK_COUNT',
      p_stock_count_id,
      'stock-count:'
        || p_stock_count_id::text
        || ':'
        || rec.item_id::text,
      now(),
      p_actor_id
    )
    returning id
    into v_movement_id;


    update public.stock_count_items
    set adjustment_movement_id = v_movement_id
    where id = rec.id;

  end loop;


  update public.stock_counts
  set
    status = 'COMPLETED',
    completed_by = p_actor_id,
    completed_at = now()
  where id = p_stock_count_id;

end;
$$;


-- ============================================================
-- 14. RLS
-- ============================================================

alter table public.waste_reasons
enable row level security;

alter table public.waste_records
enable row level security;

alter table public.stock_counts
enable row level security;

alter table public.stock_count_items
enable row level security;


create policy "inventory users can read waste reasons"
on public.waste_reasons
for select
to authenticated
using (
  public.has_permission('inventory.view')
);


create policy "inventory users can read waste records"
on public.waste_records
for select
to authenticated
using (
  public.has_permission('inventory.view')
);


create policy "inventory users can read stock counts"
on public.stock_counts
for select
to authenticated
using (
  public.has_permission('inventory.view')
);


create policy "inventory users can read stock count items"
on public.stock_count_items
for select
to authenticated
using (
  public.has_permission('inventory.view')
);


-- ============================================================
-- 15. Explicit table privileges
--
-- Direct browser/API mutations are blocked.
--
-- Waste and Stock Count mutations must use the atomic
-- server-side functions above.
-- ============================================================

revoke all
on public.waste_reasons,
   public.waste_records,
   public.stock_counts,
   public.stock_count_items
from anon;


revoke all
on public.waste_reasons,
   public.waste_records,
   public.stock_counts,
   public.stock_count_items
from authenticated;


grant select
on public.waste_reasons,
   public.waste_records,
   public.stock_counts,
   public.stock_count_items
to authenticated;


revoke all
on public.waste_reasons,
   public.waste_records,
   public.stock_counts,
   public.stock_count_items
from service_role;


grant select
on public.waste_reasons,
   public.waste_records,
   public.stock_counts,
   public.stock_count_items
to service_role;


-- ============================================================
-- 16. Function privileges
--
-- Only trusted server-side service role may call mutations.
-- ============================================================

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


revoke all
on function public.create_stock_count(
  uuid,
  text
)
from public, anon, authenticated;


grant execute
on function public.create_stock_count(
  uuid,
  text
)
to service_role;


revoke all
on function public.record_stock_count_item(
  uuid,
  uuid,
  numeric,
  uuid,
  uuid
)
from public, anon, authenticated;


grant execute
on function public.record_stock_count_item(
  uuid,
  uuid,
  numeric,
  uuid,
  uuid
)
to service_role;


revoke all
on function public.complete_stock_count(
  uuid,
  uuid
)
from public, anon, authenticated;


grant execute
on function public.complete_stock_count(
  uuid,
  uuid
)
to service_role;


-- ============================================================
-- FINAL RULES
--
-- Waste:
--
-- record_waste()
--     |
--     +-- waste_records
--     |
--     +-- stock_movements (WASTE)
--
--
-- Stock Count:
--
-- create_stock_count()
--        |
-- record_stock_count_item()
--        |
-- complete_stock_count()
--        |
-- stock_movements (COUNT_ADJUSTMENT)
--
--
-- stock_movements remains the inventory source of truth.
-- ============================================================
