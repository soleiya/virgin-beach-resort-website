-- ============================================================================
-- booking-v27: Contact form messages
-- The website Contact form posts to the send-contact-email Edge Function,
-- which saves each message here and emails it to reservations@ (or events@
-- for Weddings / Corporate). Guests can't read or write this table directly —
-- only the Edge Function (service role) writes; signed-in staff can read.
-- ============================================================================
create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text not null,
  country text,
  inquiry_type text not null default 'General Inquiry',
  message text not null,
  sent_to text,
  email_status text not null default 'sending' check (email_status in ('sending', 'sent', 'failed')),
  email_error text,
  message_id text,
  emailed_at timestamptz,
  ip text,
  user_agent text,
  page text
);

create index if not exists contact_messages_created on contact_messages (created_at desc);
create index if not exists contact_messages_ip_recent on contact_messages (ip, created_at desc);

alter table contact_messages enable row level security;

drop policy if exists "Staff can view contact messages" on contact_messages;
create policy "Staff can view contact messages"
  on contact_messages for select
  to authenticated
  using (true);
-- No insert/update policy for anon/authenticated: only the Edge Function writes.

-- Check (should return 0 rows on a fresh install):
select count(*) as contact_messages from contact_messages;
