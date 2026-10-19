-- ============================================================
-- Fix Purchasing Foundation
-- Allow a DRAFT purchase order to be cancelled before ordering.
-- ============================================================

alter table public.purchase_orders
  drop constraint if exists
  purchase_orders_ordered_timestamp;

alter table public.purchase_orders
  add constraint
  purchase_orders_ordered_timestamp
  check (
    status in (
      'DRAFT',
      'CANCELLED'
    )
    or ordered_at is not null
  );
