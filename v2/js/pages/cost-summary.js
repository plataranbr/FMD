/* Cost of Sales › Summary */
"use strict";

const CSU = { preset: "mtd", cluster: "ALL", units: [], from: "", to: "", fwd: 0, gas: false, fgManual: true, src: "all", focus: "" };

const csPct = p => p == null ? DASH : fmtPct(p, 1);
const csPill = (p, tgt) => p == null ? `<span class="muted">${DASH}</span>` : `<span class="pill b-${Cost.band(p, tgt)} num">${esc(fmtPct(p, 1))}</span>`;

function csRange() {
  const last = STATE.lastActualDate || dstr(new Date()), m = last.slice(0, 7);
  if (CSU.preset === "mtd") { CSU.from = m + "-01"; CSU.to = last; }
  else if (CSU.preset === "prev") { const pm = addMonths(m, -1); CSU.from = pm + "-01"; CSU.to = monthEnd(pm); }
  if (!CSU.from) { CSU.from = m + "-01"; CSU.to = last; }
  const to = CSU.fwd > 0 ? addDays(CSU.to, CSU.fwd) : CSU.to;
  return { from: CSU.from, to, baseTo: CSU.to };
}

FMD.page("cost/summary", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(90) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(420);
    let res;
    try { res = await Cost.load("summary"); } catch (e) { if (!ctx.isStale()) host.innerHTML = UI.card({ body: UI.banner(t("Cost data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
    if (ctx.isStale()) return;
    const missing = (res.missing || []).map(x => x.tab).filter(tb => tb === "DML_Cost_Daily" || tb === "Consumption_Master");
    let charts = [];
    const kill = () => { charts.forEach(c => c && c.destroy()); charts = []; };

    const draw = () => {
      kill(); Cost.prep();
      const R = csRange(), o = { from: R.from, to: R.to, gas: CSU.gas, fgManual: CSU.fgManual };
      const all = Cost.allKeys(), hid = all.filter(k => Cost.hidden(k) === "nodata");
      const avail = all.filter(k => !Cost.hidden(k) && (CSU.cluster === "ALL" || Cost.cluster(k) === CSU.cluster)).sort((a, b) => Cost.order(a) - Cost.order(b));
      const sel = CSU.units.filter(k => avail.includes(k)), keys = sel.length ? sel : avail;
      o.keys = new Set(keys);
      const rows = Cost.summary(o), T = Cost.totals(rows);
      const D = Cost.dml(o), relTot = D.rel.RELIABLE + D.rel.INDICATIVE + D.rel.INCOMPLETE;
      const outlets = rows.filter(r => !r.ck && r.revTot > 0);
      const above = outlets.filter(r => r.pct != null && r.pct > Cost.target("SUM", null, r.revFood, r.revBev));
      const days = daysBetween(R.from, R.baseTo) + 1, mFrom = R.from.slice(0, 7), mTo = R.baseTo.slice(0, 7);
      const range = dateLabel(R.from) + " – " + dateLabel(R.to);

      // ---- peringatan (rule-based) ----
      const warns = [];
      if (missing.length) warns.push(["crit", t("Missing data tabs: {l}. Figures below are incomplete.", { l: missing.join(", ") })]);
      if (CSU.fwd > LEAD_TIME_MIN) warns.push(["warn", t("{n} forecast days exceed the purchasing lead time (~{d} days): revenue for those days is added without matching cost, so the ratio is understated.", { n: CSU.fwd, d: LEAD_TIME_MIN })]);
      else if (days < LEAD_TIME_MIN) warns.push(["warn", t("The period is only {n} days. Purchases usually cover several days of stock, so the ratio is likely overstated; use at least one week.", { n: days })]);
      if (CSU.fgManual && !(STATE.data.CK_FG_Rows || []).some(r => r._d >= R.from && r._d <= R.to))
        warns.push(["warn", t("CK manual FG input (CK_FG_Transfer) has no entries in this period, so FG transfers from CK are zero here, not a real decrease.")]);
      const partial = rows.filter(r => !r.ck && r.since && r.since > mFrom);
      if (partial.length) warns.push(["warn", t("Cost data starts later than the period for {l}; their ratios cover part of the period only.", { l: joinList(partial.map(r => `${r.unit} (${monthLabel(r.since)})`)) })]);
      const L = Cost.lastDates(), behind = rows.filter(r => !r.ck && L[r.unit] && L[r.unit].dml && L[r.unit].dml < R.baseTo && daysBetween(L[r.unit].dml, R.baseTo) >= 2);
      if (behind.length) warns.push(["warn", t("Direct purchases are behind for {l}; costs for the latest days are not yet recorded.", { l: joinList(behind.map(r => `${r.unit} (${dateLabel(L[r.unit].dml, true)})`)) })]);
      const consLast = Object.values(L).map(x => x.srt).filter(Boolean).sort().pop() || "";
      if (consLast && consLast < R.baseTo) warns.push(["info", t("Store requisitions are recorded through {d}; later days include direct purchases only.", { d: dateLabel(consLast) })]);
      const noData = hid.filter(k => CSU.cluster === "ALL" || Cost.cluster(k) === CSU.cluster);

      const ind = relTot > 0 ? D.rel.INDICATIVE / relTot : 0, inc = relTot > 0 ? D.rel.INCOMPLETE / relTot : 0;
      const closed = mTo < (STATE.lastActualDate || "").slice(0, 7);
      const basis = closed
        ? t("Closed month, provisional basis: direct purchases (DML) plus store requisitions and transfers. Posted general-ledger figures are not connected yet.")
        : ind + inc > 0.005 ? t("Open period, provisional: direct purchases (DML) plus store requisitions and transfers. {p} of DML value is still indicative (from purchase logs, not yet matched to final orders).", { p: fmtPct(ind + inc, 0) })
        : t("Open period, provisional: direct purchases (DML) plus store requisitions and transfers. All DML value in this period is matched to final orders.");

      host.innerHTML = `
        <section class="card" style="padding:14px 18px;gap:10px"><div class="filters" id="csF1"></div><div id="csUnits"></div><div class="filters" id="csF2"></div>
          <span class="muted" style="font-size:12px">${esc(t("Targets: Summary {a} · DML {b} · SR/Transfer {c} (Food = Beverage)", { a: fmtPct(COST_TGT.SUM.F, 0), b: fmtPct(COST_TGT.DML.F, 0), c: fmtPct(COST_TGT.SRT.F, 0) }))}</span></section>
        ${warns.map(([k, w]) => UI.banner(w, k)).join("")}
        <div class="banner ${closed ? "info" : "warn"}" role="note" style="align-items:center;gap:10px"><span class="tag ${closed ? "info" : "warn"}">${esc(t("PROVISIONAL"))}</span><span>${esc(basis)}</span></div>
        <section class="grid g4">
          ${UI.kpi({ label: t("Total Cost of Sales"), value: fmtRp(T.tot), showRing: false, note: t("DML {a} · SR/Transfer {b} · excl. CK", { a: fmt(rows.filter(r => !r.ck).reduce((s, r) => s + r.dml, 0)), b: fmt(rows.filter(r => !r.ck).reduce((s, r) => s + r.srt, 0)) }) })}
          ${UI.kpi({ label: t("F&B Revenue (denominator)"), value: fmtRp(T.rev), showRing: false, note: CSU.fwd > 0 ? t("Actual through {d} + {n} forecast days", { d: dateLabel(STATE.lastActualDate, true), n: CSU.fwd }) : t("Actual, {r}", { r: range }) })}
          ${UI.kpi({ label: t("F&B Cost Ratio"), value: csPct(T.pct), showRing: false, note: T.pct == null ? "" : t("{x} vs {g} target", { x: fmtPts(T.pct - T.tgt), g: fmtPct(T.tgt, 0) }), noteKind: T.pct == null ? "" : T.pct > T.tgt ? "crit" : T.pct > T.tgt * 0.9 ? "warn" : "ok" })}
          ${UI.kpi({ label: t("Units Above Target"), value: t("{a} of {b}", { a: above.length, b: outlets.length }), showRing: false, note: above.length ? t("Largest gap: {u}", { u: above.slice().sort((a, b) => (b.tot - Cost.target("SUM", null, b.revFood, b.revBev) * b.revTot) - (a.tot - Cost.target("SUM", null, a.revFood, a.revBev) * a.revTot))[0].unit }) : t("All units within target"), noteKind: above.length ? "warn" : "ok" })}
        </section>
        <section class="card" id="csTbl"><div class="card-h"><div><h2>${esc(t("Cost of Sales by Unit"))}</h2><div class="sub">${esc(range)} · ${esc(t("Select a unit to focus the daily chart"))}</div></div><div class="card-tools"></div></div><div class="card-b"></div>
          <div class="muted" style="font-size:12px">${esc(t("Food cost = Kitchen + Event; Beverage cost = Bar. Central Kitchen is excluded from totals and ratios: its cost reaches outlets through FG transfers."))}${noData.length ? " " + esc(t("No cost data yet (not shown): {l}.", { l: noData.join(", ") })) : ""}</div></section>
        <section class="grid g2">
          <div class="card"><div class="card-h"><div><h2>${esc(t("F&B Cost Ratio vs Target"))}</h2><div class="sub">${esc(t("Line = target · shaded = 90–100% of target"))}</div></div></div><div id="csBul" class="bul" role="img" aria-label="${esc(t("F&B cost ratio by unit compared with target"))}"></div></div>
          <div class="card"><div class="card-h"><div><h2>${esc(t("Total Cost of Sales by Unit"))}</h2><div class="sub">${esc(t("Stacked by department"))}</div></div><div class="card-tools" id="csSrcT"></div></div>
            <div class="chart-legend"><span class="lg"><span class="sw" style="background:var(--accent)"></span>${esc(t("Kitchen"))}</span><span class="lg"><span class="sw" style="background:var(--orange)"></span>${esc(t("Bar"))}</span><span class="lg"><span class="sw" style="background:var(--pink)"></span>${esc(t("Event"))}</span></div>
            <div id="csStack" class="bul"></div></div>
        </section>
        <section class="card"><div class="card-h"><div><h2>${esc(t("Daily Cost vs Revenue"))}</h2><div class="sub">${esc(CSU.focus ? t("Focused on {u}", { u: CSU.focus }) : t("All selected units, excl. CK"))}</div></div><div class="card-tools" id="csDayT"></div></div>
          <div class="chart-legend"><span class="lg"><span class="sw" style="background:var(--fc)"></span>${esc(t("Cost (left axis)"))}</span><span class="lg"><span style="width:18px;height:3px;background:var(--orange)"></span>${esc(t("Revenue (right axis)"))}</span><span class="lg"><span style="width:18px;border-top:3px dashed var(--orange)"></span>${esc(t("Revenue forecast"))}</span></div>
          <div style="position:relative;height:280px"><canvas id="csDay" role="img" aria-label="${esc(t("Daily cost compared with daily revenue"))}"></canvas></div>
          <div class="muted" style="font-size:12px">${esc(t("Daily ratios are indicative only: purchases often cover several days of stock."))}</div></section>`;

      // ---- filter ----
      const F1 = host.querySelector("#csF1"), F2 = host.querySelector("#csF2");
      const pf = UI.node(`<label class="field">${esc(t("Period"))}</label>`);
      pf.appendChild(UI.seg([["mtd", t("Month to date")], ["prev", t("Last month")], ["custom", t("Custom")]], CSU.preset, v => { CSU.preset = v; draw(); }, t("Period"))); F1.appendChild(pf);
      F1.appendChild(UI.clusterSelect(CSU.cluster, v => { CSU.cluster = v; CSU.units = []; CSU.focus = ""; draw(); }));
      const dIn = (lab, val, on) => { const el = UI.node(`<label class="field">${esc(lab)}<input type="date" value="${esc(val)}"></label>`);
        el.querySelector("input").addEventListener("change", e => { if (!e.target.value) return; CSU.preset = "custom"; on(e.target.value); draw(); }); return el; };
      F1.appendChild(dIn(t("From"), CSU.from, v => (CSU.from = v)));
      F1.appendChild(dIn(t("To"), CSU.to, v => (CSU.to = v)));
      const ul = UI.node(`<div class="field">${esc(t("Units"))}</div>`);
      ul.appendChild(UI.unitPicker(avail, sel, v => { CSU.units = v.length === avail.length ? [] : v; CSU.focus = ""; draw(); })); host.querySelector("#csUnits").appendChild(ul);
      const fw = UI.node(`<label class="field">${esc(t("Forecast (+days)"))}<input type="number" min="0" max="120" value="${CSU.fwd}" style="min-width:80px;width:90px"></label>`);
      let fT; fw.querySelector("input").addEventListener("input", e => { clearTimeout(fT); fT = setTimeout(() => { CSU.fwd = Math.max(0, Math.min(120, parseInt(e.target.value, 10) || 0)); draw(); }, 400); }); F2.appendChild(fw);
      F2.appendChild(UI.select(t("CK FG source"), [["1", t("CK manual input")], ["0", t("Consumption (legacy)")]], CSU.fgManual ? "1" : "0", v => { CSU.fgManual = v === "1"; draw(); }));
      const gs = UI.node(`<label class="lg" style="font-size:13px;align-self:flex-end;height:36px"><input type="checkbox" ${CSU.gas ? "checked" : ""}> ${esc(t("Include LPG"))}</label>`);
      gs.querySelector("input").onchange = e => { CSU.gas = e.target.checked; draw(); }; F2.appendChild(gs);

      // ---- tabel ----
      const P = (key, cat) => r => csPill(r[key], Cost.target("SUM", cat, r.revFood, r.revBev));
      const unitCell = r => `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="dot" style="background:${r.rel === "RELIABLE" ? "var(--ok)" : r.rel === "INDICATIVE" ? "var(--warn)" : "var(--crit)"}" title="${esc(t("DML reliability: {r}", { r: r.rel.toLowerCase() }))}"></span><b>${esc(r.unit)}</b>${r.ck ? " " + UI.tag(t("no revenue · excl."), "mute") : ""}${r.incCons ? " " + UI.tag("INC", "crit") : ""}${CSU.focus === r.unit ? " " + UI.tag(t("focused"), "info") : ""}</div><div class="muted" style="font-size:11px">${esc(r.name)}</div>`;
      const totRow = () => ({ unit: t("Total (excl. CK)"), cF: T.cF, revFood: T.rF, pctFood: T.pctF, cB: T.cB, revBev: T.rB, pctBev: T.pctB, tot: T.tot, revTot: T.rev, pct: T.pct,
        dml: rows.filter(r => !r.ck).reduce((s, r) => s + r.dml, 0), srt: rows.filter(r => !r.ck).reduce((s, r) => s + r.srt, 0) });
      const cols = [
        { key: "unit", label: t("Unit"), render: unitCell },
        { key: "cF", label: t("Food cost"), type: "money" }, { key: "revFood", label: t("Food revenue"), type: "money" },
        { key: "pctFood", label: t("Food %"), type: "pct", render: P("pctFood", "F") },
        { key: "cB", label: t("Bev. cost"), type: "money" }, { key: "revBev", label: t("Bev. revenue"), type: "money" },
        { key: "pctBev", label: t("Bev. %"), type: "pct", render: P("pctBev", "B") },
        { key: "tot", label: t("Total cost"), type: "money" }, { key: "revTot", label: t("F&B revenue"), type: "money" },
        { key: "pct", label: t("F&B %"), type: "pct", render: P("pct", null) },
        { key: "dml", label: "DML", type: "money", hidden: true }, { key: "srt", label: "SR/Transfer", type: "money", hidden: true },
      ];
      const tbl = UI.table(cols, { rows, sort: null, full: true, total: () => totRow(), onRow: r => { CSU.focus = CSU.focus === r.unit || r.ck ? "" : r.unit; draw(); }, emptyText: t("No cost data for the selected filters.") });
      host.querySelector("#csTbl .card-b").appendChild(tbl);
      // pill di baris total (pakai target tertimbang)
      const tr = tbl.querySelector("tr.total"); if (tr) { const tds = tr.querySelectorAll("td");
        const idx = k => cols.filter(c => !c.hidden).findIndex(c => c.key === k);
        tds[idx("pctFood")].innerHTML = csPill(T.pctF, T.tgtF); tds[idx("pctBev")].innerHTML = csPill(T.pctB, T.tgtB); tds[idx("pct")].innerHTML = csPill(T.pct, T.tgt); }

      // ---- bullet rasio vs target ----
      const bl = outlets.filter(r => r.pct != null), mx = Math.max(0.45, ...bl.map(r => r.pct)) * 1.02;
      host.querySelector("#csBul").innerHTML = bl.length ? bl.map(r => { const tg = Cost.target("SUM", null, r.revFood, r.revBev), b = Cost.band(r.pct, tg);
        return `<div class="bul-r"><span class="bul-u">${esc(r.unit)}</span><div class="bul-t"><span class="bul-band" style="left:${(tg * 0.9 / mx * 100).toFixed(2)}%;width:${(tg * 0.1 / mx * 100).toFixed(2)}%"></span><i style="width:${(Math.min(r.pct, mx) / mx * 100).toFixed(2)}%;background:var(--${b === "caution" ? "warn" : b})"></i><b style="left:${(tg / mx * 100).toFixed(2)}%"></b></div><span class="num bul-v">${esc(fmtPct(r.pct, 1))}</span></div>`; }).join("")
        : UI.empty(t("No units with revenue in this period."));

      // ---- stacked total per unit ----
      host.querySelector("#csSrcT").appendChild(UI.seg([["all", t("DML + SR/Transfer")], ["dml", "DML"], ["srt", "SR/Transfer"]], CSU.src, v => { CSU.src = v; draw(); }, t("Source")));
      const part = r => CSU.src === "dml" ? [r.dmlK, r.dmlB, r.dmlE] : CSU.src === "srt" ? [r.consK, r.consB, 0] : [r.K, r.Bk, r.E];
      const st = rows.map(r => ({ r, p: part(r) })).map(x => ({ ...x, s: x.p[0] + x.p[1] + x.p[2] })).filter(x => x.s > 0), smx = Math.max(1, ...st.map(x => x.s));
      host.querySelector("#csStack").innerHTML = st.length ? st.map(x => `<div class="bul-r" title="${esc(`${t("Kitchen")} ${fmt(x.p[0])} · ${t("Bar")} ${fmt(x.p[1])} · ${t("Event")} ${fmt(x.p[2])}`)}"><span class="bul-u">${esc(x.r.unit)}</span>
          <div class="stk" style="width:${(x.s / smx * 100).toFixed(2)}%">${[["accent", 0], ["orange", 1], ["pink", 2]].map(([c, i]) => x.p[i] > 0 ? `<i style="width:${(x.p[i] / x.s * 100).toFixed(2)}%;background:var(--${c})"></i>` : "").join("")}</div><span class="num bul-v">${esc(fmt(x.s))}</span></div>`).join("")
        : UI.empty(t("No cost data for the selected filters."));

      // ---- harian ----
      const dk = CSU.focus ? [CSU.focus] : keys.filter(k => !COST_CENTER_ONLY.has(k));
      const S = Cost.daily(o, dk), dates = Object.keys(S).sort();
      host.querySelector("#csDayT").appendChild(UI.seg([["all", t("DML + SR/Transfer")], ["dml", "DML"], ["srt", "SR/Transfer"]], CSU.src, v => { CSU.src = v; draw(); }, t("Source")));
      const cv = d => CSU.src === "dml" ? S[d].dml : CSU.src === "srt" ? S[d].srt : S[d].dml + S[d].srt;
      const cvs = host.querySelector("#csDay");
      if (dates.length && chartReady(cvs)) {
        const c = chartColors(), info = dates.map(d => Rev.dayInfo(d));
        charts.push(new Chart(cvs, { data: { labels: dates.map(d => String(+d.slice(8, 10))), datasets: [
          { type: "bar", label: t("Cost"), yAxisID: "y", data: dates.map(cv), backgroundColor: c.fc + "B3", borderRadius: 4, maxBarThickness: 18 },
          { type: "line", label: t("Revenue"), yAxisID: "y2", data: dates.map(d => S[d].rev || null), borderColor: c.orange, backgroundColor: c.orange, pointRadius: 2, tension: .2,
            segment: { borderDash: s => S[dates[s.p1DataIndex]].fc ? [5, 4] : undefined } }] },
          options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
            plugins: { legend: { display: false }, tooltip: { callbacks: {
              title: it => { const d = dates[it[0].dataIndex]; return dateLabel(d) + " (" + info[it[0].dataIndex].dow + ")" + (S[d].fc ? " · " + t("forecast") : ""); },
              label: x => x.dataset.label + ": " + fmtRp(x.parsed.y || 0),
              afterBody: it => { const d = dates[it[0].dataIndex], v = S[d]; const out = ["DML: " + fmtRp(v.dml), "SR/Transfer: " + fmtRp(v.srt)];
                if (v.rev > 0) out.push(t("Ratio this day: {p}", { p: fmtPct(cv(d) / v.rev, 1) })); return out; } } } },
            scales: { x: { grid: { display: false }, ticks: { autoSkip: cvs.clientWidth < 640, maxRotation: 0, font: { size: 11 }, color: x => { const i = info[x.index]; return i && i.holiday ? c.pink : i && i.weekend ? c.orange : c.muted; } } },
              y: { beginAtZero: true, position: "left", grid: { color: c.line }, ticks: { callback: v => fmt(v, 1) } },
              y2: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, ticks: { callback: v => fmt(v, 1) } } } } }));
      } else if (!dates.length) cvs.parentElement.innerHTML = UI.empty(t("No cost data for the selected filters."));
    };
    draw();
    const onTheme = () => draw();
    document.addEventListener("fmd:theme", onTheme);
    return () => { document.removeEventListener("fmd:theme", onTheme); kill(); };
  },
});
