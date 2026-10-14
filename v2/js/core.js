/* FMD v2 — core: config, API, cache, formatters, DIM_UNIT helpers. Tanpa DOM halaman. */
"use strict";

const CFG = {
  API_URL: "https://script.google.com/macros/s/AKfycbyit7vuZRUUcSljj6nq-74WrKnWipU6DKNYw2uoqfZyQcYnVYVdUmL5iXYm5tE39teUzA/exec",
  GOOGLE_CLIENT_ID: "551623373117-uumtu4ortk0r2vtjhe19trbun7tvvfe3.apps.googleusercontent.com", // bukan rahasia
  CLASSIC_URL: "../",
  CACHE_MAX_AGE: 12 * 3600 * 1000,
  SESSION_KEY: "fmd.v2.session",
  THEME_KEY: "fmd.v2.theme",
};

const STATE = { token: null, name: "", role: "", email: "", allowed: null, data: {}, ver: {}, lastActualDate: "" };

/* ---------- storage aman (private mode / blocked storage tidak boleh mematikan app) ---------- */
const Store = {
  get(area, k) { try { return window[area].getItem(k); } catch (e) { return null; } },
  set(area, k, v) { try { window[area].setItem(k, v); } catch (e) {} },
  del(area, k) { try { window[area].removeItem(k); } catch (e) {} },
};

/* ---------- API ---------- */
const SESSION_ERR = /Sesi tidak valid|kadaluarsa|Login ulang/i;
async function api(payload) {
  const t0 = performance.now();
  const res = await fetch(CFG.API_URL, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload), redirect: "follow",
  });
  const txt = await res.text();
  console.debug("[api]", payload.action, Math.round(performance.now() - t0) + "ms", Math.round(txt.length / 1024) + "KB");
  let r;
  try { r = JSON.parse(txt); } catch (e) { throw new Error("Server returned an unreadable response."); }
  if (r && r.ok === false && SESSION_ERR.test(r.error || "") && payload.action !== "login") {
    document.dispatchEvent(new CustomEvent("fmd:session-expired"));
  }
  return r;
}
function allowedTab(tab) { return STATE.allowed === "ALL" || (Array.isArray(STATE.allowed) && STATE.allowed.includes(tab)); }

/* ---------- IndexedDB cache (sama dengan FMD live) ---------- */
const IDB = (() => {
  let dbp = null;
  function db() {
    return dbp || (dbp = new Promise((res, rej) => {
      try { const q = indexedDB.open("fmd-cache", 1);
        q.onupgradeneeded = () => q.result.createObjectStore("kv");
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      } catch (e) { rej(e); }
    }));
  }
  function tx(mode, fn) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction("kv", mode); const r = fn(t.objectStore("kv"));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    }));
  }
  return {
    get: k => tx("readonly", s => s.get(k)).catch(() => undefined),
    set: (k, v) => tx("readwrite", s => s.put(v, k)).catch(() => {}),
    clear: () => tx("readwrite", s => s.clear()).catch(() => {}),
  };
})();
const ckey = t => "tab|" + (STATE.name || "") + "|" + t; // format sama dgn FMD lama -> cache dipakai bersama

function rowsToObjs(headers, rows) {
  const H = headers.map(h => String(h).trim());
  return rows.filter(r => r.some(c => c !== "" && c != null))
    .map(r => { const o = {}; H.forEach((h, i) => (o[h] = r[i])); return o; });
}

/* ---------- Data loader: satu pintu untuk semua halaman ---------- */
const Data = {
  _inflight: {},
  has(t) { return t in STATE.data; },
  /** Muat tab (pakai cache versi). force=true: tetap tanya server walau sudah di memori. Return {missing:[...]} */
  async load(tabs, force) {
    const want = [...new Set(tabs)].filter(t => force || !this.has(t));
    if (!want.length) return { missing: [] };
    const key = want.slice().sort().join(",");
    if (this._inflight[key]) return this._inflight[key];
    const p = this._load(want).finally(() => delete this._inflight[key]);
    return (this._inflight[key] = p);
  },
  async _load(tabs) {
    const cached = {}, known = {};
    await Promise.all(tabs.map(async t => {
      const c = await IDB.get(ckey(t));
      if (c && c.ver && Date.now() - c.at < CFG.CACHE_MAX_AGE) { cached[t] = c; known[t] = c.ver; }
    }));
    const r = await api({ action: "getDataBatch", token: STATE.token, tabs, known });
    if (!r.ok) throw new Error(r.error || "getDataBatch failed");
    const missing = []; let changed = false;
    tabs.forEach(t => {
      const x = r.results[t];
      if (x && x.ok && x.unchanged && cached[t]) {
        if (!this.has(t) || STATE.ver[t] !== cached[t].ver) { STATE.data[t] = rowsToObjs(cached[t].headers, cached[t].rows); changed = true; }
        STATE.ver[t] = cached[t].ver; return;
      }
      if (!x || !x.ok) { missing.push({ tab: t, error: (x && x.error) || "no response" }); if (!this.has(t)) STATE.data[t] = []; return; }
      STATE.data[t] = rowsToObjs(x.headers, x.rows); STATE.ver[t] = x.ver; changed = true;
      if (x.ver) IDB.set(ckey(t), { ver: x.ver, at: Date.now(), headers: x.headers, rows: x.rows });
    });
    if (changed) { memoClear(); Dim.reset(); deriveLastActual(); document.dispatchEvent(new CustomEvent("fmd:data", { detail: { tabs } })); }
    return { missing };
  },
  loaded() { return Object.keys(STATE.data); },
};
function deriveLastActual() {
  const rev = STATE.data.Revenue_Master; if (!rev) return;
  let m = ""; rev.forEach(r => { const d = dstr(r.Tanggal); if (d > m) m = d; });
  STATE.lastActualDate = m;
}

/* ---------- Memo (hasil hitung berat; dikosongkan saat data baru masuk) ---------- */
const MEMO = new Map();
function memo(k, fn) { if (MEMO.has(k)) return MEMO.get(k); if (MEMO.size > 300) MEMO.clear(); const v = fn(); MEMO.set(k, v); return v; }
function memoClear() { MEMO.clear(); }

/* ---------- Tanggal (string ISO, aman TZ) ---------- */
function dstr(v) { if (v == null) return ""; if (v instanceof Date) return v.toISOString().slice(0, 10); const s = String(v); return s.length >= 10 ? s.slice(0, 10) : s; }
const ym = v => dstr(v).slice(0, 7);
function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function monthEnd(m) { const d = new Date(m.slice(0, 7) + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); }
function addMonths(m, n) { const d = new Date(m.slice(0, 7) + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); }
function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m, long) => { const i = +m.slice(5, 7) - 1; return (long ? ["January","February","March","April","May","June","July","August","September","October","November","December"][i] : MONTHS[i]) + " " + m.slice(0, 4); };
const dateLabel = iso => iso ? (+iso.slice(8, 10)) + " " + MONTHS[+iso.slice(5, 7) - 1] + " " + iso.slice(0, 4) : "—";

/* ---------- Format angka (UI English; uang Bio/Mio sesuai konvensi) ---------- */
const DASH = "—";
const isNum = n => n != null && n !== "" && isFinite(n);
function fmt(n, dp) {
  if (!isNum(n)) return DASH;
  n = Number(n); const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(dp ?? 2) + " Bio";
  if (a >= 1e6) return (n / 1e6).toFixed(dp ?? 1) + " Mio";
  return Math.round(n).toLocaleString("en-US");
}
const fmtRp = (n, dp) => isNum(n) ? "Rp " + fmt(n, dp) : DASH;
const fmtInt = n => isNum(n) ? Math.round(n).toLocaleString("en-US") : DASH;
const fmtPct = (r, dp = 1) => isNum(r) ? (r * 100).toFixed(dp) + "%" : DASH;
const fmtPts = (d, dp = 1) => isNum(d) ? (d >= 0 ? "+" : "") + (d * 100).toFixed(dp) + " pts" : DASH;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Clipboard ---------- */
function copyText(txt) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt).catch(() => fallbackCopy(txt));
  fallbackCopy(txt); return Promise.resolve();
}
function fallbackCopy(txt) {
  const ta = document.createElement("textarea"); ta.value = txt; ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove();
}
/* Desimal ikut locale browser (Excel Indonesia = koma). Uang/qty dikirim integer bersih -> aman di locale apa pun. */
const DEC_SEP = (1.5).toLocaleString().replace(/\d/g, "") || ".";
function tsvCell(v, type) {
  if (v == null || v === "") return "";
  if (type === "money" || type === "int") return isNum(v) ? String(Math.round(v)) : "";
  if (type === "pct") return isNum(v) ? (v * 100).toFixed(2).replace(".", DEC_SEP) : "";
  if (type === "num") return isNum(v) ? String(v).replace(".", DEC_SEP) : "";
  return String(v).replace(/[\t\r\n]+/g, " ");
}
/** cols: [{key,label,type,get?}]; rows: array of objects. */
function toTSV(cols, rows) {
  const head = cols.map(c => c.label + (c.type === "pct" ? " (%)" : "")).join("\t");
  return [head].concat(rows.map(r => cols.map(c => tsvCell(c.get ? c.get(r) : r[c.key], c.type)).join("\t"))).join("\n");
}

/* =========================================================
   DIM_UNIT — satu-satunya sumber kode unit, cluster, alias, cost group.
   Grain DIM_UNIT = outlet (Unit bisa berulang).
   ========================================================= */
const UNIT_ALIAS_FALLBACK = { BXC: "TBXC", SMS: "TSMS", SMB: "TSMB", PIM: "TPIM" };
const MERGE_GROUPS = { PLS: ["TIGADARI", "PIDARI"], PATIO: ["PATIO", "PATB"], PLMT: ["PLMT", "RHJ"] }; // revenue: outlet -> grup tampilan
const GROUP_DISPLAY = { PATIO: "PATIO & PATB", PLMT: "PLMT & RHJ" };
const COST_CENTER_ONLY = new Set(["CK"]); // cost center, bukan outlet revenue

const Dim = {
  _x: null,
  reset() { this._x = null; },
  get x() {
    if (this._x) return this._x;
    const dim = STATE.data.DIM_UNIT || [];
    const alias = { ...UNIT_ALIAS_FALLBACK }, units = {}, outlets = {}, kw = [], clusters = new Set();
    const hasNew = dim.length > 0 && "Cost_Data_Since" in dim[0];
    dim.forEach((d, i) => {
      const u = String(d.Unit || "").trim(), o = String(d.Outlet || "").trim(); if (!u) return;
      const active = !/^(n|no|false|0|tidak)$/i.test(String(d.Aktif ?? "").trim());
      const grup = String(d.Grup || "").trim(); if (grup && active) clusters.add(grup);
      String(d.Alias || "").split(/[,;]/).map(a => a.trim()).filter(Boolean).forEach(a => (alias[a] = u));
      const k = String(d.Storage_Keyword || "").trim().toUpperCase(); if (k) kw.push([k, u]);
      if (!units[u]) units[u] = { unit: u, order: i, cluster: grup, outlets: [], names: [], active: false,
        costGroup: String(d.Cost_Group || "").trim() || u, since: d.Cost_Data_Since ? ym(d.Cost_Data_Since) : "" };
      const U = units[u]; U.active = U.active || active;
      if (o) { U.outlets.push(o); outlets[o] = { outlet: o, unit: u, cluster: grup, name: String(d.Nama_Display || o), type: d.Unit_Type || "", active }; }
      if (d.Nama_Display && !U.names.includes(d.Nama_Display)) U.names.push(String(d.Nama_Display));
    });
    const costGroups = {};
    Object.values(units).forEach(U => (costGroups[U.costGroup] = costGroups[U.costGroup] || []).push(U.unit));
    const x = { alias, units, outlets, kw, hasNew, clusters: [...clusters].sort(), costGroups };
    if (dim.length) this._x = x; // jangan cache sebelum DIM_UNIT termuat
    return x;
  },
  norm(u) { u = String(u || "").trim(); return this.x.alias[u] || u; },
  fromStorage(s) { s = String(s || "").toUpperCase(); const h = this.x.kw.find(([k]) => s.includes(k)); return h ? h[1] : ""; },
  /** Whitelist: unit di luar DIM_UNIT tidak dimonitor (PW, PBR, ...). */
  monitored(u) { return u in this.x.units || COST_CENTER_ONLY.has(u); },
  costSince(u) { const U = this.x.units[u]; return U ? U.since : ""; },
  /** Ada data cost untuk bulan m? Cost_Data_Since kosong -> tidak pernah ("No data", bukan 0%). */
  hasCost(u, m) { if (COST_CENTER_ONLY.has(u)) return true; const s = this.costSince(u); return !!s && (!m || m >= s); },
  costGroup(u) { const U = this.x.units[u]; return U ? U.costGroup : u; },
  groupMembers(g) { return this.x.costGroups[g] || [g]; },
  unitName(u) { const U = this.x.units[u]; return U ? U.names.join(" / ") : u; },
  unitOrder(u) { const U = this.x.units[u]; return U ? U.order : 999; },
  clusterOf(u) { const U = this.x.units[u]; return U ? U.cluster : ""; },
  /** Unit aktif & dimonitor, urut DIM_UNIT, opsional filter cluster. */
  unitList(cluster, opts = {}) {
    return Object.values(this.x.units)
      .filter(U => U.active && (!cluster || cluster === "ALL" || U.cluster === cluster))
      .filter(U => !opts.costOnly || U.since)
      .sort((a, b) => a.order - b.order).map(U => U.unit);
  },
  /** Daftar unit untuk halaman cost: anggota cost group digabung jadi satu kunci (mis. "PLCS+PKJ"). */
  costUnitList(cluster) {
    const seen = new Set(), out = [];
    this.unitList(cluster, { costOnly: true }).forEach(u => { const g = this.costGroup(u); if (!seen.has(g)) { seen.add(g); out.push(g); } });
    return out;
  },
  /** Revenue: outlet -> kunci tampilan (grup merge bila ada). */
  outletKey(o) { for (const g in MERGE_GROUPS) if (MERGE_GROUPS[g].includes(o)) return g; return o; },
  outletDisplay(k) { return GROUP_DISPLAY[k] || k; },
  outletList(cluster) {
    const seen = new Set(), out = [];
    Object.values(this.x.outlets).filter(O => O.active && (!cluster || cluster === "ALL" || O.cluster === cluster))
      .forEach(O => { const k = this.outletKey(O.outlet); if (!seen.has(k)) { seen.add(k); out.push(k); } });
    return out;
  },
  outletMembers(k) { return MERGE_GROUPS[k] || [k]; },
};
