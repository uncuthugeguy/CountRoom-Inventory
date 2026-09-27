-- Return postage label cost on a return/refund case (2026-09-27).
-- Additive and safe to run more than once. `returns` has no UPDATE policy
-- (cases are written only through the process_return/edit_return RPCs), so
-- the cost is set through its own small manager-only function rather than
-- opening up a general UPDATE policy.
alter table public.returns
  add column if not exists return_postage_cost double precision not null default 0;

create or replace function public.set_return_postage_cost(p_return_id uuid, p_cost double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'manager' then
    raise exception 'Only a manager can set the return postage cost.';
  end if;
  if p_cost is null or p_cost < 0 then
    raise exception 'Return postage cost must be zero or greater.';
  end if;
  update public.returns
     set return_postage_cost = p_cost
   where id = p_return_id
     and user_id = public.current_account_id();
end;
$$;

revoke all on function public.set_return_postage_cost(uuid, double precision) from public, anon;
grant execute on function public.set_return_postage_cost(uuid, double precision) to authenticated;

-- Verify afterwards:
-- select column_name from information_schema.columns where table_name = 'returns' and column_name = 'return_postage_cost';
-- select policyname, cmd from pg_policies where tablename = 'returns';  -- should still be insert/select only
