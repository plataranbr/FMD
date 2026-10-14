/* FMD v2 — mesin revenue bersama (Executive Summary & halaman Revenue).
   Logika MTD / forecast / budget SAMA dengan FMD lama (index.html root) agar angka identik. */
"use strict";

const REV_TABS = ["Revenue_Master", "Budget_Master", "Forecast_Output", "Event_Pipeline"];
const FC_OUTLET_ALIAS = { TIGADARI: "PLS", PIDARI: "PLS" };      // Forecast_Output & Budget memakai "PLS"
const fcKey = o => FC_OUTLET_ALIAS[o] || o;
const budgetKey = o => FC_OUTLET_ALIAS[o] || o;
const FLAG_RELIABLE = new Set(["OK", "EVENT_ONLY"]); // EVENT_ONLY = nilai event terkonfirmasi, bukan tebakan baseline
const num = v => Number(v) || 0;

const Rev = {
  month() { return (STATE.lastActualDate || "").slice(0, 7); },
  last() { return STATE.lastActualDate || ""; },
  /** batas actual untuk bulan m: bulan berjalan = tanggal actual terakhir; bulan lalu = akhir bulan */
  lastFor(m) { return m === this.month() ? this.last() : monthEnd(m); },
  isOpen(m) { return m === this.month(); },
  daysInMonth(m) { return +monthEnd(m).slice(8, 10); },
  months() { return memo("rev|months", () => [...new Set((STATE.data.Revenue_Master || []).map(r => ym(r.Tanggal)).filter(Boolean))].sort().reverse()); },

  idx() {
    return memo("rev|idx", () => {
      const byOutletDay = {}, byOutletMonth = {}, lastByOutletMonth = {}, detail = {};
      (STATE.data.Revenue_Master || []).forEach(r => {
        const o = String(r.Outlet || "").trim(), d = dstr(r.Tanggal), v = num(r.Total_Revenue);
        if (!o || !d) return;
        ((byOutletDay[o] = byOutletDay[o] || {})[d] = (byOutletDay[o][d] || 0) + v);
        const m = d.slice(0, 7); ((byOutletMonth[o] = byOutletMonth[o] || {})[m] = (byOutletMonth[o][m] || 0) + v);
        if (v !== 0) { const L = (lastByOutletMonth[o] = lastByOutletMonth[o] || {}); if (!L[m] || d > L[m]) L[m] = d; }
        const k = o + "|" + d, x = detail[k] || (detail[k] = { food: 0, bev: 0, other: 0, event: 0, minSpend: 0, cover: 0, coverEv: 0, total: 0 });
        x.food += num(r.Food); x.bev += num(r.Beverage); x.other += num(r.Other); x.event += num(r.Event); x.minSpend += num(r.Min_Spend);
        x.cover += num(r.Cover_Reguler); x.coverEv += num(r.Cover_Event); x.total += v;
      });
      const budget = {};
      (STATE.data.Budget_Master || []).forEach(b => {
        const k = String(b.Unit || "").trim(), m = ym(b.Bulan);
        if (k && m) budget[k + "|" + m] = (budget[k + "|" + m] || 0) + num(b.Budget);
      });
      const fcBest = {}; let fcSnap = "";
      (STATE.data.Forecast_Output || []).forEach(r => {
        const k = String(r.Outlet || "").trim(), td = dstr(r.Target_Date), sd = dstr(r.Snapshot_Date), key = k + "|" + td;
        if (sd > fcSnap) fcSnap = sd;
        if (!fcBest[key] || sd > fcBest[key].sd) fcBest[key] = { k, td, sd, total: num(r.Total), event: num(r.Event),
          food: num(r.Food_Reg), bev: num(r.Bev_Reg), other: num(r.Other_Reg), flag: String(r.Flag || "") };
      });
      const fc = {};
      Object.values(fcBest).forEach(x => ((fc[x.k] = fc[x.k] || {})[x.td] = x));
      return { byOutletDay, byOutletMonth, lastByOutletMonth, detail, budget, fc, fcSnap };
    });
  },
  budgetFor(bk, m) { const v = this.idx().budget[bk + "|" + m]; return v == null ? null : v; },
  fcRemain(k, m = this.month(), last = this.lastFor(m)) {
    const d = this.idx().fc[k] || {}; let total = 0, reliable = 0, event = 0; const days = [];
    Object.keys(d).sort().forEach(td => { if (td.slice(0, 7) !== m || td <= last) return;
      const x = d[td]; total += x.total; event += x.event; if (FLAG_RELIABLE.has(x.flag)) reliable += x.total; days.push(x); });
    return { total, reliable, event, days };
  },

  /** Baris per kunci tampilan outlet (PLS/PATIO/PLMT digabung). Budget per KODE unik (PLS tak dobel). */
  outletRows(cluster, m = this.month()) {
    const last = this.lastFor(m);
    return memo("rev|rows|" + cluster + "|" + m + "|" + last, () => {
      const I = this.idx(), dim = Dim.x;
      return Dim.outletList(cluster).map(key => {
        const members = Dim.outletMembers(key).filter(o => o in dim.outlets);
        const fks = [...new Set(members.map(fcKey))], bks = [...new Set(members.map(budgetKey))];
        let mtd = 0; members.forEach(o => (mtd += (I.byOutletMonth[o] || {})[m] || 0));
        let fcr = 0, rel = 0, fcEv = 0, firstFlag = null;
        fks.forEach(k => { const f = this.fcRemain(k, m, last); fcr += f.total; rel += f.reliable; fcEv += f.event; if (!firstFlag && f.days.length) firstFlag = f.days[0].flag; });
        let budget = null; bks.forEach(k => { const b = this.budgetFor(k, m); if (b != null) budget = (budget || 0) + b; });
        const lastDates = members.map(o => (I.lastByOutletMonth[o] || {})[m] || "").filter(Boolean).sort();
        const eventOnly = members.every(o => /EVENT/i.test(dim.outlets[o].type));
        const O0 = dim.outlets[members[0]] || {};
        return { key, name: members.map(o => dim.outlets[o].name).filter((v, i, a) => a.indexOf(v) === i).join(" · "),
          cluster: O0.cluster || "", members, mtd, fcr, fcEvent: fcEv, proj: mtd + fcr, budget, reliable: rel, flag: firstFlag,
          lastDate: lastDates.length ? lastDates[lastDates.length - 1] : "", eventOnly };
      });
    });
  },
  totals(rows) {
    const T = { mtd: 0, fcr: 0, fcEvent: 0, proj: 0, budget: 0, reliable: 0, lflProj: 0, lflMtd: 0, noBudget: [] };
    rows.forEach(r => {
      T.mtd += r.mtd; T.fcr += r.fcr; T.fcEvent += r.fcEvent; T.proj += r.proj; T.reliable += r.reliable; T.budget += r.budget || 0;
      if (r.budget > 0) { T.lflProj += r.proj; T.lflMtd += r.mtd; } else if (r.proj > 0) T.noBudget.push(r.key);
    });
    T.ach = T.budget > 0 ? T.lflProj / T.budget : null;      // like-for-like
    T.achAll = T.budget > 0 ? T.proj / T.budget : null;      // cara FMD lama
    return T;
  },
  /** Tingkat keandalan proyeksi dari porsi forecast ber-Flag OK/EVENT_ONLY */
  reliability(r, open = true) {
    if (!open) return "closed";
    if (!(r.fcr > 0)) return "none";
    const s = r.reliable / r.fcr; return s >= 0.85 ? "high" : s >= 0.7 ? "medium" : "low";
  },

  dailySeries(rows, m = this.month()) {
    const I = this.idx(), last = this.lastFor(m), act = {}, fc = {}, ev = {};
    rows.forEach(r => {
      r.members.forEach(o => { const d = I.byOutletDay[o] || {}; for (const x in d) if (x.slice(0, 7) === m) act[x] = (act[x] || 0) + d[x]; });
      [...new Set(r.members.map(fcKey))].forEach(k => this.fcRemain(k, m, last).days.forEach(x => {
        fc[x.td] = (fc[x.td] || 0) + x.total; ev[x.td] = (ev[x.td] || 0) + x.event; }));
    });
    if (this.isOpen(m) && last && act[last] != null && fc[last] == null) fc[last] = act[last];
    const dates = []; for (let d = m + "-01"; d.slice(0, 7) === m; d = addDays(d, 1)) dates.push(d);
    return { dates, last, actual: dates.map(d => d <= last ? (act[d] ?? 0) : null), forecast: dates.map(d => d > last || (d === last && this.isOpen(m)) ? (fc[d] ?? null) : null), event: dates.map(d => ev[d] || null) };
  },
  /** Rincian satu hari (actual s.d. last, forecast setelahnya) untuk baris terpilih */
  dayDetail(rows, d) {
    const I = this.idx(), m = d.slice(0, 7), last = this.lastFor(m);
    if (d <= last) {
      const x = { kind: "actual", food: 0, bev: 0, other: 0, event: 0, minSpend: 0, cover: 0, coverEv: 0, total: 0, byOutlet: [] };
      rows.forEach(r => { let tot = 0; r.members.forEach(o => { const y = I.detail[o + "|" + d]; if (!y) return;
        for (const k in y) x[k] += y[k]; tot += y.total; }); if (tot) x.byOutlet.push({ key: r.key, total: tot }); });
      x.byOutlet.sort((a, b) => b.total - a.total); return x;
    }
    const x = { kind: "forecast", food: 0, bev: 0, other: 0, event: 0, total: 0, flags: {}, byOutlet: [] };
    rows.forEach(r => { let tot = 0; [...new Set(r.members.map(fcKey))].forEach(k => { const y = (I.fc[k] || {})[d]; if (!y) return;
      x.food += y.food; x.bev += y.bev; x.other += y.other; x.event += y.event; x.total += y.total; tot += y.total; x.flags[y.flag] = (x.flags[y.flag] || 0) + y.total; });
      if (tot) x.byOutlet.push({ key: r.key, total: tot }); });
    x.byOutlet.sort((a, b) => b.total - a.total); return x;
  },
  monthlySeries(rows, year = this.month().slice(0, 4), upTo = this.month()) {
    const I = this.idx(), months = [];
    for (let i = 1; i <= +upTo.slice(5, 7); i++) months.push(year + "-" + String(i).padStart(2, "0"));
    return months.map(m => {
      let a = 0, b = 0, f = 0; const bks = new Set();
      rows.forEach(r => { r.members.forEach(o => { a += (I.byOutletMonth[o] || {})[m] || 0; bks.add(budgetKey(o)); });
        if (this.isOpen(m)) [...new Set(r.members.map(fcKey))].forEach(k => (f += this.fcRemain(k, m).total)); });
      bks.forEach(k => (b += this.budgetFor(k, m) || 0));
      return { m, actual: a, forecast: f, budget: b };
    });
  },
  /** Total actual hari yang sama (1..day) di bulan m untuk baris terpilih */
  sameDays(rows, m, day) {
    const I = this.idx(); let s = 0;
    rows.forEach(r => r.members.forEach(o => { const d = I.byOutletDay[o] || {}; for (const x in d) if (x.slice(0, 7) === m && +x.slice(8, 10) <= day) s += d[x]; }));
    return s;
  },

  /** Event: snapshot terbaru per Source_Outlet (sama dgn FMD lama). opts: {from, to} (eksklusif from, inklusif to), outlet.
      Baris dengan Status_Event terisi selain AKTIF (mis. GUGUR/EXPIRED) dikecualikan. */
  events(cluster, days = 21, opts = {}) {
    const ev = STATE.data.Event_Pipeline || [], last = this.last();
    const from = opts.from || last, to = opts.to || addDays(last, days);
    const latest = {};
    ev.forEach(r => { const o = String(r.Source_Outlet || r.Unit || "").trim(), sd = dstr(r.Snapshot_Date); if (!latest[o] || sd > latest[o]) latest[o] = sd; });
    const allowed = new Set(Dim.outletList(cluster));
    return ev.filter(r => {
      const o = String(r.Source_Outlet || r.Unit || "").trim(), te = dstr(r.Tanggal_Event), se = String(r.Status_Event || "").trim().toUpperCase();
      return dstr(r.Snapshot_Date) === latest[o] && te > from && te <= to && allowed.has(Dim.outletKey(o)) && (!se || se === "AKTIF")
        && (!opts.outlet || opts.outlet === "ALL" || Dim.outletKey(o) === opts.outlet);
    }).map(r => ({ outlet: Dim.outletKey(String(r.Source_Outlet || r.Unit).trim()), date: dstr(r.Tanggal_Event), name: r.Nama_Event || "—",
      pax: num(r.Pax), value: num(r.Nilai_Event), status: String(r.Status || "").trim(), sales: String(r.Sales || "").trim(), snapshot: dstr(r.Snapshot_Date),
      definite: /^(confirmed|definite)$/i.test(String(r.Status || "").trim()) }))
      .sort((a, b) => a.date.localeCompare(b.date) || b.value - a.value);
  },
  eventSnapshot() { return memo("rev|evsnap", () => (STATE.data.Event_Pipeline || []).reduce((m, r) => { const s = dstr(r.Snapshot_Date); return s > m ? s : m; }, "")); },

  dayInfo(d) {
    const map = memo("rev|days", () => { const o = {}; (STATE.data.DIM_TANGGAL || []).forEach(r => {
      o[dstr(r.Tanggal)] = { holiday: String(r.Kategori_Hari || "").toUpperCase() === "LIBUR_NASIONAL", note: String(r.Keterangan || "") }; }); return o; });
    const wd = new Date(d + "T00:00:00Z").getUTCDay(), x = map[d] || {};
    return { weekend: wd === 0 || wd === 6, holiday: !!x.holiday, note: x.note || "", dow: dowShort(wd) };
  },
};

/* ---------- Grafik harian bersama (Executive Summary & Daily & Projection) ---------- */
function chartColors() {
  return { accent: cssVar("--accent"), fc: cssVar("--fc"), orange: cssVar("--orange"), pink: cssVar("--pink"), ev: cssVar("--ev-bar"),
    muted: cssVar("--muted"), line: cssVar("--line"), ink: cssVar("--ink"), card: cssVar("--card") };
}
function chartReady(canvas) {
  if (typeof Chart === "function" && Chart.register) { Chart.defaults.font.family = "Poppins, system-ui, sans-serif"; Chart.defaults.color = cssVar("--muted"); return true; }
  canvas.parentElement.innerHTML = UI.empty(t("Chart library could not load.")); return false;
}
/** opts: {m, onPick(date), selected} */
function dailyRevenueChart(canvas, rows, opts = {}) {
  if (!chartReady(canvas)) return null;
  const m = opts.m || Rev.month(), c = chartColors(), s = Rev.dailySeries(rows, m), info = s.dates.map(d => Rev.dayInfo(d));
  const bud = rows.reduce((a, r) => a + (r.budget || 0), 0), budDaily = bud > 0 ? bud / s.dates.length : null;
  const pt = base => info.map(x => x.holiday ? c.pink : x.weekend ? c.orange : base);
  const rad = s.dates.map(d => d === opts.selected ? 7 : 4);
  const ch = new Chart(canvas, { data: { labels: s.dates.map(d => String(+d.slice(8, 10))), datasets: [
    { type: "line", label: t("Actual"), data: s.actual, borderColor: c.accent, backgroundColor: pt(c.accent), pointBorderColor: pt(c.accent), pointRadius: rad, pointHoverRadius: 7, borderWidth: 3, tension: .25, spanGaps: false, order: 1 },
    { type: "line", label: t("Forecast"), data: s.forecast, borderColor: c.fc, backgroundColor: pt(c.fc), pointBorderColor: pt(c.fc), pointRadius: rad, pointHoverRadius: 7, borderWidth: 3, borderDash: [7, 6], tension: .25, spanGaps: false, order: 2 },
    { type: "line", label: t("Budget (daily average)"), data: s.dates.map(() => budDaily), borderColor: c.orange, borderWidth: 1.5, borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 0, order: 3 },
    { type: "bar", label: t("Event value in forecast"), data: s.event, backgroundColor: c.ev, borderRadius: 4, maxBarThickness: 12, order: 4 } ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      onClick: opts.onPick ? (e, els) => { if (els.length) opts.onPick(s.dates[els[0].index]); } : undefined,
      onHover: opts.onPick ? (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; } : undefined,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: it => { const d = s.dates[it[0].dataIndex], x = info[it[0].dataIndex]; return dateLabel(d) + " (" + x.dow + ")" + (x.holiday ? " · " + (x.note || t("Public holiday")) : ""); },
        label: x => x.parsed.y == null ? null : x.dataset.label + ": " + fmtRp(x.parsed.y) } } },
      scales: { x: { grid: { display: false }, ticks: { color: ctx => { const x = info[ctx.index]; return x && x.holiday ? c.pink : x && x.weekend ? c.orange : c.muted; }, autoSkip: canvas.clientWidth < 640, maxRotation: 0, font: { size: 11 } } },
        y: { ticks: { callback: v => fmt(v, 1) }, grid: { color: c.line }, beginAtZero: true } } } });
  ch.$series = s; return ch;
}
function monthlyRevenueChart(canvas, rows, upTo) {
  if (!chartReady(canvas)) return null;
  const c = chartColors(), s = Rev.monthlySeries(rows, (upTo || Rev.month()).slice(0, 4), upTo || Rev.month());
  return new Chart(canvas, { type: "bar", data: { labels: s.map(x => monthName(x.m)), datasets: [
    { label: t("Actual"), data: s.map(x => x.actual), backgroundColor: c.accent, stack: "a", borderRadius: 8, maxBarThickness: 26 },
    { label: t("Forecast"), data: s.map(x => x.forecast || null), backgroundColor: c.fc, stack: "a", borderRadius: 8, maxBarThickness: 26 },
    { label: t("Budget"), data: s.map(x => x.budget || null), backgroundColor: c.orange, stack: "b", borderRadius: 8, maxBarThickness: 26 } ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
      tooltip: { callbacks: { label: x => x.dataset.label + ": " + fmtRp(x.parsed.y) } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => fmt(v, 1) }, grid: { color: c.line } } } } });
}
function chartLegend(kind) {
  const sw = (bg, dash) => `<span class="lg"><span style="width:18px;${dash ? `border-top:3px dashed ${bg}` : `height:10px;border-radius:3px;background:${bg}`}"></span>`;
  const dot = (bg, l) => `<span class="lg"><span class="dot" style="background:${bg}"></span>${esc(l)}</span>`;
  return kind === "monthly"
    ? `${sw("var(--accent)")}${t("Actual")}</span>${sw("var(--fc)")}${t("Forecast")}</span>${sw("var(--orange)")}${t("Budget")}</span>`
    : `${sw("var(--accent)")}${t("Actual")}</span>${sw("var(--fc)", 1)}${t("Forecast")}</span>${sw("var(--orange)", 1)}${t("Budget (daily average)")}</span>${sw("var(--ev-bar)")}${t("Event value in forecast")}</span>${dot("var(--orange)", t("Weekend"))}${dot("var(--pink)", t("Public holiday"))}`;
}
