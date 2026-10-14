/* FMD v2 — mesin Cost of Sales (paritas dgn FMD lama: DML_Cost_Daily + Consumption_Master + CK manual FG). */
"use strict";

const COST_TABS = ["DML_Cost_Daily", "Consumption_Master", "DML_Gas_Daily", "CK_FG_Transfer", "CK_FG_Production"];
// set tab per halaman: muat seperlunya (Consumption_Master ~58k baris berat; Summary cukup agregat harian Consumption_Agg)
const COST_SETS = {
  summary: ["DML_Cost_Daily", "Consumption_Agg", "DML_Gas_Daily", "CK_FG_Transfer"],
  dml: ["DML_Cost_Daily", "DML_Gas_Daily", "DML_Cadence"],
  full: COST_TABS,
};
const COST_BASE_TABS = ["Revenue_Master", "Forecast_Output", "DIM_UNIT", "DIM_TANGGAL"];
const STORE_UNITS = ["PLD", "PLS", "PLMT", "CK", "TSMB"];          // unit ber-store (sumber SR/transfer)
const FG_CK_PREFIX = ["1117", "1118", "1119", "1120", "1121"];       // = FG_Master template CK
const COST_TGT = { SUM: { F: 0.29, B: 0.29 }, DML: { F: 0.14, B: 0.14 }, SRT: { F: 0.15, B: 0.15 } };
const LEAD_TIME_MIN = 4;                                             // hari; periode lebih pendek -> rasio bias naik

const Cost = {
  _done: new WeakSet(), _ck: null,
  async load(set = "summary") {
    const t0 = performance.now();
    const r = await Data.load(COST_SETS[set].concat(COST_BASE_TABS));
    // server lama belum punya tab Consumption_Agg -> pakai Consumption_Master (lebih lambat, hasil sama)
    if (set === "summary" && r.missing.some(x => x.tab === "Consumption_Agg")) {
      const r2 = await Data.load(["Consumption_Master"]); r.missing = r.missing.filter(x => x.tab !== "Consumption_Agg").concat(r2.missing);
    }
    this.prep();
    console.info(`[FMD] cost load (${set}) ${Math.round(performance.now() - t0)} ms`);
    return r;
  },
  /** sumber konsumsi: agregat harian bila ada, else baris detail */
  consSrc() { const a = STATE.data.Consumption_Agg; return a && a.length ? a : (STATE.data.Consumption_Master || []); },
  /** normalisasi kode unit + tanggal; per objek array (Data.load bisa mengganti array kapan saja) */
  prep() {
    const once = (tab, fn) => { const a = STATE.data[tab]; if (!a || this._done.has(a)) return false; a.forEach(fn); this._done.add(a); return true; };
    let ch = false;
    ch = once("DML_Cost_Daily", r => { r.Unit = Dim.norm(r.Unit); r._d = dstr(r.Tanggal); }) || ch;
    ch = once("DML_Gas_Daily", r => { r.Unit = Dim.norm(r.Unit); r._d = dstr(r.Tanggal); }) || ch;
    const consFix = r => { r.Unit_Beban = Dim.norm(r.Unit_Beban) || Dim.fromStorage(r.Storage_Raw); r.Unit_Sumber = Dim.norm(r.Unit_Sumber); r._d = dstr(r.Tanggal); };
    ch = once("Consumption_Master", consFix) || ch;
    ch = once("Consumption_Agg", consFix) || ch;
    if (this._ck !== STATE.data.CK_FG_Transfer) {
      this._ck = STATE.data.CK_FG_Transfer;
      STATE.data.CK_FG_Rows = (this._ck || []).map(r => ({ Tanggal: r.Date, _d: dstr(r.Date), Unit_Beban: Dim.norm(r.Unit), Unit_Sumber: "CK",
        Tipe: "TRANSFER", ArtNo: String(r.Art_No || ""), Description: r.Description, Kategori: "FOOD", Qty: Number(r.Qty) || 0, Amount: Number(r.Amount) || 0, Flag_Status: "", Src: "MANUAL" }));
      ch = true;
    }
    if (ch) memoClear();
  },
  /** kunci tampilan unit = cost group (mis. PLCS+PKJ); CK tetap CK */
  key(u) { return COST_CENTER_ONLY.has(u) ? u : Dim.costGroup(u); },
  members(k) { return COST_CENTER_ONLY.has(k) ? [k] : Dim.groupMembers(k); },
  /** semua kunci unit yg punya data cost di sumber (sebelum filter tampil) */
  allKeys() {
    return memo("cost|keys", () => [...new Set([
      ...(STATE.data.DML_Cost_Daily || []).map(r => r.Unit),
      ...this.consSrc().map(r => r.Unit_Beban)].filter(Boolean).map(u => this.key(u)))]);
  },
  /** tampil? = dimonitor DIM_UNIT & punya Cost_Data_Since (CK selalu). Mengembalikan alasan bila tidak. */
  hidden(k) { if (COST_CENTER_ONLY.has(k)) return ""; const m = this.members(k); return m.some(u => Dim.costSince(u)) ? "" : (m.some(u => Dim.monitored(u)) ? "nodata" : "unmonitored"); },
  since(k) { return this.members(k).map(u => Dim.costSince(u)).filter(Boolean).sort()[0] || ""; },
  order(k) { return Math.min(...this.members(k).map(u => Dim.unitOrder(u))); },
  cluster(k) { return COST_CENTER_ONLY.has(k) ? "" : Dim.clusterOf(this.members(k)[0]); },
  name(k) { return this.members(k).map(u => Dim.unitName(u)).filter(Boolean).join(" / "); },
  target(src, cat, rf, rb) { const T = COST_TGT[src || "SUM"]; if (cat === "F") return T.F; if (cat === "B") return T.B;
    return rf + rb > 0 ? (T.F * rf + T.B * rb) / (rf + rb) : (T.F + T.B) / 2; },
  band(p, tgt) { if (p == null) return "none"; const r = p / tgt; return r > 1 ? "crit" : r > 0.95 ? "warn" : r > 0.9 ? "caution" : "ok"; },

  /* ---------- revenue per kunci (actual s.d. tgl terakhir unit, sesudahnya forecast snapshot terbaru) ---------- */
  rev(k, from, to) { return memo(`cost|rev|${k}|${from}|${to}`, () => this._rev(k, from, to)); },
  _rev(k, from, to) {
    const uset = new Set(this.members(k)), act = {}; let lastAct = "";
    (STATE.data.Revenue_Master || []).forEach(r => { if (!uset.has(String(r.Unit || "").trim())) return; const d = dstr(r.Tanggal); if (d < from || d > to) return;
      const a = (act[d] = act[d] || { food: 0, bev: 0 }); a.food += Number(r.Food) || 0; a.bev += Number(r.Beverage) || 0; if (d > lastAct) lastAct = d; });
    const best = {};
    (STATE.data.Forecast_Output || []).forEach(r => { if (!uset.has(String(r.Unit || "").trim())) return; const td = dstr(r.Target_Date); if (td < from || td > to) return;
      const kk = (r.Outlet || "") + "|" + td, sd = dstr(r.Snapshot_Date); if (!best[kk] || sd > best[kk]._sd) best[kk] = { r, _sd: sd }; });
    const fc = {}; Object.values(best).forEach(({ r }) => { const td = dstr(r.Target_Date), a = (fc[td] = fc[td] || { food: 0, bev: 0, event: 0 });
      a.food += Number(r.Food_Reg) || 0; a.bev += Number(r.Bev_Reg) || 0; a.event += Number(r.Event) || 0; });
    let food = 0, bev = 0, nAct = 0, nFc = 0; const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      let f, b, isFc = false;
      if (lastAct && d <= lastAct) { const a = act[d] || { food: 0, bev: 0 }; f = a.food; b = a.bev; nAct++; }   // aktual: Event sudah termasuk Food/Bev
      else { const a = fc[d]; if (!a) continue; f = a.food + a.event; b = a.bev; isFc = true; nFc++; }       // forecast: Event aditif
      food += f; bev += b; days.push({ d, rev: f + b, f, b, fc: isFc });
    }
    return { revFood: food, revBev: bev, revTot: food + bev, nAct, nFc, lastAct, days };
  },

  /* ---------- agregat ---------- o = {from,to,keys:Set,gas,fgManual} ---------- */
  sig(o) { return [o.from, o.to, [...o.keys].sort().join(","), o.gas, o.fgManual].join("|"); },
  inKeys(o, u) { return o.keys.has(this.key(u)); },
  dml(o) { return memo("cost|dml|" + this.sig(o), () => {
    const U = {}, rel = { RELIABLE: 0, INDICATIVE: 0, INCOMPLETE: 0 }, day = {};
    (STATE.data.DML_Cost_Daily || []).forEach(r => { const u = r.Unit; if (!u || !this.inKeys(o, u) || !(r._d >= o.from && r._d <= o.to)) return;
      const k = this.key(u), b = String(r.Bucket || "").toUpperCase(), a = Number(r.Amount) || 0, rl = String(r.Reliability || "").toUpperCase();
      const x = (U[k] = U[k] || { K: 0, B: 0, E: 0, G: 0, inc: 0, ind: 0 });
      if (b === "KITCHEN") x.K += a; else if (b === "BAR") x.B += a; else if (b === "EVENT") x.E += a;
      if (rl === "INCOMPLETE") x.inc += a; else if (rl === "INDICATIVE") x.ind += a; rel[rl] = (rel[rl] || 0) + a;
      const dd = ((day[k] = day[k] || {})[r._d] = day[k][r._d] || { K: 0, B: 0, E: 0 });
      if (b === "KITCHEN") dd.K += a; else if (b === "BAR") dd.B += a; else if (b === "EVENT") dd.E += a; });
    // gas (LPG) dikeluarkan dari Kitchen kecuali dicentang
    const gas = {};
    (STATE.data.DML_Gas_Daily || []).forEach(r => { if (!this.inKeys(o, r.Unit) || !(r._d >= o.from && r._d <= o.to)) return; const k = this.key(r.Unit), a = Number(r.Amount) || 0;
      gas[k] = (gas[k] || 0) + a; ((day[k] = day[k] || {})[r._d] = day[k][r._d] || { K: 0, B: 0, E: 0 }).G = (day[k][r._d].G || 0) + a; });
    Object.entries(U).forEach(([k, x]) => { x.G = gas[k] || 0; if (!o.gas) x.K = Math.max(0, x.K - x.G); });
    if (!o.gas) Object.values(day).forEach(dd => Object.values(dd).forEach(v => { if (v.G) v.K = Math.max(0, v.K - v.G); }));
    return { U, rel, day };
  }); },
  consFilter(r, o) {
    const kat = String(r.Kategori || "").toUpperCase(); if (kat !== "FOOD" && kat !== "BEVERAGE") return false;
    const u = r.Unit_Beban; if (!u || !this.inKeys(o, u) || !(r._d >= o.from && r._d <= o.to)) return false;
    const fromStore = STORE_UNITS.includes(String(r.Unit_Sumber || "").trim());
    return STORE_UNITS.includes(u) || (String(r.Tipe || "").toUpperCase() === "TRANSFER" && fromStore);   // unit tanpa store: hanya transfer masuk
  },
  isFgCK(r) { if (r.FG !== undefined) return String(r.FG).toUpperCase() === "Y"; if (String(r.Unit_Sumber || "").trim() !== "CK") return false; const a = String(r.ArtNo || ""); return a.length === 7 && FG_CK_PREFIX.some(p => a.startsWith(p)); },
  consRows(o) { return memo("cost|consrows|" + this.sig(o), () => {
    let rows = this.consSrc().filter(r => this.consFilter(r, o) && (!o.fgManual || !this.isFgCK(r)));
    if (o.fgManual) rows = rows.concat((STATE.data.CK_FG_Rows || []).filter(r => this.consFilter(r, o)));
    return rows; }); },
  cons(o) { return memo("cost|cons|" + this.sig(o), () => {
    const U = {}, day = {}, inc = {};
    this.consRows(o).forEach(r => { const k = this.key(r.Unit_Beban), c = String(r.Kategori).toUpperCase() === "BEVERAGE" ? "B" : "K", a = Number(r.Amount) || 0;
      (U[k] = U[k] || { K: 0, B: 0 })[c] += a; ((day[k] = day[k] || {})[r._d] = day[k][r._d] || { K: 0, B: 0 })[c] += a;
      if (String(r.Flag_Status || "").toUpperCase() === "INCOMPLETE") inc[k] = true; });
    return { U, day, inc }; }); },
  /** ringkasan per unit: DML + SR/Trf (dua aliran terpisah, tidak dobel) */
  summary(o) { return memo("cost|sum|" + this.sig(o), () => {
    const D = this.dml(o), C = this.cons(o), rows = [];
    new Set([...Object.keys(D.U), ...Object.keys(C.U)]).forEach(k => {
      if (this.hidden(k)) return;
      const d = D.U[k] || { K: 0, B: 0, E: 0, G: 0, inc: 0, ind: 0 }, c = C.U[k] || { K: 0, B: 0 }, rv = this.rev(k, o.from, o.to);
      const dF = d.K + d.E, dB = d.B, cF = c.K, cB = c.B, F = dF + cF, B = dB + cB, tot = F + B;
      rows.push({ unit: k, name: this.name(k), ck: COST_CENTER_ONLY.has(k), since: this.since(k),
        K: d.K + c.K, Bk: d.B + c.B, E: d.E, dmlK: d.K, dmlB: d.B, dmlE: d.E, consK: c.K, consB: c.B,
        dml: dF + dB, srt: cF + cB, cF: F, cB: B, tot, gas: d.G,
        revFood: rv.revFood, revBev: rv.revBev, revTot: rv.revTot, nAct: rv.nAct, nFc: rv.nFc, lastAct: rv.lastAct,
        pctFood: rv.revFood > 0 ? F / rv.revFood : null, pctBev: rv.revBev > 0 ? B / rv.revBev : null, pct: rv.revTot > 0 ? tot / rv.revTot : null,
        pctDml: rv.revTot > 0 ? (dF + dB) / rv.revTot : null, pctSrt: rv.revTot > 0 ? (cF + cB) / rv.revTot : null,
        rel: d.inc > 0 ? "INCOMPLETE" : d.ind > 0 ? "INDICATIVE" : "RELIABLE", incCons: !!C.inc[k] });
    });
    return rows.sort((a, b) => this.order(a.unit) - this.order(b.unit));
  }); },
  /** total excl CK + target tertimbang revenue */
  totals(rows, src = "SUM", pick = r => r.tot, pickF = r => r.cF, pickB = r => r.cB) {
    const T = { cF: 0, cB: 0, tot: 0, rF: 0, rB: 0, rev: 0, twF: 0, twB: 0 };
    rows.forEach(r => { if (r.ck) return; T.cF += pickF(r); T.cB += pickB(r); T.tot += pick(r); T.rF += r.revFood; T.rB += r.revBev; T.rev += r.revTot;
      T.twF += COST_TGT[src].F * r.revFood; T.twB += COST_TGT[src].B * r.revBev; });
    T.pctF = T.rF > 0 ? T.cF / T.rF : null; T.pctB = T.rB > 0 ? T.cB / T.rB : null; T.pct = T.rev > 0 ? T.tot / T.rev : null;
    T.tgtF = T.rF > 0 ? T.twF / T.rF : COST_TGT[src].F; T.tgtB = T.rB > 0 ? T.twB / T.rB : COST_TGT[src].B; T.tgt = T.rev > 0 ? (T.twF + T.twB) / T.rev : (COST_TGT[src].F + COST_TGT[src].B) / 2;
    return T;
  },
  /** seri harian (excl CK): cost DML, SR/Trf, revenue (+flag forecast) */
  daily(o, keys) { return memo("cost|day|" + this.sig(o) + "|" + keys.join(","), () => {
    const D = this.dml(o), C = this.cons(o), out = {};
    for (let d = o.from; d <= o.to; d = addDays(d, 1)) out[d] = { dml: 0, srt: 0, rev: 0, fc: false };
    keys.forEach(k => {
      Object.entries(D.day[k] || {}).forEach(([d, v]) => { if (out[d]) out[d].dml += v.K + v.B + v.E; });
      Object.entries(C.day[k] || {}).forEach(([d, v]) => { if (out[d]) out[d].srt += v.K + v.B; });
      this.rev(k, o.from, o.to).days.forEach(x => { if (out[x.d]) { out[x.d].rev += x.rev; if (x.fc) out[x.d].fc = true; } });
    });
    return out;
  }); },
  /** tanggal terakhir data cost per kunci (DML / SR) */
  lastDates() { return memo("cost|last", () => {
    const o = {};
    (STATE.data.DML_Cost_Daily || []).forEach(r => { const k = this.key(r.Unit), x = (o[k] = o[k] || { dml: "", srt: "" }); if (r._d > x.dml) x.dml = r._d; });
    this.consSrc().forEach(r => { if (!r.Unit_Beban) return; const k = this.key(r.Unit_Beban), x = (o[k] = o[k] || { dml: "", srt: "" }); if (r._d > x.srt) x.srt = r._d; });
    return o; }); },
};

/* ---------- Detail DML (getDMLDetail): satu panggilan per rentang, cache per bulan + versi (IDB) ---------- */
const DmlDetail = {
  byMonth: null, ver: null, at: 0, failed: [],
  async ensure(months) {
    if (!this.byMonth) { const c = await IDB.get("dml|detail");
      if (c && Date.now() - c.at < CFG.CACHE_MAX_AGE) { this.byMonth = c.byMonth; this.ver = c.ver; this.at = c.at; } else this.byMonth = {}; }
    const have = months.every(m => this.byMonth[m]);
    const r = await api({ action: "getDMLDetail", token: STATE.token, from: months[0] + "-01", to: monthEnd(months[months.length - 1]), known: (have && this.ver) || null });
    if (!r.ok) { this.failed = months; throw new Error(r.error || "getDMLDetail"); }
    this.failed = [];
    if (r.unchanged) return;
    if (r.ver !== this.ver) { this.byMonth = {}; this.at = Date.now(); }
    months.forEach(m => (this.byMonth[m] = []));
    rowsToObjs(r.headers, r.rows).forEach(o => { const m = dstr(o.Tanggal).slice(0, 7); (this.byMonth[m] = this.byMonth[m] || []).push(o); });
    this.ver = r.ver || null;
    if (r.ver) IDB.set("dml|detail", { ver: r.ver, at: this.at || Date.now(), byMonth: this.byMonth });
    memoClear();
  },
  loaded() { return Object.keys(this.byMonth || {}).sort(); },
  /** baris ternormalisasi untuk bulan termuat */
  rows(months) {
    const out = [];
    months.forEach(m => (this.byMonth && this.byMonth[m] || []).forEach(r => {
      if (!r._n) { r._d = dstr(r.Tanggal); r.Unit = Dim.norm(r.Unit); r._k = Cost.key(r.Unit); r.Bucket = String(r.Bucket || "").toUpperCase();
        r.Qty = Number(r.Qty) || 0; r._amt = r.Amount === "" || r.Amount == null ? null : Number(r.Amount) || 0; r._p = Number(r.Harga) || 0;
        r._spike = r.Spike === true || /^(true|spike)/i.test(String(r.Spike)); r._n = 1; }
      out.push(r); }));
    return out;
  },
};
const cadKey = (u, mid, item) => String(u).trim() + "|" + (mid !== "" && mid != null ? mid : item);
function cadenceMap() { return memo("cost|cad", () => { const m = {}; (STATE.data.DML_Cadence || []).forEach(r => { m[cadKey(Dim.norm(r.Unit), r.Mapping_ID, r.Nama_Item)] = r; }); return m; }); }
