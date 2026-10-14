/* Overview › Executive Summary */
"use strict";

const SUM_CFG = {
  ACH_CRIT: 0.8, ACH_WARN: 0.9,
  EVENT_DAYS: 21, EVENT_RATIO: 1.0, EVENT_MIN_RP: 50e6, // ambang event signifikan (usulan; konfirmasi Ans)
  RELIABLE_MIN: 0.7, ATTN_MAX: 4, ALERTS_SHOWN: 6,
};
const SUM_UI = { cluster: "ALL", view: "daily", sev: "all", showAll: false };

const joinList = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const rp = (n, dp) => fmtRp(n, dp);

function summaryModel(cluster) {
  const m = Rev.month(), last = Rev.last();
  const rows = Rev.outletRows(cluster), T = Rev.totals(rows);
  const daysIn = Rev.daysInMonth(m), elapsed = +last.slice(8, 10), remain = daysIn - elapsed;
  const prevM = addMonths(m, -1), I = Rev.idx();
  let prevSame = 0;
  rows.forEach(r => r.members.forEach(o => { const d = I.byOutletDay[o] || {};
    for (const t in d) if (t.slice(0, 7) === prevM && +t.slice(8, 10) <= elapsed) prevSame += d[t]; }));
  const budgeted = rows.filter(r => r.budget > 0).map(r => ({ ...r, ach: r.proj / r.budget, gap: r.budget - r.proj }));
  const shortfalls = budgeted.filter(r => r.gap > 0).sort((a, b) => b.gap - a.gap);
  const lag = rows.filter(r => !r.eventOnly && r.lastDate && r.lastDate < last).map(r => ({ ...r, behind: daysBetween(r.lastDate, last) }));
  const noBudget = rows.filter(r => !(r.budget > 0) && r.proj > 0);
  const reliability = T.fcr > 0 ? T.reliable / T.fcr : null;

  // event signifikan: nilai ≥ rasio × rata-rata revenue harian outlet MTD
  const avgDaily = {}; rows.forEach(r => (avgDaily[r.key] = elapsed ? r.mtd / elapsed : 0));
  const events = Rev.events(cluster, SUM_CFG.EVENT_DAYS).map(e => {
    const base = avgDaily[e.outlet] || 0, ratio = base > 0 ? e.value / base : null;
    return { ...e, ratio, significant: e.value >= SUM_CFG.EVENT_MIN_RP && (ratio == null ? e.value > 0 : ratio >= SUM_CFG.EVENT_RATIO) };
  });
  const sigEvents = events.filter(e => e.significant);

  // ---- alert rule-based ----
  const alerts = []; let checks = 0;
  checks++; budgeted.filter(r => r.ach < SUM_CFG.ACH_WARN).sort((a, b) => b.gap - a.gap).forEach(r => {
    const crit = r.ach < SUM_CFG.ACH_CRIT;
    alerts.push({ sev: crit ? "crit" : "warn", outlet: r.key,
      title: `${r.key} projected at ${fmtPct(r.ach, 0)} of budget`,
      body: `MTD ${rp(r.mtd)} plus forecast ${rp(r.fcr)} for the remaining ${remain} days, against a budget of ${rp(r.budget)}; shortfall ${rp(r.gap)}.` +
        (r.eventOnly ? " Event-only outlet: the forecast reflects the current event pipeline only." : ""),
      action: r.eventOnly ? "Confirm the event pipeline with Sales; unbooked capacity is not included in the forecast."
        : `Review sales initiatives for the remaining ${remain} days and confirm the status of tentative events.`,
      link: ["#/revenue/outlet", "Revenue › By Outlet"] });
  });
  checks++; lag.forEach(r => alerts.push({ sev: "warn", outlet: r.key, title: `${r.key} revenue data is ${r.behind} day${r.behind > 1 ? "s" : ""} behind`,
    body: `The latest ${r.key} record is dated ${dateLabel(r.lastDate)}, while other outlets are reported through ${dateLabel(last)}. Its month-end projection is likely understated.`,
    action: "Follow up with the unit to submit the daily report.", link: ["#/data/status", "Data › Status"] }));
  checks++; if (noBudget.length) alerts.push({ sev: "warn", title: `No ${monthLabel(m, true).split(" ")[0]} budget for ${joinList(noBudget.map(r => r.key))}`,
    body: `${joinList(noBudget.map(r => r.key))} ${noBudget.length > 1 ? "have" : "has"} revenue (projection ${rp(noBudget.reduce((s, r) => s + r.proj, 0))}) but no budget, so ${noBudget.length > 1 ? "they are" : "it is"} excluded from budget attainment.`,
    action: "Add the budget to Budget_Master, or confirm that these outlets are intentionally unbudgeted.", link: ["#/data/status", "Data › Status"] });
  checks++; if (reliability != null && reliability < SUM_CFG.RELIABLE_MIN) alerts.push({ sev: "info",
    title: "Forecast relies heavily on pooled baselines",
    body: `Only ${fmtPct(reliability, 0)} of the remaining forecast is backed by a full day-of-week baseline or confirmed events.`,
    action: "Treat the month-end projection as indicative.", link: ["#/revenue/daily", "Revenue › Daily & Projection"] });
  checks++; // event check (tampil di kartu event)
  const order = { crit: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => order[a.sev] - order[b.sev]);

  // ---- brief ----
  const mName = monthLabel(m, true).split(" ")[0];
  const parts = [];
  checks++;
  parts.push(`${mName} revenue is projected at ${rp(T.proj)} (MTD ${rp(T.mtd)} plus forecast ${rp(T.fcr)} for the remaining ${remain} days)` +
    (T.ach != null ? `, ${fmtPct(T.ach)} of budget on a like-for-like basis.` : "; no budget is available for comparison."));
  if (T.ach != null) {
    const g = T.budget - T.lflProj;
    if (g > 0) parts.push(`The like-for-like shortfall is ${rp(g)}` + (shortfalls.length ? `; the largest gaps are at ${joinList(shortfalls.slice(0, 3).map(r => `${r.key} (${rp(r.gap)})`))}.` : "."));
    else parts.push(`Outlets are ahead of budget by ${rp(-g)} on a like-for-like basis.`);
  }
  if (noBudget.length) parts.push(`${joinList(noBudget.map(r => r.key))} ${noBudget.length > 1 ? "are" : "is"} excluded because no budget is set.`);
  checks++;
  if (prevSame > 0) parts.push(`MTD revenue is ${fmtPct(T.mtd / prevSame - 1)} ${T.mtd >= prevSame ? "above" : "below"} the same ${elapsed} days of ${monthLabel(prevM, true).split(" ")[0]}.`);
  if (lag.length) parts.push(`Data for ${joinList(lag.map(r => r.key))} is behind.`);
  if (sigEvents.length) parts.push(`${sigEvents.length} significant event${sigEvents.length > 1 ? "s" : ""} worth ${rp(sigEvents.reduce((s, e) => s + e.value, 0))} ${sigEvents.length > 1 ? "are" : "is"} scheduled in the next ${SUM_CFG.EVENT_DAYS} days.`);

  const attn = budgeted.filter(r => r.ach < SUM_CFG.ACH_WARN).sort((a, b) => b.gap - a.gap).slice(0, SUM_CFG.ATTN_MAX)
    .map(r => ({ ...r, reason: (lag.find(x => x.key === r.key) ? "Data behind · " : "") + "Gap " + rp(r.gap) }));
  return { m, last, rows, T, daysIn, elapsed, remain, prevSame, prevM, reliability, alerts, checks, brief: parts.join(" "), attn, events, sigEvents };
}

/* ---------- Chart ---------- */
function summaryChart(canvas, M, view) {
  if (typeof Chart !== "function" || !Chart.register) { canvas.parentElement.innerHTML = UI.empty("Chart library could not load."); return null; }
  const c = { accent: cssVar("--accent"), fc: cssVar("--fc"), orange: cssVar("--orange"), pink: cssVar("--pink"), ev: cssVar("--ev-bar"), muted: cssVar("--muted"), line: cssVar("--line"), ink: cssVar("--ink"), track: cssVar("--track") };
  Chart.defaults.font.family = "Poppins, system-ui, sans-serif"; Chart.defaults.color = c.muted;
  const yTicks = { callback: v => fmt(v, 1), color: c.muted }, grid = { color: c.line };
  if (view === "monthly") {
    const s = Rev.monthlySeries(M.rows);
    return new Chart(canvas, { type: "bar", data: { labels: s.map(x => MONTHS[+x.m.slice(5, 7) - 1]), datasets: [
      { label: "Actual", data: s.map(x => x.actual), backgroundColor: c.accent, stack: "a", borderRadius: 8, maxBarThickness: 26 },
      { label: "Forecast", data: s.map(x => x.forecast || null), backgroundColor: c.fc, stack: "a", borderRadius: 8, maxBarThickness: 26 },
      { label: "Budget", data: s.map(x => x.budget || null), backgroundColor: c.orange, stack: "b", borderRadius: 8, maxBarThickness: 26 } ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
        tooltip: { callbacks: { label: x => x.dataset.label + ": " + fmtRp(x.parsed.y) } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: yTicks, grid } } } });
  }
  const s = Rev.dailySeries(M.rows), info = s.dates.map(d => Rev.dayInfo(d));
  const budDaily = M.T.budget > 0 ? M.T.budget / M.daysIn : null;
  const pt = base => info.map(x => x.holiday ? c.pink : x.weekend ? c.orange : base);
  return new Chart(canvas, { data: { labels: s.dates.map(d => String(+d.slice(8, 10))), datasets: [
    { type: "line", label: "Actual", data: s.actual, borderColor: c.accent, backgroundColor: pt(c.accent), pointBorderColor: pt(c.accent), pointRadius: 4, borderWidth: 3, tension: .25, spanGaps: false, order: 1 },
    { type: "line", label: "Forecast", data: s.forecast, borderColor: c.fc, backgroundColor: pt(c.fc), pointBorderColor: pt(c.fc), pointRadius: 4, borderWidth: 3, borderDash: [7, 6], tension: .25, spanGaps: false, order: 2 },
    { type: "line", label: "Budget (daily average)", data: s.dates.map(() => budDaily), borderColor: c.orange, borderWidth: 1.5, borderDash: [6, 5], pointRadius: 0, order: 3 },
    { type: "bar", label: "Scheduled events (forecast)", data: s.event, backgroundColor: c.ev, borderRadius: 4, maxBarThickness: 12, order: 4 } ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: it => { const d = s.dates[it[0].dataIndex], x = info[it[0].dataIndex]; return dateLabel(d) + " (" + x.dow + ")" + (x.holiday ? " · " + (x.note || "Public holiday") : ""); },
        label: x => x.parsed.y == null ? null : x.dataset.label + ": " + fmtRp(x.parsed.y) } } },
      scales: { x: { grid: { display: false }, ticks: { color: ctx => { const x = info[ctx.index]; return x && x.holiday ? c.pink : x && x.weekend ? c.orange : c.muted; }, autoSkip: false, maxRotation: 0,
        callback: (v, i) => (i % 2 === 0 || info[i].weekend || info[i].holiday) ? String(i + 1) : "" } }, y: { ticks: yTicks, grid, beginAtZero: true } } } });
}

/* ---------- Render ---------- */
FMD.page("overview/summary", {
  async render(host, ctx) {
    host.innerHTML = `<div class="grid g4">${UI.skeleton(110).repeat(4)}</div>${UI.skeleton(320)}`;
    const { missing } = await Data.load(REV_TABS);
    if (ctx.isStale()) return;
    if (!STATE.lastActualDate) { host.innerHTML = UI.card({ body: UI.banner("Revenue data is not available" + (missing.length ? ": " + missing.map(x => x.tab).join(", ") : "."), "warn") }); return; }
    let chart = null;
    const draw = () => {
      if (chart) { chart.destroy(); chart = null; }
      const M = summaryModel(SUM_UI.cluster), T = M.T;
      $("pageTitle").textContent = "Executive Summary — " + monthLabel(M.m, true);
      const lfl = T.noBudget.length ? "Like-for-like · excl. " + T.noBudget.join(", ") : "Like-for-like basis";
      const relTxt = M.reliability == null ? "No forecast remaining" : `Forecast reliability: ${M.reliability >= .85 ? "high" : M.reliability >= .7 ? "medium" : "low"}`;
      const gap = T.budget - T.lflProj;
      const kpis = [
        UI.kpi({ label: "Revenue MTD", value: rp(T.mtd), note: M.prevSame > 0 ? `${T.mtd >= M.prevSame ? "+" : ""}${fmtPct(T.mtd / M.prevSame - 1)} vs same days ${MONTHS[+M.prevM.slice(5, 7) - 1]}` : `Through ${dateLabel(M.last)}`,
          ratio: T.proj > 0 ? T.mtd / T.proj : null, variant: "orange", title: "Ring: MTD as a share of the month-end projection" }),
        UI.kpi({ label: "Month-End Projection", value: rp(T.proj), note: relTxt, ratio: M.reliability, variant: "indigo",
          title: "Ring: share of the remaining forecast backed by a full baseline or confirmed events" }),
        UI.kpi({ label: "Budget Attainment", value: fmtPct(T.ach), note: lfl, ratio: T.ach,
          title: `All outlets incl. unbudgeted: ${fmtPct(T.achAll)} (classic dashboard basis)` }),
        UI.kpi({ label: gap > 0 ? "Gap to Budget" : "Ahead of Budget", value: rp(Math.abs(gap)),
          note: gap > 0 && M.remain > 0 ? `Needs ${rp((T.budget - T.lflMtd) / M.remain)}/day vs forecast ${rp((T.lflProj - T.lflMtd) / M.remain)}/day` : "Like-for-like",
          ratio: T.budget > 0 ? Math.min(1, T.lflProj / T.budget) : null, variant: "pink", title: "Ring: like-for-like projection as a share of budget" }),
      ];
      const sevName = { crit: "Critical", warn: "Warning", info: "Info", all: "All" };
      const shown = M.alerts.filter(a => SUM_UI.sev === "all" || a.sev === SUM_UI.sev);
      const list = SUM_UI.showAll ? shown : shown.slice(0, SUM_CFG.ALERTS_SHOWN);
      const achTag = r => UI.tag(fmtPct(r.ach, 0), r.ach < SUM_CFG.ACH_CRIT ? "crit" : "warn");
      host.innerHTML = `
        <div class="filters">${""}</div>
        <section class="grid g4" aria-label="Key figures">${kpis.join("")}</section>
        <section class="grid g3">
          <div class="card span2">
            <div class="card-h"><div style="display:flex;gap:12px;align-items:center">
              <span style="width:40px;height:40px;border-radius:14px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/></svg></span>
              <div><h2>Executive Brief</h2><div class="sub">Automated insight · ${M.checks} rule-based checks · data through ${esc(dateLabel(M.last))}</div></div></div></div>
            <p style="margin:0;font-size:14.5px;line-height:1.7">${esc(M.brief)}</p>
            <div class="chips" style="align-items:center"><span class="muted" style="font-size:12px;margin-right:4px">Alerts</span>
              ${["all", "crit", "warn", "info"].map(k => { const n = k === "all" ? M.alerts.length : M.alerts.filter(a => a.sev === k).length;
                return `<button type="button" class="chip" data-sev="${k}" aria-pressed="${SUM_UI.sev === k}">${sevName[k]} (${n})</button>`; }).join("")}</div>
            <div style="display:flex;flex-direction:column;gap:10px">
              ${list.length ? list.map(a => `<article class="alert">
                <span class="tag ${a.sev}" style="min-width:68px;text-align:center">${sevName[a.sev]}</span>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
                  <h3 style="margin:0;font-size:14px;font-weight:600">${esc(a.title)}</h3>
                  <p style="margin:0;font-size:13px;line-height:1.55;color:var(--body)">${esc(a.body)}</p>
                  <p style="margin:2px 0 0;font-size:13px;line-height:1.55"><b>Recommended action:</b> ${esc(a.action)}</p></div>
                <a class="alert-link" href="${a.link[0]}">${esc(a.link[1])} →</a></article>`).join("")
                : UI.empty("No alerts for this selection.")}
              ${shown.length > SUM_CFG.ALERTS_SHOWN ? `<button type="button" class="btn" id="alertMore" style="align-self:flex-start">${SUM_UI.showAll ? "Show fewer" : `Show all ${shown.length} alerts`}</button>` : ""}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
            <div class="card"><h2 style="margin:0;font-size:17px">Outlets Requiring Attention</h2>
              ${M.attn.length ? M.attn.map(r => `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)">
                ${UI.unitBadge(r.key)}<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.name)}">${esc(r.name)}</div>
                <div class="muted" style="font-size:12px">${esc(r.reason)}</div></div>${achTag(r)}</div>`).join("")
                : UI.empty("All budgeted outlets are projected at 90% of budget or above.")}
              <a href="#/revenue/outlet" style="font-size:13px">View all outlets</a></div>
            <div class="card"><div><h2 style="margin:0;font-size:17px">Upcoming Significant Events</h2>
              <div class="sub muted" style="font-size:12px">Next ${SUM_CFG.EVENT_DAYS} days · value ≥ ${SUM_CFG.EVENT_RATIO * 100}% of the outlet’s average daily revenue (MTD) and ≥ ${rp(SUM_CFG.EVENT_MIN_RP, 0)}</div></div>
              ${M.sigEvents.length ? M.sigEvents.slice(0, 6).map(e => { const d = daysBetween(M.last, e.date);
                return `<div style="display:flex;gap:12px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)">
                <div style="flex:0 0 48px;height:52px;border-radius:14px;background:var(--soft);display:flex;flex-direction:column;align-items:center;justify-content:center">
                  <span style="font-size:17px;font-weight:700;line-height:1">${+e.date.slice(8, 10)}</span><span class="muted" style="font-size:10px;text-transform:uppercase">${MONTHS[+e.date.slice(5, 7) - 1]}</span></div>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
                  <div style="display:flex;justify-content:space-between;gap:8px"><span style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.name)}">${esc(e.name)}</span><span class="num" style="font-size:13px;font-weight:600;white-space:nowrap">${esc(rp(e.value))}</span></div>
                  <div class="muted" style="font-size:12px">${esc(e.outlet)} · ${e.pax ? fmtInt(e.pax) + " pax" : "pax n/a"} · in ${d} day${d > 1 ? "s" : ""}</div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">${UI.tag(e.definite ? "Definite" : (e.status || "Tentative"), e.definite ? "ok" : "warn")}${e.ratio != null ? UI.tag(e.ratio.toFixed(1) + "× daily average", e.ratio >= 2 ? "info" : "mute") : ""}</div></div></div>`; }).join("")
                : UI.empty("No significant events in the next " + SUM_CFG.EVENT_DAYS + " days.")}
              ${M.sigEvents.length > 6 ? `<div class="muted" style="font-size:12px">+${M.sigEvents.length - 6} more</div>` : ""}
              <a href="#/revenue/events" style="font-size:13px">View event pipeline (${M.events.length} in window)</a></div>
          </div>
        </section>
        <section class="card">
          <div class="card-h"><div><h2 id="chTitle"></h2><div class="sub" id="chSub"></div></div><div class="card-tools" id="chTools"></div></div>
          <div id="chLegend" style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--muted)"></div>
          <div style="position:relative;height:280px"><canvas id="sumChart" aria-label="Revenue chart" role="img"></canvas></div>
        </section>`;
      host.querySelector(".filters").appendChild(UI.clusterSelect(SUM_UI.cluster, v => { SUM_UI.cluster = v; SUM_UI.showAll = false; draw(); }));
      host.querySelectorAll("[data-sev]").forEach(b => b.onclick = () => { SUM_UI.sev = b.dataset.sev; SUM_UI.showAll = false; draw(); });
      const more = host.querySelector("#alertMore"); if (more) more.onclick = () => { SUM_UI.showAll = !SUM_UI.showAll; draw(); };
      const daily = SUM_UI.view === "daily";
      $("chTitle").textContent = daily ? "Daily Revenue — Actual & Forecast" : "Revenue vs Budget — Year to Date";
      $("chSub").textContent = daily ? `${monthLabel(M.m, true)} · actual through ${dateLabel(M.last)}, forecast for the remaining days` : `${monthLabel(M.m).slice(0, 3)} bar = MTD actual + forecast for the remaining days`;
      $("chTools").appendChild(UI.seg([["daily", "Daily"], ["monthly", "Monthly"]], SUM_UI.view, v => { SUM_UI.view = v; draw(); }, "Chart view"));
      const sw = (bg, dash) => `<span style="display:flex;align-items:center;gap:6px"><span style="width:18px;${dash ? `border-top:3px dashed ${bg}` : `height:10px;border-radius:3px;background:${bg}`}"></span>`;
      $("chLegend").innerHTML = daily
        ? `${sw("var(--accent)")}Actual</span>${sw("var(--fc)", 1)}Forecast</span>${sw("var(--orange)", 1)}Budget (daily average)</span>${sw("var(--ev-bar)")}Event value in forecast</span><span style="display:flex;align-items:center;gap:6px"><span class="dot" style="background:var(--orange)"></span>Weekend</span><span style="display:flex;align-items:center;gap:6px"><span class="dot" style="background:var(--pink)"></span>Public holiday</span>`
        : `${sw("var(--accent)")}Actual</span>${sw("var(--fc)")}Forecast</span>${sw("var(--orange)")}Budget</span>`;
      chart = summaryChart($("sumChart"), M, SUM_UI.view);
    };
    draw();
    const onTheme = () => draw();
    document.addEventListener("fmd:theme", onTheme);
    return () => { document.removeEventListener("fmd:theme", onTheme); if (chart) chart.destroy(); };
  },
});
