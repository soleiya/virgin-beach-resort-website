-- =============================================================================
-- booking-v89 — StoreHub POS (F&B outlets) → Supabase → staff dashboard + exec.
--
-- StoreHub (ntq.storehubhq.com) runs the restaurant / bar tills: Front Office,
-- Pavilion 1, Pavilion 2, Warehouse. These sales are NOT in Cloudbeds and NOT in
-- accounting's (Sugar's) monthly figure, so they are shown as their own line and
-- added on top of casitas + day trips.
--
-- Data flow:
--   pg_cron 'storehub-pull' (every 15 min) → sh_call('pull') → edge function
--   storehub-sync (x-webhook-secret = cb_webhook_secret(), same as cloudbeds-sync)
--   → StoreHub API (Basic auth, secrets STOREHUB_ACCOUNT + STOREHUB_API_KEY that
--   the owner adds) → sh_upsert(p) here.
--
-- Revenue basis for F&B ("net"): total − VAT − service charge, cancelled sales
-- excluded, returns subtracted, counted on the Manila date of the sale.
--
-- Tables (RLS on, no policies: only the service role / definer RPCs read them):
--   sh_stores, sh_products, sh_transactions
-- RPCs:
--   sh_upsert(jsonb)          service role — used by storehub-sync
--   sh_report(from, to)       staff (authenticated) — F&B tab on /staff/
--   exec_fnb(year)            service role — merged into /exec/ by exec-briefing
--   sh_call(action, body)     pg_cron → edge function
-- =============================================================================

create table if not exists public.sh_stores (
  id text primary key,
  name text not null,
  raw jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.sh_products (
  id text primary key,
  name text not null,
  category text,
  unit_price numeric,
  cost numeric,
  parent_id text,
  raw jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.sh_transactions (
  ref_id text primary key,
  invoice_number text,
  store_id text,
  transaction_type text not null default 'Sale',        -- 'Sale' | 'Return'
  transaction_time timestamptz not null,
  business_date date not null,                          -- Manila date of transaction_time
  total numeric not null default 0,                     -- what the guest paid (incl. VAT + service charge)
  sub_total numeric not null default 0,
  tax numeric not null default 0,
  discount numeric not null default 0,
  service_charge numeric not null default 0,
  rounded_amount numeric not null default 0,
  is_cancelled boolean not null default false,
  channel text,
  table_id text,
  employee_id text,
  customer_ref_id text,
  payments jsonb not null default '[]',
  items jsonb not null default '[]',
  raw jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists sh_transactions_date_idx on public.sh_transactions (business_date);
create index if not exists sh_transactions_store_idx on public.sh_transactions (store_id, business_date);

alter table public.sh_stores enable row level security;
alter table public.sh_products enable row level security;
alter table public.sh_transactions enable row level security;
revoke all on public.sh_stores, public.sh_products, public.sh_transactions from anon, authenticated;

-- ---------------------------------------------------------------- write (sync)
-- p = { stores: [...], products: [...], transactions: [...] } exactly as StoreHub returns them.
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
  on conflict (id) do update set name = excluded.name, category = excluded.category, unit_price = excluded.unit_price,
    cost = excluded.cost, parent_id = excluded.parent_id, raw = excluded.raw, synced_at = now();
  get diagnostics n_p = row_count;

  insert into sh_transactions (ref_id, invoice_number, store_id, transaction_type, transaction_time, business_date,
    total, sub_total, tax, discount, service_charge, rounded_amount, is_cancelled, channel, table_id, employee_id,
    customer_ref_id, payments, items, raw, synced_at)
  select t->>'refId', t->>'invoiceNumber', t->>'storeId', coalesce(nullif(t->>'transactionType', ''), 'Sale'),
         (t->>'transactionTime')::timestamptz, ((t->>'transactionTime')::timestamptz at time zone 'Asia/Manila')::date,
         coalesce(nullif(t->>'total', '')::numeric, 0), coalesce(nullif(t->>'subTotal', '')::numeric, 0),
         coalesce(nullif(t->>'tax', '')::numeric, 0), coalesce(nullif(t->>'discount', '')::numeric, 0),
         coalesce(nullif(t->>'serviceCharge', '')::numeric, 0), coalesce(nullif(t->>'roundedAmount', '')::numeric, 0),
         coalesce((t->>'isCancelled')::boolean, false), t->>'channel', t->>'tableId', t->>'employeeId',
         t->>'customerRefId', coalesce(t->'payments', '[]'), coalesce(t->'items', '[]'), t - 'items' - 'payments', now()
    from jsonb_array_elements(coalesce(p->'transactions', '[]')) t
   where coalesce(t->>'refId', '') <> '' and coalesce(t->>'transactionTime', '') <> ''
  on conflict (ref_id) do update set invoice_number = excluded.invoice_number, store_id = excluded.store_id,
    transaction_type = excluded.transaction_type, transaction_time = excluded.transaction_time,
    business_date = excluded.business_date, total = excluded.total, sub_total = excluded.sub_total, tax = excluded.tax,
    discount = excluded.discount, service_charge = excluded.service_charge, rounded_amount = excluded.rounded_amount,
    is_cancelled = excluded.is_cancelled, channel = excluded.channel, table_id = excluded.table_id,
    employee_id = excluded.employee_id, customer_ref_id = excluded.customer_ref_id, payments = excluded.payments,
    items = excluded.items, raw = excluded.raw, synced_at = now();
  get diagnostics n_t = row_count;

  return jsonb_build_object('stores', n_s, 'products', n_p, 'transactions', n_t);
end $$;

-- Signed amounts of one sale: returns count negative, cancelled sales count zero.
create or replace function public.sh_sign(t public.sh_transactions)
returns int language sql immutable as $$
  select case when t.is_cancelled then 0 when t.transaction_type = 'Return' then -1 else 1 end
$$;

-- ---------------------------------------------------------------- staff F&B tab
create or replace function public.sh_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Pick a date range'; end if;
  if p_to - p_from > 400 then raise exception 'Pick up to about a year'; end if;

  with t as (
    select x.*, public.sh_sign(x) sg, coalesce(s.name, x.store_id, '—') store
      from sh_transactions x left join sh_stores s on s.id = x.store_id
     where x.business_date between p_from and p_to
  ), live as (select * from t where sg <> 0)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'synced_at', (select max(synced_at) from sh_transactions),
    'last_pull', (select value from cb_sync_state where key = 'storehub_last_pull'),
    'totals', (select jsonb_build_object(
        'gross', round(coalesce(sum(sg * total), 0), 2),
        'net', round(coalesce(sum(sg * (total - tax - service_charge)), 0), 2),
        'tax', round(coalesce(sum(sg * tax), 0), 2),
        'service_charge', round(coalesce(sum(sg * service_charge), 0), 2),
        'discount', round(coalesce(sum(sg * discount), 0), 2),
        'sales', count(*) filter (where sg = 1),
        'returns', count(*) filter (where sg = -1),
        'cancelled', (select count(*) from t where is_cancelled),
        'items', coalesce(sum(sg * (select sum(coalesce((i->>'quantity')::numeric, 0)) from jsonb_array_elements(items) i)), 0)
      ) from live),
    'days', coalesce((select jsonb_agg(d order by d->>'date') from (
        select jsonb_build_object('date', business_date, 'gross', round(sum(sg * total), 2),
               'net', round(sum(sg * (total - tax - service_charge)), 2), 'sales', count(*) filter (where sg = 1)) d
          from live group by business_date) q), '[]'),
    'stores', coalesce((select jsonb_agg(d order by (d->>'gross')::numeric desc) from (
        select jsonb_build_object('store', store, 'gross', round(sum(sg * total), 2),
               'net', round(sum(sg * (total - tax - service_charge)), 2), 'sales', count(*) filter (where sg = 1)) d
          from live group by store) q), '[]'),
    'payments', coalesce((select jsonb_agg(d order by (d->>'amount')::numeric desc) from (
        select jsonb_build_object('method', coalesce(nullif(pm->>'paymentMethod', ''), 'Other'),
               'amount', round(sum(sg * coalesce((pm->>'amount')::numeric, 0)), 2), 'count', count(*)) d
          from live, jsonb_array_elements(payments) pm group by coalesce(nullif(pm->>'paymentMethod', ''), 'Other')) q), '[]'),
    'products', coalesce((select jsonb_agg(d order by (d->>'amount')::numeric desc) from (
        select jsonb_build_object('product', coalesce(pr.name, i->>'productId', '—'), 'category', pr.category,
               'qty', sum(live.sg * coalesce((i->>'quantity')::numeric, 0)),
               'amount', round(sum(live.sg * coalesce((i->>'total')::numeric, 0)), 2)) d
          from live, jsonb_array_elements(live.items) i left join sh_products pr on pr.id = i->>'productId'
         group by coalesce(pr.name, i->>'productId', '—'), pr.category
         order by sum(live.sg * coalesce((i->>'total')::numeric, 0)) desc limit 50) q), '[]'),
    'recent', coalesce((select jsonb_agg(d order by d->>'time' desc) from (
        select jsonb_build_object('time', transaction_time, 'invoice', invoice_number, 'store', store,
               'type', transaction_type, 'cancelled', is_cancelled, 'total', total,
               'items', (select string_agg(coalesce(pr.name, i->>'productId') || ' ×' || coalesce(i->>'quantity', '1'), ', ')
                           from jsonb_array_elements(t.items) i left join sh_products pr on pr.id = i->>'productId'),
               'method', (select string_agg(distinct pm->>'paymentMethod', ', ') from jsonb_array_elements(t.payments) pm)) d
          from t order by transaction_time desc limit 300) q), '[]')
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------- exec briefing
-- Monthly F&B net for one year (and earlier years for comparison), merged into the
-- exec-briefing response as data.fnb by the edge function.
create or replace function public.exec_fnb(p_year int)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'synced_at', (select max(synced_at) from sh_transactions),
    'first_date', (select min(business_date) from sh_transactions),
    'months', coalesce((select jsonb_agg(jsonb_build_object('year', y, 'month', m, 'net', net, 'gross', gross, 'sales', n) order by y, m) from (
        select extract(year from business_date)::int y, extract(month from business_date)::int m,
               round(sum(public.sh_sign(x) * (total - tax - service_charge)), 2) net,
               round(sum(public.sh_sign(x) * total), 2) gross,
               count(*) filter (where public.sh_sign(x) = 1) n
          from sh_transactions x
         where business_date between make_date(p_year - 3, 1, 1) and make_date(p_year, 12, 31)
         group by 1, 2) q), '[]'))
$$;

-- ---------------------------------------------------------------- cron → edge function
create or replace function public.sh_call(p_action text, p_body jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text := cb_webhook_secret();
begin
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://dokscqjvqtyhecmbshqd.supabase.co/functions/v1/storehub-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := coalesce(p_body, '{}'::jsonb) || jsonb_build_object('action', p_action),
    timeout_milliseconds := 120000
  );
exception when others then
  raise warning 'sh_call % failed: %', p_action, sqlerrm;
end $$;

revoke all on function public.sh_upsert(jsonb) from public, anon, authenticated;
revoke all on function public.sh_report(date, date) from public, anon;
revoke all on function public.exec_fnb(int) from public, anon, authenticated;
revoke all on function public.sh_call(text, jsonb) from public, anon, authenticated;
grant execute on function public.sh_upsert(jsonb) to service_role;
grant execute on function public.sh_report(date, date) to authenticated, service_role;
grant execute on function public.exec_fnb(int) to service_role;
grant execute on function public.sh_call(text, jsonb) to service_role;

-- every 15 minutes, offset from the Cloudbeds jobs
select cron.unschedule('storehub-pull') where exists (select 1 from cron.job where jobname = 'storehub-pull');
select cron.schedule('storehub-pull', '4-59/15 * * * *', $$select public.sh_call('pull')$$);
