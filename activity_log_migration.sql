-- CountRoom: shared activity log migration (v3 — defensive column handling)
-- Run this in Supabase Dashboard > SQL Editor.
--
-- v2 hit "column entity_type does not exist" on your database — most likely
-- because a stray/older `activity_log` table already existed in some other
-- shape (this project has a history of stale schema scripts sitting in open
-- SQL Editor tabs getting run by accident — see the project notes) and the
-- v2 script's plain `update ... set entity_id = product_id, ...` line
-- referenced a column that particular table didn't have. This version never
-- references a possibly-missing column directly — every column add/backfill/
-- drop is wrapped in an `information_schema.columns` existence check inside
-- a single `do $$ ... $$` block, so it's safe no matter which of the three
-- shapes (fresh, v1, or some other stray version) the live table is
-- currently in.
--
-- Screenshot the editor content right after clicking into a "New" tab,
-- before pasting, to confirm it's actually empty — then select-all + paste
-- this whole file and run it in one go (don't run a partial selection).
--
-- After running, verify the RLS policy directly rather than trusting the
-- "Success" toast (per the round-1/round-2 notes — a `_shared`-style policy
-- has re-appeared on this project before without anyone running SQL that
-- looked like it would do that):
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where tablename = 'activity_log';
--
-- Expect exactly two rows, both scoped to `account_id = current_account_id()`
-- — never `true`:
--   - "activity_log_select_own" (cmd 'SELECT'): qual also ANDs in
--     `current_role() = 'manager'` — this is what makes the log manager-only
--     server-side, not just a hidden UI tab.
--   - "activity_log_insert_own" (cmd 'INSERT'): with_check has no role
--     check — an employee's own loggable actions (e.g. adding a product)
--     still need to be able to insert a row; it's *reading the log back*
--     that's restricted to managers.
--
-- It's also worth running this diagnostic first (read-only, safe) if you
-- want to see what's actually there before this script changes anything:
--
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'activity_log'
--   order by ordinal_position;

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  -- Who actually did it — separate from account_id once more than one
  -- person can act on an account. Null rather than cascaded on delete: the
  -- log entry should outlive the person who made it, the same reasoning
  -- stock_movements.created_by and profile_change_requests.resolved_by use.
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default '',
  entity_type text not null default 'product',
  action text not null default 'edited',
  -- No hard foreign key: entity_id can point at a product, sale, return or
  -- membership row depending on entity_type, so a single FK doesn't fit.
  -- History reads by entity_label (snapshotted at write time) regardless of
  -- whether the referenced row still exists.
  entity_id uuid,
  entity_label text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

-- Upgrade path from any older shape (v1's product_id/product_name, or some
-- other stray version) — every branch below only touches a column after
-- confirming (via information_schema) that it actually exists on the live
-- table, so this can never fail with "column ... does not exist" regardless
-- of which shape the table started in.
do $mig$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_log' and column_name = 'entity_type'
  ) then
    alter table public.activity_log add column entity_type text not null default 'product';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_log' and column_name = 'entity_id'
  ) then
    alter table public.activity_log add column entity_id uuid;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_log' and column_name = 'entity_label'
  ) then
    alter table public.activity_log add column entity_label text not null default '';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_log' and column_name = 'action'
  ) then
    alter table public.activity_log add column action text not null default 'edited';
  end if;

  -- Backfill from v1's product_id/product_name, then drop them — only if
  -- they actually exist on this table.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_log' and column_name = 'product_id'
  ) then
    update public.activity_log
      set entity_id = product_id,
          entity_label = coalesce(product_name, '')
      where entity_id is null and product_id is not null;
    alter table public.activity_log drop constraint if exists activity_log_product_id_fkey;
    alter table public.activity_log drop column product_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_log' and column_name = 'product_name'
  ) then
    alter table public.activity_log drop column product_name;
  end if;
end
$mig$;

alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in ('added', 'edited', 'removed', 'invited', 'role_changed'));
alter table public.activity_log drop constraint if exists activity_log_entity_type_check;
alter table public.activity_log add constraint activity_log_entity_type_check
  check (entity_type in ('product', 'sale', 'return', 'member'));

drop index if exists activity_log_product_idx;
create index if not exists activity_log_entity_idx on public.activity_log (entity_type, entity_id);
create index if not exists activity_log_account_created_idx on public.activity_log (account_id, created_at desc);

-- Stamps account_id/actor_id server-side on every insert, the same pattern
-- stamp_account_and_actor() already uses for stock_movements — the client
-- only ever sends actor_name/entity_type/action/entity_id/entity_label/detail;
-- it cannot claim to be logging on behalf of a different account or person.
create or replace function public.stamp_activity_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.account_id := public.current_account_id();
  if new.account_id is null then
    raise exception 'You are not part of a CountRoom account.';
  end if;
  new.actor_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists activity_log_stamp on public.activity_log;
create trigger activity_log_stamp
  before insert on public.activity_log
  for each row execute function public.stamp_activity_log();

alter table public.activity_log enable row level security;

-- `_own` only — never `_shared`/`USING (true)`. See the round-1/round-2
-- notes elsewhere in this project: a `_shared` policy on any table here has
-- twice re-appeared by accident and opened every account's data to every
-- other signed-in user.
drop policy if exists "activity_log_select_own" on public.activity_log;
create policy "activity_log_select_own" on public.activity_log
  for select to authenticated
  using (account_id = public.current_account_id() and public.current_role() = 'manager');

drop policy if exists "activity_log_insert_own" on public.activity_log;
create policy "activity_log_insert_own" on public.activity_log
  for insert to authenticated
  with check (account_id = public.current_account_id());

-- Audit trail is intentionally immutable from the browser, same as
-- stock_movements/sales/sale_items above.
revoke update, delete on public.activity_log from authenticated;
grant select, insert on public.activity_log to authenticated;
