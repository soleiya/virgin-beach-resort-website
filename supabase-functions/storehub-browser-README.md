# StoreHub browser import (booking-v90/v91)

The ntq StoreHub account has no API access, so sales are read from StoreHub's own
report engine inside a **signed-in Backoffice tab** and pushed to Supabase
(`sh_ingest`) through a small bridge tab on virginbeachresort.com, because the
Backoffice's Content-Security-Policy blocks direct calls to Supabase.

Important: in the StoreHub tab, **never open a page by URL or reload**. Every full
page load signs the user out. Run everything with JavaScript in the open tab.

Steps (used by the daily scheduled task):

1. Make a one-time code (expires in 3 hours) in Supabase SQL:
   ```sql
   with c as (select encode(extensions.gen_random_bytes(24), 'hex') code)
   insert into public.sh_ingest_codes (code_hash, expires_at)
   select encode(extensions.digest(code, 'sha256'), 'hex'), now() + interval '3 hours' from c
   returning (select code from c) code;
   ```
2. In the StoreHub tab, run `storehub-browser-storehub-tab.js` (it adds a button "VBR import: open bridge").
   Click that button with a real click; it opens https://virginbeachresort.com/staff/
   in a new tab.
3. In that new tab, run `storehub-browser-bridge-tab.js` (it uses the public anon key the page already loads).
4. Back in the StoreHub tab run:
   `await window.vbrImport({ code: '<code>', days: ['YYYY-MM-DD', ...] })`
   It returns `{ rows, sent, errors, failed }` and keeps progress in `window.__vbrImp`.
5. Expire the code (`update sh_ingest_codes set expires_at = now() where expires_at > now()`),
   remove the button, close the bridge tab.

Days are StoreHub business days (Manila, 1:00 AM to 1:00 AM). Each outlet-day becomes one
`rpt:<date>:<outlet>` row; re-running a day overwrites it.
