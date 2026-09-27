-- Adds order_number (the eBay/marketplace order number CountRoom Register
-- records on each sale) to sales_view, so CountRoom Inventory can show it
-- and search sales by it. Same definition as before with one column
-- appended at the end — CREATE OR REPLACE VIEW only allows adding columns
-- at the end. Not masked: an order number isn't cost/profit data.
-- Safe to run more than once.
create or replace view public.sales_view with (security_invoker = false) as
 SELECT id,
    user_id,
    channel,
    payment_method,
    subtotal,
    created_at,
    created_by,
    updated_at,
        CASE WHEN "current_role"() = 'manager'::text THEN total_cost ELSE NULL::double precision END AS total_cost,
        CASE WHEN "current_role"() = 'manager'::text THEN profit ELSE NULL::double precision END AS profit,
        CASE WHEN "current_role"() = 'manager'::text THEN buyer_protection_fee ELSE NULL::double precision END AS buyer_protection_fee,
        CASE WHEN "current_role"() = 'manager'::text THEN buyer_protection_fee_paid_by ELSE NULL::text END AS buyer_protection_fee_paid_by,
        CASE WHEN "current_role"() = 'manager'::text THEN delivery_cost ELSE NULL::double precision END AS delivery_cost,
        CASE WHEN "current_role"() = 'manager'::text THEN delivery_paid_by ELSE NULL::text END AS delivery_paid_by,
        CASE WHEN "current_role"() = 'manager'::text THEN vat ELSE NULL::double precision END AS vat,
        CASE WHEN "current_role"() = 'manager'::text THEN advertising_cost ELSE NULL::double precision END AS advertising_cost,
        CASE WHEN "current_role"() = 'manager'::text THEN order_total ELSE NULL::double precision END AS order_total,
    sale_date,
    backdated,
    status,
    tip,
    service_charge,
    discount_total,
    client_ref,
    tab_id,
        CASE WHEN "current_role"() = 'manager'::text THEN ebay_vat ELSE NULL::double precision END AS ebay_vat,
    order_number
   FROM sales
  WHERE user_id = current_account_id();

-- Verify afterwards:
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'sales_view' and column_name = 'order_number';
