-- ============================================================================
-- Purchase order invoice fields + lot support
-- ============================================================================
-- Adds the auction/supplier-invoice fields Mason asked for (PO number, order
-- date, VAT, buyer's premium, delivery cost, grand total), lets a PO line be
-- a free-text item or a "mixed lot" instead of always pointing at an
-- existing product, and adds a table recording what a lot turned out to
-- contain once unboxed.
--
-- Depends on supplier_po_migration.sql already having been run (creates
-- public.purchase_orders / public.purchase_order_lines). Entirely additive
-- and idempotent — every statement is `if not exists` / `create or replace`,
-- safe to run more than once and safe to run whether or not any PO rows
-- exist yet.
--
-- As with every migration in this project: run this yourself in the
-- Supabase SQL Editor (not run by the assistant), then verify with the
-- query at the bottom rather than trusting a "Success" toast alone — this
-- project's notes record the products/stock_movements `_shared` RLS policies
-- silently reappearing more than once, so a live check after running is the
-- house habit here, not optional.

-- ---------------------------------------------------------------------------
-- purchase_orders: invoice-level fields
-- ---------------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists po_number text not null default '',
  add column if not exists order_date date,
  add column if not exists delivery_cost double precision not null default 0 check (delivery_cost >= 0),
  add column if not exists buyers_premium double precision not null default 0 check (buyers_premium >= 0),
  add column if not exists vat_amount double precision not null default 0 check (vat_amount >= 0),
  add column if not exists grand_total double precision not null default 0 check (grand_total >= 0);

create unique index if not exists purchase_orders_user_po_number_unique
  on public.purchase_orders (user_id, po_number)
  where po_number <> '';

-- ---------------------------------------------------------------------------
-- purchase_order_lines: custom-named items and mixed lots
-- ---------------------------------------------------------------------------
-- product_id is already nullable in supplier_po_migration.sql (`on delete
-- set null`, no `not null`) — that's what makes a line without a catalogue
-- product possible at all; nothing to change there.
alter table public.purchase_order_lines
  add column if not exists custom_name text,
  add column if not exists is_lot boolean not null default false,
  add column if not exists vat_amount double precision check (vat_amount >= 0);

alter table public.purchase_order_lines
  drop constraint if exists purchase_order_lines_product_or_name_check;
alter table public.purchase_order_lines
  add constraint purchase_order_lines_product_or_name_check
  check (product_id is not null or coalesce(custom_name, '') <> '');

-- ---------------------------------------------------------------------------
-- purchase_order_unboxed_items: what a lot line turned out to contain
-- ---------------------------------------------------------------------------
-- One row per item found while unboxing a lot (see
-- InventoryRepository.unboxPurchaseOrderLine). sku/name are snapshotted the
-- same way purchase_order_lines' own sku/name already are, so this keeps
-- reading correctly if the product is later renamed or deleted.
create table if not exists public.purchase_order_unboxed_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_line_id uuid not null references public.purchase_order_lines(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null default '',
  name text not null default '',
  quantity integer not null check (quantity > 0),
  allocated_cost double precision not null default 0 check (allocated_cost >= 0),
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_unboxed_items_line_idx
  on public.purchase_order_unboxed_items (purchase_order_line_id);
create index if not exists purchase_order_unboxed_items_product_idx
  on public.purchase_order_unboxed_items (product_id);

alter table public.purchase_order_unboxed_items enable row level security;

-- Scoped the same way purchase_order_lines itself is: no user_id column
-- here either, joined back through purchase_order_lines -> purchase_orders
-- -> user_id. Deliberately `_own`-only, never `_shared`/`USING (true)` — see
-- this project's RLS history before ever writing a `_shared` policy again.
drop policy if exists "purchase_order_unboxed_items_select_account" on public.purchase_order_unboxed_items;
create policy "purchase_order_unboxed_items_select_account" on public.purchase_order_unboxed_items
  for select using (
    exists (
      select 1 from public.purchase_order_lines pol
      join public.purchase_orders po on po.id = pol.purchase_order_id
      where pol.id = purchase_order_unboxed_items.purchase_order_line_id
        and po.user_id = (select auth.uid())
    )
  );

drop policy if exists "purchase_order_unboxed_items_insert_account" on public.purchase_order_unboxed_items;
create policy "purchase_order_unboxed_items_insert_account" on public.purchase_order_unboxed_items
  for insert with check (
    exists (
      select 1 from public.purchase_order_lines pol
      join public.purchase_orders po on po.id = pol.purchase_order_id
      where pol.id = purchase_order_unboxed_items.purchase_order_line_id
        and po.user_id = (select auth.uid())
    )
  );

drop policy if exists "purchase_order_unboxed_items_update_account" on public.purchase_order_unboxed_items;
create policy "purchase_order_unboxed_items_update_account" on public.purchase_order_unboxed_items
  for update using (
    exists (
      select 1 from public.purchase_order_lines pol
      join public.purchase_orders po on po.id = pol.purchase_order_id
      where pol.id = purchase_order_unboxed_items.purchase_order_line_id
        and po.user_id = (select auth.uid())
    )
  );

drop policy if exists "purchase_order_unboxed_items_delete_account" on public.purchase_order_unboxed_items;
create policy "purchase_order_unboxed_items_delete_account" on public.purchase_order_unboxed_items
  for delete using (
    exists (
      select 1 from public.purchase_order_lines pol
      join public.purchase_orders po on po.id = pol.purchase_order_id
      where pol.id = purchase_order_unboxed_items.purchase_order_line_id
        and po.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.purchase_order_unboxed_items to authenticated;

-- ---------------------------------------------------------------------------
-- Verification — run after the statements above and check the output:
-- ---------------------------------------------------------------------------
-- 1. New columns exist:
--    select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'purchase_orders'
--      and column_name in ('po_number','order_date','delivery_cost','buyers_premium','vat_amount','grand_total');
--    select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'purchase_order_lines'
--      and column_name in ('custom_name','is_lot','vat_amount');
-- 2. New table + RLS policies exist and are all `_own`-style (none `USING (true)`):
--    select policyname, qual from pg_policies where tablename = 'purchase_order_unboxed_items';
