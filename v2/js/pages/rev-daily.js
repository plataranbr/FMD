/* Revenue › Daily & Projection */
"use strict";

const DP = { cluster: "ALL", outlet: "ALL", month: "", view: "month", selA: "", selF: "" };

FMD.page("revenue/daily", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(80) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(320);
    const { missing } = await Data.load(REV_TABS);
    if (ctx.isStale()) return;
    if (!STATE.lastActualDate) { host.innerHTML = UI.card({ body: UI.banner(t("Revenue data is not available") + (missing.length ? ": " + missing.map(x => x.tab).join(", ") : "."), "warn") }); return; }
    const P = routeParams();
    if (P.outlet) { DP.outlet = P.outlet; DP.cluster = "ALL"; }
    if (P.m) DP.month = P.m;
    if (!DP.month || !Rev.months().includes(DP.month)) DP.month = Rev.month();
    let charts = [];
    const kill = () => { charts.forEach(c => c && c.destroy()); charts = []; };

    const draw = () => {
      kill();
      const m = DP.month, open = Rev.isOpen(m), last = Rev.lastFor(m);
      const all = Rev.outletRows(DP.cluster, m);
      if (DP.outlet !== "ALL" && !all.some(r => r.key === DP.outlet)) DP.outlet = "ALL";
      const rows = DP.outlet === "ALL" ? all : all.filter(r => r.key === DP.outlet), T = Rev.totals(rows);
      const s = Rev.dailySeries(rows, m), daysIn = s.dates.length, elapsed = open ? +last.slice(8, 10) : daysIn, remain = daysIn - elapsed;
      let we = 0, wd = 0, nWe = 0, nWd = 0, nAct = 0;
      s.dates.forEach((d, i) => { if (d > last) return; const v = s.actual[i] || 0; if (v) nAct++;
        if (Rev.dayInfo(d).weekend) { we += v; nWe++; } else { wd += v; nWd++; } });
      const budget = T.budget, lfl = T.noBudget.length > 0;
      const evSnap = Rev.eventSnapshot(), fcSnap = Rev.idx().fcSnap;
      if (!DP.selA || DP.selA.slice(0, 7) !== m || DP.selA > last) DP.selA = last;
      if (open && (!DP.selF || DP.selF.slice(0, 7) !== m || DP.selF <= last)) DP.selF = remain > 0 ? addDays(last, 1) : "";
      if (!open) DP.selF = "";
      const title = DP.outlet === "ALL" ? (DP.cluster === "ALL" ? t("All outlets") : t("All {c} outlets", { c: DP.cluster })) : DP.outlet + " — " + rows[0].name;

      const runRate = open && budget > 0 && remain > 0 ? (budget - (lfl ? T.lflMtd : T.mtd)) / remain : null;
      const fcPerDay = open && remain > 0 ? ((lfl ? T.lflProj - T.lflMtd : T.fcr) / remain) : null; // basis sama dgn run-rate (like-for-like)
      const kpis = [
        UI.kpi({ label: open ? t("Revenue MTD") : t("Revenue"), value: fmtRp(T.mtd), note: tn(nAct, "{n} day of actuals", "{n} days of actuals"), showRing: false }),
        UI.kpi({ label: t("Average per Day"), value: fmtRp(elapsed ? T.mtd / elapsed : null), note: t("Weekday {a} · weekend {b}", { a: fmt(nWd ? wd / nWd : null), b: fmt(nWe ? we / nWe : null) }), showRing: false }),
        open ? UI.kpi({ label: t("Month-End Projection"), value: fmtRp(T.proj), note: T.fcEvent > 0 ? t("Includes {v} of events in forecast", { v: fmtRp(T.fcEvent) }) : t("No events in forecast"), showRing: false })
             : UI.kpi({ label: t("Budget"), value: fmtRp(budget || null), note: lfl && budget ? t("Like-for-like · excl. {k}", { k: T.noBudget.join(", ") }) : t("Full month"), showRing: false }),
        open ? UI.kpi({ label: t("Required Daily Run-Rate"), value: fmtRp(runRate), note: runRate == null ? t("No budget for this selection") : runRate <= 0 ? t("Budget already reached") : t("To reach 100% of budget · forecast {f}/day", { f: fmt(fcPerDay) }), noteKind: runRate > fcPerDay ? "warn" : runRate != null ? "ok" : "", showRing: false })
             : UI.kpi({ label: t("Budget Attainment"), value: fmtPct(T.ach), note: T.ach != null ? t("Variance {v}", { v: fmtRp((lfl ? T.lflProj : T.proj) - budget) }) : t("No budget for this selection"), noteKind: T.ach == null ? "" : T.ach >= 1 ? "ok" : "warn", showRing: false }),
      ];

      host.innerHTML = `
        <section class="card" style="padding:14px 18px"><div class="filters" id="dpFilters" style="justify-content:space-between">
          <div class="filters" id="dpF"></div>
          <span class="muted" style="font-size:12px">${esc(t("Latest actual {a} · forecast snapshot {b}", { a: dateLabel(STATE.lastActualDate), b: fcSnap ? dateLabel(fcSnap) : "—" }))}</span></div></section>
        <section class="grid g4">${kpis.join("")}</section>
        <section class="card">
          <div class="card-h"><div><h2>${esc(t("Daily Timeline — Actual & Forecast"))}</h2><div class="sub">${esc(title)} · ${esc(monthLabel(m, true))}${open ? "" : " · " + esc(t("closed month"))}</div></div>
            <span class="muted" style="font-size:12px">${esc(t("Select a day for its breakdown"))}</span></div>
          <div class="chart-legend">${chartLegend("daily")}</div>
          <div style="position:relative;height:300px"><canvas id="dpChart" role="img" aria-label="${esc(t("Daily revenue chart"))}"></canvas></div>
          <div class="grid g2" id="dpPanels"></div>
          <details><summary style="cursor:pointer;font-size:13px;font-weight:600">${esc(t("Daily table"))}</summary><div id="dpTable" style="margin-top:10px"></div></details>
        </section>
        <section class="card">
          <div class="card-h"><div><h2>${esc(t("Trend per Outlet"))}</h2><div class="sub" id="smNote"></div></div><div class="card-tools" id="smTools"></div></div>
          <div class="sm-grid" id="smGrid"></div>
        </section>`;

      const F = host.querySelector("#dpF");
      F.appendChild(UI.clusterSelect(DP.cluster, v => { DP.cluster = v; DP.outlet = "ALL"; draw(); }));
      F.appendChild(UI.select(t("Outlet"), [["ALL", DP.cluster === "ALL" ? t("All outlets") : t("All {c} outlets", { c: DP.cluster })]].concat(all.map(r => [r.key, Dim.outletDisplay(r.key) + " — " + r.name])), DP.outlet, v => { DP.outlet = v; draw(); }));
      F.appendChild(UI.select(t("Month"), Rev.months().map(x => [x, monthLabel(x, true)]), m, v => { DP.month = v; DP.selA = DP.selF = ""; draw(); }));

      const panels = () => {
        const box = host.querySelector("#dpPanels"), kv = (k, v, cls = "") => `<div class="kv ${cls}"><span>${esc(k)}</span><span class="num">${esc(v)}</span></div>`;
        const outlets = x => x.byOutlet.length > 1 ? `<div class="muted" style="font-size:12px;margin-top:6px">${esc(t("Largest"))}: ${esc(x.byOutlet.slice(0, 4).map(o => o.key + " " + fmt(o.total)).join(" · "))}</div>` : "";
        let html = "";
        if (DP.selA) {
          const a = Rev.dayDetail(rows, DP.selA), di = Rev.dayInfo(DP.selA);
          html += `<div class="panel"><h3>${esc(t("Actual"))} · ${esc(di.dow)} ${esc(dateLabel(DP.selA))}${di.holiday ? " · " + esc(di.note || t("Public holiday")) : ""}</h3>
            ${kv(t("Food"), fmtRp(a.food))}${kv(t("Beverage"), fmtRp(a.bev))}${kv(t("Other"), fmtRp(a.other))}${kv(t("Total"), fmtRp(a.total), "tot")}
            ${kv(t("of which Event (memo)"), fmtRp(a.event))}${a.minSpend ? kv(t("of which Minimum spend (memo)"), fmtRp(a.minSpend)) : ""}
            ${kv(t("Covers (regular · event)"), fmtInt(a.cover) + " · " + fmtInt(a.coverEv))}${outlets(a)}</div>`;
        }
        if (DP.selF) {
          const f = Rev.dayDetail(rows, DP.selF), di = Rev.dayInfo(DP.selF);
          const evs = Rev.events(DP.cluster, 0, { from: addDays(DP.selF, -1), to: DP.selF, outlet: DP.outlet });
          const rel = f.total > 0 ? ((f.flags.OK || 0) + (f.flags.EVENT_ONLY || 0)) / f.total : null;
          html += `<div class="panel"><h3>${esc(t("Forecast"))} · ${esc(di.dow)} ${esc(dateLabel(DP.selF))}${di.holiday ? " · " + esc(di.note || t("Public holiday")) : ""}</h3>
            ${kv(t("Food (regular)"), fmtRp(f.food))}${kv(t("Beverage (regular)"), fmtRp(f.bev))}${kv(t("Other (regular)"), fmtRp(f.other))}${kv(t("Event"), fmtRp(f.event))}${kv(t("Total"), fmtRp(f.total), "tot")}
            ${rel != null ? kv(t("Backed by full baseline or confirmed events"), fmtPct(rel, 0)) : ""}
            ${evs.length ? `<div style="font-size:12px;color:var(--body);margin-top:6px;display:flex;flex-direction:column;gap:2px">${evs.slice(0, 5).map(e => `<span>· ${esc(e.name)} — ${esc(e.outlet)} · ${esc(e.pax ? t("{n} pax", { n: fmtInt(e.pax) }) : t("pax n/a"))} · ${esc(e.definite ? t("Definite") : e.status || t("Tentative"))} · ${esc(fmtRp(e.value))}</span>`).join("")}${evs.length > 5 ? `<span class="muted">${esc(t("+{n} more", { n: evs.length - 5 }))}</span>` : ""}</div>` : ""}
            ${outlets(f)}</div>`;
        } else if (open) html += `<div class="panel">${UI.empty(t("No forecast days remaining this month."))}</div>`;
        box.innerHTML = html || "";
      };
      panels();
      const ch = dailyRevenueChart(host.querySelector("#dpChart"), rows, { m, selected: null, onPick: d => { if (d <= last) DP.selA = d; else DP.selF = d; panels(); } });
      charts.push(ch);

      // tabel harian
      const bd = budget > 0 ? budget / daysIn : null; let cum = 0;
      const trows = s.dates.map((d, i) => { const a = s.actual[i], f = d > last ? s.forecast[i] : null, v = a != null ? a : f; cum += v || 0;
        return { date: d, dow: Rev.dayInfo(d).dow, actual: a, forecast: f, event: s.event[i], budget: bd, varB: bd != null && v != null ? v - bd : null, cum, kind: a != null ? t("Actual") : f != null ? t("Forecast") : "" }; });
      host.querySelector("#dpTable").appendChild(UI.table([
        { key: "date", label: t("Date"), type: "date" }, { key: "dow", label: t("Day") }, { key: "kind", label: t("Basis") },
        { key: "actual", label: t("Actual"), type: "money" }, { key: "forecast", label: t("Forecast"), type: "money" },
        { key: "event", label: t("Event in forecast"), type: "money" }, { key: "budget", label: t("Daily budget"), type: "money" },
        { key: "varB", label: t("vs daily budget"), type: "money" }, { key: "cum", label: t("Cumulative"), type: "money" },
      ], { rows: trows, topN: null, total: rs => ({ date: t("Total"), actual: rs.reduce((x, r) => x + (r.actual || 0), 0), forecast: rs.reduce((x, r) => x + (r.forecast || 0), 0), event: rs.reduce((x, r) => x + (r.event || 0), 0), budget: budget || null }) }));

      // small multiples
      host.querySelector("#smTools").appendChild(UI.seg([["month", t("Monthly vs budget")], ["day", t("Daily this month")]], DP.view, v => { DP.view = v; draw(); }, t("View")));
      host.querySelector("#smNote").textContent = DP.view === "month" ? t("Solid = actual by month this year (current month = projection) · dashed orange = budget · select an outlet to filter") : t("Solid = daily actual · dashed = forecast for the remaining days · select an outlet to filter");
      const grid = host.querySelector("#smGrid"), c = chartColors(), year = m.slice(0, 4);
      if (!chartReady(grid.appendChild(document.createElement("canvas")))) return; grid.innerHTML = "";
      all.forEach(r => {
        const cell = UI.node(`<div class="sm-cell link-row" title="${esc(r.name)}" ${r.key === DP.outlet ? 'style="border-color:var(--accent)"' : ""}><h4>${esc(Dim.outletDisplay(r.key))}<span>${r.budget > 0 ? fmtPct(r.proj / r.budget, 0) : ""}</span></h4><div class="sm-cv"><canvas></canvas></div></div>`);
        cell.onclick = () => { DP.outlet = DP.outlet === r.key ? "ALL" : r.key; draw(); window.scrollTo({ top: 0, behavior: "smooth" }); };
        grid.appendChild(cell);
        let data;
        if (DP.view === "month") {
          const ms = Rev.monthlySeries([r], year, m);
          data = { labels: ms.map(x => monthName(x.m).slice(0, 3)), datasets: [
            { label: t("Actual / projection"), data: ms.map(x => x.actual + (x.forecast || 0)), borderColor: c.accent, backgroundColor: c.accent, pointRadius: 2, borderWidth: 2, tension: .25 },
            { label: t("Budget"), data: ms.map(x => x.budget || null), borderColor: c.orange, borderDash: [4, 3], pointRadius: 0, borderWidth: 1.5, tension: .25 }] };
        } else {
          const ds = Rev.dailySeries([r], m);
          data = { labels: ds.dates.map(d => String(+d.slice(8, 10))), datasets: [
            { label: t("Actual"), data: ds.actual, borderColor: c.accent, pointRadius: 0, borderWidth: 2, tension: .25, spanGaps: false },
            { label: t("Forecast"), data: ds.forecast, borderColor: c.fc, borderDash: [4, 3], pointRadius: 0, borderWidth: 1.5, tension: .25, spanGaps: false }] };
        }
        charts.push(new Chart(cell.querySelector("canvas"), { type: "line", data, options: { responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => x.dataset.label + ": " + fmtRp(x.parsed.y) } } },
          scales: { x: { ticks: { font: { size: 9 }, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { font: { size: 9 }, callback: v => fmt(v, 1), maxTicksLimit: 4 }, grid: { color: c.line }, beginAtZero: true } } } }));
      });
    };
    draw();
    const onTheme = () => draw();
    document.addEventListener("fmd:theme", onTheme);
    return () => { document.removeEventListener("fmd:theme", onTheme); kill(); };
  },
});
