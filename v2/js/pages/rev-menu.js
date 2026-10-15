/* Revenue › Menu Sales */
"use strict";

const MSU = { exclBad: true, inclEvent: false, cluster: "ALL", units: [], from: "", to: "", group: "", cgrp: "", listing: "", basis: "rev", lvl: "unit", tbDir: "top", tbZero: true, life: "all", day: "" };
const MS_CFG = { LIFE_PCT: 0.25, LIFE_BASE: 10, PROJ_WEEKS: 8 };
const cgLabel = cg => cg || t("Unmapped");
const itemKey = r => r.u + "|" + r.menu + "|" + r.serv;
const itemName = r => r.menu + (r.serv ? " (" + r.serv + ")" : "");
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

const PLS_OUTLETS = ["TIGADARI", "PIDARI"];
function msScopeUnits() {
  const all = Menu.units.filter(u => MSU.cluster === "ALL" || Menu.cluster[u] === MSU.cluster);
  let sel = MSU.units.filter(u => all.includes(u));
  if (sel.includes("PLS")) sel = [...new Set(sel.concat(PLS_OUTLETS.filter(u => all.includes(u))))];   // PLS = Jan–Mar gabungan + Tigadari & Pidari
  return { all, sel: sel.length ? sel : all };
}
/** baris item terfilter. opts.months: override rentang; opts.noListing: abaikan filter listing */
const sel0 = () => msScopeUnits().sel;
function msItems(opts = {}) {
  const { sel } = msScopeUnits(), U = new Set(sel), from = opts.from || MSU.from, to = opts.to || MSU.to;
  return Menu.items.filter(r => U.has(r.u) && r.m >= from && r.m <= to && (!MSU.exclBad || opts.keepBad || !Menu.isBad(r.u, r.m)) && (!MSU.group || r.g === MSU.group)
    && (!MSU.cgrp || (MSU.cgrp === "__none" ? !r.cg : r.cg === MSU.cgrp)) && (opts.noListing || !MSU.listing || r.lt === MSU.listing));
}
/** item utk peringkat (top/bottom, kuadran, lifecycle): event & paket dikeluarkan kecuali dicentang */
const msRankable = rows => MSU.inclEvent ? rows : rows.filter(r => !isEventItem(r));
function msAggItems(rows) {
  const o = {};
  rows.forEach(r => { const k = itemKey(r), a = o[k] || (o[k] = { key: k, u: r.u, unit: menuUnitLabel(r.u), name: itemName(r), cat: r.c, cg: cgLabel(r.cg), g: r.g, price: 0, sold: 0, rev: 0, lt: "", m: "" });
    a.sold += r.sold; a.rev += r.rev; if (r.m >= a.m) { a.m = r.m; a.price = r.price || a.price; a.lt = r.lt || a.lt; } });
  return Object.values(o);
}

/* ---------- harian (level Main Group) ----------
   Unit melapor pada tanggal berbeda → per unit: realisasi s.d. tanggal lapor terakhirnya, sisanya diproyeksikan
   dari rata-rata hari yang sama 8 minggu terakhir unit itu. "complete" = tanggal terakhir saat SEMUA unit sudah lapor. */
function msUnitLast() {
  return memo("ms|ulast", () => { const o = {}; Menu.daily.forEach(r => { if (!o[r.u] || r.d > o[r.u]) o[r.u] = r.d; }); return o; });
}
const msDailyOk = r => (!MSU.group || r.g === MSU.group) && (!MSU.cgrp || !Menu.dailyHasCat || (MSU.cgrp === "__none" ? !r.cg : r.cg === MSU.cgrp));
function msDaily() {
  const { sel } = msScopeUnits(), rev = MSU.basis === "rev";
  const last = Menu.dailyLast(); if (!last) return null;
  const m = last.slice(0, 7), UL = msUnitLast();
  const units = sel.filter(u => UL[u] && UL[u].slice(0, 7) === m), U = new Set(units);
  if (!units.length) return null;
  const val = {}; // u -> d -> g -> v
  Menu.daily.forEach(r => { if (!U.has(r.u) || !msDailyOk(r)) return;
    const v = rev ? r.rev : r.sold, a = (val[r.u] = val[r.u] || {}), b = (a[r.d] = a[r.d] || {}); b[r.g] = (b[r.g] || 0) + v; });
  const dates = []; for (let d = m + "-01"; d.slice(0, 7) === m; d = addDays(d, 1)) dates.push(d);
  const act = {}, prj = {}, actG = {}, prjG = {};
  const add = (o, og, d, g) => { Object.entries(g).forEach(([k, v]) => { o[d] = (o[d] || 0) + v; const x = (og[d] = og[d] || {}); x[k] = (x[k] || 0) + v; }); };
  units.forEach(u => {
    const lu = UL[u], uv = val[u] || {};
    dates.forEach(d => {
      if (d <= lu) { add(act, actG, d, uv[d] || {}); return; }
      const same = []; for (let k = 1; k <= MS_CFG.PROJ_WEEKS; k++) { const x = addDays(d, -7 * k); if (x <= lu && uv[x]) same.push(x); }
      if (!same.length) return;
      const g = {}; same.forEach(x => Object.entries(uv[x]).forEach(([k, v]) => (g[k] = (g[k] || 0) + v / same.length))); add(prj, prjG, d, g);
    });
  });
  const lus = units.map(u => UL[u]).sort(), complete = lus[0], latest = lus[lus.length - 1];
  const sum = o => Object.values(o).reduce((s, v) => s + v, 0);
  const behind = units.filter(u => UL[u] <= addDays(latest, -2)).map(u => ({ u, d: UL[u] })).sort((a, b) => a.d.localeCompare(b.d));
  return { m, last, complete, latest, units, behind, dates, act, prj, actG, prjG, mtd: sum(act), projTotal: sum(act) + sum(prj),
    actual: dates.map(d => d <= latest ? (act[d] || 0) : null), proj: dates.map(d => prj[d] || null), wd: d => new Date(d + "T00:00:00Z").getUTCDay() };
}

function msBrief(D) {
  if (!D) return t("No daily menu data for this selection.");
  const rev = MSU.basis === "rev", f = v => rev ? fmtRp(v) : fmtInt(v), out = [];
  const prevM = addMonths(D.m, -1), U = new Set(D.units);   // basis sama: data harian, unit yg sama
  const prevTot = Menu.daily.reduce((s, r) => s + (U.has(r.u) && r.d.slice(0, 7) === prevM && msDailyOk(r) ? (rev ? r.rev : r.sold) : 0), 0);
  out.push(t("Menu sales recorded so far are {a}; including a projection for days not yet reported, {m} is estimated at {p}", { a: f(D.mtd), m: monthName(D.m, true), p: f(D.projTotal) }) +
    (prevTot > 0 ? t(", {x} versus {pm}.", { x: (D.projTotal >= prevTot ? "+" : "") + fmtPct(D.projTotal / prevTot - 1), pm: monthName(prevM, true) }) : "."));
  if (D.complete < D.latest) out.push(t("Units report on different dates: all {n} units are complete through {c}, the latest report is {l}; {k} two or more days behind.", { n: D.units.length, c: dateLabel(D.complete), l: dateLabel(D.latest), k: tn(D.behind.length, "{n} unit is", "{n} units are") }));
  let we = 0, all = 0, nWe = 0, nAll = 0;
  D.dates.forEach(d => { if (d > D.complete) return; const v = D.act[d] || 0; all += v; nAll++; if ([0, 6].includes(D.wd(d))) { we += v; nWe++; } });
  if (all > 0) out.push(t("Weekends contribute {a} of sales from {b} of days.", { a: fmtPct(we / all, 0), b: fmtPct(nWe / nAll, 0) }));
  const wk = (from, to) => { const g = {}; Object.entries(D.actG).forEach(([d, o]) => { if (d > from && d <= to) Object.entries(o).forEach(([k, v]) => (g[k] = (g[k] || 0) + v)); }); return g; };
  const a = wk(addDays(D.complete, -7), D.complete), b = wk(addDays(D.complete, -14), addDays(D.complete, -7));
  const mv = Object.keys(a).filter(k => b[k] > 0).map(k => ({ k, d: a[k] / b[k] - 1 })).filter(x => Math.abs(x.d) >= 0.1).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  if (mv.length) out.push(t("Seven days to {c} vs the previous seven: {l}.", { c: dateLabel(D.complete, true), l: joinList(mv.slice(0, 3).map(x => `${x.k} ${(x.d > 0 ? "+" : "") + fmtPct(x.d, 0)}`)) }));
  return out.join(" ");
}

/* ---------- lifecycle: status dari 3 bulan LENGKAP; bulan berjalan hanya ditampilkan (MTD aktual) ----------
   Data SALES ITEM hanya berisi item yang terjual -> "tidak terjual" = tidak ada baris. */
function msLifecycle() {
  const last = Menu.dailyLast(), cur = last ? last.slice(0, 7) : "";
  const curOpen = !!last && last < monthEnd(cur);
  const upto = Menu.months.filter(m => m <= MSU.to);
  const mtdM = curOpen && upto[upto.length - 1] === cur ? cur : "";
  const ms = upto.filter(m => m !== mtdM).slice(-3);
  if (!ms.length) return { ms, rows: [], badU: [], noLatest: [], mtdM };
  const latest = ms[ms.length - 1];
  const badU = new Set(sel0().filter(u => ms.some(m => Menu.isBad(u, m))));
  const has = new Set(Menu.items.filter(r => r.m === latest).map(r => r.u));          // unit tanpa data bulan terakhir: jangan dianggap "turun"
  const noLatest = sel0().filter(u => !has.has(u));
  const rows = msRankable(msItems({ from: ms[0], to: mtdM || latest, noListing: true, keepBad: true })).filter(r => has.has(r.u) && (!MSU.exclBad || !badU.has(r.u)));
  const first = {}; const { sel } = msScopeUnits(), U = new Set(sel);
  Menu.items.forEach(r => { if (!U.has(r.u)) return; const k = itemKey(r); if (!first[k] || r.m < first[k]) first[k] = r.m; });
  const o = {};
  // item yg ganti nama/PLU di POS (mis. PLD recode Okt) jangan dianggap "berhenti": cek juga PLU & nama ternormalisasi
  const nn = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, ""), soldBy = {};
  rows.forEach(r => { if (r.sold <= 0) return; const x = (soldBy[r.m] = soldBy[r.m] || new Set()); x.add(r.u + "#" + r.art); x.add(r.u + "@" + nn(r.menu)); });
  rows.forEach(r => { const k = itemKey(r), a = o[k] || (o[k] = { key: k, u: r.u, unit: menuUnitLabel(r.u), name: itemName(r), cat: r.c, per: {}, lt: "", ids: new Set() });
    a.per[r.m] = (a.per[r.m] || 0) + r.sold; a.ids.add(r.u + "#" + r.art); a.ids.add(r.u + "@" + nn(r.menu)); if (r.m !== mtdM || !a.lt) a.lt = r.lt || a.lt; });
  const aliveIn = (a, m) => !!soldBy[m] && [...a.ids].some(id => soldBy[m].has(id));
  const L = { rise: t("Rising"), dec: t("Declining"), dead: t("Stopped selling"), ghost: t("Delisted, still selling"), fresh: t("New"), stable: t("Stable") };
  const list = Object.values(o).map(a => {
    const v = ms.map(m => a.per[m] || 0), base = v[0], lv = v[v.length - 1], mtd = mtdM ? (a.per[mtdM] || 0) : null;
    const chg = base >= MS_CFG.LIFE_BASE ? lv / base - 1 : null;
    const sold = m => (a.per[m] || 0) > 0, n = ms.length;
    let st = "stable";
    if (a.lt === "X" && (sold(latest) || (mtdM && mtd > 0))) st = "ghost";
    else if (n >= 3 && sold(ms[0]) && !aliveIn(a, ms[1]) && !aliveIn(a, ms[2]) && !(mtdM && aliveIn(a, mtdM))) st = "dead";
    else if (first[a.key] === latest || (mtdM && first[a.key] === mtdM)) st = "fresh";
    else if (chg != null && chg >= MS_CFG.LIFE_PCT) st = "rise";
    else if (chg != null && chg <= -MS_CFG.LIFE_PCT) st = "dec";
    return { ...a, ids: undefined, v, chg, st, stLabel: L[st], listing: a.lt === "V" ? t("On menu") : a.lt === "X" ? t("Delisted") : "—",
      m1: v[0], m2: v[1] ?? null, m3: v[2] ?? null, mtd };
  });
  return { ms, latest, mtdM, rows: list, L, badU: MSU.exclBad ? [...badU] : [], noLatest };
}
const spark = (v, color) => { const mx = Math.max(...v, 1); return `<svg width="84" height="24" viewBox="0 0 84 24" aria-hidden="true"><polyline points="${v.map((x, i) => (6 + i * (72 / Math.max(1, v.length - 1))).toFixed(1) + "," + (21 - x / mx * 17).toFixed(1)).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`; };

/** treemap squarified: items {a: luas} terurut menurun -> {x,y,w,h} */
function squarify(items, x, y, w, h) {
  const out = [], rest = items.slice();
  const worst = (row, side) => { const s = row.reduce((t, r) => t + r.a, 0), mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a)); return Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn)); };
  while (rest.length) {
    const side = Math.min(w, h); let row = [rest.shift()];
    while (rest.length && worst(row.concat(rest[0]), side) <= worst(row, side)) row.push(rest.shift());
    const s = row.reduce((t, r) => t + r.a, 0), thick = s / side;
    let off = 0;
    row.forEach(r => { const len = r.a / thick;
      out.push(w >= h ? { ...r, x, y: y + off, w: thick, h: len } : { ...r, x: x + off, y, w: len, h: thick }); off += len; });
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
  }
  return out;
}

FMD.page("revenue/menu", {
  async render(host, ctx) {
    host.innerHTML = UI.card({ body: `<div class="empty" id="msLoad">${esc(t("Loading menu data…"))}</div>` });
    try { await Menu.load(msg => { const el = host.querySelector("#msLoad"); if (el) el.textContent = msg; }); }
    catch (e) { if (ctx.isStale()) return; host.innerHTML = UI.card({ body: UI.banner(t("Menu data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
    if (ctx.isStale()) return;
    if (!Menu.months.length) { host.innerHTML = UI.card({ body: UI.banner(t("Menu data is empty."), "warn") }); return; }
    if (!Menu.months.includes(MSU.to)) MSU.to = Menu.months[Menu.months.length - 1];
    if (!Menu.months.includes(MSU.from)) MSU.from = Menu.months[Math.max(0, Menu.months.indexOf(MSU.to) - 2)];
    let charts = [];
    const kill = () => { charts.forEach(c => c && c.destroy()); charts = []; };

    const draw = () => {
      kill();
      if (MSU.from > MSU.to) [MSU.from, MSU.to] = [MSU.to, MSU.from];
      const rev = MSU.basis === "rev", V = r => rev ? r.rev : r.sold, fV = v => rev ? fmtRp(v) : fmtInt(v);
      const { all: unitsAll, sel } = msScopeUnits(), items = msItems(), agg = msAggItems(msRankable(items));
      const evRev = items.reduce((s, r) => s + (isEventItem(r) ? r.rev : 0), 0);
      const months = Menu.months.filter(m => m >= MSU.from && m <= MSU.to);
      const LC = msLifecycle(), D = msDaily();
      const totRev = items.reduce((s, r) => s + r.rev, 0), totSold = items.reduce((s, r) => s + r.sold, 0);
      const active = agg.filter(a => a.sold > 0).length, issues = LC.rows.filter(r => r.st === "dead" || r.st === "ghost").length;
      const groups = [...new Set(Menu.items.map(r => r.g))].sort(), cgs = [...new Set(Menu.items.filter(r => !MSU.group || r.g === MSU.group).map(r => r.cg))].sort();
      const range = monthLabel(MSU.from) + (MSU.from !== MSU.to ? " – " + monthLabel(MSU.to) : "");
      const warn = Menu.warn.filter(w => w.m >= MSU.from && w.m <= MSU.to);
      const badList = Object.values(Menu.bad || {}).filter(b => b.m >= MSU.from && b.m <= MSU.to && sel.includes(b.u)).sort((a, b) => a.m.localeCompare(b.m) || a.u.localeCompare(b.u));

      host.innerHTML = `
        <section class="card" style="padding:14px 18px;gap:10px"><div class="filters" id="msF1"></div><div id="msUnits"></div><div class="filters" id="msF2"></div>
          <span class="muted" style="font-size:12px"><span class="dot" aria-hidden="true"></span> ${esc(t("All units are cached; changing units does not reload data."))}</span>
          ${Menu.units.includes("PLS") ? `<span class="muted" style="font-size:12px">${esc(t("PLS: Jan–Mar comes from the monthly POS file and is not split into Tigadari / Pidari; selecting PLS also includes Tigadari and Pidari."))}</span>` : ""}</section>
        ${warn.length ? UI.banner(t("Item-level data does not match the monthly summary for {l}. Item tables for these months may be incomplete; check that Menu_Sales_Monthly in the Sheet is up to date.", { l: joinList(warn.map(w => `${monthLabel(w.m)} (${fmt(w.item)} vs ${fmt(w.agg)})`)) }), "warn") : ""}
        ${badList.length ? `<div class="banner warn" role="note" style="flex-direction:column;gap:6px"><div>${esc(t("Item totals do not match the daily totals for {n} unit-months in this range — usually a source sheet still holding another month’s data or a unit-month that was re-extracted only partly.", { n: badList.length }))}</div>
          <div style="font-size:12px">${esc(badList.map(b => `${menuUnitLabel(b.u)} ${monthName(b.m)}: ${fmt(b.item)} vs ${fmt(b.daily)}`).join(" · "))}</div>
          <label class="lg" style="font-size:12.5px"><input type="checkbox" id="msExcl" ${MSU.exclBad ? "checked" : ""}> ${esc(t("Exclude these unit-months from all tables and figures"))}</label></div>` : ""}
        <section class="grid g4">
          ${UI.kpi({ label: t("Menu Revenue"), value: fmtRp(totRev), showRing: false, note: range + " · " + tn(sel.length, "{n} unit", "{n} units") + (evRev ? " · " + t("events & packages {p}", { p: fmtPct(evRev / (totRev || 1), 0) }) : "") })}
          ${UI.kpi({ label: t("Items Sold"), value: fmtInt(totSold), showRing: false, note: t("Portions and covers") })}
          ${UI.kpi({ label: t("Active Items"), value: fmtInt(active), showRing: false, note: t("Sold at least once in the period") })}
          ${UI.kpi({ label: t("Menu Health Issues"), value: fmtInt(issues), showRing: false, note: t("Stopped selling + delisted still selling") + (LC.latest ? " · " + t("through {m}", { m: monthName(LC.latest) }) : ""), noteKind: issues ? "warn" : "" })}
        </section>
        <section class="card"><div class="card-h"><div><h2>${esc(t("Daily Sales Timeline & Projection"))}</h2>
          <div class="sub">${D ? esc(t("{m} · all units complete through {c}, latest report {d} · by main group", { m: monthLabel(D.m, true), c: dateLabel(D.complete), d: dateLabel(D.latest) })) : ""}${D && MSU.cgrp && !Menu.dailyHasCat ? " · " + esc(t("category filter not applied (daily data has no category yet)")) : ""}</div></div>
          <span class="muted" style="font-size:12px">${esc(t("Select a day for its breakdown"))}</span></div>
          <div class="chart-legend"><span class="lg"><span style="width:18px;height:10px;border-radius:3px;background:var(--accent)"></span>${esc(t("Actual"))}</span><span class="lg"><span style="width:18px;height:10px;border-radius:3px;background:var(--fc);opacity:.6"></span>${esc(t("Projection (units not yet reported)"))}</span><span class="lg"><span class="dot" style="background:var(--orange)"></span>${esc(t("Weekend"))}</span><span class="lg"><span class="dot" style="background:var(--pink)"></span>${esc(t("Public holiday"))}</span></div>
          <div id="msBehind" class="chips" style="align-items:center"></div>
          <div style="position:relative;height:260px"><canvas id="msDaily" role="img" aria-label="${esc(t("Daily menu sales chart"))}"></canvas></div>
          <div class="grid g2"><div class="panel"><h3>${esc(t("Sales Brief · rule-based"))}</h3><p style="margin:0;font-size:13px;line-height:1.6">${esc(msBrief(D))}</p>
            <div class="muted" style="font-size:12px;margin-top:4px">${esc(t("Projection method: for each unit, days after its latest report use the average of the same weekday over its last {n} weeks (menu POS basis). Indicative only — the official revenue forecast is on Daily & Projection.", { n: MS_CFG.PROJ_WEEKS }))}</div></div>
            <div class="panel" id="msDay"></div></div></section>
        <section class="card" id="msMx"><div class="card-h"><div><h2>${esc(t("Monthly Sales Matrix"))}</h2><div class="sub">${esc(range)}${LC.mtdM && months.includes(LC.mtdM) ? " · " + esc(t("{m} is month to date", { m: monthName(LC.mtdM) })) : ""}</div></div><div class="card-tools" id="msMxT"></div></div><div class="card-b"></div></section>
        <section class="card" id="msTM"><div class="card-h"><div><h2>${esc(MSU.cgrp ? t("Categories in {g}", { g: cgLabel(MSU.cgrp === "__none" ? "" : MSU.cgrp) }) : t("Sales by Category"))}</h2><div class="sub">${esc(range)} · ${esc(rev ? t("tile size = revenue") : t("tile size = units sold"))}${MSU.inclEvent ? "" : " · " + esc(t("excluding events & packages"))}</div></div><div class="card-tools" id="msTMT"></div></div>
          <div id="msTMbox" class="tm" role="group" aria-label="${esc(t("Category treemap"))}"></div><div id="msTML" class="chart-legend"></div><div id="msTMN" class="muted" style="font-size:12px"></div></section>
        <section class="card" id="msTB"><div class="card-h"><div><h2>${esc(t("Top / Bottom Sellers"))}</h2><div class="sub">${esc(range)}${MSU.inclEvent ? "" : " · " + esc(t("excluding events & packages"))}</div></div><div class="card-tools" id="msTBT"></div></div><div class="card-b"></div></section>
        <section class="card" id="msLC"><div class="card-h"><div><h2>${esc(t("Menu Lifecycle — Movers & Menu Health (3 months)"))}</h2><div class="sub">${esc(LC.ms.map(m => monthName(m)).join(" · "))}${LC.mtdM ? " · " + esc(t("status uses complete months; {m} to date shown for reference, not projected", { m: monthName(LC.mtdM) })) : ""}${MSU.inclEvent ? "" : " · " + esc(t("excluding events & packages"))}${LC.noLatest.length ? " · " + esc(t("excluded (no data for {m}): {l}", { m: monthName(LC.latest), l: LC.noLatest.map(menuUnitLabel).join(", ") })) : ""}${LC.badU.length ? " · " + esc(t("excluded (data issue): {l}", { l: LC.badU.map(menuUnitLabel).join(", ") })) : ""}</div></div></div>
          <div class="chips" id="msLCchips"></div><div class="card-b"></div>
          <div class="muted" style="font-size:12px">${esc(t("Units sold. Rising/Declining: change of at least ±{p} from the first month, with a base of at least {b} sold · Stopped selling: sold in the first month, none in the next two (POS data lists sold items only) · Delisted, still selling: delisted (X) with sales in the latest month or month to date · New: first sold in the latest month or month to date.", { p: fmtPct(MS_CFG.LIFE_PCT, 0), b: MS_CFG.LIFE_BASE }))}</div></section>`;

      const ex = host.querySelector("#msExcl"); if (ex) ex.onchange = e => { MSU.exclBad = e.target.checked; draw(); };
      // ---- filter ----
      const F1 = host.querySelector("#msF1"), F2 = host.querySelector("#msF2");
      F1.appendChild(UI.clusterSelect(MSU.cluster, v => { MSU.cluster = v; MSU.units = []; draw(); }));
      F1.appendChild(UI.select(t("From"), Menu.months.map(m => [m, monthLabel(m)]), MSU.from, v => { MSU.from = v; draw(); }));
      F1.appendChild(UI.select(t("To"), Menu.months.map(m => [m, monthLabel(m)]), MSU.to, v => { MSU.to = v; draw(); }));
      const ul = UI.node(`<div class="field">${esc(t("Units"))}</div>`);
      ul.appendChild(UI.unitPicker(unitsAll, MSU.units.filter(u => unitsAll.includes(u)), v => { MSU.units = v.length === unitsAll.length ? [] : v; draw(); }, menuUnitLabel));
      host.querySelector("#msUnits").appendChild(ul);
      F2.appendChild(UI.select(t("Group"), [["", t("All groups")]].concat(groups.map(g => [g, g])), MSU.group, v => { MSU.group = v; MSU.cgrp = ""; draw(); }));
      F2.appendChild(UI.select(t("Category group"), [["", t("All categories")]].concat(cgs.map(c => [c || "__none", cgLabel(c)])), MSU.cgrp, v => { MSU.cgrp = v; draw(); }));
      F2.appendChild(UI.select(t("Menu listing"), [["", t("All")], ["V", t("On menu (V)")], ["X", t("Delisted (X)")]], MSU.listing, v => { MSU.listing = v; draw(); }));
      const bf = UI.node(`<label class="field">${esc(t("Value"))}</label>`); bf.appendChild(UI.seg([["rev", t("Revenue")], ["sold", t("Sold")]], MSU.basis, v => { MSU.basis = v; draw(); }, t("Value"))); F2.appendChild(bf);

      // ---- harian ----
      const dayPanel = () => {
        const box = host.querySelector("#msDay"); if (!D) { box.innerHTML = UI.empty(t("No daily menu data for this selection.")); return; }
        const d = MSU.day && MSU.day.slice(0, 7) === D.m ? MSU.day : D.complete, ga = D.actG[d] || {}, gp = D.prjG[d] || {};
        const keys = [...new Set(Object.keys(ga).concat(Object.keys(gp)))].sort((x, y) => ((ga[y] || 0) + (gp[y] || 0)) - ((ga[x] || 0) + (gp[x] || 0)));
        const ta = D.act[d] || 0, tp = D.prj[d] || 0, di = Rev.dayInfo(d);
        const row = (k, a, p) => `<div class="kv"><span>${esc(k)}</span><span class="num">${esc(fV(a))}${p ? ` <span class="muted">+ ${esc(fV(p))}</span>` : ""}</span></div>`;
        box.innerHTML = `<h3>${esc(di.dow)} ${esc(dateLabel(d))}${di.holiday ? " · " + esc(di.note || t("Public holiday")) : ""}</h3>` +
          (ta || tp ? keys.map(k => row(k, ga[k] || 0, gp[k] || 0)).join("") + `<div class="kv tot"><span>${esc(t("Total"))}</span><span class="num">${esc(fV(ta))}${tp ? ` <span class="muted">+ ${esc(fV(tp))}</span>` : ""}</span></div>` +
            (tp ? `<div class="muted" style="font-size:12px">${esc(t("Grey figures are projections for units that have not reported this day."))}</div>` : "")
            : UI.empty(t("No sales recorded for this day.")));
      };
      dayPanel();
      if (D && D.behind.length) host.querySelector("#msBehind").innerHTML = `<span class="muted" style="font-size:12px">${esc(t("Reporting lag"))}:</span> ` + D.behind.map(b => UI.tag(menuUnitLabel(b.u) + " · " + dateLabel(b.d, true), "warn")).join(" ");
      if (D && chartReady(host.querySelector("#msDaily"))) {
        const c = chartColors(), info = D.dates.map(d => Rev.dayInfo(d));
        charts.push(new Chart(host.querySelector("#msDaily"), { type: "bar", data: { labels: D.dates.map(d => String(+d.slice(8, 10))), datasets: [
          { label: t("Actual"), data: D.actual, backgroundColor: info.map(x => x.holiday ? c.pink : x.weekend ? c.orange : c.accent), borderRadius: 4, maxBarThickness: 18, stack: "s" },
          { label: t("Projection"), data: D.proj, backgroundColor: c.fc + "99", borderColor: c.fc, borderWidth: 1, borderDash: [4, 3], borderRadius: 4, maxBarThickness: 18, stack: "s" }] },
          options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
            onClick: (e, els) => { if (els.length) { MSU.day = D.dates[els[0].index]; dayPanel(); } },
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
            plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => { const d = D.dates[it[0].dataIndex]; return dateLabel(d) + " (" + info[it[0].dataIndex].dow + ")"; }, label: x => x.parsed.y ? x.dataset.label + ": " + fV(x.parsed.y) : null } } },
            scales: { x: { stacked: true, grid: { display: false }, ticks: { autoSkip: host.querySelector("#msDaily").clientWidth < 640, maxRotation: 0, font: { size: 11 }, color: x => { const i = info[x.index]; return i && i.holiday ? c.pink : i && i.weekend ? c.orange : c.muted; } } },
              y: { stacked: true, beginAtZero: true, grid: { color: c.line }, ticks: { callback: v => rev ? fmt(v, 1) : fmtInt(v) } } } } }));
      }

      // ---- matrix ----
      const LV = { cluster: t("Cluster"), unit: t("Unit"), group: t("Main group"), cg: t("Category group"), cat: t("Category"), item: t("Item") };
      host.querySelector("#msMxT").appendChild(UI.seg(Object.entries(LV), MSU.lvl, v => { MSU.lvl = v; draw(); }, t("Level")));
      const keyOf = r => ({ cluster: Menu.cluster[r.u] || "—", unit: menuUnitLabel(r.u), group: r.g, cg: cgLabel(r.cg), cat: r.c, item: menuUnitLabel(r.u) + " · " + itemName(r) })[MSU.lvl];
      const piv = {}; items.forEach(r => { const k = keyOf(r), p = piv[k] || (piv[k] = { k, total: 0 }); p[r.m] = (p[r.m] || 0) + V(r); p.total += V(r); });
      const mxCols = [{ key: "k", label: LV[MSU.lvl] }].concat(months.map(m => ({ key: m, label: monthLabel(m) + (m === LC.mtdM ? " *" : ""), type: rev ? "money" : "int" })), [{ key: "total", label: t("Total"), type: rev ? "money" : "int" }], [{ key: "share", label: t("Share"), type: "pct", get: r => r.total / (totAll || 1) }]);
      const prow = Object.values(piv), totAll = prow.reduce((s, r) => s + r.total, 0);
      const mxTotal = rs => { const o = { k: t("Total"), total: 0 }; months.forEach(m => (o[m] = rs.reduce((s, r) => s + (r[m] || 0), 0))); o.total = rs.reduce((s, r) => s + r.total, 0); return o; };
      host.querySelector("#msMx .card-b").appendChild(UI.table(mxCols, { rows: prow, topN: MSU.lvl === "item" ? 50 : null, sort: { key: "total", dir: "desc" }, total: mxTotal, search: true }));

      // ---- top / bottom ----
      const tbT = host.querySelector("#msTBT");
      tbT.appendChild(UI.seg([["top", t("Top")], ["bottom", t("Bottom")]], MSU.tbDir, v => { MSU.tbDir = v; draw(); }, t("Direction")));
      if (MSU.tbDir === "bottom") { const z = UI.node(`<label class="lg" style="font-size:12px"><input type="checkbox" ${MSU.tbZero ? "checked" : ""}> ${esc(t("Exclude zero-sold"))}</label>`);
        z.querySelector("input").onchange = e => { MSU.tbZero = e.target.checked; draw(); }; tbT.appendChild(z); }
      const evT = UI.node(`<label class="lg" style="font-size:12px"><input type="checkbox" ${MSU.inclEvent ? "checked" : ""}> ${esc(t("Include events & packages"))}</label>`);
      evT.querySelector("input").onchange = e => { MSU.inclEvent = e.target.checked; draw(); }; tbT.appendChild(evT);
      const tbRows = agg.filter(a => MSU.tbDir === "top" || !MSU.tbZero || a.sold > 0);
      host.querySelector("#msTB .card-b").appendChild(UI.table([
        { key: "name", label: t("Menu item"), render: r => `<div>${esc(r.name)}</div><div class="muted" style="font-size:11px">${esc(r.unit)} · ${esc(r.cat)}</div>` },
        { key: "unit", label: t("Unit"), hidden: true }, { key: "cat", label: t("Category"), hidden: true }, { key: "cg", label: t("Category group"), hidden: true },
        { key: "price", label: t("Price"), type: "money" }, { key: "sold", label: t("Sold"), type: "int" }, { key: "rev", label: t("Revenue"), type: "money" },
        { key: "share", label: t("Share"), type: "pct", get: r => (rev ? r.rev / (totRev || 1) : r.sold / (totSold || 1)) },   // pangsa thd total termasuk event
      ], { rows: tbRows, topN: 10, sort: { key: rev ? "rev" : "sold", dir: MSU.tbDir === "top" ? "desc" : "asc" }, emptyText: t("No items for the selected filters.") }));

      // ---- treemap kategori ----
      const TMC = { FOOD: t("Food"), BEVERAGE: t("Beverage"), EVENT: t("Events & packages"), OTHER: t("Other") };
      const fbOf = r => isEventItem(r) ? "EVENT" : (r.fb === "FOOD" || r.fb === "BEVERAGE") ? r.fb : "OTHER";
      const lvlCat = !!MSU.cgrp, tmIn = msRankable(items), tm = {};
      tmIn.forEach(r => { const k = lvlCat ? r.c : cgLabel(r.cg), x = tm[k] || (tm[k] = { k, cg: r.cg, v: 0, fb: {} }); x.v += V(r); x.fb[fbOf(r)] = (x.fb[fbOf(r)] || 0) + Math.abs(V(r)); });
      const tmAll = Object.values(tm).map(x => ({ ...x, cls: Object.entries(x.fb).sort((a, b) => b[1] - a[1])[0][0] }));
      const tmPos = tmAll.filter(x => x.v > 0).sort((a, b) => b.v - a.v), tmNeg = tmAll.filter(x => x.v < 0), tmTot = tmPos.reduce((s, x) => s + x.v, 0);
      if (lvlCat) { const b = UI.node(`<button type="button" class="chip">← ${esc(t("All category groups"))}</button>`); b.onclick = () => { MSU.cgrp = ""; draw(); }; host.querySelector("#msTMT").appendChild(b); }
      host.querySelector("#msTML").innerHTML = Object.keys(TMC).filter(k => tmPos.some(x => x.cls === k)).map(k => `<span class="lg"><span class="sw tm-${k.toLowerCase()}"></span>${esc(TMC[k])}</span>`).join("");
      host.querySelector("#msTMN").textContent = (tmNeg.length ? t("Not shown (negative): {l}.", { l: tmNeg.map(x => `${x.k} ${fV(x.v)}`).join(", ") }) + " " : "") + (lvlCat ? "" : t("Select a tile to filter the page to that category group."));
      const box = host.querySelector("#msTMbox");
      const paint = () => {
        const W = box.clientWidth, H = box.clientHeight; box.innerHTML = "";
        if (!tmPos.length || W < 10) { box.innerHTML = UI.empty(t("No items for the selected filters.")); return; }
        squarify(tmPos.map(x => ({ ...x, a: x.v / tmTot * W * H })), 0, 0, W, H).forEach(x => {
          const lv = x.w < 56 ? 0 : x.h >= 60 ? 3 : x.h >= 42 ? 2 : x.h >= 26 ? 1 : 0;
          const el = UI.node(`<button type="button" class="tm-tile tm-${x.cls.toLowerCase()}" style="left:${x.x}px;top:${x.y}px;width:${Math.max(0, x.w - 2)}px;height:${Math.max(0, x.h - 2)}px" title="${esc(`${x.k} · ${fV(x.v)} · ${fmtPct(x.v / tmTot, 1)}`)}" aria-label="${esc(`${x.k} · ${fV(x.v)} · ${fmtPct(x.v / tmTot, 1)}`)}">${lv ? `<b>${esc(x.k)}</b>` : ""}${lv >= 2 ? `<span class="num">${esc(fV(x.v))}</span>` : ""}${lv >= 3 ? `<span class="num muted">${esc(fmtPct(x.v / tmTot, 1))}</span>` : ""}</button>`);
          el.onclick = () => { if (lvlCat) return; MSU.cgrp = x.cg || "__none"; draw(); };
          if (lvlCat) el.style.cursor = "default";
          box.appendChild(el); });
      };
      paint();
      const ro = new ResizeObserver(() => paint()); ro.observe(box); charts.push({ destroy: () => ro.disconnect() });

      // ---- lifecycle ----
      const kinds = { rise: "ok", dec: "crit", dead: "warn", ghost: "crit", fresh: "info", stable: "mute" }, sc = { rise: "var(--ok)", dec: "var(--crit)", dead: "var(--warn)", ghost: "var(--pink)", fresh: "var(--accent)", stable: "var(--muted)" };
      const chips = host.querySelector("#msLCchips");
      chips.innerHTML = [["all", t("All")]].concat(["rise", "dec", "dead", "ghost", "fresh"].map(k => [k, LC.L ? LC.L[k] : k])).map(([k, l]) => {
        const n = k === "all" ? LC.rows.length : LC.rows.filter(r => r.st === k).length; return `<button type="button" class="chip" data-st="${k}" aria-pressed="${MSU.life === k}">${esc(l)} (${fmtInt(n)})</button>`; }).join("");
      chips.querySelectorAll("button").forEach(b => (b.onclick = () => { MSU.life = b.dataset.st; draw(); document.querySelector("#msLC").scrollIntoView({ block: "nearest" }); }));
      const lcRows = LC.rows.filter(r => MSU.life === "all" || r.st === MSU.life);
      host.querySelector("#msLC .card-b").appendChild(UI.table([
        { key: "unit", label: t("Unit") }, { key: "name", label: t("Menu item") }, { key: "listing", label: t("Listing") },
        { key: "m1", label: LC.ms[0] ? monthName(LC.ms[0]) : "", type: "int" }, { key: "m2", label: LC.ms[1] ? monthName(LC.ms[1]) : "", type: "int" },
        { key: "m3", label: LC.ms[2] ? monthName(LC.ms[2]) : "", type: "int" },
        { key: "mtd", label: LC.mtdM ? t("{m} to date", { m: monthName(LC.mtdM) }) : "", type: "int" },
        { key: "trend", label: t("Trend"), sortable: false, copy: false, render: r => spark(r.v, sc[r.st]) },
        { key: "chg", label: t("Change"), type: "pct", render: r => r.chg == null ? '<span class="muted">—</span>' : `<span class="num" style="color:${r.chg >= 0 ? "var(--ok)" : "var(--crit)"}">${r.chg > 0 ? "+" : ""}${esc(fmtPct(r.chg, 0))}</span>` },
        { key: "stLabel", label: t("Status"), render: r => UI.tag(r.stLabel, kinds[r.st]) },
      ].filter(c => c.label !== ""), { rows: lcRows, topN: 20, sort: { key: LC.ms.length >= 3 ? "m3" : "m1", dir: "desc" }, emptyText: t("No items for the selected filters.") }));
    };
    draw();
    const onTheme = () => draw();
    document.addEventListener("fmd:theme", onTheme);
    return () => { document.removeEventListener("fmd:theme", onTheme); kill(); };
  },
});
