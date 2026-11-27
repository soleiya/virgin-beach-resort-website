-- 2026-11-27: resumed "Weekday 10% · Everyone" (7c44f3fa). Applied once via SQL editor; kept for the record.
do $$
declare cid uuid := '7c44f3fa-e23d-4301-bd59-3ee1a8ea229e'; n_sent int; n_visit int; n_requeue int; n_codes int; n_queued int;
begin
  -- 1. already emailed (any campaign, sent or bounced)
  update campaign_recipients cr set status='skipped', error='already sent (resume 2026-11-27)'
   where cr.campaign_id=cid and cr.status in ('queued','failed')
     and exists (select 1 from campaign_recipients x where lower(trim(x.email))=lower(trim(cr.email)) and x.status in ('sent','bounced'));
  get diagnostics n_sent = row_count;
  -- 2. stayed / visited in the last 60 days (website confirmed/completed, Cloudbeds checked in/out/confirmed)
  update campaign_recipients cr set status='skipped', error='visited in last 60 days (resume 2026-11-27)'
   where cr.campaign_id=cid and cr.status in ('queued','failed')
     and lower(trim(cr.email)) in (
       select lower(trim(guest_email)) from booking_requests
        where guest_email like '%@%' and check_in between current_date-60 and current_date and status::text in ('confirmed','completed')
       union
       select lower(trim(g.email)) from cb_reservations r join cb_guest_contacts g on g.reservation_id=r.id
        where g.email like '%@%' and r.check_in between current_date-60 and current_date and not coalesce(r.deleted,false)
          and r.status in ('checked_in','checked_out','confirmed'));
  get diagnostics n_visit = row_count;
  -- switch off the codes of everyone skipped today
  update discount_codes d set active=false from campaign_recipients cr
   where cr.campaign_id=cid and cr.status='skipped' and cr.error like '%(resume 2026-11-27)' and d.code=cr.code;
  get diagnostics n_codes = row_count;
  -- the 214 that failed on Google's limit were never sent: queue them again
  update campaign_recipients set status='queued', attempts=0, error=null
   where campaign_id=cid and status='failed' and error ~* '5\.4\.5|sending limit';
  get diagnostics n_requeue = row_count;
  -- 1,500 campaign emails per rolling 24h, 500 kept for booking emails (2,000 Gmail limit)
  insert into campaign_settings(key,value) values ('daily_cap','1500'::jsonb),('mailbox_reserve','500'::jsonb)
   on conflict (key) do update set value=excluded.value;
  update campaigns set status='sending', updated_at=now(), updated_by='ai@zhostel.com (via Claude)' where id=cid and status='paused';
  select count(*) into n_queued from campaign_recipients where campaign_id=cid and status='queued';
  raise notice 'already-sent % | recent % | codes off % | requeued % | queued %', n_sent, n_visit, n_codes, n_requeue, n_queued;
end $$;
