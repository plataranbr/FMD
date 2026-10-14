/* FMD v2 — data Penjualan Menu: muat sekali semua unit (agg + harian + item), cache IDB per versi data. */
"use strict";

const MENU_CHUNK = 6;                                   // batas server menuItems per request
// Sumber = SALES ITEM: "PLS" hanya muncul di bulan dari file bulanan POS (Tigadari+Pidari belum terpisah); EVENT = sheet event eksternal
const MENU_UNIT_LABEL = { PLS: () => t("PLS (Tigadari + Pidari combined)"), EVENT: () => t("External events") };
const menuUnitLabel = u => MENU_UNIT_LABEL[u] ? MENU_UNIT_LABEL[u]() : u;
const MENU_EVENT_CG = "Event & Package";
const isEventItem = r => r.g === "EVENT" || r.cg === MENU_EVENT_CG;
const mnum = v => Number(String(v ?? "").replace(/,/g, "")) || 0;

const Menu = {
  loaded: false, ver: "", agg: [], daily: [], items: [], months: [], units: [], cluster: {}, map: {}, warn: [],
  _p: null, _cb: null,
  /** satu proses muat berjalan sekaligus; pemanggil kedua menunggu hasil yang sama */
  load(onProgress) {
    this._cb = onProgress || this._cb;
    if (!this._p) this._p = this._load(m => this._cb && this._cb(m)).finally(() => { this._p = null; });
    return this._p;
  },
  async _load(onProgress) {
    await Data.load(["Menu_Category_Map", "DIM_TANGGAL"]);
    const ver = STATE.ver.Menu_Category_Map || "";
    if (this.loaded && this.ver === ver) return;
    this.buildMap();
    const c = ver ? await IDB.get("menu|data") : null;
    if (c && c.ver === ver && c.at && Date.now() - c.at < CFG.CACHE_MAX_AGE) { this.ingest(c.raw); this.ver = ver; return; }
    onProgress && onProgress(t("Loading menu summary…"));
    const [agg, daily] = await Promise.all([api({ action: "menuAgg", token: STATE.token }), api({ action: "menuDaily", token: STATE.token })]);
    if (!agg.ok) throw new Error(agg.error || "menuAgg");
    if (!daily.ok) throw new Error(daily.error || "menuDaily");
    const units = (agg.meta.units || []).map(String).sort(), chunks = [];
    for (let i = 0; i < units.length; i += MENU_CHUNK) chunks.push(units.slice(i, i + MENU_CHUNK));
    let done = 0; onProgress && onProgress(t("Loading menu items {a}/{b}…", { a: 0, b: chunks.length }));
    const res = await Promise.all(chunks.map(ch => api({ action: "menuItems", token: STATE.token, units: ch }).then(r => {
      done++; onProgress && onProgress(t("Loading menu items {a}/{b}…", { a: done, b: chunks.length })); return r; })));
    const bad = res.find(r => !r.ok); if (bad) throw new Error(bad.error || "menuItems");
    const raw = { agg: agg.data, daily: daily.data, dcols: (daily.meta && daily.meta.cols) || null, items: res.flatMap(r => r.data), units, stale: res.reduce((s, r) => s + ((r.meta && r.meta.skippedStaleMonthly) || 0), 0) };
    this.ingest(raw); this.ver = ver;
    if (ver) IDB.set("menu|data", { ver, at: Date.now(), raw });   // satu kunci saja: versi lama tertimpa
  },
  buildMap() {
    const m = {};
    (STATE.data.Menu_Category_Map || []).forEach(r => {
      const k = String(r.Main_Group || "").trim().toUpperCase() + "|" + String(r.Category || "").trim().toUpperCase();
      m[k] = { cg: String(r.Category_Group || "").trim(), fb: String(r.FB_Class || "").trim().toUpperCase(), ch: String(r.Channel || "").trim(), promo: String(r.Is_Promo || "").trim().toUpperCase() === "Y" };
    });
    this.map = m;
  },
  catInfo(g, c) { return this.map[String(g).toUpperCase() + "|" + String(c).toUpperCase()] || { cg: "", fb: "", ch: "", promo: false }; },
  ingest(raw) {
    this.agg = raw.agg.map(r => ({ m: String(r[0]).slice(0, 7), cl: String(r[1]), u: String(r[2]).trim(), g: String(r[3]).trim(), c: String(r[4]).trim(), sold: mnum(r[5]), rev: mnum(r[6]) }));
    const dc = raw.dcols || ["Date", "Cluster", "Unit", "Main_Group", "Sold", "Total_Revenue"], di = k => dc.indexOf(k), iC = di("Category");
    this.dailyHasCat = iC >= 0;
    this.daily = raw.daily.map(r => { const g = String(r[di("Main_Group")]).trim(), c = iC >= 0 ? String(r[iC] ?? "").trim() : "";
      return { d: String(r[di("Date")]).slice(0, 10), cl: String(r[di("Cluster")]), u: String(r[di("Unit")]).trim(), g, c, cg: c ? this.catInfo(g, c).cg : "",
        sold: mnum(r[di("Sold")]), rev: mnum(r[di("Total_Revenue")]) }; });
    this.items = raw.items.map(r => { const g = String(r[2]).trim(), c = String(r[3]).trim(), ci = this.catInfo(g, c);
      return { m: String(r[0]).slice(0, 7), u: String(r[1]).trim(), g, c, art: String(r[4]), menu: String(r[5] ?? "").trim(), serv: String(r[6] ?? "").trim(),
        lt: String(r[7] ?? "").trim().toUpperCase(), price: mnum(r[8]), sold: mnum(r[9]), rev: mnum(r[10]), cg: ci.cg, fb: ci.fb || g, ch: ci.ch || "", promo: ci.promo }; });
    this.cluster = {}; this.agg.forEach(r => (this.cluster[r.u] = r.cl)); this.daily.forEach(r => (this.cluster[r.u] = this.cluster[r.u] || r.cl));
    this.units = [...new Set(raw.units.concat(this.items.map(r => r.u)))].sort();
    this.months = [...new Set(this.items.map(r => r.m).concat(this.agg.map(r => r.m)))].filter(Boolean).sort();
    // cek integritas: total item per bulan harus = total agregat (selisih → data item hilang/basi di Sheet)
    const sum = (arr, k) => arr.reduce((o, r) => ((o[r.m] = (o[r.m] || 0) + r[k]), o), {});
    const ai = sum(this.agg, "rev"), ii = sum(this.items, "rev");
    this.warn = this.months.map(m => ({ m, agg: ai[m] || 0, item: ii[m] || 0 })).filter(x => Math.abs(x.agg - x.item) > Math.max(1e6, 0.005 * x.agg));
    this.stale = raw.stale || 0;
    // cek per unit-bulan: total item bulanan harus = total harian (sumber sama). Bulan yg harian-nya tak mulai dari tgl 1 dilewati.
    const dmin = this.daily.reduce((m, r) => !m || r.d < m ? r.d : m, ""), firstFull = dmin && dmin.slice(8, 10) === "01" ? dmin.slice(0, 7) : (dmin ? addMonths(dmin, 1) : "9999");
    const du = {}, iu = {}, ul = {};
    this.daily.forEach(r => { const k = r.u + "|" + r.d.slice(0, 7); du[k] = (du[k] || 0) + r.rev; if (!ul[r.u] || r.d > ul[r.u]) ul[r.u] = r.d; });
    this.items.forEach(r => { const k = r.u + "|" + r.m; iu[k] = (iu[k] || 0) + r.rev; });
    this.bad = {};
    Object.keys(iu).forEach(k => { const [u, m] = k.split("|"); if (m < firstFull) return;
      const it = iu[k], dy = du[k] || 0, diff = it - dy;
      if (Math.abs(diff) > Math.max(5e6, 0.02 * Math.max(dy, it))) this.bad[k] = { u, m, item: it, daily: dy }; });
    this.loaded = true; memoClear();
  },
  isBad(u, m) { return !!(this.bad && this.bad[u + "|" + m]); },
  dailyLast() { return this.daily.reduce((m, r) => r.d > m ? r.d : m, ""); },
};
