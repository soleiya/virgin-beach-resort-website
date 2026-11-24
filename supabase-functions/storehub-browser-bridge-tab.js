// Run in the virginbeachresort.com tab that the StoreHub button opened. See storehub-browser-README.md.
// Uses the public anon key that the page already loads (window.SUPABASE_CONFIG, booking-config.js).
(function (ANON) {
  if (window.__vbrBridgeOn) return "already on";
  window.__vbrBridgeOn = true;
  window.addEventListener("message", async (e) => {
    if (e.origin !== "https://ntq.storehubhq.com" || !e.data || e.data.kind !== "vbr-ingest") return;
    let res;
    try {
      const r = await fetch("https://dokscqjvqtyhecmbshqd.supabase.co/rest/v1/rpc/sh_ingest", {
        method: "POST",
        headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ p_code: e.data.code, p: e.data.p }),
      });
      res = { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (err) { res = { ok: false, body: String(err) }; }
    e.source.postMessage({ kind: "vbr-ingest-result", id: e.data.id, res }, e.origin);
  });
  return "bridge ready";
})((window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || "");
