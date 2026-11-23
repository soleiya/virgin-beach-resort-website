-- =============================================================================
-- booking-v88 — weeknight-only discount codes (Nov 2026 weekday campaign)
--
-- discount_codes.weekdays_only: when true, a 'rooms' code takes its % / ₱ off
-- the casita charges of weeknights only (Sun–Thu nights that aren't peak /
-- holiday eves). Fri, Sat and peak nights in the same stay keep the normal
-- rate. A stay with no weeknight at all is refused with a clear message.
--
-- campaign_launch copies offer.weekdays_only (true/false) into each guest's
-- personal code. campaign_save accepts the new "rooms" email layout
-- (room showcase with the fake-website safety notice, campaigns edge function v12).
--
-- quote_overnight and campaign_launch are patched in place from their live
-- definitions (each edit must match exactly once, or the script stops).
-- =============================================================================

alter table public.discount_codes add column if not exists weekdays_only boolean not null default false;
comment on column public.discount_codes.weekdays_only is
  'v88: rooms discount applies to weeknight (Sun–Thu, non-peak) casita charges only';

do $mig$
declare
  src text; out text;
  edits text[][];
  i int;
begin
  ---------------------------------------------------------------- quote_overnight
  src := pg_get_functiondef('public.quote_overnight(date,date,uuid[],integer,integer,integer,integer,integer,jsonb,boolean,text,date)'::regprocedure);
  edits := array[
    array['v_room numeric := 0; v_extra_total numeric := 0;',
          'v_room numeric := 0; v_room_wd numeric := 0; v_extra_total numeric := 0;'],
    array['v_amounts := v_amounts || jsonb_build_object(k, coalesce((v_amounts->>k)::int, 0) + 1);',
          'v_amounts := v_amounts || jsonb_build_object(k, coalesce((v_amounts->>k)::int, 0) + 1);
        if not n.weekend then v_room_wd := v_room_wd + v_rate; end if;  -- v88'],
    array['v_room := v_room + v.weekday_rate * v_wd;',
          'v_room := v_room + v.weekday_rate * v_wd;
        v_room_wd := v_room_wd + v.weekday_rate * v_wd;  -- v88'],
    array['    elsif dc.applies_to = ''add_ons'' and v_addon <= 0 then',
          '    elsif coalesce(dc.weekdays_only, false) and dc.applies_to = ''rooms'' and v_room_wd <= 0 then  -- v88
      v_code_err := ''Code '' || dc.code || '' is for weeknight stays only (Sunday to Thursday nights).'';
    elsif dc.applies_to = ''add_ons'' and v_addon <= 0 then'],
    array['        v_code_base := v_room - case when v_seniors > 0 and v_guests > 0 then round(v_room / v_guests * v_seniors, 2) else 0 end;
        v_code_label := ''off casita rates'';',
          '        v_code_base := v_room - case when v_seniors > 0 and v_guests > 0 then round(v_room / v_guests * v_seniors, 2) else 0 end;
        v_code_label := ''off casita rates'';
        if coalesce(dc.weekdays_only, false) then  -- v88: weeknight casita charges only
          v_code_base := v_room_wd - case when v_seniors > 0 and v_guests > 0 then round(v_room_wd / v_guests * v_seniors, 2) else 0 end;
          v_code_label := ''off weeknight casita rates'';
        end if;']
  ];
  out := src;
  for i in 1 .. array_length(edits, 1) loop
    if (length(out) - length(replace(out, edits[i][1], ''))) / length(edits[i][1]) <> 1 then
      raise exception 'v88 quote_overnight edit % did not match exactly once', i;
    end if;
    out := replace(out, edits[i][1], edits[i][2]);
  end loop;
  execute out;

  ---------------------------------------------------------------- campaign_launch
  src := pg_get_functiondef('public.campaign_launch(uuid)'::regprocedure);
  edits := array[
    array['min_nights, max_uses, once_per_guest, campaign_id, assigned_email, created_by)',
          'min_nights, max_uses, once_per_guest, campaign_id, assigned_email, created_by, weekdays_only)'],
    array['1, false, c.id, g.email, v_who);',
          '1, false, c.id, g.email, v_who, coalesce((o->>''weekdays_only'')::boolean, false));  -- v88']
  ];
  out := src;
  for i in 1 .. array_length(edits, 1) loop
    if (length(out) - length(replace(out, edits[i][1], ''))) / length(edits[i][1]) <> 1 then
      raise exception 'v88 campaign_launch edit % did not match exactly once', i;
    end if;
    out := replace(out, edits[i][1], edits[i][2]);
  end loop;
  execute out;

  ---------------------------------------------------------------- campaign_save
  src := pg_get_functiondef('public.campaign_save(jsonb)'::regprocedure);
  edits := array[
    array['not in (''classic'', ''letter'', ''spotlight'', ''news'')',
          'not in (''classic'', ''letter'', ''spotlight'', ''news'', ''rooms'')']
  ];
  out := src;
  for i in 1 .. array_length(edits, 1) loop
    if (length(out) - length(replace(out, edits[i][1], ''))) / length(edits[i][1]) <> 1 then
      raise exception 'v88 campaign_save edit % did not match exactly once', i;
    end if;
    out := replace(out, edits[i][1], edits[i][2]);
  end loop;
  execute out;
end
$mig$;
