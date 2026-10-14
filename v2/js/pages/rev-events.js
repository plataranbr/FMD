/* Revenue › Events */
"use strict";

const EVP = { cluster: "ALL", outlet: "ALL", win: "rest", status: "all", q: "" };

FMD.page("revenue/events", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(80) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(400);
    const { missing } = await Data.load(REV_TABS);
    if (ctx.isStale()) return;
    if (!STATE.lastActualDate) { host.innerHTML = UI.card({ body: UI.banner(t("Revenue data is not available") + (missing.length ? ": " + missing.map(x => x.tab).join(", ") : "."), "warn") }); return; }
    let tbl = null; // eslint-disable-line no-unused-vars

    const model = () => {
      const last = Rev.last(), m = Rev.month(), elapsed = +last.slice(8, 10);
      const to = EVP.win === "rest" ? monthEnd(m) : addDays(last, +EVP.win);
      const rows = Rev.outletRows(EVP.cluster, m), avg = {}; rows.forEach(r => (avg[r.key] = elapsed ? r.mtd / elapsed : 0));
      const q = EVP.q.trim().toLowerCase();
      const all = Rev.events(EVP.cluster, 0, { from: last, to, outlet: EVP.outlet }).map(e => ({ ...e, dow: dowOf(e.date),
        ratio: avg[e.outlet] > 0 ? e.value / avg[e.outlet] : null, stLabel: e.definite ? t("Definite") : (e.status || t("Tentative")) }));
      const list = all.filter(e => (EVP.status === "all" || (EVP.status === "def") === e.definite)
        && (!q || (e.name + " " + e.outlet + " " + e.sales + " " + e.status).toLowerCase().includes(q)));
      return { last, m, to, rows, all, list };
    };

    const draw = () => {
      const M = model(), L = M.list, sum = (a, f) => a.reduce((s, e) => s + f(e), 0);
      const val = sum(L, e => e.value), tent = L.filter(e => !e.definite), pax = sum(L, e => e.pax);
      const T = Rev.totals(M.rows), inMonth = sum(L.filter(e => e.date.slice(0, 7) === M.m), e => e.value);
      const kpis = [
        UI.kpi({ label: t("Events in Window"), value: fmtInt(L.length), showRing: false, note: t("Definite {a} · tentative {b}", { a: L.length - tent.length, b: tent.length }) }),
        UI.kpi({ label: t("Event Value"), value: fmtRp(val), showRing: false, note: T.proj > 0 && inMonth > 0 ? t("{p} of the {m} month-end projection", { p: fmtPct(inMonth / T.proj), m: monthName(M.m, true) }) : t("After filters") }),
        UI.kpi({ label: t("Tentative Value at Risk"), value: fmtRp(sum(tent, e => e.value)), showRing: false, note: t("Not yet confirmed"), noteKind: tent.length ? "warn" : "" }),
        UI.kpi({ label: t("Total Pax"), value: fmtInt(pax), showRing: false, note: t("Definite and tentative") }),
      ];
      host.innerHTML = `
        <section class="card" style="padding:14px 18px"><div class="filters" id="evF"></div></section>
        <section class="grid g4">${kpis.join("")}</section>
        <section class="card" id="evCard"><div class="card-h"><div><h2>${esc(t("Upcoming Events"))}</h2>
          <div class="sub">${esc(dateLabel(addDays(M.last, 1)))} – ${esc(dateLabel(M.to))} · ${esc(t("event pipeline snapshot {d}", { d: dateLabel(Rev.eventSnapshot()) }))}</div></div></div>
          <div class="card-b"></div>
          <div class="muted" style="font-size:12px">${esc(t("Source: latest event pipeline snapshot per unit. Rows marked dropped or expired in the pipeline are excluded. “vs daily avg” compares the event value with the outlet’s average daily revenue this month."))}</div></section>`;
      const F = host.querySelector("#evF");
      F.appendChild(UI.clusterSelect(EVP.cluster, v => { EVP.cluster = v; EVP.outlet = "ALL"; draw(); }));
      F.appendChild(UI.select(t("Outlet"), [["ALL", t("All outlets")]].concat(M.rows.map(r => [r.key, Dim.outletDisplay(r.key) + " — " + r.name])), EVP.outlet, v => { EVP.outlet = v; draw(); }));
      F.appendChild(UI.select(t("Window"), [["rest", t("Rest of {m}", { m: monthName(M.m, true) })], ["7", t("Next {n} days", { n: 7 })], ["30", t("Next {n} days", { n: 30 })], ["60", t("Next {n} days", { n: 60 })]], EVP.win, v => { EVP.win = v; draw(); }));
      const sf = UI.node(`<label class="field">${esc(t("Status"))}</label>`);
      sf.appendChild(UI.seg([["all", t("All")], ["def", t("Definite")], ["tent", t("Tentative")]], EVP.status, v => { EVP.status = v; draw(); }, t("Status")));
      F.appendChild(sf);
      const qf = UI.node(`<label class="field">${esc(t("Search"))}<input type="search" placeholder="${esc(t("Event, outlet or sales"))}" value="${esc(EVP.q)}"></label>`);
      let tm = null; qf.querySelector("input").addEventListener("input", e => { clearTimeout(tm); tm = setTimeout(() => { EVP.q = e.target.value; refresh(); }, 200); });
      F.appendChild(qf);
      tbl = UI.table([
        { key: "date", label: t("Date"), render: r => `<span class="num">${esc(dateLabel(r.date, true))}</span> <span class="muted" style="font-size:11px">${esc(r.dow)}</span>` },
        { key: "outlet", label: t("Outlet"), render: r => `<b>${esc(r.outlet)}</b>` },
        { key: "name", label: t("Event") },
        { key: "pax", label: t("Pax"), type: "int" },
        { key: "value", label: t("Value"), type: "money" },
        { key: "ratio", label: t("vs daily avg"), type: "num", render: r => `<span class="num">${esc(fmtX(r.ratio))}</span>` },
        { key: "stLabel", label: t("Status"), render: r => UI.tag(r.stLabel, r.definite ? "ok" : "warn") },
        { key: "sales", label: t("Sales") },
      ], { rows: L, topN: null, full: L.length <= 40, sort: { key: "date", dir: "asc" }, emptyText: t("No events match the selected filters."),
        total: rs => ({ date: t("Total"), name: tn(rs.length, "{n} event", "{n} events"), pax: sum(rs, e => e.pax), value: sum(rs, e => e.value) }) });
      host.querySelector("#evCard .card-b").appendChild(tbl);
    };
    const refresh = () => { draw(); const i = host.querySelector('input[type="search"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
    draw();
  },
});
