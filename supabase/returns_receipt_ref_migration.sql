-- Applied live 2026-09-30 via Supabase MCP (migration "returns_receipt_ref").
-- A scannable returns-receipt number, shared by CountRoom Inventory and
-- Register. Same shape as a sale's client_ref (YYMMDDHHmmss + 6 random
-- digits, 18 digits, Code 128 Set C friendly). Filled by default, so every
-- existing and future return (process_return, create/start_register_return)
-- gets one without any function changes.
alter table public.returns add column if not exists receipt_ref text;

update public.returns
   set receipt_ref = to_char(created_at at time zone 'Europe/London', 'YYMMDDHH24MISS')
                     || lpad((floor(random() * 1000000))::int::text, 6, '0')
 where receipt_ref is null;

alter table public.returns
  alter column receipt_ref set default
    (to_char(now() at time zone 'Europe/London', 'YYMMDDHH24MISS')
     || lpad((floor(random() * 1000000))::int::text, 6, '0'));
alter table public.returns alter column receipt_ref set not null;

create unique index if not exists returns_receipt_ref_key on public.returns (user_id, receipt_ref);
