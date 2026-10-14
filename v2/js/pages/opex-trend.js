/* Operating Expenses › Trend — supplies (non-COGS, COA 7xxx) per bulan dari store requisition. */
"use strict";

const OXT = { cluster: "ALL", units: [], by: "cat", measure: "amt" };

FMD.page("opex/trend", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(90) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(380);
    try { await Cost.load("cons"); } catch (e) { if (!ctx.isStale()) host.innerHTML = UI.card({ body: UI.banner(t("Cost data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
    if (ctx.isStale()) return;
    let chart = null;
    const draw = () => {
      if (chart) { chart.destroy(); chart = null; }
      Cost.prep();
      const sc = costUnitScope(OXT), keys = sc.keys.filter(k => !COST_CENTER_ONLY.has(k)), avail = sc.avail.filter(k => !COST_CENTER_ONLY.has(k)), K = new Set(keys);
      const sup = (STATE.data.Consumption_Master || []).filter(r => r.Unit_Beban && K.has(Cost.key(r.Unit_Beban)) && coaClass(r) === "SUP");
      const months = [...new Set(sup.map(r => r._d.slice(0, 7)))].sort();
      const lastData = sup.reduce((m, r) => r._d > m ? r._d : m, "");
      const rowKey = r => OXT.by === "cat" ? supCategory(r.Kategori) : Cost.key(r.Unit_Beban);
      const piv = {}, tot = {};
      sup.forEach(r => { const k = rowKey(r), m = r._d.slice(0, 7), a = Number(r.Amount) || 0; const p = (piv[k] = piv[k] || { k, total: 0 }); p[m] = (p[m] || 0) + a; p.total += a; tot[m] = (tot[m] || 0) + a; });
      const rev = {}; months.forEach(m => { const R = monthRange(m); rev[m] = keys.reduce((s, k) => s + Cost.rev(k, R.from, R.to).revAll, 0); });
      const revOf = (k, m) => { if (OXT.by === "unit") { const R = monthRange(m); return Cost.rev(k, R.from, R.to).revAll; } return rev[m]; };
      const V = (p, m) => OXT.measure === "amt" ? (p[m] || 0) : (revOf(p.k, m) > 0 ? (p[m] || 0) / revOf(p.k, m) : null);
      const rows = Object.values(piv).sort((a, b) => b.total - a.total);
      const lm = months[months.length - 1], pm = months[months.length - 2];
      const chg = rows.filter(p => pm && lm).map(p => ({ k: p.k, d: (p[lm] || 0) - (p[pm] || 0) })).sort((a, b) => b.d - a.d)[0];

      host.innerHTML = `
        <section class="card" style="padding:14px 18px;gap:10px"><div class="filters" id="otF"></div><div id="otU"></div></section>
        ${lastData ? UI.banner(t("Store requisitions are recorded through {d}. A month is complete only after the store working paper is closed (around day 10 of the next month).", { d: dateLabel(lastData) }), "info") : ""}
        <section class="grid g4">
          ${UI.kpi({ label: t("Supplies Issued"), value: lm ? fmtRp(tot[lm]) : DASH, showRing: false, note: lm ? monthName(lm, true) : t("No data") })}
          ${UI.kpi({ label: t("vs Previous Month"), value: pm && tot[pm] ? (tot[lm] >= tot[pm] ? "+" : "") + fmtPct(tot[lm] / tot[pm] - 1, 1) : DASH, showRing: false, note: pm ? t("{m}: {v}", { m: monthName(pm, true), v: fmtRp(tot[pm]) }) : "", noteKind: pm && tot[lm] > tot[pm] * 1.1 ? "warn" : "" })}
          ${UI.kpi({ label: t("Intensity"), value: lm && rev[lm] > 0 ? fmtPct(tot[lm] / rev[lm], 2) : DASH, showRing: false, note: t("of total revenue, {m}", { m: lm ? monthName(lm, true) : "" }) })}
          ${UI.kpi({ label: t("Largest Increase"), value: chg && chg.d > 0 ? chg.k : DASH, showRing: false, note: chg && chg.d > 0 ? "+" + fmtRp(chg.d) : t("No increase"), noteKind: chg && chg.d > 0 ? "warn" : "" })}
        </section>
        <section class="card"><div class="card-h"><div><h2>${esc(t("Monthly Supplies"))}</h2><div class="sub">${esc(t("Top 6 + other, stacked"))}</div></div></div>
          <div style="position:relative;height:300px"><canvas id="otC" role="img" aria-label="${esc(t("Monthly supplies chart"))}"></canvas></div><div id="otL" class="chart-legend"></div></section>
        <section class="card" id="otT"><div class="card-h"><div><h2>${esc(OXT.by === "cat" ? t("By Expense Category") : t("By Unit"))}</h2><div class="sub">${esc(t("Store issues on expense COA (7xxx); pre-opening and balance-sheet postings excluded"))}</div></div><div class="card-tools"></div></div><div class="card-b"></div></section>`;
      const F = host.querySelector("#otF");
      F.appendChild(UI.clusterSelect(OXT.cluster, v => { OXT.cluster = v; OXT.units = []; draw(); }));
      const segF = (lab, opts, key) => { const f = UI.node(`<label class="field">${esc(lab)}</label>`); f.appendChild(UI.seg(opts, OXT[key], v => { OXT[key] = v; draw(); }, lab)); F.appendChild(f); };
      segF(t("Rows"), [["cat", t("Category")], ["unit", t("Unit")]], "by");
      segF(t("Measure"), [["amt", t("Amount")], ["pct", t("% of revenue")]], "measure");
      const ul = UI.node(`<div class="field">${esc(t("Units"))}</div>`);
      ul.appendChild(UI.unitPicker(avail, sc.sel.filter(k => avail.includes(k)), v => { OXT.units = v.length === avail.length ? [] : v; draw(); })); host.querySelector("#otU").appendChild(ul);

      if (!months.length) { host.querySelector("#otT .card-b").innerHTML = UI.empty(t("No supplies issued for the selected units.")); host.querySelector("#otC").parentElement.innerHTML = UI.empty(t("No data")); return; }
      const fv = OXT.measure === "amt" ? "money" : "pct";
      host.querySelector("#otT .card-b").appendChild(UI.table([{ key: "k", label: OXT.by === "cat" ? t("Category") : t("Unit") }]
        .concat(months.map(m => ({ key: m, label: monthLabel(m), type: fv, get: p => V(p, m) })))
        .concat(pm ? [{ key: "chg", label: t("Change {m}", { m: monthName(lm) }), type: "pct", get: p => (p[pm] || 0) > 0 ? (p[lm] || 0) / p[pm] - 1 : null,
          render: p => { const v = (p[pm] || 0) > 0 ? (p[lm] || 0) / p[pm] - 1 : null; return v == null ? DASH : `<span class="num" style="color:${v > 0.1 ? "var(--crit)" : v < -0.1 ? "var(--ok)" : "inherit"}">${v > 0 ? "+" : ""}${esc(fmtPct(v, 0))}</span>`; } }] : [])
        .concat([{ key: "total", label: t("Total"), type: "money" }]),
        { rows, topN: 20, sort: { key: "total", dir: "desc" }, search: true,
          total: () => { const o = { k: t("Total"), total: rows.reduce((s, p) => s + p.total, 0) }; months.forEach(m => (o[m] = OXT.measure === "amt" ? tot[m] : (rev[m] > 0 ? tot[m] / rev[m] : null))); return o; } }));
      const cv = host.querySelector("#otC");
      if (chartReady(cv)) {
        const c = chartColors(), pal = [c.accent, c.orange, c.pink, "#1F6B47", "#5B3FB0", "#0E6A85", c.muted];
        const top = rows.slice(0, 6), other = rows.slice(6);
        const ds = top.map((p, i) => ({ label: p.k, data: months.map(m => V(p, m)), backgroundColor: pal[i], borderRadius: 3, stack: "s" }));
        if (other.length) ds.push({ label: t("Other"), data: months.map(m => OXT.measure === "amt" ? other.reduce((s, p) => s + (p[m] || 0), 0) : (rev[m] > 0 ? other.reduce((s, p) => s + (p[m] || 0), 0) / rev[m] : null)), backgroundColor: pal[6], borderRadius: 3, stack: "s" });
        chart = new Chart(cv, { type: "bar", data: { labels: months.map(m => monthLabel(m)), datasets: ds },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => x.dataset.label + ": " + (OXT.measure === "amt" ? fmtRp(x.parsed.y) : fmtPct(x.parsed.y, 2)) } } },
            scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: c.line }, ticks: { callback: v => OXT.measure === "amt" ? fmt(v, 1) : fmtPct(v, 1) } } } } });
        host.querySelector("#otL").innerHTML = ds.map(d => `<span class="lg"><span class="sw" style="background:${d.backgroundColor}"></span>${esc(d.label)}</span>`).join("");
      }
    };
    draw();
    const onTheme = () => draw();
    document.addEventListener("fmd:theme", onTheme);
    return () => { document.removeEventListener("fmd:theme", onTheme); if (chart) chart.destroy(); };
  },
});
