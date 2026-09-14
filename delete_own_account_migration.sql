-- Self-service account deletion.
--
-- Two functions, both SECURITY DEFINER (owned by `postgres`, same as every
-- other RPC in this app -- `postgres` has DELETE on auth.users on this
-- project, confirmed live via has_table_privilege() before writing this).
--
--   preview_account_deletion() -- read-only. Tells the UI what deleting the
--   caller's own account would remove, and whether it's currently allowed.
--
--   delete_own_account() -- the real thing. Deletes every row this account
--   owns, every membership the caller holds (their own account *and* any
--   team they've joined elsewhere), and finally the caller's own
--   auth.users row. Irreversible.
--
-- Blocked while the caller's own account still has other *active* team
-- members -- they need to be removed first (existing remove_team_member
-- flow) so nobody's access silently disappears out from under them.
--
-- Deletion order matters: three tables reference products with
-- ON DELETE NO ACTION (listings, modifier_groups, tab_items), so anything
-- that could leave one of those rows pointing at a soon-to-be-deleted
-- product has to go first. tabs CASCADEs to tab_items and kitchen_tickets,
-- which clears the tab_items -> products reference as a side effect.
-- Everything else here rides this account's own ON DELETE CASCADE chains
-- (confirmed live via a full pg_constraint sweep of the public schema
-- before writing this) rather than being deleted table-by-table.
--
-- STATUS: already applied live to the production project
-- (hfgryucmjgwqrbgazloy) via the Supabase MCP connector on 2026-09-14, and
-- both grants verified afterwards (authenticated only, no anon/public).
-- Kept here, same as the other *_migration.sql files in this repo, as the
-- source of record -- idempotent (CREATE OR REPLACE), safe to re-run.

create or replace function public.preview_account_deletion()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_other_active_members int;
  v_products int;
  v_sales int;
  v_purchase_orders int;
  v_suppliers int;
  v_other_memberships int;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select count(*) into v_other_active_members
    from public.memberships
    where account_id = v_uid and member_id is distinct from v_uid and status = 'active';

  select count(*) into v_products from public.products where user_id = v_uid;
  select count(*) into v_sales from public.sales where user_id = v_uid;
  select count(*) into v_purchase_orders from public.purchase_orders where user_id = v_uid;
  select count(*) into v_suppliers from public.suppliers where user_id = v_uid;

  select count(*) into v_other_memberships
    from public.memberships
    where member_id = v_uid and account_id is distinct from v_uid and status = 'active';

  return jsonb_build_object(
    'canDelete', v_other_active_members = 0,
    'otherActiveTeamMembers', v_other_active_members,
    'productCount', v_products,
    'saleCount', v_sales,
    'purchaseOrderCount', v_purchase_orders,
    'supplierCount', v_suppliers,
    'otherTeamMemberships', v_other_memberships
  );
end;
$$;

revoke all on function public.preview_account_deletion() from public;
grant execute on function public.preview_account_deletion() to authenticated;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_other_active_members int;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select count(*) into v_other_active_members
    from public.memberships
    where account_id = v_uid and member_id is distinct from v_uid and status = 'active';

  if v_other_active_members > 0 then
    raise exception 'Remove every other team member from your account before deleting it.';
  end if;

  delete from public.tabs where account_id = v_uid;
  delete from public.listings where account_id = v_uid;
  delete from public.modifier_groups where account_id = v_uid;
  delete from public.sales where user_id = v_uid;
  delete from public.returns where user_id = v_uid;
  delete from public.purchase_orders where user_id = v_uid;
  delete from public.suppliers where user_id = v_uid;
  delete from public.products where user_id = v_uid;
  delete from public.till_sessions where account_id = v_uid;
  delete from public.discounts where account_id = v_uid;
  delete from public.register_tiles where account_id = v_uid;
  delete from public.ebay_credentials where account_id = v_uid;
  delete from public.account_settings where account_id = v_uid;
  delete from public.activity_log where account_id = v_uid;
  delete from public.profile_change_requests where account_id = v_uid or member_id = v_uid;
  delete from public.profiles where account_id = v_uid or member_id = v_uid;
  delete from public.memberships where account_id = v_uid or member_id = v_uid;

  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- Verification (already run once, safe to re-run):
--   select proname, proacl from pg_proc where proname in
--     ('preview_account_deletion','delete_own_account');
--   -- proacl should show authenticated=X, no PUBLIC/anon entry.
