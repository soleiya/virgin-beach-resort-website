/* ==========================================================================
   Booking form configuration
   --------------------------------------------------------------------------
   This site's booking form talks directly to a Supabase project you own —
   a real, free database, not a spreadsheet or an email inbox. Every
   request becomes a row with a real status (Pending, Pending Payment,
   Confirmed, Declined, Completed) that your team updates as they work it.

   Full setup instructions (about 10 minutes, one-time) are in
   SETUP-BOOKING.md at the root of this project. Short version:
     1. Create a free project at https://supabase.com
     2. Run the SQL in SETUP-BOOKING.md (SQL Editor tab) to create the
        booking_requests table.
     3. In Project Settings → API, copy your Project URL and the
        "anon public" key.
     4. Paste them below.

   The anon key is SAFE to publish here — it is meant to be public. Per the
   Row Level Security policy set up in SETUP-BOOKING.md, it can only ever
   INSERT new booking requests. It cannot read, edit, or delete anything —
   only you, logged into your Supabase dashboard, can do that.

   Until this is filled in, the form still works for guests — it falls back
   to opening their email app with the request pre-filled — so no request
   is ever lost while you finish setup.
   ========================================================================== */
window.SUPABASE_CONFIG = {
  url: "https://dokscqjvqtyhecmbshqd.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRva3NjcWp2cXR5aGVjbWJzaHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTQzNDksImV4cCI6MjEwMzA5MDM0OX0.DbnnSokdaT_4E48LvgxG5An-xqVKGnxKjAVGrR-YLvk",
  fallbackEmail: "reservations@virginbeachresort.com",
};
