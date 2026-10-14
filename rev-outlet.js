/* Revenue › By Outlet */
"use strict";

const OP = { cluster: "ALL", month: "" };

function avgLastDays(r, last, n) {
  const I = Rev.idx(); let s = 0;
  r.members.forEach(o => { const d = I.byOutletDay[o] || {}; for (let i = 0; i < n; i++) s += d[addDays(last, -i)] || 0; });
  return s / n;
}

FMD.page("revenue/outlet", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(80) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(400);
    const { missing } = await Data.load(REV_TABS);
    if (ctx.isStale()) return;
    if (!STATE.lastActualDate) { host.innerHTML = UI.card({ body: UI.banner(t("Revenue data is not available") + (missing.length ? ": " + missing.map(x => x.tab).join(", ") : "."), "warn") }); return; }
    if (!OP.month || !Rev.months().includes(OP.month)) OP.month = Rev.month();

    const draw = () => {
      const m = OP.month, open = Rev.isOpen(m), last = Rev.lastFor(m), daysIn = Rev.daysInMonth(m);
      const elapsed = open ? +last.slice(8, 10) : daysIn, remain = daysIn - elapsed;
      const rows = Rev.outletRows(OP.cluster, m).map(r => ({ ...r,
        avg: elapsed ? r.mtd / elapsed : null, ach: r.budget > 0 ? r.proj / r.budget : null,
        rel: Rev.reliability(r, open), behind: r.lastDate && r.lastDate < last ? daysBetween(r.lastDate, last) : 0 }));
      const T = Rev.totals(rows), prevM = addMonths(m, -1), prev = Rev.sameDays(rows, prevM, elapsed);
      const relLabel = { high: t("High reliability"), medium: t("Medium reliability"), low: t("Low reliability"), none: t("No forecast"), closed: t("Closed month") };
      const relColor = { high: "var(--ok)", medium: "var(--warn)", low: "var(--crit)", none: "var(--muted)", closed: "var(--muted)" };
      const nHigh = rows.filter(r => r.rel === "high").length, nFc = rows.filter(r => r.rel !== "none").length;

      // insight rule-based
      const ins = []; let checks = 0;
      checks++; const worst = rows.filter(r => r.ach != null && !r.eventOnly).sort((a, b) => a.ach - b.ach)[0];
      if (worst && worst.ach < 0.9) {
        if (open && remain > 0) { const need = (worst.budget - worst.mtd) / remain, a28 = avgLastDays(worst, last, 28);
          ins.push(t("{k} is projected at {p} of budget; closing the gap needs {r}/day, {x} its 28-day average of {a}.", { k: worst.key, p: fmtPct(worst.ach, 0), r: fmtRp(need), x: a28 > 0 ? fmtX(need / a28) : "—", a: fmtRp(a28) }));
        } else ins.push(t("{k} closed at {p} of budget, the lowest among budgeted outlets.", { k: worst.key, p: fmtPct(worst.ach, 0) }));
      }
      checks++; const lag = rows.filter(r => r.behind > 0 && !r.eventOnly);
      if (lag.length) ins.push(t("Data is behind for {l}; projections for these outlets are likely understated.", { l: joinList(lag.map(r => `${r.key} (${t("latest")} ${dateLabel(r.lastDate, true)})`)) }));
      checks++; if (T.noBudget.length) ins.push(t("{k} has no budget for {m} and is excluded from the attainment total to keep the comparison like-for-like.", { k: joinList(T.noBudget), m: monthName(m, true) }));
      if (!ins.length) ins.push(t("No exceptions: all budgeted outlets are at 90% of budget or above and data is current."));

      const kpis = [
        UI.kpi({ label: open ? t("Revenue MTD") : t("Revenue"), value: fmtRp(T.mtd), showRing: false,
          note: prev > 0 ? t("{p} vs same days {m}", { p: (T.mtd >= prev ? "+" : "") + fmtPct(T.mtd / prev - 1), m: monthName(prevM) }) : "", noteKind: prev > 0 ? (T.mtd >= prev ? "ok" : "warn") : "" }),
        UI.kpi({ label: open ? t("Month-End Projection") : t("Month Total"), value: fmtRp(T.proj), showRing: false,
          note: open ? t("{a} of {b} outlets high reliability", { a: nHigh, b: nFc }) : t("Closed month") }),
        UI.kpi({ label: t("Monthly Budget"), value: fmtRp(T.budget || null), showRing: false,
          note: T.noBudget.length ? tn(T.noBudget.length, "{n} outlet without budget excluded", "{n} outlets without budget excluded") : t("All outlets budgeted"), noteKind: T.noBudget.length ? "warn" : "" }),
        UI.kpi({ label: t("Budget Attainment"), value: fmtPct(T.ach), showRing: false,
          note: T.ach == null ? t("No budget for this selection") : T.budget > T.lflProj ? t("Shortfall {v}", { v: fmtRp(T.budget - T.lflProj) }) : t("Ahead by {v}", { v: fmtRp(T.lflProj - T.budget) }),
          noteKind: T.ach == null ? "" : T.ach >= 1 ? "ok" : "warn" }),
      ];

      host.innerHTML = `
        <section class="card" style="padding:14px 18px"><div class="filters" style="justify-content:space-between"><div class="filters" id="opF"></div>
          <span class="muted" style="font-size:12px">${esc(t("Latest actual {a} · forecast snapshot {b}", { a: dateLabel(STATE.lastActualDate), b: Rev.idx().fcSnap ? dateLabel(Rev.idx().fcSnap) : "—" }))}</span></div></section>
        <section class="insight"><span style="width:36px;height:36px;flex:0 0 36px;border-radius:12px;background:var(--card);color:var(--accent);display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/></svg></span>
          <div><b style="font-size:13px">${esc(t("Page insights · {n} rule-based checks", { n: checks }))}</b><ul>${ins.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div></section>
        <section class="grid g4">${kpis.join("")}</section>
        <section class="card" id="opCard"><div class="card-h"><div><h2>${esc(t("Outlet Performance"))}</h2><div class="sub">${esc(t("Select a row to open the daily view · bar marker = 100% of budget"))}</div></div></div>
          <div class="card-b"></div>
          <div class="chart-legend"><span>${esc(t("Projection reliability"))}:</span>${["high", "medium", "low", "none"].map(k => `<span class="lg"><span class="dot" style="background:${relColor[k]}"></span>${esc(relLabel[k])}</span>`).join("")}</div></section>`;
      const F = host.querySelector("#opF");
      F.appendChild(UI.clusterSelect(OP.cluster, v => { OP.cluster = v; draw(); }));
      F.appendChild(UI.select(t("Period"), Rev.months().map(x => [x, monthLabel(x, true) + (Rev.isOpen(x) ? " (MTD)" : "")]), m, v => { OP.month = v; draw(); }));

      const band = a => a == null ? "mute" : a < 0.8 ? "crit" : a < 0.9 ? "warn" : a <= 1 ? "info" : "ok";
      const barColor = { crit: "var(--crit)", warn: "var(--warn)", info: "var(--accent)", ok: "var(--ok)", mute: "var(--line)" };
      host.querySelector("#opCard .card-b").appendChild(UI.table([
        { key: "key", label: t("Outlet"), render: r => `<div style="display:flex;align-items:center;gap:10px">${UI.unitBadge(Dim.outletDisplay(r.key))}<span class="muted" style="font-size:12px">${esc(r.name)}${r.eventOnly ? " · " + esc(t("event-only")) : ""}</span></div>` },
        { key: "name", label: t("Name"), hidden: true },
        { key: "mtd", label: open ? t("Revenue MTD") : t("Revenue"), type: "money", render: r => `<span class="num" data-raw="${Math.round(r.mtd)}">${fmt(r.mtd)}</span><div class="muted num" style="font-size:11px">${esc(fmt(r.avg))} ${esc(t("/ day"))}</div>` },
        { key: "proj", label: open ? t("Month-end projection") : t("Month total"), type: "money", render: r => `<span class="num" data-raw="${Math.round(r.proj)}" style="font-weight:600;color:${relColor[r.rel]}">${fmt(r.proj)}</span><div class="muted" style="font-size:11px">${esc(relLabel[r.rel])}</div>` },
        { key: "rel", label: t("Reliability"), get: r => relLabel[r.rel], hidden: true },
        { key: "budget", label: t("Budget"), type: "money" },
        { key: "ach", label: t("Budget attainment"), type: "pct", render: r => r.ach == null ? `<span class="muted">${esc(t("No budget"))}</span>` :
          `<div style="display:flex;align-items:center;gap:10px;min-width:170px"><div class="ach-bar"><i style="width:${Math.min(100, r.ach / 1.2 * 100).toFixed(1)}%;background:${barColor[band(r.ach)]}"></i><b style="left:83.3%"></b></div>${UI.tag(fmtPct(r.ach, 0), band(r.ach))}</div>` },
        { key: "gap", label: t("Gap to budget"), type: "money", get: r => r.budget > 0 ? r.proj - r.budget : null },
        { key: "lastDate", label: t("Data through"), get: r => r.lastDate, render: r => !r.lastDate ? '<span class="muted">—</span>' : r.behind > 0 && !r.eventOnly ? UI.tag(dateLabel(r.lastDate, true), "warn") : `<span class="muted" style="font-size:12px">${esc(dateLabel(r.lastDate, true))}</span>` },
      ], { rows, topN: null, full: true, sort: { key: "proj", dir: "desc" },
        onRow: r => { location.hash = pageLink("revenue/daily", { outlet: r.key, m }); },
        total: () => ({ key: t("Total"), mtd: T.mtd, proj: T.proj, budget: T.budget || null, ach: T.ach, gap: T.budget > 0 ? T.lflProj - T.budget : null, lastDate: T.noBudget.length ? t("attainment like-for-like") : "" }) }));
    };
    draw();
  },
});
