-- =============================================================================
-- booking-v82: campaigns without a promotion + email layouts
--
-- * offer.kind 'none' = a plain email blast: no discount code is created, no
--   offer box in the email, and no expiry date is needed.
-- * offer.layout (classic | letter | spotlight | news) is stored inside the
--   offer JSON and read by the campaigns edge function; no column needed.
-- Changes: campaign_save (accepts 'none'), campaign_launch (no codes for 'none').
-- =============================================================================

create or replace function campaign_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_status text; v_who text := coalesce(auth.jwt() ->> 'email', 'system');
  o jsonb := coalesce(p->'offer', '{}'::jsonb); v_kind text;
begin
  perform campaign_guard();
  v_kind := coalesce(o->>'kind', 'percent');
  if v_kind not in ('percent', 'fixed', 'perk', 'none') then raise exception 'Offer type must be percent, fixed, perk or none'; end if;
  if v_kind = 'percent' and not (coalesce((o->>'percent')::numeric, 0) > 0 and (o->>'percent')::numeric <= 100) then raise exception 'Enter a percent between 1 and 100'; end if;
  if v_kind = 'fixed' and not (coalesce((o->>'amount')::numeric, 0) > 0) then raise exception 'Enter the peso amount off'; end if;
  if v_kind = 'perk' and nullif(trim(coalesce(o->>'perk', '')), '') is null then raise exception 'Describe the freebie'; end if;
  if o ? 'layout' and coalesce(o->>'layout', '') not in ('classic', 'letter', 'spotlight', 'news') then o := o - 'layout'; end if;
  if nullif(trim(coalesce(p->>'name', '')), '') is null then raise exception 'Give the campaign a name'; end if;
  if v_id is not null then
    select status into v_status from campaigns where id = v_id for update;
    if not found then raise exception 'Campaign not found'; end if;
    if v_status not in ('suggested', 'draft', 'paused') then raise exception 'A % campaign can''t be edited', v_status; end if;
    update campaigns set
      name = trim(p->>'name'),
      status = case when v_status = 'suggested' then 'draft' else v_status end,
      rationale = coalesce(p->>'rationale', rationale),
      audience = coalesce(p->'audience', audience), audience_label = coalesce(p->>'audience_label', audience_label),
      offer = o, code_prefix = upper(nullif(regexp_replace(coalesce(p->>'code_prefix', ''), '[^A-Za-z0-9]', '', 'g'), '')),
      expires_on = nullif(p->>'expires_on', '')::date,
      subject = p->>'subject', headline = p->>'headline', body = p->>'body', cta_label = p->>'cta_label',
      updated_at = now(), updated_by = v_who
    where id = v_id;
  else
    insert into campaigns (name, status, source, rationale, audience, audience_label, offer, code_prefix, expires_on, subject, headline, body, cta_label, created_by, updated_by)
    values (trim(p->>'name'), 'draft', 'staff', p->>'rationale', coalesce(p->'audience', '{}'::jsonb), p->>'audience_label', o,
      upper(nullif(regexp_replace(coalesce(p->>'code_prefix', ''), '[^A-Za-z0-9]', '', 'g'), '')),
      nullif(p->>'expires_on', '')::date, p->>'subject', p->>'headline', p->>'body', p->>'cta_label', v_who, v_who)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function campaign_save(jsonb) from public, anon;
grant execute on function campaign_save(jsonb) to authenticated, service_role;

create or replace function campaign_launch(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c campaigns%rowtype; o jsonb; v_who text := coalesce(auth.jwt() ->> 'email', 'system'); n int := 0; g record; v_code text;
  v_today date := (now() at time zone 'Asia/Manila')::date; v_kinds text[]; v_promo boolean;
begin
  perform campaign_guard();
  select * into c from campaigns where id = p_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if c.status not in ('suggested', 'draft') then raise exception 'This campaign is already %', c.status; end if;
  if nullif(trim(coalesce(c.subject, '')), '') is null or nullif(trim(coalesce(c.body, '')), '') is null then raise exception 'Add the email subject and message first'; end if;
  o := c.offer;
  v_promo := coalesce(o->>'kind', 'percent') <> 'none';
  if v_promo and (c.expires_on is null or c.expires_on < v_today) then raise exception 'Set an offer expiry date in the future'; end if;
  v_kinds := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(o->'booking_kinds') = 'array' then o->'booking_kinds' else '["overnight"]'::jsonb end) x
                       where x in ('overnight', 'day_trip')), array['overnight']);
  for g in select gp.email, gp.name from guest_profiles gp where campaign_rule_match(gp, c.audience) order by gp.spend desc loop
    v_code := null;
    if v_promo then
      v_code := campaign_new_code(coalesce(c.code_prefix, 'VBR'));
      insert into discount_codes (code, label, applies_to, discount_kind, percent, amount_off, perk, min_room_total, starts_on, expires_on, active, note,
        booking_kinds, stay_from, stay_to, min_nights, max_uses, once_per_guest, campaign_id, assigned_email, created_by)
      values (v_code, left(c.name, 120),
        case when coalesce(o->>'kind', 'percent') = 'perk' then 'all'
             when (o->>'applies_to') in ('rooms', 'add_ons', 'all') then
               case when o->>'applies_to' = 'add_ons' and v_kinds <> array['overnight'] then 'all' else o->>'applies_to' end
             else 'all' end,
        coalesce(o->>'kind', 'percent'),
        case when coalesce(o->>'kind', 'percent') = 'percent' then (o->>'percent')::numeric end,
        case when o->>'kind' = 'fixed' then (o->>'amount')::numeric end,
        case when o->>'kind' = 'perk' then trim(o->>'perk') end,
        coalesce(nullif(o->>'min_total', '')::numeric, 0), v_today, c.expires_on, true,
        'Campaign "' || left(c.name, 80) || '" — personal code for ' || g.email,
        v_kinds, nullif(o->>'stay_from', '')::date, nullif(o->>'stay_to', '')::date, coalesce(nullif(o->>'min_nights', '')::int, 0),
        1, false, c.id, g.email, v_who);
    end if;
    insert into campaign_recipients (campaign_id, email, name, code) values (c.id, g.email, g.name, v_code);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'No guests match this audience'; end if;
  update campaigns set status = 'sending', launched_at = now(), launched_by = v_who, est_recipients = n, updated_at = now(), updated_by = v_who where id = p_id;
  return jsonb_build_object('id', p_id, 'recipients', n, 'codes', v_promo);
end;
$$;
revoke all on function campaign_launch(uuid) from public, anon;
grant execute on function campaign_launch(uuid) to authenticated, service_role;
