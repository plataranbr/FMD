/* FMD v2 — mesin revenue bersama (Executive Summary & halaman Revenue).
   Logika MTD / forecast / budget SAMA dengan FMD lama (index.html root) agar angka identik. */
"use strict";

const REV_TABS = ["Revenue_Master", "Budget_Master", "Forecast_Output", "Event_Pipeline"];
const FC_OUTLET_ALIAS = { TIGADARI: "PLS", PIDARI: "PLS" };      // Forecast_Output & Budget memakai "PLS"
const fcKey = o => FC_OUTLET_ALIAS[o] || o;
const budgetKey = o => FC_OUTLET_ALIAS[o] || o;
const FLAG_LABEL = { OK: "High", POOLED_WE: "Medium", POOLED_ALL: "Low", NO_BASELINE: "No baseline", EVENT_ONLY: "Event only", SKIP_SPECIAL: "Special day" };
const FLAG_RELIABLE = new Set(["OK", "EVENT_ONLY"]); // EVENT_ONLY = nilai event terkonfirmasi, bukan tebakan baseline

const Rev = {
  month() { return (STATE.lastActualDate || "").slice(0, 7); },
  last() { return STATE.lastActualDate || ""; },
  daysInMonth(m) { return +monthEnd(m).slice(8, 10); },

  /* ---- index sekali per data (memo dikosongkan otomatis saat data baru masuk) ---- */
  idx() {
    return memo("rev|idx", () => {
      const byOutletDay = {}, byOutletMonth = {}, lastByOutlet = {};
      (STATE.data.Revenue_Master || []).forEach(r => {
        const o = String(r.Outlet || "").trim(), d = dstr(r.Tanggal), v = Number(r.Total_Revenue) || 0;
        if (!o || !d) return;
        ((byOutletDay[o] = byOutletDay[o] || {})[d] = (byOutletDay[o][d] || 0) + v);
        const m = d.slice(0, 7); ((byOutletMonth[o] = byOutletMonth[o] || {})[m] = (byOutletMonth[o][m] || 0) + v);
        if (v !== 0 && (!lastByOutlet[o] || d > lastByOutlet[o])) lastByOutlet[o] = d;
      });
      const budget = {};
      (STATE.data.Budget_Master || []).forEach(b => {
        const k = String(b.Unit || "").trim(), m = ym(b.Bulan);
        if (k && m) budget[k + "|" + m] = (budget[k + "|" + m] || 0) + (Number(b.Budget) || 0);
      });
      // forecast: per (fcKey, Target_Date) ambil Snapshot_Date terbesar
      const fcBest = {};
      (STATE.data.Forecast_Output || []).forEach(r => {
        const k = String(r.Outlet || "").trim(), td = dstr(r.Target_Date), sd = dstr(r.Snapshot_Date);
        const key = k + "|" + td;
        if (!fcBest[key] || sd > fcBest[key].sd) fcBest[key] = { k, td, sd, total: Number(r.Total) || 0, event: Number(r.Event) || 0, flag: String(r.Flag || "") };
      });
      const fc = {};
      Object.values(fcBest).forEach(x => ((fc[x.k] = fc[x.k] || {})[x.td] = x));
      return { byOutletDay, byOutletMonth, lastByOutlet, budget, fc };
    });
  },
  budgetFor(bk, m) { const v = this.idx().budget[bk + "|" + m]; return v == null ? null : v; },
  /** forecast sisa bulan m (Target_Date > last) untuk satu fcKey */
  fcRemain(k, m = this.month(), last = this.last()) {
    const d = this.idx().fc[k] || {}; let total = 0, reliable = 0; const days = [];
    Object.keys(d).sort().forEach(td => { if (td.slice(0, 7) !== m || td <= last) return;
      const x = d[td]; total += x.total; if (FLAG_RELIABLE.has(x.flag)) reliable += x.total; days.push(x); });
    return { total, reliable, days };
  },

  /** Baris per kunci tampilan outlet (PLS/PATIO/PLMT digabung). Budget per KODE unik (PLS tak dobel). */
  outletRows(cluster, m = this.month()) {
    return memo("rev|rows|" + cluster + "|" + m + "|" + this.last(), () => {
      const I = this.idx(), last = this.last(), dim = Dim.x;
      return Dim.outletList(cluster).map(key => {
        const members = Dim.outletMembers(key).filter(o => o in dim.outlets);
        const fks = [...new Set(members.map(fcKey))], bks = [...new Set(members.map(budgetKey))];
        let mtd = 0; members.forEach(o => (mtd += (I.byOutletMonth[o] || {})[m] || 0));
        let fcr = 0, rel = 0, firstFlag = null;
        fks.forEach(k => { const f = this.fcRemain(k, m, last); fcr += f.total; rel += f.reliable; if (!firstFlag && f.days.length) firstFlag = f.days[0].flag; });
        let budget = null; bks.forEach(k => { const b = this.budgetFor(k, m); if (b != null) budget = (budget || 0) + b; });
        const lastDates = members.map(o => I.lastByOutlet[o] || "").filter(Boolean).sort();
        const eventOnly = members.every(o => /EVENT/i.test(dim.outlets[o].type));
        const O0 = dim.outlets[members[0]] || {};
        return { key, name: members.map(o => dim.outlets[o].name).filter((v, i, a) => a.indexOf(v) === i).join(" · "),
          cluster: O0.cluster || "", members, mtd, fcr, proj: mtd + fcr, budget, reliable: rel, flag: firstFlag,
          lastDate: lastDates.length ? lastDates[lastDates.length - 1] : "", eventOnly };
      });
    });
  },
  /** Total. lfl = hanya outlet dengan budget > 0 (apel-ke-apel). */
  totals(rows) {
    const t = { mtd: 0, fcr: 0, proj: 0, budget: 0, reliable: 0, lflProj: 0, lflMtd: 0, noBudget: [] };
    rows.forEach(r => {
      t.mtd += r.mtd; t.fcr += r.fcr; t.proj += r.proj; t.reliable += r.reliable; t.budget += r.budget || 0;
      if (r.budget > 0) { t.lflProj += r.proj; t.lflMtd += r.mtd; } else if (r.proj > 0) t.noBudget.push(r.key);
    });
    t.ach = t.budget > 0 ? t.lflProj / t.budget : null;      // like-for-like
    t.achAll = t.budget > 0 ? t.proj / t.budget : null;      // cara FMD lama
    return t;
  },

  /** Seri harian bulan m: actual (s.d. last), forecast (setelah last; titik sambung di last). */
  dailySeries(rows, m = this.month()) {
    const I = this.idx(), last = this.last(), act = {}, fc = {}, ev = {};
    rows.forEach(r => {
      r.members.forEach(o => { const d = I.byOutletDay[o] || {}; for (const t in d) if (t.slice(0, 7) === m) act[t] = (act[t] || 0) + d[t]; });
      [...new Set(r.members.map(fcKey))].forEach(k => this.fcRemain(k, m, last).days.forEach(x => {
        fc[x.td] = (fc[x.td] || 0) + x.total; ev[x.td] = (ev[x.td] || 0) + x.event; }));
    });
    if (last && act[last] != null && fc[last] == null && last.slice(0, 7) === m) fc[last] = act[last];
    const dates = []; for (let d = m + "-01"; d.slice(0, 7) === m; d = addDays(d, 1)) dates.push(d);
    return { dates, actual: dates.map(d => d <= last ? (act[d] ?? 0) : null), forecast: dates.map(d => fc[d] ?? null), event: dates.map(d => ev[d] || null) };
  },
  /** Bulanan tahun berjalan: actual & budget per bulan (bulan berjalan = MTD + forecast sisa). */
  monthlySeries(rows, year = this.month().slice(0, 4)) {
    const I = this.idx(), cur = this.month(), months = [];
    for (let i = 1; i <= +cur.slice(5, 7); i++) months.push(year + "-" + String(i).padStart(2, "0"));
    return months.map(m => {
      let a = 0, b = 0, f = 0; const bks = new Set();
      rows.forEach(r => { r.members.forEach(o => { a += (I.byOutletMonth[o] || {})[m] || 0; bks.add(budgetKey(o)); });
        if (m === cur) [...new Set(r.members.map(fcKey))].forEach(k => (f += this.fcRemain(k, m).total)); });
      bks.forEach(k => (b += this.budgetFor(k, m) || 0));
      return { m, actual: a, forecast: f, budget: b };
    });
  },

  /** Event mendatang: snapshot terbaru per Source_Outlet (sama dgn FMD lama), jendela (last, last+days]. */
  events(cluster, days = 21) {
    const ev = STATE.data.Event_Pipeline || [], last = this.last(), end = addDays(last, days);
    const latest = {};
    ev.forEach(r => { const o = String(r.Source_Outlet || r.Unit || "").trim(), sd = dstr(r.Snapshot_Date); if (!latest[o] || sd > latest[o]) latest[o] = sd; });
    const allowed = new Set(Dim.outletList(cluster));
    return ev.filter(r => {
      const o = String(r.Source_Outlet || r.Unit || "").trim(), te = dstr(r.Tanggal_Event);
      return dstr(r.Snapshot_Date) === latest[o] && te > last && te <= end && allowed.has(Dim.outletKey(o));
    }).map(r => ({ outlet: Dim.outletKey(String(r.Source_Outlet || r.Unit).trim()), date: dstr(r.Tanggal_Event), name: r.Nama_Event || "—",
      pax: Number(r.Pax) || 0, value: Number(r.Nilai_Event) || 0, status: r.Status || "",
      definite: /^(confirmed|definite)$/i.test(String(r.Status || "").trim()) }))
      .sort((a, b) => a.date.localeCompare(b.date) || b.value - a.value);
  },

  /** Jenis hari: weekend dari kalender (tidak bergantung kolom Hari), libur dari DIM_TANGGAL. */
  dayInfo(d) {
    const map = memo("rev|days", () => { const o = {}; (STATE.data.DIM_TANGGAL || []).forEach(r => {
      o[dstr(r.Tanggal)] = { holiday: String(r.Kategori_Hari || "").toUpperCase() === "LIBUR_NASIONAL", note: String(r.Keterangan || "") }; }); return o; });
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    const x = map[d] || {};
    return { weekend: wd === 0 || wd === 6, holiday: !!x.holiday, note: x.note || "", dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd] };
  },
};
