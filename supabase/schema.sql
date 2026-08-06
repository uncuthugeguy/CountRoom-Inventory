-- StockFlow schema for Supabase/PostgreSQL
-- Run this complete file in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable: not every product carries a manufacturer barcode. Postgres
  -- treats each NULL as distinct, so any number of blank-barcode products
  -- can coexist under the same unique constraint.
  barcode text,
  sku text not null,
  name text not null,
  category text,
  location text,
  variation text,
  quantity integer not null default 0 check (quantity >= 0),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, barcode)
);

-- Migrate a database that already ran an earlier version of this file.
alter table public.products alter column barcode drop not null;
alter table public.products add column if not exists variation text;
alter table public.products drop constraint if exists products_user_sku_unique;
alter table public.products add constraint products_user_sku_unique unique (user_id, sku);
-- double precision, not numeric — supabase-js returns numeric columns as
-- strings to preserve precision, but returns double precision as a plain JS
-- number, which is what the client's arithmetic wants.
alter table public.products add column if not exists cost double precision not null default 0 check (cost >= 0);
alter table public.products add column if not exists price double precision not null default 0 check (price >= 0);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

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
  created_at timestamptz not null default now(),
  check (new_quantity = previous_quantity + delta),
  check (
    (type = 'in' and delta >= 0) or
    (type = 'out' and delta <= 0) or
    (type = 'adjust')
  )
);

-- A sale (the transaction header) and its line items. Sales are a POS/cash
-- register record, so they're written by the checkout_sale() function below
-- as a single atomic unit alongside the matching stock_movements rows.
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null default '',
  payment_method text not null check (payment_method in ('cash', 'card', 'other')),
  subtotal double precision not null default 0 check (subtotal >= 0),
  total_cost double precision not null default 0 check (total_cost >= 0),
  profit double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Deferred so checkout_sale() can write line items before the parent sale
  -- row exists (it inserts the sale last, once every line has validated and
  -- the final totals are known); Postgres checks this at commit instead.
  sale_id uuid not null references public.sales(id) on delete cascade deferrable initially deferred,
  -- Set null rather than cascaded: a sale's history should outlive the
  -- product it once referred to, the same way stock_movements does.
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price double precision not null check (unit_price >= 0),
  unit_cost double precision not null check (unit_cost >= 0),
  line_total double precision not null check (line_total >= 0),
  line_profit double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists products_user_name_idx on public.products (user_id, name);
create index if not exists products_user_sku_idx on public.products (user_id, sku);
create index if not exists movements_user_created_idx on public.stock_movements (user_id, created_at desc);
create index if not exists movements_product_idx on public.stock_movements (product_id);
create index if not exists sales_user_created_idx on public.sales (user_id, created_at desc);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

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

drop policy if exists "sales_select_own" on public.sales;
create policy "sales_select_own" on public.sales for select to authenticated using (auth.uid() = user_id);
drop policy if exists "sales_insert_own" on public.sales;
create policy "sales_insert_own" on public.sales for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "sale_items_select_own" on public.sale_items;
create policy "sale_items_select_own" on public.sale_items for select to authenticated using (auth.uid() = user_id);
drop policy if exists "sale_items_insert_own" on public.sale_items;
create policy "sale_items_insert_own" on public.sale_items for insert to authenticated with check (auth.uid() = user_id);

-- Audit and financial rows are intentionally immutable from the browser.
revoke update, delete on public.stock_movements from authenticated;
revoke update, delete on public.sales from authenticated;
revoke update, delete on public.sale_items from authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert on public.stock_movements to authenticated;
grant select, insert on public.sales to authenticated;
grant select, insert on public.sale_items to authenticated;

-- Runs an entire checkout as one atomic transaction: every line decrements
-- stock and writes a stock_movements + sale_items row, or none of it does.
-- `for update` on the product row also serialises two concurrent checkouts
-- of the same product so neither can oversell past the other.
create or replace function public.checkout_sale(payload jsonb)
returns public.sales
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_sale_id uuid := gen_random_uuid();
  v_line jsonb;
  v_product public.products;
  v_qty integer;
  v_unit_price double precision;
  v_new_qty integer;
  v_subtotal double precision := 0;
  v_total_cost double precision := 0;
  v_profit double precision := 0;
  v_sale public.sales;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if jsonb_array_length(coalesce(payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item before checking out.';
  end if;

  for v_line in select * from jsonb_array_elements(payload->'lines')
  loop
    v_qty := (v_line->>'quantity')::integer;
    v_unit_price := (v_line->>'unitPrice')::double precision;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be greater than zero.';
    end if;

    select * into v_product from public.products
      where id = (v_line->>'productId')::uuid and user_id = v_user
      for update;

    if not found then
      raise exception 'Product not found.';
    end if;

    if v_product.quantity < v_qty then
      raise exception 'Only % in stock for %.', v_product.quantity, v_product.name;
    end if;

    v_new_qty := v_product.quantity - v_qty;

    update public.products
      set quantity = v_new_qty, updated_at = now()
      where id = v_product.id;

    insert into public.stock_movements
      (user_id, product_id, type, quantity, delta, previous_quantity, new_quantity, reason)
    values
      (v_user, v_product.id, 'out', v_qty, -v_qty, v_product.quantity, v_new_qty,
       'Sale — ' || coalesce(nullif(payload->>'channel', ''), 'Unspecified'));

    insert into public.sale_items
      (user_id, sale_id, product_id, sku, name, quantity, unit_price, unit_cost, line_total, line_profit)
    values
      (v_user, v_sale_id, v_product.id, v_product.sku, v_product.name, v_qty, v_unit_price, v_product.cost,
       v_unit_price * v_qty, (v_unit_price - v_product.cost) * v_qty);

    v_subtotal := v_subtotal + v_unit_price * v_qty;
    v_total_cost := v_total_cost + v_product.cost * v_qty;
    v_profit := v_profit + (v_unit_price - v_product.cost) * v_qty;
  end loop;

  insert into public.sales (id, user_id, channel, payment_method, subtotal, total_cost, profit)
  values (
    v_sale_id,
    v_user,
    coalesce(payload->>'channel', ''),
    payload->>'paymentMethod',
    v_subtotal,
    v_total_cost,
    v_profit
  )
  returning * into v_sale;

  return v_sale;
end;
$$;

grant execute on function public.checkout_sale(jsonb) to authenticated;

-- Returns, refunds, replacements and goodwill gestures ----------------------
--
-- A single case can combine any subset of refund / return / replacement /
-- goodwill at once, so `actions` is an array rather than one enum column.
-- Every column besides id/user_id/created_at is nullable-or-defaulted:
-- there is no required field on a case beyond having *something* recorded,
-- which process_return() below enforces the same way checkout_sale() enforces
-- a non-empty cart.

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Set null rather than cascaded: a return should outlive the sale it
  -- refers to, the same way sale_items outlives a deleted product.
  sale_id uuid references public.sales(id) on delete set null,
  channel text not null default '',
  customer_ref text not null default '',
  reason text not null default '',
  notes text not null default '',
  actions text[] not null default '{}',
  refund_amount double precision not null default 0 check (refund_amount >= 0),
  refund_method text check (refund_method in ('cash', 'card', 'other')),
  goodwill_type text not null default '',
  goodwill_value double precision not null default 0 check (goodwill_value >= 0),
  created_at timestamptz not null default now()
);

-- An item physically coming back — the item itself for a plain return, or
-- the "old" side of a replacement.
create table if not exists public.return_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  return_id uuid not null references public.returns(id) on delete cascade deferrable initially deferred,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  disposition text not null check (disposition in ('restock', 'writeoff')),
  unit_cost double precision not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

-- An item going back out to the customer at no charge — the "new" side of a
-- replacement.
create table if not exists public.replacement_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  return_id uuid not null references public.returns(id) on delete cascade deferrable initially deferred,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_cost double precision not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

create index if not exists returns_user_created_idx on public.returns (user_id, created_at desc);
create index if not exists returns_sale_idx on public.returns (sale_id);
create index if not exists return_lines_return_idx on public.return_lines (return_id);
create index if not exists return_lines_product_idx on public.return_lines (product_id);
create index if not exists replacement_lines_return_idx on public.replacement_lines (return_id);
create index if not exists replacement_lines_product_idx on public.replacement_lines (product_id);

alter table public.returns enable row level security;
alter table public.return_lines enable row level security;
alter table public.replacement_lines enable row level security;

drop policy if exists "returns_select_own" on public.returns;
create policy "returns_select_own" on public.returns for select to authenticated using (auth.uid() = user_id);
drop policy if exists "returns_insert_own" on public.returns;
create policy "returns_insert_own" on public.returns for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "return_lines_select_own" on public.return_lines;
create policy "return_lines_select_own" on public.return_lines for select to authenticated using (auth.uid() = user_id);
drop policy if exists "return_lines_insert_own" on public.return_lines;
create policy "return_lines_insert_own" on public.return_lines for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "replacement_lines_select_own" on public.replacement_lines;
create policy "replacement_lines_select_own" on public.replacement_lines for select to authenticated using (auth.uid() = user_id);
drop policy if exists "replacement_lines_insert_own" on public.replacement_lines;
create policy "replacement_lines_insert_own" on public.replacement_lines for insert to authenticated with check (auth.uid() = user_id);

-- Audit and financial rows are intentionally immutable from the browser,
-- same as sales and stock_movements.
revoke update, delete on public.returns from authenticated;
revoke update, delete on public.return_lines from authenticated;
revoke update, delete on public.replacement_lines from authenticated;
grant select, insert on public.returns to authenticated;
grant select, insert on public.return_lines to authenticated;
grant select, insert on public.replacement_lines to authenticated;

-- Runs an entire return case as one atomic transaction, the same shape as
-- checkout_sale(): every returned line either restocks (or is written off
-- with no stock change) and every replacement line decrements stock, or
-- none of it does. `for update` on each product row serialises this against
-- concurrent sales/returns of the same product.
create or replace function public.process_return(payload jsonb)
returns public.returns
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_return_id uuid := gen_random_uuid();
  v_line jsonb;
  v_product public.products;
  v_qty integer;
  v_disposition text;
  v_new_qty integer;
  v_actions text[];
  v_reason text := nullif(payload->>'reason', '');
  v_note_suffix text := case when v_reason is not null then ': ' || v_reason else '' end;
  v_return public.returns;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(array_agg(value #>> '{}'), '{}')
    into v_actions
    from jsonb_array_elements(coalesce(payload->'actions', '[]'::jsonb));

  if jsonb_array_length(coalesce(payload->'returnLines', '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(payload->'replacementLines', '[]'::jsonb)) = 0
     and coalesce(array_length(v_actions, 1), 0) = 0
     and coalesce(nullif(payload->>'refundAmount', '')::double precision, 0) = 0
     and coalesce(nullif(payload->>'goodwillValue', '')::double precision, 0) = 0
     and coalesce(payload->>'goodwillType', '') = ''
     and coalesce(payload->>'reason', '') = ''
     and coalesce(payload->>'notes', '') = '' then
    raise exception 'Add at least one action, item, refund, or note before saving.';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(payload->'returnLines', '[]'::jsonb))
  loop
    v_qty := (v_line->>'quantity')::integer;
    v_disposition := v_line->>'disposition';

    if v_qty is null or v_qty <= 0 then
      raise exception 'Returned item quantity must be greater than zero.';
    end if;
    if v_disposition not in ('restock', 'writeoff') then
      raise exception 'Unknown disposition: %', v_disposition;
    end if;

    select * into v_product from public.products
      where id = (v_line->>'productId')::uuid and user_id = v_user
      for update;

    if not found then
      raise exception 'Product not found.';
    end if;

    -- Only a restock changes the quantity on hand — a write-off leaves the
    -- item out of sellable stock, so it gets no stock_movements row; its
    -- cost is captured on the return line instead, for loss reporting.
    if v_disposition = 'restock' then
      v_new_qty := v_product.quantity + v_qty;

      update public.products
        set quantity = v_new_qty, updated_at = now()
        where id = v_product.id;

      insert into public.stock_movements
        (user_id, product_id, type, quantity, delta, previous_quantity, new_quantity, reason)
      values
        (v_user, v_product.id, 'in', v_qty, v_qty, v_product.quantity, v_new_qty,
         'Return — restock' || v_note_suffix);
    end if;

    insert into public.return_lines
      (user_id, return_id, product_id, sku, name, quantity, disposition, unit_cost)
    values
      (v_user, v_return_id, v_product.id, v_product.sku, v_product.name, v_qty, v_disposition, v_product.cost);
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(payload->'replacementLines', '[]'::jsonb))
  loop
    v_qty := (v_line->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Replacement item quantity must be greater than zero.';
    end if;

    select * into v_product from public.products
      where id = (v_line->>'productId')::uuid and user_id = v_user
      for update;

    if not found then
      raise exception 'Product not found.';
    end if;

    if v_product.quantity < v_qty then
      raise exception 'Only % in stock for %.', v_product.quantity, v_product.name;
    end if;

    v_new_qty := v_product.quantity - v_qty;

    update public.products
      set quantity = v_new_qty, updated_at = now()
      where id = v_product.id;

    insert into public.stock_movements
      (user_id, product_id, type, quantity, delta, previous_quantity, new_quantity, reason)
    values
      (v_user, v_product.id, 'out', v_qty, -v_qty, v_product.quantity, v_new_qty,
       'Return — replacement' || v_note_suffix);

    insert into public.replacement_lines
      (user_id, return_id, product_id, sku, name, quantity, unit_cost)
    values
      (v_user, v_return_id, v_product.id, v_product.sku, v_product.name, v_qty, v_product.cost);
  end loop;

  insert into public.returns
    (id, user_id, sale_id, channel, customer_ref, reason, notes, actions,
     refund_amount, refund_method, goodwill_type, goodwill_value)
  values (
    v_return_id,
    v_user,
    nullif(payload->>'saleId', '')::uuid,
    coalesce(payload->>'channel', ''),
    coalesce(payload->>'customerRef', ''),
    coalesce(payload->>'reason', ''),
    coalesce(payload->>'notes', ''),
    v_actions,
    case when 'refund' = any(v_actions) then coalesce(nullif(payload->>'refundAmount', '')::double precision, 0) else 0 end,
    case when 'refund' = any(v_actions) then payload->>'refundMethod' else null end,
    case when 'goodwill' = any(v_actions) then coalesce(payload->>'goodwillType', '') else '' end,
    case when 'goodwill' = any(v_actions) then coalesce(nullif(payload->>'goodwillValue', '')::double precision, 0) else 0 end
  )
  returning * into v_return;

  return v_return;
end;
$$;

grant execute on function public.process_return(jsonb) to authenticated;
