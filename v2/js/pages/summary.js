/* Overview › Executive Summary */
"use strict";

const SUM_CFG = { ACH_CRIT: 0.8, ACH_WARN: 0.9, EVENT_DAYS: 7, EVENTS_SHOWN: 8, RELIABLE_MIN: 0.7, ATTN_MAX: 4, ALERTS_SHOWN: 6 };
const SUM_UI = { cluster: "ALL", outlet: "ALL", view: "daily", sev: "all", showAll: false };
const rp = (n, dp) => fmtRp(n, dp);
const SEV_NAME = () => ({ crit: t("Critical"), warn: t("Warning"), info: t("Info"), all: t("All") });

function summaryModel(cluster) {
  const m = Rev.month(), last = Rev.last();
  const rows = Rev.outletRows(cluster), T = Rev.totals(rows);
  const daysIn = Rev.daysInMonth(m), elapsed = +last.slice(8, 10), remain = daysIn - elapsed;
  const prevM = addMonths(m, -1), prevSame = Rev.sameDays(rows, prevM, elapsed);
  const budgeted = rows.filter(r => r.budget > 0).map(r => ({ ...r, ach: r.proj / r.budget, gap: r.budget - r.proj }));
  const shortfalls = budgeted.filter(r => r.gap > 0).sort((a, b) => b.gap - a.gap);
  const lag = rows.filter(r => !r.eventOnly && r.lastDate && r.lastDate < last).map(r => ({ ...r, behind: daysBetween(r.lastDate, last) }));
  const noBudget = rows.filter(r => !(r.budget > 0) && r.proj > 0);
  const reliability = T.fcr > 0 ? T.reliable / T.fcr : null;
  const avgDaily = {}; rows.forEach(r => (avgDaily[r.key] = elapsed ? r.mtd / elapsed : 0));
  const events = Rev.events(cluster, SUM_CFG.EVENT_DAYS).map(e => {
    const base = avgDaily[e.outlet] || 0; return { ...e, ratio: base > 0 ? e.value / base : null };
  }).sort((a, b) => b.value - a.value || a.date.localeCompare(b.date));
  const mName = monthName(m, true), keys = a => joinList(a.map(r => r.key));

  const alerts = []; let checks = 0;
  checks++; budgeted.filter(r => r.ach < SUM_CFG.ACH_WARN).sort((a, b) => b.gap - a.gap).forEach(r => {
    alerts.push({ sev: r.ach < SUM_CFG.ACH_CRIT ? "crit" : "warn", outlet: r.key,
      title: t("{k} projected at {p} of budget", { k: r.key, p: fmtPct(r.ach, 0) }),
      body: t("MTD {mtd} plus forecast {fc} for the remaining {d} days, against a budget of {b}; shortfall {g}.", { mtd: rp(r.mtd), fc: rp(r.fcr), d: remain, b: rp(r.budget), g: rp(r.gap) }) +
        (r.eventOnly ? " " + t("Event-only outlet: the forecast reflects the current event pipeline only.") : ""),
      action: r.eventOnly ? t("Confirm the event pipeline with Sales; unbooked capacity is not included in the forecast.")
        : t("Review sales initiatives for the remaining {d} days and confirm the status of tentative events.", { d: remain }),
      link: ["#/revenue/outlet", t("Revenue") + " › " + t("By Outlet")] });
  });
  checks++; lag.forEach(r => alerts.push({ sev: "warn", outlet: r.key,
    title: tn(r.behind, "{k} revenue data is {n} day behind", "{k} revenue data is {n} days behind", { k: r.key }),
    body: t("The latest {k} record is dated {d}, while other outlets are reported through {l}. Its month-end projection is likely understated.", { k: r.key, d: dateLabel(r.lastDate), l: dateLabel(last) }),
    action: t("Follow up with the unit to submit the daily report."), link: ["#/data/status", t("Data") + " › " + t("Status")] }));
  checks++; if (noBudget.length) alerts.push({ sev: "warn",
    title: t("No {m} budget for {k}", { m: mName, k: keys(noBudget) }),
    body: tn(noBudget.length, "{k} has revenue (projection {p}) but no budget, so it is excluded from budget attainment.", "{k} have revenue (projection {p}) but no budget, so they are excluded from budget attainment.", { k: keys(noBudget), p: rp(noBudget.reduce((s, r) => s + r.proj, 0)) }),
    action: t("Add the budget to Budget_Master, or confirm that these outlets are intentionally unbudgeted."), link: ["#/data/status", t("Data") + " › " + t("Status")] });
  checks++; if (reliability != null && reliability < SUM_CFG.RELIABLE_MIN) alerts.push({ sev: "info",
    title: t("Forecast relies heavily on pooled baselines"),
    body: t("Only {p} of the remaining forecast is backed by a full day-of-week baseline or confirmed events.", { p: fmtPct(reliability, 0) }),
    action: t("Treat the month-end projection as indicative."), link: ["#/revenue/daily", t("Revenue") + " › " + t("Daily & Projection")] });
  checks++;
  const order = { crit: 0, warn: 1, info: 2 }; alerts.sort((a, b) => order[a.sev] - order[b.sev]);

  const parts = []; checks++;
  parts.push(t("{m} revenue is projected at {p} (MTD {mtd} plus forecast {fc} for the remaining {d} days)", { m: mName, p: rp(T.proj), mtd: rp(T.mtd), fc: rp(T.fcr), d: remain }) +
    (T.ach != null ? t(", {a} of budget on a like-for-like basis.", { a: fmtPct(T.ach) }) : t("; no budget is available for comparison.")));
  if (T.ach != null) {
    const g = T.budget - T.lflProj;
    if (g > 0) parts.push(t("The like-for-like shortfall is {g}", { g: rp(g) }) + (shortfalls.length ? t("; the largest gaps are at {l}.", { l: joinList(shortfalls.slice(0, 3).map(r => `${r.key} (${rp(r.gap)})`)) }) : "."));
    else parts.push(t("Outlets are ahead of budget by {g} on a like-for-like basis.", { g: rp(-g) }));
  }
  if (noBudget.length) parts.push(tn(noBudget.length, "{k} is excluded because no budget is set.", "{k} are excluded because no budget is set.", { k: keys(noBudget) }));
  checks++;
  if (prevSame > 0) parts.push(t(T.mtd >= prevSame ? "MTD revenue is {p} above the same {d} days of {m}." : "MTD revenue is {p} below the same {d} days of {m}.", { p: fmtPct(Math.abs(T.mtd / prevSame - 1)), d: elapsed, m: monthName(prevM, true) }));
  if (lag.length) parts.push(t("Data for {k} is behind.", { k: keys(lag) }));
  if (events.length) parts.push(tn(events.length, "{n} event worth {v} is scheduled in the next {d} days.", "{n} events worth {v} are scheduled in the next {d} days.", { v: rp(events.reduce((s, e) => s + e.value, 0)), d: SUM_CFG.EVENT_DAYS }));

  const attn = budgeted.filter(r => r.ach < SUM_CFG.ACH_WARN).sort((a, b) => b.gap - a.gap).slice(0, SUM_CFG.ATTN_MAX)
    .map(r => ({ ...r, reason: (lag.find(x => x.key === r.key) ? t("Data behind") + " · " : "") + t("Gap") + " " + rp(r.gap) }));
  return { m, last, rows, T, daysIn, elapsed, remain, prevSame, prevM, reliability, alerts, checks, brief: parts.join(" "), attn, events };
}

FMD.page("overview/summary", {
  async render(host, ctx) {
    host.innerHTML = `<div class="grid g4">${UI.skeleton(110).repeat(4)}</div>${UI.skeleton(320)}`;
    const { missing } = await Data.load(REV_TABS);
    if (ctx.isStale()) return;
    if (!STATE.lastActualDate) { host.innerHTML = UI.card({ body: UI.banner(t("Revenue data is not available") + (missing.length ? ": " + missing.map(x => x.tab).join(", ") : "."), "warn") }); return; }
    let chart = null;
    const draw = () => {
      if (chart) { chart.destroy(); chart = null; }
      const M = summaryModel(SUM_UI.cluster), T = M.T, SN = SEV_NAME();
      $("pageTitle").textContent = t("Executive Summary") + " — " + monthLabel(M.m, true);
      const lfl = T.noBudget.length ? t("Like-for-like · excl. {k}", { k: T.noBudget.join(", ") }) : t("Like-for-like basis");
      const relTxt = M.reliability == null ? t("No forecast remaining") : t(M.reliability >= .85 ? "Forecast reliability: high" : M.reliability >= .7 ? "Forecast reliability: medium" : "Forecast reliability: low");
      const gap = T.budget - T.lflProj;
      const kpis = [
        UI.kpi({ label: t("Revenue MTD"), value: rp(T.mtd), note: M.prevSame > 0 ? t("{p} vs same days {m}", { p: (T.mtd >= M.prevSame ? "+" : "") + fmtPct(T.mtd / M.prevSame - 1), m: monthName(M.prevM) }) : t("Through {d}", { d: dateLabel(M.last) }),
          ratio: T.proj > 0 ? T.mtd / T.proj : null, variant: "orange", title: t("Ring: MTD as a share of the month-end projection") }),
        UI.kpi({ label: t("Month-End Projection"), value: rp(T.proj), note: relTxt, ratio: M.reliability, variant: "indigo", title: t("Ring: share of the remaining forecast backed by a full baseline or confirmed events") }),
        UI.kpi({ label: t("Budget Attainment"), value: fmtPct(T.ach), note: lfl, ratio: T.ach, title: t("All outlets incl. unbudgeted: {p} (classic dashboard basis)", { p: fmtPct(T.achAll) }) }),
        UI.kpi({ label: gap > 0 ? t("Gap to Budget") : t("Ahead of Budget"), value: rp(Math.abs(gap)),
          note: gap > 0 && M.remain > 0 ? t("Needs {a}/day vs forecast {b}/day", { a: rp((T.budget - T.lflMtd) / M.remain), b: rp((T.lflProj - T.lflMtd) / M.remain) }) : t("Like-for-like basis"),
          ratio: T.budget > 0 ? Math.min(1, T.lflProj / T.budget) : null, variant: "pink", title: t("Ring: like-for-like projection as a share of budget") }),
      ];
      const shown = M.alerts.filter(a => SUM_UI.sev === "all" || a.sev === SUM_UI.sev);
      const list = SUM_UI.showAll ? shown : shown.slice(0, SUM_CFG.ALERTS_SHOWN);
      const achTag = r => UI.tag(fmtPct(r.ach, 0), r.ach < SUM_CFG.ACH_CRIT ? "crit" : "warn");
      const evTotal = M.events.reduce((s, e) => s + e.value, 0);
      host.innerHTML = `
        <div class="filters"></div>
        <section class="grid g4" aria-label="${esc(t("Key figures"))}">${kpis.join("")}</section>
        <section class="grid g3">
          <div class="card span2">
            <div class="card-h"><div style="display:flex;gap:12px;align-items:center">
              <span style="width:40px;height:40px;border-radius:14px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/></svg></span>
              <div><h2>${esc(t("Executive Brief"))}</h2><div class="sub">${esc(t("Automated insight · {n} rule-based checks · data through {d}", { n: M.checks, d: dateLabel(M.last) }))}</div></div></div></div>
            <p style="margin:0;font-size:14.5px;line-height:1.7">${esc(M.brief)}</p>
            <div class="chips" style="align-items:center"><span class="muted" style="font-size:12px;margin-right:4px">${esc(t("Alerts"))}</span>
              ${["all", "crit", "warn", "info"].map(k => { const n = k === "all" ? M.alerts.length : M.alerts.filter(a => a.sev === k).length;
                return `<button type="button" class="chip" data-sev="${k}" aria-pressed="${SUM_UI.sev === k}">${esc(SN[k])} (${n})</button>`; }).join("")}</div>
            <div style="display:flex;flex-direction:column;gap:10px">
              ${list.length ? list.map(a => `<article class="alert">
                <span class="tag ${a.sev}" style="min-width:68px;text-align:center">${esc(SN[a.sev])}</span>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
                  <h3 style="margin:0;font-size:14px;font-weight:600">${esc(a.title)}</h3>
                  <p style="margin:0;font-size:13px;line-height:1.55;color:var(--body)">${esc(a.body)}</p>
                  <p style="margin:2px 0 0;font-size:13px;line-height:1.55"><b>${esc(t("Recommended action:"))}</b> ${esc(a.action)}</p></div>
                <a class="alert-link" href="${a.link[0]}">${esc(a.link[1])} →</a></article>`).join("")
                : UI.empty(t("No alerts for this selection."))}
              ${shown.length > SUM_CFG.ALERTS_SHOWN ? `<button type="button" class="btn" id="alertMore" style="align-self:flex-start">${esc(SUM_UI.showAll ? t("Show fewer") : t("Show all {n} alerts", { n: shown.length }))}</button>` : ""}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
            <div class="card"><h2 style="margin:0;font-size:17px">${esc(t("Outlets Requiring Attention"))}</h2>
              ${M.attn.length ? M.attn.map(r => `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)">
                ${UI.unitBadge(r.key)}<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.name)}">${esc(r.name)}</div>
                <div class="muted" style="font-size:12px">${esc(r.reason)}</div></div>${achTag(r)}</div>`).join("")
                : UI.empty(t("All budgeted outlets are projected at 90% of budget or above."))}
              <a href="#/revenue/outlet" style="font-size:13px">${esc(t("View all outlets"))}</a></div>
            <div class="card"><div><h2 style="margin:0;font-size:17px">${esc(t("Upcoming Events — Next {d} Days", { d: SUM_CFG.EVENT_DAYS }))}</h2>
              <div class="sub muted" style="font-size:12px">${esc(dateLabel(addDays(M.last, 1)))} – ${esc(dateLabel(addDays(M.last, SUM_CFG.EVENT_DAYS)))} · ${esc(t("sorted by value"))} · ${esc(tn(M.events.length, "{n} event", "{n} events"))}, ${esc(rp(evTotal))}</div></div>
              ${M.events.length ? M.events.slice(0, SUM_CFG.EVENTS_SHOWN).map(e => { const d = daysBetween(M.last, e.date);
                return `<div style="display:flex;gap:12px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)">
                <div style="flex:0 0 48px;height:52px;border-radius:14px;background:var(--soft);display:flex;flex-direction:column;align-items:center;justify-content:center">
                  <span style="font-size:17px;font-weight:700;line-height:1">${+e.date.slice(8, 10)}</span><span class="muted" style="font-size:10px;text-transform:uppercase">${esc(monthName(e.date))}</span></div>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
                  <div style="display:flex;justify-content:space-between;gap:8px"><span style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.name)}">${esc(e.name)}</span><span class="num" style="font-size:13px;font-weight:600;white-space:nowrap">${esc(rp(e.value))}</span></div>
                  <div class="muted" style="font-size:12px">${esc(e.outlet)} · ${esc(e.pax ? t("{n} pax", { n: fmtInt(e.pax) }) : t("pax n/a"))} · ${esc(tn(d, "in {n} day", "in {n} days"))}</div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">${UI.tag(e.definite ? t("Definite") : (e.status || t("Tentative")), e.definite ? "ok" : "warn")}${e.ratio != null ? UI.tag(t("{x} daily average", { x: fmtX(e.ratio) }), e.ratio >= 2 ? "info" : "mute") : ""}</div></div></div>`; }).join("")
                : UI.empty(t("No events in the next {d} days.", { d: SUM_CFG.EVENT_DAYS }))}
              ${M.events.length > SUM_CFG.EVENTS_SHOWN ? `<div class="muted" style="font-size:12px">${esc(t("+{n} more", { n: M.events.length - SUM_CFG.EVENTS_SHOWN }))}</div>` : ""}
              <a href="#/revenue/events" style="font-size:13px">${esc(t("View event pipeline"))}</a></div>
          </div>
        </section>
        <section class="card">
          <div class="card-h"><div><h2 id="chTitle"></h2><div class="sub" id="chSub"></div></div><div class="card-tools" id="chTools"></div></div>
          <div id="chLegend" class="chart-legend"></div>
          <div style="position:relative;height:280px"><canvas id="sumChart" role="img" aria-label="${esc(t("Revenue chart"))}"></canvas></div>
        </section>
        ${costCard()}`;
      host.querySelector(".filters").appendChild(UI.clusterSelect(SUM_UI.cluster, v => { SUM_UI.cluster = v; SUM_UI.outlet = "ALL"; SUM_UI.showAll = false; draw(); }));
      host.querySelectorAll("[data-sev]").forEach(b => b.onclick = () => { SUM_UI.sev = b.dataset.sev; SUM_UI.showAll = false; draw(); });
      const more = host.querySelector("#alertMore"); if (more) more.onclick = () => { SUM_UI.showAll = !SUM_UI.showAll; draw(); };
      const daily = SUM_UI.view === "daily";
      if (SUM_UI.outlet !== "ALL" && !M.rows.some(r => r.key === SUM_UI.outlet)) SUM_UI.outlet = "ALL";
      const cRows = SUM_UI.outlet === "ALL" ? M.rows : M.rows.filter(r => r.key === SUM_UI.outlet);
      const allLbl = SUM_UI.cluster === "ALL" ? t("All outlets") : t("All {c} outlets", { c: SUM_UI.cluster });
      const cName = SUM_UI.outlet === "ALL" ? allLbl : SUM_UI.outlet + " — " + cRows[0].name;
      $("chTitle").textContent = daily ? t("Daily Revenue — Actual & Forecast") : t("Revenue vs Budget — Year to Date");
      $("chSub").textContent = cName + " · " + (daily ? t("{m} · actual through {d}, forecast for the remaining days", { m: monthLabel(M.m, true), d: dateLabel(M.last) }) : t("{m} bar = MTD actual + forecast for the remaining days", { m: monthName(M.m) }));
      $("chTools").appendChild(UI.select(t("Outlet"), [["ALL", allLbl]].concat(M.rows.map(r => [r.key, Dim.outletDisplay(r.key) + " — " + r.name])), SUM_UI.outlet, v => { SUM_UI.outlet = v; draw(); }));
      $("chTools").appendChild(UI.seg([["daily", t("Daily")], ["monthly", t("Monthly")]], SUM_UI.view, v => { SUM_UI.view = v; draw(); }, t("Chart view")));
      $("chLegend").innerHTML = chartLegend(daily ? "daily" : "monthly");
      chart = daily ? dailyRevenueChart($("sumChart"), cRows) : monthlyRevenueChart($("sumChart"), cRows);
    };
    // kartu Rasio Biaya F&B (bulan berjalan) — dimuat setelah revenue tampil, tidak menahan halaman
    let costState = "loading";
    function costCard() {
      if (costState === "hidden") return "";
      if (costState === "loading") return UI.card({ title: t("F&B Cost Ratio · month to date"), body: UI.skeleton(90) });
      const R = { from: (STATE.lastActualDate || "").slice(0, 7) + "-01", to: STATE.lastActualDate };
      const keys = Cost.allKeys().filter(k => !Cost.hidden(k) && !COST_CENTER_ONLY.has(k) && (SUM_UI.cluster === "ALL" || Cost.cluster(k) === SUM_UI.cluster));
      const rows = Cost.summary({ from: R.from, to: R.to, gas: false, fgManual: true, keys: new Set(keys) }), T = Cost.totals(rows);
      const above = rows.filter(r => !r.ck && r.pct != null && r.pct > Cost.target("SUM", null, r.revFood, r.revBev)).sort((a, b) => b.pct - a.pct);
      const pill = (p, g) => p == null ? DASH : `<span class="pill b-${Cost.band(p, g)} num">${esc(fmtPct(p, 1))}</span>`;
      return `<section class="card"><div class="card-h"><div><h2>${esc(t("F&B Cost Ratio · month to date"))}</h2><div class="sub">${esc(t("Provisional: direct purchases + store requisitions, excl. CK · {r}", { r: dateLabel(R.from) + " – " + dateLabel(R.to) }))}</div></div><div class="card-tools"><a href="#/cost/summary" style="font-size:13px">${esc(t("Open Cost of Sales"))}</a></div></div>
        <div class="grid g4">
          <div class="panel"><div class="muted" style="font-size:12px">${esc(t("F&B cost ratio"))}</div><div style="font-size:22px;font-weight:600">${pill(T.pct, T.tgt)}</div><div class="muted" style="font-size:12px">${esc(T.pct == null ? "" : t("{x} vs {g} target", { x: fmtPts(T.pct - T.tgt), g: fmtPct(T.tgt, 0) }))}</div></div>
          <div class="panel"><div class="muted" style="font-size:12px">${esc(t("Food"))}</div><div style="font-size:22px;font-weight:600">${pill(T.pctF, T.tgtF)}</div><div class="muted num" style="font-size:12px">${esc(fmtRp(T.cF))}</div></div>
          <div class="panel"><div class="muted" style="font-size:12px">${esc(t("Beverage"))}</div><div style="font-size:22px;font-weight:600">${pill(T.pctB, T.tgtB)}</div><div class="muted num" style="font-size:12px">${esc(fmtRp(T.cB))}</div></div>
          <div class="panel"><div class="muted" style="font-size:12px">${esc(t("Units above target"))}</div><div style="font-size:22px;font-weight:600">${esc(t("{a} of {b}", { a: above.length, b: rows.filter(r => !r.ck && r.revTot > 0).length }))}</div><div class="muted" style="font-size:12px">${esc(above.slice(0, 4).map(r => r.unit + " " + fmtPct(r.pct, 0)).join(" · "))}</div></div>
        </div></section>`;
    }
    draw();
    Cost.load("summary").then(r => { if (ctx.isStale()) return; costState = r.missing.some(m => m.tab === "DML_Cost_Daily") ? "hidden" : "ready"; draw(); })
      .catch(() => { if (!ctx.isStale()) { costState = "hidden"; draw(); } });
    const onTheme = () => draw();
    document.addEventListener("fmd:theme", onTheme);
    return () => { document.removeEventListener("fmd:theme", onTheme); if (chart) chart.destroy(); };
  },
});
