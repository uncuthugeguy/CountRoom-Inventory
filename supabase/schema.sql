-- StockFlow schema for Supabase/PostgreSQL
-- Run this complete file in Supabase Dashboard > SQL Editor.
-- Safe to re-run: every statement is idempotent (create-if-not-exists,
-- create-or-replace, drop-then-create for policies/triggers).

create extension if not exists pgcrypto;

-- Teams and roles --------------------------------------------------------
--
-- Every table below still has a `user_id` column, but its meaning changed:
-- it now identifies the *account* (the business) data belongs to, not
-- necessarily the person who acted. A membership links a real login
-- (auth.users) to an account with a role. The account owner — whoever
-- originally signed up — is bootstrapped as a "manager" membership of
-- their own account_id (account_id = member_id) the same moment their
-- auth.users row is created, so existing single-user behaviour is
-- unchanged for anyone who never invites a teammate.
--
-- Inviting an employee: a manager calls invite_employee(email). If that
-- email already has a StockFlow login, they're linked to the manager's
-- account immediately. Otherwise a pending row waits for them — when they
-- sign up with that exact email, the handle_new_user trigger below links
-- it automatically instead of bootstrapping them as their own new account.
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  -- Null while an invite is pending nobody has signed up with that email yet.
  member_id uuid references auth.users(id) on delete cascade,
  -- Kept even after acceptance, purely as a label for the team list — never
  -- re-read from auth.users, which the client can't query directly.
  invited_email text,
  role text not null check (role in ('manager', 'employee')),
  status text not null default 'active' check (status in ('active', 'pending', 'removed')),
  created_at timestamptz not null default now(),
  unique (account_id, member_id),
  check (member_id is not null or invited_email is not null)
);

-- Only one pending invite per email per account at a time.
create unique index if not exists memberships_account_pending_email_idx
  on public.memberships (account_id, lower(invited_email))
  where status = 'pending';

create index if not exists memberships_account_idx on public.memberships (account_id);

-- Helper functions used throughout this file's RLS policies and triggers.
-- SECURITY DEFINER is required here, not just a hardening choice: these
-- functions query memberships from inside memberships' own RLS policy
-- (see below), and without SECURITY DEFINER that would recurse into the
-- same policy check forever.
-- Mandatory MFA gate ---------------------------------------------------
--
-- Every StockFlow account must enroll a verified TOTP factor and reach
-- AAL2 before it can touch any business data. This is enforced here,
-- server-side — not just in the client's sign-in flow, which a direct API
-- call could skip entirely — by making the two helper functions almost
-- every policy/function in this file goes through refuse to resolve an
-- account for a session that hasn't verified a factor and stepped up to
-- AAL2. A brand new session (magic link only gets you to AAL1) or one
-- with no enrolled authenticator at all simply sees no data anywhere,
-- until it verifies a TOTP code.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
as $$
  select
    exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    )
    and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
$$;

create or replace function public.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select account_id from public.memberships
  where member_id = auth.uid() and status = 'active' and public.mfa_satisfied()
  limit 1
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.memberships
  where member_id = auth.uid() and status = 'active' and public.mfa_satisfied()
  limit 1
$$;

grant execute on function public.current_account_id() to authenticated;
grant execute on function public.current_role() to authenticated;

-- Fires on every new login. Links a pending invite if this email was
-- invited already; otherwise bootstraps this person as the manager of
-- their own brand-new account — exactly today's single-user behaviour.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending public.memberships;
begin
  select * into v_pending
    from public.memberships
    where status = 'pending'
      and invited_email is not null
      and lower(invited_email) = lower(new.email)
    order by created_at asc
    limit 1;

  if found then
    update public.memberships
      set member_id = new.id, status = 'active'
      where id = v_pending.id;
  else
    insert into public.memberships (account_id, member_id, role, status)
    values (new.id, new.id, 'manager', 'active');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- One-time backfill for accounts created before this migration — the
-- trigger above only fires on future signups. Safe to re-run.
insert into public.memberships (account_id, member_id, role, status)
select u.id, u.id, 'manager', 'active'
from auth.users u
where not exists (select 1 from public.memberships m where m.member_id = u.id);

alter table public.memberships enable row level security;

drop policy if exists "memberships_select_own_account" on public.memberships;
create policy "memberships_select_own_account" on public.memberships
  for select to authenticated
  using (account_id = public.current_account_id());

-- No direct insert/update/delete from the client — invite_employee() below
-- is SECURITY DEFINER and does the only writing this table needs.
revoke insert, update, delete on public.memberships from authenticated;
grant select on public.memberships to authenticated;

-- Invites (or re-links) an employee by email. Written as SECURITY DEFINER
-- because looking up an email in auth.users — to tell "already has a
-- login" apart from "needs to sign up" — isn't possible from an ordinary
-- authenticated query; auth.users itself is never exposed to the client.
create or replace function public.invite_employee(p_email text)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := public.current_account_id();
  v_role text := public.current_role();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_existing_user_id uuid;
  v_membership public.memberships;
begin
  if v_account is null then
    raise exception 'You need an account before you can invite anyone.';
  end if;
  if v_role is distinct from 'manager' then
    raise exception 'Only a manager can invite team members.';
  end if;
  if v_email = '' then
    raise exception 'Enter an email address to invite.';
  end if;

  select id into v_existing_user_id from auth.users where lower(email) = v_email limit 1;

  if v_existing_user_id is not null and v_existing_user_id = v_account then
    raise exception 'That is your own account.';
  end if;

  if v_existing_user_id is not null then
    -- Clear out any stale pending invite for this email under this account
    -- (e.g. invited before they had signed up) so the team list doesn't
    -- show a duplicate "pending" row alongside the new active one.
    update public.memberships
      set status = 'removed'
      where account_id = v_account and status = 'pending' and lower(invited_email) = v_email and member_id is null;

    -- Already has a StockFlow login somewhere — link them in immediately.
    insert into public.memberships (account_id, member_id, role, status, invited_email)
    values (v_account, v_existing_user_id, 'employee', 'active', v_email)
    on conflict (account_id, member_id) do update
      set role = 'employee', status = 'active', invited_email = v_email
    returning * into v_membership;
  else
    -- No account yet — leave a pending invite; handle_new_user() links it
    -- automatically once they sign up with this exact email.
    insert into public.memberships (account_id, member_id, role, status, invited_email)
    values (v_account, null, 'employee', 'pending', v_email)
    on conflict (account_id, lower(invited_email)) where status = 'pending' do update
      set invited_email = v_email
    returning * into v_membership;
  end if;

  return v_membership;
end;
$$;

grant execute on function public.invite_employee(text) to authenticated;

-- Removes a team member's access (or withdraws a pending invite) without
-- deleting their history — every row they touched keeps their created_by,
-- so past activity still reads correctly.
create or replace function public.remove_team_member(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := public.current_account_id();
  v_role text := public.current_role();
begin
  if v_role is distinct from 'manager' then
    raise exception 'Only a manager can remove a team member.';
  end if;

  update public.memberships
    set status = 'removed'
    where id = p_membership_id
      and account_id = v_account
      and member_id is distinct from v_account; -- can't remove your own owner membership
end;
$$;

grant execute on function public.remove_team_member(uuid) to authenticated;

-- Products -----------------------------------------------------------------

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

-- Every insert is filed under the account, no matter who on the team makes
-- it — this runs whether the client sends its own user_id or not.
create or replace function public.stamp_account_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := public.current_account_id();
  if new.user_id is null then
    raise exception 'You are not part of a StockFlow account.';
  end if;
  return new;
end;
$$;

drop trigger if exists products_stamp_account on public.products;
create trigger products_stamp_account
  before insert on public.products
  for each row execute function public.stamp_account_id();

-- Employees can still create products, edit the day-to-day catalogue fields
-- (name, barcode, category, location, variation, reorder level, quantity),
-- and can still adjust stock. What they can't do is touch what a product
-- costs or sells for, or delete one outright. Enforced here, not just
-- hidden in the UI, since RLS/UI can be bypassed by anyone calling the API
-- directly — but deliberately narrow, so an employee editing an unrelated
-- field (say, fixing a typo'd location) never gets blocked by this.
create or replace function public.enforce_manager_only_product_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() = 'manager' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Only a manager can delete a product.';
  end if;

  if new.cost is distinct from old.cost or new.price is distinct from old.price then
    raise exception 'Only a manager can change what a product costs or sells for.';
  end if;

  return new;
end;
$$;

drop trigger if exists products_manager_only on public.products;
create trigger products_manager_only
  before update or delete on public.products
  for each row execute function public.enforce_manager_only_product_changes();

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

-- Who actually performed the movement — distinct from user_id (the
-- account) once more than one person can act on it.
alter table public.stock_movements add column if not exists created_by uuid references auth.users(id);

create or replace function public.stamp_account_and_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := public.current_account_id();
  if new.user_id is null then
    raise exception 'You are not part of a StockFlow account.';
  end if;
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists movements_stamp_account_actor on public.stock_movements;
create trigger movements_stamp_account_actor
  before insert on public.stock_movements
  for each row execute function public.stamp_account_and_actor();

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

alter table public.sales add column if not exists created_by uuid references auth.users(id);

-- Order-level marketplace fees on top of the item price — a Vinted/eBay-style
-- "Buyer Protection" add-on, delivery, VAT and ad spend, plus the buyer's
-- own order total for reconciliation. All optional in practice (most sales
-- have none of these), hence the zero/'seller'/null defaults rather than a
-- NOT NULL-with-no-default that would break existing rows.
alter table public.sales add column if not exists buyer_protection_fee double precision not null default 0 check (buyer_protection_fee >= 0);
alter table public.sales add column if not exists buyer_protection_fee_paid_by text not null default 'seller' check (buyer_protection_fee_paid_by in ('seller', 'buyer'));
alter table public.sales add column if not exists delivery_cost double precision not null default 0 check (delivery_cost >= 0);
alter table public.sales add column if not exists delivery_paid_by text not null default 'seller' check (delivery_paid_by in ('seller', 'buyer'));
alter table public.sales add column if not exists vat double precision not null default 0 check (vat >= 0);
alter table public.sales add column if not exists advertising_cost double precision not null default 0 check (advertising_cost >= 0);
-- Unlike the fee columns above, a null order_total is meaningful (the buyer
-- total wasn't recorded) rather than a stand-in for zero, so this one has no
-- default and stays nullable.
alter table public.sales add column if not exists order_total double precision check (order_total is null or order_total >= 0);

-- No default and nullable, unlike products.updated_at — a sale that's never
-- been edited should show no updated_at at all (matching the client's
-- optional Sale.updatedAt), not a timestamp equal to when it was created.
-- The trigger below only ever fires on UPDATE, never INSERT, so a freshly
-- checked-out sale stays NULL here until edit_sale() actually touches it.
alter table public.sales add column if not exists updated_at timestamptz;

drop trigger if exists sales_set_updated_at on public.sales;
create trigger sales_set_updated_at
  before update on public.sales
  for each row execute function public.set_updated_at();

drop trigger if exists sales_stamp_account_actor on public.sales;
create trigger sales_stamp_account_actor
  before insert on public.sales
  for each row execute function public.stamp_account_and_actor();

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

drop trigger if exists sale_items_stamp_account on public.sale_items;
create trigger sale_items_stamp_account
  before insert on public.sale_items
  for each row execute function public.stamp_account_id();

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

-- Every active team member — manager or employee — can see and act on the
-- same account's inventory.
drop policy if exists "products_select_own" on public.products;
create policy "products_select_own" on public.products for select to authenticated using (user_id = public.current_account_id());
drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own" on public.products for insert to authenticated with check (user_id = public.current_account_id());
drop policy if exists "products_update_own" on public.products;
create policy "products_update_own" on public.products for update to authenticated using (user_id = public.current_account_id()) with check (user_id = public.current_account_id());
drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own" on public.products for delete to authenticated using (user_id = public.current_account_id());

drop policy if exists "movements_select_own" on public.stock_movements;
create policy "movements_select_own" on public.stock_movements for select to authenticated using (user_id = public.current_account_id());
drop policy if exists "movements_insert_own" on public.stock_movements;
create policy "movements_insert_own" on public.stock_movements for insert to authenticated
with check (
  user_id = public.current_account_id()
  and exists (
    select 1 from public.products p
    where p.id = product_id and p.user_id = public.current_account_id()
  )
  -- An absolute recount (as opposed to ordinary stock in/out) needs a
  -- manager's say-so — otherwise whoever counted the shelf could also
  -- "approve" their own discrepancy with nobody else looking at it.
  and (type <> 'adjust' or public.current_role() = 'manager')
);

drop policy if exists "sales_select_own" on public.sales;
create policy "sales_select_own" on public.sales for select to authenticated using (user_id = public.current_account_id());
drop policy if exists "sales_insert_own" on public.sales;
create policy "sales_insert_own" on public.sales for insert to authenticated with check (user_id = public.current_account_id());

drop policy if exists "sale_items_select_own" on public.sale_items;
create policy "sale_items_select_own" on public.sale_items for select to authenticated using (user_id = public.current_account_id());
drop policy if exists "sale_items_insert_own" on public.sale_items;
create policy "sale_items_insert_own" on public.sale_items for insert to authenticated with check (user_id = public.current_account_id());

-- Audit and financial rows are intentionally immutable from the browser.
revoke update, delete on public.stock_movements from authenticated;
revoke update, delete on public.sales from authenticated;
revoke update, delete on public.sale_items from authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert on public.stock_movements to authenticated;
grant select, insert on public.sales to authenticated;
grant select, insert on public.sale_items to authenticated;

-- Read-only views that hide what a product actually costs and what a sale
-- actually made from anyone who isn't a manager. security_invoker = true
-- matters here: without it, a view created from the SQL editor runs with
-- the *editor's* privileges (which can bypass RLS entirely) rather than
-- the querying user's — silently undoing every policy above.
create or replace view public.products_view
with (security_invoker = true) as
select
  id, user_id, barcode, sku, name, category, location, variation,
  quantity, reorder_level, price, created_at, updated_at,
  case when public.current_role() = 'manager' then cost end as cost
from public.products;

create or replace view public.sales_view
with (security_invoker = true) as
select
  id, user_id, channel, payment_method, subtotal, created_at, created_by, updated_at,
  case when public.current_role() = 'manager' then total_cost end as total_cost,
  case when public.current_role() = 'manager' then profit end as profit,
  -- Marketplace fees are as profit-sensitive as cost/profit themselves
  -- (they reveal margin and ad spend), so they're masked from a
  -- non-manager the same way.
  case when public.current_role() = 'manager' then buyer_protection_fee end as buyer_protection_fee,
  case when public.current_role() = 'manager' then buyer_protection_fee_paid_by end as buyer_protection_fee_paid_by,
  case when public.current_role() = 'manager' then delivery_cost end as delivery_cost,
  case when public.current_role() = 'manager' then delivery_paid_by end as delivery_paid_by,
  case when public.current_role() = 'manager' then vat end as vat,
  case when public.current_role() = 'manager' then advertising_cost end as advertising_cost,
  case when public.current_role() = 'manager' then order_total end as order_total
from public.sales;

create or replace view public.sale_items_view
with (security_invoker = true) as
select
  id, user_id, sale_id, product_id, sku, name, quantity, unit_price, line_total, created_at,
  case when public.current_role() = 'manager' then unit_cost end as unit_cost,
  case when public.current_role() = 'manager' then line_profit end as line_profit
from public.sale_items;

grant select on public.products_view to authenticated;
grant select on public.sales_view to authenticated;
grant select on public.sale_items_view to authenticated;

-- Runs an entire checkout as one atomic transaction: every line decrements
-- stock and writes a stock_movements + sale_items row, or none of it does.
-- `for update` on the product row also serialises two concurrent checkouts
-- of the same product so neither can oversell past the other.
create or replace function public.checkout_sale(payload jsonb)
returns public.sales
language plpgsql
as $$
declare
  v_account uuid := public.current_account_id();
  v_role text := public.current_role();
  v_sale_id uuid := gen_random_uuid();
  v_line jsonb;
  v_product public.products;
  v_qty integer;
  v_unit_price double precision;
  v_new_qty integer;
  v_subtotal double precision := 0;
  v_total_cost double precision := 0;
  v_profit double precision := 0;
  v_buyer_protection_fee double precision := coalesce((payload->>'buyerProtectionFee')::double precision, 0);
  v_buyer_protection_fee_paid_by text := coalesce(payload->>'buyerProtectionFeePaidBy', 'seller');
  v_delivery_cost double precision := coalesce((payload->>'deliveryCost')::double precision, 0);
  v_delivery_paid_by text := coalesce(payload->>'deliveryPaidBy', 'seller');
  v_vat double precision := coalesce((payload->>'vat')::double precision, 0);
  v_advertising_cost double precision := coalesce((payload->>'advertisingCost')::double precision, 0);
  -- Unlike the fee amounts above, a genuinely absent order total stays NULL
  -- rather than coalescing to 0 — it's a reconciliation figure, not a cost.
  v_order_total double precision := (payload->>'orderTotal')::double precision;
  v_sale public.sales;
begin
  if v_account is null then
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
      where id = (v_line->>'productId')::uuid and user_id = v_account
      for update;

    if not found then
      raise exception 'Product not found.';
    end if;

    -- Employees ring up sales at the listed price. Any discount or
    -- markdown needs a manager to enter it.
    if v_role <> 'manager' and v_unit_price is distinct from v_product.price then
      raise exception 'Only a manager can change the sale price for %.', v_product.name;
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
      (v_account, v_product.id, 'out', v_qty, -v_qty, v_product.quantity, v_new_qty,
       'Sale — ' || coalesce(nullif(payload->>'channel', ''), 'Unspecified'));

    insert into public.sale_items
      (user_id, sale_id, product_id, sku, name, quantity, unit_price, unit_cost, line_total, line_profit)
    values
      (v_account, v_sale_id, v_product.id, v_product.sku, v_product.name, v_qty, v_unit_price, v_product.cost,
       v_unit_price * v_qty, (v_unit_price - v_product.cost) * v_qty);

    v_subtotal := v_subtotal + v_unit_price * v_qty;
    v_total_cost := v_total_cost + v_product.cost * v_qty;
    v_profit := v_profit + (v_unit_price - v_product.cost) * v_qty;
  end loop;

  -- Net of the marketplace fees, not just item price minus item cost —
  -- delivery only comes off profit when the seller (not the buyer) paid it.
  v_profit := v_profit - (
    v_vat + v_advertising_cost +
    case when v_buyer_protection_fee_paid_by = 'seller' then v_buyer_protection_fee else 0 end +
    case when v_delivery_paid_by = 'seller' then v_delivery_cost else 0 end
  );

  insert into public.sales (
    id, user_id, channel, payment_method, subtotal, total_cost, profit,
    buyer_protection_fee, buyer_protection_fee_paid_by, delivery_cost, delivery_paid_by, vat, advertising_cost, order_total
  )
  values (
    v_sale_id,
    v_account,
    coalesce(payload->>'channel', ''),
    payload->>'paymentMethod',
    v_subtotal,
    v_total_cost,
    v_profit,
    v_buyer_protection_fee,
    v_buyer_protection_fee_paid_by,
    v_delivery_cost,
    v_delivery_paid_by,
    v_vat,
    v_advertising_cost,
    v_order_total
  )
  returning * into v_sale;

  return v_sale;
end;
$$;

grant execute on function public.checkout_sale(jsonb) to authenticated;

-- Edits a past sale: reverses the stock effect of its original lines, then
-- reapplies the edited ones as one atomic transaction — the same
-- reverse-then-reapply approach localRepository.ts's updateSale() uses for
-- the offline backend, so both backends net stock identically regardless of
-- what changed about the sale.
--
-- security definer (unlike checkout_sale() above) because sales/sale_items
-- are intentionally locked down from direct UPDATE/DELETE by authenticated
-- (see "Audit and financial rows are intentionally immutable from the
-- browser" above) — this function is the one sanctioned way through that
-- lock. Running as the owner also means RLS does not apply here the way it
-- does for an ordinary query, so every lookup below explicitly scopes to
-- `user_id = v_account` itself rather than relying on a policy to do it.
create or replace function public.edit_sale(payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := public.current_account_id();
  v_role text := public.current_role();
  v_sale_id uuid := (payload->>'id')::uuid;
  v_old_line record;
  v_line jsonb;
  v_product public.products;
  v_qty integer;
  v_unit_price double precision;
  v_new_qty integer;
  v_subtotal double precision := 0;
  v_total_cost double precision := 0;
  v_profit double precision := 0;
  v_buyer_protection_fee double precision := coalesce((payload->>'buyerProtectionFee')::double precision, 0);
  v_buyer_protection_fee_paid_by text := coalesce(payload->>'buyerProtectionFeePaidBy', 'seller');
  v_delivery_cost double precision := coalesce((payload->>'deliveryCost')::double precision, 0);
  v_delivery_paid_by text := coalesce(payload->>'deliveryPaidBy', 'seller');
  v_vat double precision := coalesce((payload->>'vat')::double precision, 0);
  v_advertising_cost double precision := coalesce((payload->>'advertisingCost')::double precision, 0);
  v_order_total double precision := (payload->>'orderTotal')::double precision;
  v_sale public.sales;
begin
  if v_account is null then
    raise exception 'Not authenticated';
  end if;

  -- Matches MANAGER_ONLY.editSale on the client (which already blocks this
  -- before the request is even sent) — checked again here since a security
  -- definer function is the one place RLS and grants can't enforce it for us.
  if v_role is distinct from 'manager' then
    raise exception 'Only a manager can edit a sale.';
  end if;

  if v_sale_id is null then
    raise exception 'Sale not found.';
  end if;

  -- Locks the row and confirms it's actually this account's sale before
  -- anything else runs.
  perform 1 from public.sales where id = v_sale_id and user_id = v_account for update;
  if not found then
    raise exception 'Sale not found.';
  end if;

  if jsonb_array_length(coalesce(payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item before checking out.';
  end if;

  -- Reverse the stock effect of every original line first, so the reapply
  -- step below always sees an accurate picture of what's on hand — mirrors
  -- localRepository.ts's updateSale() exactly. A line whose product has
  -- since been deleted is simply skipped, the same way the offline backend
  -- drops it.
  for v_old_line in
    select product_id, quantity from public.sale_items
    where sale_id = v_sale_id and user_id = v_account
  loop
    if v_old_line.product_id is null then
      continue;
    end if;

    select * into v_product from public.products
      where id = v_old_line.product_id and user_id = v_account
      for update;

    if not found then
      continue;
    end if;

    v_new_qty := v_product.quantity + v_old_line.quantity;

    update public.products
      set quantity = v_new_qty, updated_at = now()
      where id = v_product.id;

    insert into public.stock_movements
      (user_id, product_id, type, quantity, delta, previous_quantity, new_quantity, reason)
    values
      (v_account, v_product.id, 'in', v_old_line.quantity, v_old_line.quantity, v_product.quantity, v_new_qty,
       'Sale edit — reversal');
  end loop;

  delete from public.sale_items where sale_id = v_sale_id and user_id = v_account;

  for v_line in select * from jsonb_array_elements(payload->'lines')
  loop
    v_qty := (v_line->>'quantity')::integer;
    v_unit_price := (v_line->>'unitPrice')::double precision;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be greater than zero.';
    end if;

    select * into v_product from public.products
      where id = (v_line->>'productId')::uuid and user_id = v_account
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
      (v_account, v_product.id, 'out', v_qty, -v_qty, v_product.quantity, v_new_qty,
       'Sale edit — ' || coalesce(nullif(payload->>'channel', ''), 'Unspecified'));

    insert into public.sale_items
      (user_id, sale_id, product_id, sku, name, quantity, unit_price, unit_cost, line_total, line_profit)
    values
      (v_account, v_sale_id, v_product.id, v_product.sku, v_product.name, v_qty, v_unit_price, v_product.cost,
       v_unit_price * v_qty, (v_unit_price - v_product.cost) * v_qty);

    v_subtotal := v_subtotal + v_unit_price * v_qty;
    v_total_cost := v_total_cost + v_product.cost * v_qty;
    v_profit := v_profit + (v_unit_price - v_product.cost) * v_qty;
  end loop;

  -- Net of the marketplace fees, exactly like checkout_sale() — delivery
  -- only comes off profit when the seller (not the buyer) paid it.
  v_profit := v_profit - (
    v_vat + v_advertising_cost +
    case when v_buyer_protection_fee_paid_by = 'seller' then v_buyer_protection_fee else 0 end +
    case when v_delivery_paid_by = 'seller' then v_delivery_cost else 0 end
  );

  update public.sales
    set
      channel = coalesce(payload->>'channel', ''),
      payment_method = payload->>'paymentMethod',
      subtotal = v_subtotal,
      total_cost = v_total_cost,
      profit = v_profit,
      buyer_protection_fee = v_buyer_protection_fee,
      buyer_protection_fee_paid_by = v_buyer_protection_fee_paid_by,
      delivery_cost = v_delivery_cost,
      delivery_paid_by = v_delivery_paid_by,
      vat = v_vat,
      advertising_cost = v_advertising_cost,
      order_total = v_order_total
    where id = v_sale_id and user_id = v_account
    returning * into v_sale;

  return v_sale;
end;
$$;

grant execute on function public.edit_sale(jsonb) to authenticated;

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

alter table public.returns add column if not exists created_by uuid references auth.users(id);

drop trigger if exists returns_stamp_account_actor on public.returns;
create trigger returns_stamp_account_actor
  before insert on public.returns
  for each row execute function public.stamp_account_and_actor();

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

drop trigger if exists return_lines_stamp_account on public.return_lines;
create trigger return_lines_stamp_account
  before insert on public.return_lines
  for each row execute function public.stamp_account_id();

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

drop trigger if exists replacement_lines_stamp_account on public.replacement_lines;
create trigger replacement_lines_stamp_account
  before insert on public.replacement_lines
  for each row execute function public.stamp_account_id();

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
create policy "returns_select_own" on public.returns for select to authenticated using (user_id = public.current_account_id());
drop policy if exists "returns_insert_own" on public.returns;
create policy "returns_insert_own" on public.returns for insert to authenticated with check (user_id = public.current_account_id());

drop policy if exists "return_lines_select_own" on public.return_lines;
create policy "return_lines_select_own" on public.return_lines for select to authenticated using (user_id = public.current_account_id());
drop policy if exists "return_lines_insert_own" on public.return_lines;
create policy "return_lines_insert_own" on public.return_lines for insert to authenticated with check (user_id = public.current_account_id());

drop policy if exists "replacement_lines_select_own" on public.replacement_lines;
create policy "replacement_lines_select_own" on public.replacement_lines for select to authenticated using (user_id = public.current_account_id());
drop policy if exists "replacement_lines_insert_own" on public.replacement_lines;
create policy "replacement_lines_insert_own" on public.replacement_lines for insert to authenticated with check (user_id = public.current_account_id());

-- Audit and financial rows are intentionally immutable from the browser,
-- same as sales and stock_movements.
revoke update, delete on public.returns from authenticated;
revoke update, delete on public.return_lines from authenticated;
revoke update, delete on public.replacement_lines from authenticated;
grant select, insert on public.returns to authenticated;
grant select, insert on public.return_lines to authenticated;
grant select, insert on public.replacement_lines to authenticated;

create or replace view public.return_lines_view
with (security_invoker = true) as
select
  id, user_id, return_id, product_id, sku, name, quantity, disposition, created_at,
  case when public.current_role() = 'manager' then unit_cost end as unit_cost
from public.return_lines;

create or replace view public.replacement_lines_view
with (security_invoker = true) as
select
  id, user_id, return_id, product_id, sku, name, quantity, created_at,
  case when public.current_role() = 'manager' then unit_cost end as unit_cost
from public.replacement_lines;

grant select on public.return_lines_view to authenticated;
grant select on public.replacement_lines_view to authenticated;

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
  v_account uuid := public.current_account_id();
  v_role text := public.current_role();
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
  if v_account is null then
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

  -- Money leaving the business (refunds, goodwill) or stock being written
  -- off needs a manager — an employee can still log a plain restock return.
  if v_role <> 'manager' then
    if 'refund' = any(v_actions) or 'goodwill' = any(v_actions) then
      raise exception 'Only a manager can process a refund or goodwill gesture.';
    end if;

    for v_line in select * from jsonb_array_elements(coalesce(payload->'returnLines', '[]'::jsonb))
    loop
      if (v_line->>'disposition') = 'writeoff' then
        raise exception 'Only a manager can write off returned stock.';
      end if;
    end loop;
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
      where id = (v_line->>'productId')::uuid and user_id = v_account
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
        (v_account, v_product.id, 'in', v_qty, v_qty, v_product.quantity, v_new_qty,
         'Return — restock' || v_note_suffix);
    end if;

    insert into public.return_lines
      (user_id, return_id, product_id, sku, name, quantity, disposition, unit_cost)
    values
      (v_account, v_return_id, v_product.id, v_product.sku, v_product.name, v_qty, v_disposition, v_product.cost);
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(payload->'replacementLines', '[]'::jsonb))
  loop
    v_qty := (v_line->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Replacement item quantity must be greater than zero.';
    end if;

    select * into v_product from public.products
      where id = (v_line->>'productId')::uuid and user_id = v_account
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
      (v_account, v_product.id, 'out', v_qty, -v_qty, v_product.quantity, v_new_qty,
       'Return — replacement' || v_note_suffix);

    insert into public.replacement_lines
      (user_id, return_id, product_id, sku, name, quantity, unit_cost)
    values
      (v_account, v_return_id, v_product.id, v_product.sku, v_product.name, v_qty, v_product.cost);
  end loop;

  insert into public.returns
    (id, user_id, sale_id, channel, customer_ref, reason, notes, actions,
     refund_amount, refund_method, goodwill_type, goodwill_value)
  values (
    v_return_id,
    v_account,
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

-- Account settings: personal/employee details --------------------------------
--
-- A manager's own edit here applies immediately (see request_profile_update
-- below); an employee's edit is held in profile_change_requests until a
-- manager approves or rejects it — the same "propose, then a manager
-- decides" shape invite_employee already uses for account access, just
-- applied to personal details instead. A password is deliberately NOT
-- handled here — AuthScreen and ResetPasswordScreen go straight through
-- Supabase Auth (auth.updateUser), so it stays a personal security action
-- with no approval step, for anyone, immediately.
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references auth.users(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null default '',
  birthday date,
  address text not null default '',
  employee_number text not null default '',
  username text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists profiles_account_idx on public.profiles (account_id);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_account" on public.profiles;
create policy "profiles_select_own_account" on public.profiles
  for select to authenticated
  using (account_id = public.current_account_id());

-- No direct insert/update/delete from the client — request_profile_update()
-- and approve_profile_change() below (both SECURITY DEFINER) are the only
-- way to write this table, so the manager-approval rule can't be bypassed
-- by calling the REST API directly instead of going through them.
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;

create table if not exists public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  proposed jsonb not null,
  -- 'superseded' is set automatically when the same employee submits another
  -- edit before a manager has acted on the first one — see
  -- request_profile_update below.
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create index if not exists profile_change_requests_account_idx on public.profile_change_requests (account_id, status);

alter table public.profile_change_requests enable row level security;

drop policy if exists "profile_change_requests_select_own_account" on public.profile_change_requests;
create policy "profile_change_requests_select_own_account" on public.profile_change_requests
  for select to authenticated
  using (account_id = public.current_account_id());

revoke insert, update, delete on public.profile_change_requests from authenticated;
grant select on public.profile_change_requests to authenticated;

-- Submits an edit to your own profile. Written as SECURITY DEFINER so the
-- manager/employee branch below is enforced server-side, not just hidden in
-- the client UI.
create or replace function public.request_profile_update(
  p_full_name text,
  p_birthday date,
  p_address text,
  p_employee_number text,
  p_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := public.current_account_id();
  v_role text := public.current_role();
  v_member uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_account is null then
    raise exception 'You need an account before you can edit your profile.';
  end if;

  if v_role = 'manager' then
    insert into public.profiles (member_id, account_id, full_name, birthday, address, employee_number, username, updated_at)
    values (v_member, v_account, coalesce(p_full_name, ''), p_birthday, coalesce(p_address, ''), coalesce(p_employee_number, ''), coalesce(p_username, ''), now())
    on conflict (member_id) do update
      set full_name = excluded.full_name,
          birthday = excluded.birthday,
          address = excluded.address,
          employee_number = excluded.employee_number,
          username = excluded.username,
          updated_at = now()
    returning * into v_profile;

    return jsonb_build_object(
      'status', 'applied',
      'profile', jsonb_build_object(
        'fullName', v_profile.full_name,
        'birthday', coalesce(v_profile.birthday::text, ''),
        'address', v_profile.address,
        'employeeNumber', v_profile.employee_number,
        'username', v_profile.username,
        'updatedAt', v_profile.updated_at
      )
    );
  end if;

  -- Employee: superseding a still-pending request of their own rather than
  -- piling them up, so editing again before a manager gets to the first one
  -- just updates what's waiting for review.
  update public.profile_change_requests
    set status = 'superseded', resolved_at = now()
    where account_id = v_account and member_id = v_member and status = 'pending';

  insert into public.profile_change_requests (account_id, member_id, proposed, status)
  values (
    v_account, v_member,
    jsonb_build_object(
      'fullName', coalesce(p_full_name, ''),
      'birthday', coalesce(p_birthday::text, ''),
      'address', coalesce(p_address, ''),
      'employeeNumber', coalesce(p_employee_number, ''),
      'username', coalesce(p_username, '')
    ),
    'pending'
  );

  return jsonb_build_object('status', 'pending');
end;
$$;

grant execute on function public.request_profile_update(text, date, text, text, text) to authenticated;

-- Manager-only: every employee profile edit still awaiting a decision on
-- this account, oldest first.
create or replace function public.list_pending_profile_changes()
returns table (
  id uuid,
  member_id uuid,
  invited_email text,
  proposed jsonb,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_role() is distinct from 'manager' then
    raise exception 'Only a manager can view pending profile changes.';
  end if;

  return query
    select r.id, r.member_id, m.invited_email, r.proposed, r.requested_at
    from public.profile_change_requests r
    left join public.memberships m on m.member_id = r.member_id and m.account_id = r.account_id
    where r.account_id = public.current_account_id() and r.status = 'pending'
    order by r.requested_at asc;
end;
$$;

grant execute on function public.list_pending_profile_changes() to authenticated;

-- Manager-only: applies a pending employee edit to their profile.
create or replace function public.approve_profile_change(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := public.current_account_id();
  v_role text := public.current_role();
  v_request public.profile_change_requests;
begin
  if v_role is distinct from 'manager' then
    raise exception 'Only a manager can approve a profile change.';
  end if;

  select * into v_request
    from public.profile_change_requests
    where id = p_request_id and account_id = v_account and status = 'pending';

  if not found then
    raise exception 'That change request is not pending any more.';
  end if;

  insert into public.profiles (member_id, account_id, full_name, birthday, address, employee_number, username, updated_at)
  values (
    v_request.member_id,
    v_account,
    coalesce(v_request.proposed->>'fullName', ''),
    nullif(v_request.proposed->>'birthday', '')::date,
    coalesce(v_request.proposed->>'address', ''),
    coalesce(v_request.proposed->>'employeeNumber', ''),
    coalesce(v_request.proposed->>'username', ''),
    now()
  )
  on conflict (member_id) do update
    set full_name = excluded.full_name,
        birthday = excluded.birthday,
        address = excluded.address,
        employee_number = excluded.employee_number,
        username = excluded.username,
        updated_at = now();

  update public.profile_change_requests
    set status = 'approved', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id;
end;
$$;

grant execute on function public.approve_profile_change(uuid) to authenticated;

-- Manager-only: discards a pending employee edit without applying it.
create or replace function public.reject_profile_change(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := public.current_account_id();
  v_role text := public.current_role();
begin
  if v_role is distinct from 'manager' then
    raise exception 'Only a manager can reject a profile change.';
  end if;

  update public.profile_change_requests
    set status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id and account_id = v_account and status = 'pending';

  if not found then
    raise exception 'That change request is not pending any more.';
  end if;
end;
$$;

grant execute on function public.reject_profile_change(uuid) to authenticated;

-- Account settings: label logo, label template, sale channels ---------------
--
-- Unlike profiles above, this is shared account-wide, not per-person —
-- whoever last saved a change is what everyone signed into this account
-- sees next time they open the app on any device or browser. One row per
-- account; no manager/employee split needed here since nothing here is
-- sensitive, so ordinary RLS (not a SECURITY DEFINER function) is enough.
create table if not exists public.account_settings (
  account_id uuid primary key references auth.users(id) on delete cascade,
  logo_data_url text,
  label_template jsonb,
  sale_channels jsonb not null default '[]'::jsonb,
  -- Named, saved label layouts (e.g. "Shipping label", "RV") a user can
  -- switch back to over label_template at any time — see LabelPreset.
  label_presets jsonb not null default '[]'::jsonb,
  -- Saved reference codes (printer maintenance commands, Wi-Fi joins,
  -- supplier links, etc.) shown on screen for scanning — see QuickCode.
  quick_codes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- `create table if not exists` above only helps on a brand new install —
-- on an account_settings table that already existed before label presets
-- or quick codes were added, this is what actually adds the column,
-- safely, every re-run.
alter table public.account_settings add column if not exists label_presets jsonb not null default '[]'::jsonb;
alter table public.account_settings add column if not exists quick_codes jsonb not null default '[]'::jsonb;

alter table public.account_settings enable row level security;

drop policy if exists "account_settings_select_own_account" on public.account_settings;
create policy "account_settings_select_own_account" on public.account_settings
  for select to authenticated
  using (account_id = public.current_account_id());

drop policy if exists "account_settings_insert_own_account" on public.account_settings;
create policy "account_settings_insert_own_account" on public.account_settings
  for insert to authenticated
  with check (account_id = public.current_account_id());

drop policy if exists "account_settings_update_own_account" on public.account_settings;
create policy "account_settings_update_own_account" on public.account_settings
  for update to authenticated
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

revoke delete on public.account_settings from authenticated;
grant select, insert, update on public.account_settings to authenticated;
