-- ============================================================================
-- SUPPLIERS & PURCHASE ORDERS — column fix (replaces supplier_po_migration.sql)
-- ============================================================================
-- Turns out `suppliers`, `supplier_products`, `purchase_orders` and
-- `purchase_order_lines` already existed in this database from earlier work
-- — with working manager-only RLS (including an mfa_satisfied() check on
-- selects) already in place. The original supplier_po_migration.sql assumed
-- these tables didn't exist yet and used different column names
-- (account_id/po_id instead of the real user_id/purchase_order_id), which is
-- why it failed with "column account_id does not exist".
--
-- This migration does NOT touch any existing table, column, trigger, or
-- policy. All four tables were confirmed empty (0 rows) before writing this,
-- so the only change needed is additive: `purchase_order_lines` is missing
-- three columns the app needs (sku/name snapshotted at order time — the
-- same reasoning sale_items/return_lines snapshot them — plus line_total).
-- Safe to run more than once.

alter table public.purchase_order_lines
  add column if not exists sku text not null default '',
  add column if not exists name text not null default '',
  add column if not exists line_total double precision not null default 0 check (line_total >= 0);

-- Verify afterwards — should show the three new columns with no errors:
-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'purchase_order_lines'
-- order by ordinal_position;
