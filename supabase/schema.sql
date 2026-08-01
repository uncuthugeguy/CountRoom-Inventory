-- StockFlow schema for Supabase/PostgreSQL
-- Run this complete file in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  barcode text not null,
  sku text not null,
  name text not null,
  category text,
  location text,
  quantity integer not null default 0 check (quantity >= 0),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, barcode)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null check (type in ('in', 'out', 'adjust')),
  quantity integer not null check (quantity >= 0),
  delta integer not null,
  previous_quantity integer not null check (previous_quantity >= 0),
  new_quantity integer not null check (new_quantity >= 0),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists products_user_name_idx on public.products (user_id, name);
create index if not exists products_user_sku_idx on public.products (user_id, sku);
create index if not exists movements_user_created_idx on public.stock_movements (user_id, created_at desc);
create index if not exists movements_product_idx on public.stock_movements (product_id);

alter table public.products enable row level security;
alter table public.stock_movements enable row level security;

-- Each authenticated account can only see and change its own inventory.
drop policy if exists "products_select_own" on public.products;
create policy "products_select_own" on public.products for select to authenticated using (auth.uid() = user_id);
drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own" on public.products for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "products_update_own" on public.products;
create policy "products_update_own" on public.products for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own" on public.products for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "movements_select_own" on public.stock_movements;
create policy "movements_select_own" on public.stock_movements for select to authenticated using (auth.uid() = user_id);
drop policy if exists "movements_insert_own" on public.stock_movements;
create policy "movements_insert_own" on public.stock_movements for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.products p
    where p.id = product_id and p.user_id = auth.uid()
  )
);

-- Audit rows are intentionally immutable from the browser.
revoke update, delete on public.stock_movements from authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert on public.stock_movements to authenticated;
