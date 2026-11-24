-- =============================================================================
-- booking-v91 — StoreHub daily summaries (from the Backoffice reports).
--
-- Without API access, history is read from StoreHub's own report engine in the
-- signed-in browser (/api/v2/report/sales), one Manila business day at a time
-- (StoreHub's day runs 1:00 AM → 1:00 AM). Each outlet-day becomes ONE row in
-- sh_transactions:
--   ref_id 'rpt:<YYYY-MM-DD>:<outlet>', txn_count = receipts that day,
--   total = net + VAT + service charge, items = products (net), payments =
--   payment methods, raw.source = 'report', raw.returns = returns count.
-- When real receipts (API sync) exist for a day, that day's rpt rows are ignored
-- so nothing is counted twice.
--
-- Also: business_date now follows StoreHub's 1 AM day (Manila time − 1 h) so
-- daily totals match the Backoffice.
-- =============================================================================

alter table public.sh_transactions add column if not exists txn_count int not null default 1;

-- txnCount / businessDate optional in the payload (daily summaries set both)
create or replace function public.sh_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_s int := 0; n_p int := 0; n_t int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  insert into sh_stores (id, name, raw, synced_at)
  select s->>'id', coalesce(nullif(s->>'name', ''), s->>'id'), s, now()
    from jsonb_array_elements(coalesce(p->'stores', '[]')) s where coalesce(s->>'id', '') <> ''
  on conflict (id) do update set name = excluded.name, raw = excluded.raw, synced_at = now();
  get diagnostics n_s = row_count;
  insert into sh_products (id, name, category, unit_price, cost, parent_id, raw, synced_at)
  select x->>'id', coalesce(nullif(x->>'name', ''), x->>'id'), nullif(x->>'category', ''),
         nullif(x->>'unitPrice', '')::numeric, nullif(x->>'cost', '')::numeric, nullif(x->>'parentProductId', ''), x, now()
    from jsonb_array_elements(coalesce(p->'products', '[]')) x where coalesce(x->>'id', '') <> ''
  on conflict (id) do update set name = excluded.name, category = coalesce(excluded.category, sh_products.category),
    unit_price = excluded.unit_price, cost = excluded.cost, parent_id = excluded.parent_id, raw = excluded.raw, synced_at = now();
  get diagnostics n_p = row_count;
  insert into sh_transactions (ref_id, invoice_number, store_id, transaction_type, transaction_time, business_date,
    total, sub_total, tax, discount, service_charge, rounded_amount, is_cancelled, channel, table_id, employee_id,
    customer_ref_id, payments, items, raw, txn_count, synced_at)
  select t->>'refId', t->>'invoiceNumber', t->>'storeId', coalesce(nullif(t->>'transactionType', ''), 'Sale'),
         (t->>'transactionTime')::timestamptz,
         coalesce(nullif(t->>'businessDate', '')::date,
                  (((t->>'transactionTime')::timestamptz at time zone 'Asia/Manila') - interval '1 hour')::date),
         coalesce(nullif(t->>'total', '')::numeric, 0), coalesce(nullif(t->>'subTotal', '')::numeric, 0),
         coalesce(nullif(t->>'tax', '')::numeric, 0), coalesce(nullif(t->>'discount', '')::numeric, 0),
         coalesce(nullif(t->>'serviceCharge', '')::numeric, 0), coalesce(nullif(t->>'roundedAmount', '')::numeric, 0),
         coalesce((t->>'isCancelled')::boolean, false), t->>'channel', t->>'tableId', t->>'employeeId',
         t->>'customerRefId', coalesce(t->'payments', '[]'), coalesce(t->'items', '[]'), t - 'items' - 'payments',
         coalesce(nullif(t->>'txnCount', '')::int, 1), now()
    from jsonb_array_elements(coalesce(p->'transactions', '[]')) t
   where coalesce(t->>'refId', '') <> '' and coalesce(t->>'transactionTime', '') <> ''
  on conflict (ref_id) do update set invoice_number = excluded.invoice_number, store_id = excluded.store_id,
    transaction_type = excluded.transaction_type, transaction_time = excluded.transaction_time,
    business_date = excluded.business_date, total = excluded.total, sub_total = excluded.sub_total, tax = excluded.tax,
    discount = excluded.discount, service_charge = excluded.service_charge, rounded_amount = excluded.rounded_amount,
    is_cancelled = excluded.is_cancelled, channel = excluded.channel, table_id = excluded.table_id,
    employee_id = excluded.employee_id, customer_ref_id = excluded.customer_ref_id, payments = excluded.payments,
    items = excluded.items, raw = excluded.raw, txn_count = excluded.txn_count, synced_at = now();
  get diagnostics n_t = row_count;
  return jsonb_build_object('stores', n_s, 'products', n_p, 'transactions', n_t);
end $$;

-- existing API rows: move to the 1 AM business day
update public.sh_transactions set business_date = ((transaction_time at time zone 'Asia/Manila') - interval '1 hour')::date
 where ref_id not like 'rpt:%';

-- the rows to count: receipts, plus daily summaries for days without receipts
create or replace function public.sh_rows(p_from date, p_to date)
returns setof public.sh_transactions language sql stable security definer set search_path = public as $$
  select x.* from sh_transactions x
   where x.business_date between p_from and p_to
     and not (x.ref_id like 'rpt:%' and exists (
       select 1 from sh_transactions y where y.business_date = x.business_date and y.ref_id not like 'rpt:%'))
$$;
revoke all on function public.sh_rows(date, date) from public, anon, authenticated;

create or replace function public.sh_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Pick a date range'; end if;
  if p_to - p_from > 400 then raise exception 'Pick up to about a year'; end if;
  with t as (
    select x.*, public.sh_sign(x) sg, coalesce(s.name, x.store_id, '—') store, (x.ref_id like 'rpt:%') rpt
      from public.sh_rows(p_from, p_to) x left join sh_stores s on s.id = x.store_id
  ), live as (select * from t where sg <> 0)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'synced_at', (select max(synced_at) from sh_transactions),
    'last_pull', (select value from cb_sync_state where key = 'storehub_last_pull'),
    'summaries', (select count(*) from t where rpt),
    'totals', (select jsonb_build_object(
        'gross', round(coalesce(sum(sg * total), 0), 2),
        'net', round(coalesce(sum(sg * (total - tax - service_charge)), 0), 2),
        'tax', round(coalesce(sum(sg * tax), 0), 2),
        'service_charge', round(coalesce(sum(sg * service_charge), 0), 2),
        'discount', round(coalesce(sum(sg * discount), 0), 2),
        'sales', coalesce(sum(txn_count) filter (where sg = 1), 0),
        'returns', count(*) filter (where sg = -1) + coalesce(sum(nullif(raw->>'returns', '')::int), 0),
        'cancelled', (select count(*) from t where is_cancelled),
        'items', coalesce(sum(sg * (select sum(coalesce((i->>'quantity')::numeric, 0)) from jsonb_array_elements(items) i)), 0)
      ) from live),
    'days', coalesce((select jsonb_agg(d order by d->>'date') from (
        select jsonb_build_object('date', business_date, 'gross', round(sum(sg * total), 2),
               'net', round(sum(sg * (total - tax - service_charge)), 2), 'sales', sum(txn_count) filter (where sg = 1)) d
          from live group by business_date) q), '[]'),
    'stores', coalesce((select jsonb_agg(d order by (d->>'gross')::numeric desc) from (
        select jsonb_build_object('store', store, 'gross', round(sum(sg * total), 2),
               'net', round(sum(sg * (total - tax - service_charge)), 2), 'sales', sum(txn_count) filter (where sg = 1)) d
          from live group by store) q), '[]'),
    'payments', coalesce((select jsonb_agg(d order by (d->>'amount')::numeric desc) from (
        select jsonb_build_object('method', coalesce(nullif(pm->>'paymentMethod', ''), 'Other'),
               'amount', round(sum(sg * coalesce((pm->>'amount')::numeric, 0)), 2),
               'count', sum(coalesce(nullif(pm->>'count', '')::int, 1))) d
          from live, jsonb_array_elements(payments) pm group by coalesce(nullif(pm->>'paymentMethod', ''), 'Other')) q), '[]'),
    'products', coalesce((select jsonb_agg(d order by (d->>'amount')::numeric desc) from (
        select jsonb_build_object('product', coalesce(pr.name, i->>'productId', '—'), 'category', pr.category,
               'qty', sum(live.sg * coalesce((i->>'quantity')::numeric, 0)),
               'amount', round(sum(live.sg * coalesce((i->>'total')::numeric, 0)), 2)) d
          from live, jsonb_array_elements(live.items) i left join sh_products pr on pr.id = i->>'productId'
         group by coalesce(pr.name, i->>'productId', '—'), pr.category
         order by sum(live.sg * coalesce((i->>'total')::numeric, 0)) desc limit 50) q), '[]'),
    'recent', coalesce((select jsonb_agg(d order by d->>'time' desc) from (
        select jsonb_build_object('time', transaction_time, 'invoice', case when rpt then 'Daily summary' else invoice_number end,
               'store', store, 'type', transaction_type, 'cancelled', is_cancelled, 'total', total, 'count', txn_count,
               'items', case when rpt then jsonb_array_length(t.items) || ' products · ' || txn_count || ' receipts'
                        else (select string_agg(coalesce(pr.name, i->>'productId') || ' ×' || coalesce(i->>'quantity', '1'), ', ')
                                from jsonb_array_elements(t.items) i left join sh_products pr on pr.id = i->>'productId') end,
               'method', (select string_agg(distinct pm->>'paymentMethod', ', ') from jsonb_array_elements(t.payments) pm)) d
          from t order by transaction_time desc limit 300) q), '[]')
  ) into v;
  return v;
end $$;

create or replace function public.exec_fnb(p_year int)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'synced_at', (select max(synced_at) from sh_transactions),
    'first_date', (select min(business_date) from sh_transactions),
    'months', coalesce((select jsonb_agg(jsonb_build_object('year', y, 'month', m, 'net', net, 'gross', gross,
                 'service_charge', sc, 'charge_to_room', ctr, 'sales', n) order by y, m) from (
        select extract(year from business_date)::int y, extract(month from business_date)::int m,
               round(sum(public.sh_sign(x) * (total - tax - service_charge)), 2) net,
               round(sum(public.sh_sign(x) * total), 2) gross,
               round(sum(public.sh_sign(x) * service_charge), 2) sc,
               round(sum(public.sh_sign(x) * (select coalesce(sum((pm->>'amount')::numeric), 0) from jsonb_array_elements(x.payments) pm
                                               where pm->>'paymentMethod' ilike '%room%')), 2) ctr,
               sum(txn_count) filter (where public.sh_sign(x) = 1) n
          from public.sh_rows(make_date(p_year - 3, 1, 1), make_date(p_year, 12, 31)) x
         group by 1, 2) q), '[]'))
$$;
