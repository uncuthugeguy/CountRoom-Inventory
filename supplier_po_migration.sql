-- ============================================================================
-- SUPPLIERS & PURCHASE ORDERS — schema extension
-- ============================================================================
-- The app's `InventoryRepository` interface, domain logic (`domain/
-- suppliers.ts`) and local/offline-mode implementation have supported
-- suppliers and purchase orders for a while — this section documents what
-- makes that work against the real Supabase-backed account too.
--
-- This block is a reference for a fresh install only (`create table if not
-- exists`, `drop policy if exists` + `create policy`, `drop trigger if
-- exists` + `create trigger` — safe to run more than once). The live
-- production database already has these four tables from earlier work, and
-- what's below matches that live schema exactly (column names, RLS
-- policies, and all) rather than a design written fresh — see
-- supplier_po_fix.sql at the repo root for the one small additive change
-- (three columns on purchase_order_lines) that earlier work was missing.
--
-- Manager-only end to end (select/insert/update/delete on all four tables),
-- matching `repository.ts`'s own doc comment on this section
-- ("SUPPLIER & PURCHASE ORDER MANAGEMENT (manager-only)") — unlike products/
-- sales there's no employee-facing view of any of this, so no cost-masking
-- view is needed the way `products_view`/`sales_view` mask cost/profit.
-- Selects additionally require mfa_satisfied(), matching current_account_id()
-- itself elsewhere in this file.
--
-- Column naming follows the same convention as products/sales/stock_movements
-- above: the scoping column is called `user_id` even though it holds the
-- account id, not a personal user id (kept for consistency with those older
-- tables). Unlike those tables, there is no stamp_account_id() trigger here
-- — the client sets user_id explicitly on insert (see supabaseRepository.ts),
-- and RLS's `with check` rejects any attempt to write a different account's
-- id, so this can't be spoofed even without a trigger.

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  lead_time_days integer not null default 0 check (lead_time_days >= 0),
  contact_name text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Deleting a supplier removes its product-cost links and purchase orders
-- too (cascade, below), matching localRepository's `deleteSupplier` exactly
-- — it filters both `supplierProducts` and `purchaseOrders` down to the
-- ones that survive, rather than orphaning them.
create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- double precision, not numeric — see the products/sales tables above in
  -- this file for why (supabase-js returns numeric as a string).
  unit_cost double precision not null default 0 check (unit_cost >= 0),
  minimum_order integer not null default 0 check (minimum_order >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  -- Snapshotted at creation, not joined — a PO's history should keep
  -- reading correctly even if the supplier is later renamed, the same
  -- reasoning sale_items/return_lines snapshot sku/name for.
  supplier_name text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'confirmed', 'received', 'cancelled')),
  -- Plain `date`, not timestamptz — avoids a timezone round-trip changing
  -- the date the manager actually typed, the same reasoning reports.ts's
  -- DateRange uses plain ISO date strings rather than Date objects.
  expected_delivery_date date,
  received_date date,
  notes text not null default '',
  subtotal double precision not null default 0 check (subtotal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- No user_id/account_id column here — scoped by RLS through a join back to
-- purchase_orders.user_id instead (see the policies below), the same
-- reasoning stock_movements' insert policy joins back to products.
create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  -- Set null rather than cascaded: a PO's history should outlive the
  -- product it once referred to, the same reasoning sale_items uses.
  product_id uuid references public.products(id) on delete set null,
  sku text not null default '',
  name text not null default '',
  quantity integer not null check (quantity > 0),
  unit_cost double precision not null check (unit_cost >= 0),
  line_total double precision not null default 0 check (line_total >= 0),
  -- Set once the PO is received — how many of this line actually arrived,
  -- which can differ from `quantity` on a short/partial delivery.
  quantity_received integer,
  created_at timestamptz not null default now()
);

create index if not exists suppliers_user_name_idx on public.suppliers (user_id, name);
create index if not exists supplier_products_user_idx on public.supplier_products (user_id);
create index if not exists supplier_products_supplier_idx on public.supplier_products (supplier_id);
create index if not exists supplier_products_product_idx on public.supplier_products (product_id);
create index if not exists purchase_orders_user_created_idx on public.purchase_orders (user_id, created_at desc);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id);
create index if not exists purchase_order_lines_po_idx on public.purchase_order_lines (purchase_order_id);
create index if not exists purchase_order_lines_product_idx on public.purchase_order_lines (product_id);

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists supplier_products_set_updated_at on public.supplier_products;
create trigger supplier_products_set_updated_at
  before update on public.supplier_products
  for each row execute function public.set_updated_at();

drop trigger if exists purchase_orders_set_updated_at on public.purchase_orders;
create trigger purchase_orders_set_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

-- Manager-only on every operation, on every table — deliberately stricter
-- than products/sales (which every active team member can read). Split
-- into one named policy per operation, matching every other table in this
-- file, rather than a single `for all` policy — easier to audit against a
-- live `pg_policies` query, which matters given the round-1/round-2 history
-- of an accidental `_shared`/`USING (true)` policy reopening an unrelated
-- table earlier in this project.

drop policy if exists "suppliers_select_account" on public.suppliers;
create policy "suppliers_select_account" on public.suppliers
  for select to authenticated
  using (user_id = public.current_account_id() and public.mfa_satisfied());
drop policy if exists "suppliers_insert_account" on public.suppliers;
create policy "suppliers_insert_account" on public.suppliers
  for insert to authenticated
  with check (user_id = public.current_account_id() and public.current_role() = 'manager');
drop policy if exists "suppliers_update_account" on public.suppliers;
create policy "suppliers_update_account" on public.suppliers
  for update to authenticated
  using (user_id = public.current_account_id() and public.current_role() = 'manager')
  with check (user_id = public.current_account_id());
drop policy if exists "suppliers_delete_account" on public.suppliers;
create policy "suppliers_delete_account" on public.suppliers
  for delete to authenticated
  using (user_id = public.current_account_id() and public.current_role() = 'manager');

drop policy if exists "supplier_products_select_account" on public.supplier_products;
create policy "supplier_products_select_account" on public.supplier_products
  for select to authenticated
  using (user_id = public.current_account_id() and public.mfa_satisfied());
drop policy if exists "supplier_products_insert_account" on public.supplier_products;
create policy "supplier_products_insert_account" on public.supplier_products
  for insert to authenticated
  with check (user_id = public.current_account_id() and public.current_role() = 'manager');
drop policy if exists "supplier_products_update_account" on public.supplier_products;
create policy "supplier_products_update_account" on public.supplier_products
  for update to authenticated
  using (user_id = public.current_account_id() and public.current_role() = 'manager')
  with check (user_id = public.current_account_id());
drop policy if exists "supplier_products_delete_account" on public.supplier_products;
create policy "supplier_products_delete_account" on public.supplier_products
  for delete to authenticated
  using (user_id = public.current_account_id() and public.current_role() = 'manager');

drop policy if exists "purchase_orders_select_account" on public.purchase_orders;
create policy "purchase_orders_select_account" on public.purchase_orders
  for select to authenticated
  using (user_id = public.current_account_id() and public.mfa_satisfied());
drop policy if exists "purchase_orders_insert_account" on public.purchase_orders;
create policy "purchase_orders_insert_account" on public.purchase_orders
  for insert to authenticated
  with check (user_id = public.current_account_id() and public.current_role() = 'manager');
drop policy if exists "purchase_orders_update_account" on public.purchase_orders;
create policy "purchase_orders_update_account" on public.purchase_orders
  for update to authenticated
  using (user_id = public.current_account_id() and public.current_role() = 'manager')
  with check (user_id = public.current_account_id());
drop policy if exists "purchase_orders_delete_account" on public.purchase_orders;
create policy "purchase_orders_delete_account" on public.purchase_orders
  for delete to authenticated
  using (user_id = public.current_account_id() and public.current_role() = 'manager');

drop policy if exists "purchase_order_lines_select_account" on public.purchase_order_lines;
create policy "purchase_order_lines_select_account" on public.purchase_order_lines
  for select to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_lines.purchase_order_id
      and po.user_id = public.current_account_id()
      and public.mfa_satisfied()
  ));
drop policy if exists "purchase_order_lines_insert_account" on public.purchase_order_lines;
create policy "purchase_order_lines_insert_account" on public.purchase_order_lines
  for insert to authenticated
  with check (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_lines.purchase_order_id
      and po.user_id = public.current_account_id()
      and public.current_role() = 'manager'
  ));
drop policy if exists "purchase_order_lines_update_account" on public.purchase_order_lines;
create policy "purchase_order_lines_update_account" on public.purchase_order_lines
  for update to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_lines.purchase_order_id
      and po.user_id = public.current_account_id()
      and public.current_role() = 'manager'
  ));
drop policy if exists "purchase_order_lines_delete_account" on public.purchase_order_lines;
create policy "purchase_order_lines_delete_account" on public.purchase_order_lines
  for delete to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_lines.purchase_order_id
      and po.user_id = public.current_account_id()
      and public.current_role() = 'manager'
  ));

grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.supplier_products to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_lines to authenticated;

-- Verify after running: 16 rows total (4 tables x 4 operations), nothing
-- named "_shared", nothing with a bare `true` qual.
-- select schemaname, tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where tablename in ('suppliers', 'supplier_products', 'purchase_orders', 'purchase_order_lines')
-- order by tablename, cmd;
