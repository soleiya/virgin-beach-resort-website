// Run in the signed-in StoreHub Backoffice tab (ntq.storehubhq.com). Never reload that tab.
// Adds the bridge button and window.vbrImport({ code, days }). See storehub-browser-README.md.
(function () {
  if (!document.getElementById("vbrBridgeBtn")) {
    const b = document.createElement("button");
    b.id = "vbrBridgeBtn";
    b.textContent = "VBR import: open bridge";
    b.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:999999;padding:12px 16px;background:#0f766e;color:#fff;border:0;border-radius:10px;font:600 14px sans-serif";
    b.onclick = () => { window.__vbrWin = window.open("https://virginbeachresort.com/staff/", "vbrimport"); b.textContent = window.__vbrWin ? "Bridge opened" : "Popup blocked"; };
    document.body.appendChild(b);
  }
  window.__vbrPending = window.__vbrPending || {};
  if (!window.__vbrResOn) {
    window.__vbrResOn = true;
    window.addEventListener("message", (e) => {
      if (e.origin !== "https://virginbeachresort.com" || !e.data || e.data.kind !== "vbr-ingest-result") return;
      const f = window.__vbrPending[e.data.id];
      if (f) { delete window.__vbrPending[e.data.id]; f(e.data.res); }
    });
  }
  const send = (code, p) => new Promise((res) => {
    const W = window.__vbrWin;
    if (!W || W.closed) return res({ ok: false, body: "bridge not open" });
    const id = Math.random().toString(36).slice(2);
    window.__vbrPending[id] = res;
    W.postMessage({ kind: "vbr-ingest", id, code, p }, "https://virginbeachresort.com");
    setTimeout(() => { if (window.__vbrPending[id]) { delete window.__vbrPending[id]; res({ ok: false, body: "timeout" }); } }, 30000);
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const addD = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  async function rpt(D, groupBys, measures) {
    const body = { startTime: new Date(D + "T01:00:00+08:00").toISOString(), endTime: new Date(addD(D, 1) + "T00:59:59.999+08:00").toISOString(),
      operationHours: 1, filters: [], measures, groupBys, sorts: [], page: 1, size: 1000 };
    let last = "";
    for (let a = 0; a < 5; a++) {
      try {
        const r = await fetch("/api/v2/report/sales", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (r.ok) return await r.json();
        last = "HTTP " + r.status;
        if (r.status === 401) throw new Error("signed out");
      } catch (e) { if (/signed out/.test(e.message)) throw e; last = e.message; }
      await sleep(3000 * (a + 1));
    }
    throw new Error("report failed " + D + " " + last);
  }
  window.vbrImport = async function ({ code, days }) {
    const S = (window.__vbrImp = { done: 0, total: days.length, rows: 0, sent: 0, errors: 0, failed: [], lastErr: "" });
    const products = new Map(), stores = new Set();
    for (const D of days) {
      try {
        const st = await rpt(D, ["storeName"], ["netSales", "tax", "serviceCharge", "discount", "totalTransactions", "returnsCount"]);
        const rows = (st.data || []).filter((r) => Number(r.totalTransactions) || Number(r.netSales));
        if (rows.length) {
          await sleep(600); const pr = await rpt(D, ["storeName", "parentProductTitle"], ["quantity", "netSales"]);
          await sleep(600); const pm = await rpt(D, ["storeName", "paymentMethod"], ["paymentNetSales"]);
          const buf = [];
          for (const r of rows) {
            const store = r.storename || r.storeName || "Unknown"; stores.add(store);
            const net = Number(r.netSales) || 0, tax = Number(r.tax) || 0, sc = Number(r.serviceCharge) || 0;
            const items = (pr.data || []).filter((p) => (p.storename || p.storeName) === store).map((p) => {
              const t = p.parentProductTitle || p.parentproduct_title || "—"; products.set("name:" + t, t);
              return { productId: "name:" + t, quantity: Number(p.quantity) || 0, total: Math.round((Number(p.netSales) || 0) * 100) / 100 };
            });
            const payments = (pm.data || []).filter((p) => (p.storename || p.storeName) === store).map((p) => ({
              paymentMethod: p.paymentmethod || p.paymentMethod || "Other", amount: Math.round((Number(p.paymentNetSales) || 0) * 100) / 100, count: Number(p.count) || 0 }));
            buf.push({ refId: "rpt:" + D + ":" + store, storeId: store, invoiceNumber: "Daily summary", transactionTime: D + "T12:00:00+08:00", businessDate: D,
              total: Math.round((net + tax + sc) * 100) / 100, subTotal: net, tax, serviceCharge: sc, discount: Number(r.discount) || 0,
              txnCount: Number(r.totalTransactions) || 0, returns: Number(r.returnsCount) || 0, source: "report", items, payments });
            S.rows++;
          }
          const res = await send(code, { transactions: buf });
          if (res.ok) S.sent += buf.length; else { S.errors++; S.lastErr = res.body; S.failed.push(D); }
        }
      } catch (e) { S.errors++; S.lastErr = e.message; S.failed.push(D); if (/signed out/.test(e.message)) break; }
      S.done++; await sleep(800);
    }
    const plist = [...products].map(([id, name]) => ({ id, name }));
    for (let i = 0; i < plist.length; i += 1000) await send(code, { products: plist.slice(i, i + 1000) });
    if (stores.size) await send(code, { stores: [...stores].map((s) => ({ id: s, name: s })) });
    return S;
  };
  return "ready";
})();
