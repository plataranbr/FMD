/* Data › Status & Period Close — kesegaran per sumber, status tutup bulan per unit, daftar audit data, registri unit. */
"use strict";

const DS_TABS = ["Revenue_Master", "Forecast_Output", "Event_Pipeline", "Budget_Master", "DIM_UNIT", "DML_Cost_Daily", "Consumption_Master", "CK_FG_Transfer"];
const CLOSE_DAY = 5, LATE_SOURCES_DAY = 10;   // closing tgl 5; menu & konsumsi bisa s.d. tgl 10

FMD.page("data/status", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(120) + UI.skeleton(320);
    let missing = [];
    try { missing = (await Data.load(DS_TABS)).missing; Cost.prep(); } catch (e) { if (!ctx.isStale()) host.innerHTML = UI.card({ body: UI.banner(t("Data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
    let fresh = null; try { const r = await api({ action: "getFreshness", token: STATE.token }); if (r && r.ok) fresh = r; } catch (e) { /* opsional */ }
    if (ctx.isStale()) return;
    const x = Dim.x, today = dstr(new Date()), lastAct = STATE.lastActualDate || "";
    const maxD = (arr, f) => (arr || []).reduce((m, r) => { const d = f(r); return d && d > m ? d : m; }, "");
    const ageDays = d => d ? daysBetween(d, today) : null;

    // ---- 1. kesegaran per sumber ----
    const snapMax = tab => maxD(STATE.data[tab], r => dstr(r.Snapshot_Date));
    const src = [
      { s: t("Revenue (DRR)"), tab: "Revenue_Master", last: lastAct, note: t("Actual revenue, all outlets"), lag: 2 },
      { s: t("Revenue forecast"), tab: "Forecast_Output", last: snapMax("Forecast_Output"), note: t("Latest snapshot"), lag: 2 },
      { s: t("Event pipeline"), tab: "Event_Pipeline", last: snapMax("Event_Pipeline"), note: t("Latest snapshot"), lag: 2 },
      { s: t("Budget"), tab: "Budget_Master", last: maxD(STATE.data.Budget_Master, r => dstr(r.Bulan).slice(0, 7)), note: t("Latest month with budget"), month: true },
      { s: t("Direct purchases (DML)"), tab: "DML_Cost_Daily", last: maxD(STATE.data.DML_Cost_Daily, r => r._d), note: fresh && fresh.dml ? t("Last DML job: {d}", { d: fresh.dml }) + (fresh.dml_status && fresh.dml_status !== "OK" ? " · " + t("job still running or stuck") : "") : "", lag: 2 },
      { s: t("Store requisitions"), tab: "Consumption_Master", last: maxD(STATE.data.Consumption_Master, r => r._d), note: t("Closed monthly from store working papers (by day {d})", { d: LATE_SOURCES_DAY }), lag: 45 },
      { s: t("CK FG transfers"), tab: "CK_FG_Transfer", last: maxD(STATE.data.CK_FG_Rows, r => r._d), note: t("CK team input"), lag: 3 },
      { s: t("Menu sales (Sales Item)"), tab: "Menu_Sales_Daily", last: Menu.loaded ? Menu.dailyLast() : "", note: Menu.loaded ? t("Latest unit report") : t("Open Menu Sales once to check"), lag: 3 },
    ].map(r => { const miss = missing.some(m => m.tab === r.tab); const age = r.month ? null : ageDays(r.last);
      const stt = miss ? "crit" : !r.last ? "mute" : r.month ? (r.last >= today.slice(0, 7) ? "ok" : "warn") : age <= r.lag ? "ok" : age <= r.lag * 3 ? "warn" : "crit";
      return { ...r, age, st: stt, stL: miss ? t("Not accessible") : !r.last ? t("Unknown") : stt === "ok" ? t("Fresh") : stt === "warn" ? t("Behind") : t("Stale") }; });

    // ---- 2. status tutup bulan per unit (3 bulan terakhir) ----
    const curM = (lastAct || today).slice(0, 7), months = [addMonths(curM, -2), addMonths(curM, -1), curM];
    const revLast = {}; (STATE.data.Revenue_Master || []).forEach(r => { const u = String(r.Unit || "").trim(), d = dstr(r.Tanggal), m = d.slice(0, 7); const k = u + "|" + m; if (!revLast[k] || d > revLast[k]) revLast[k] = d; });
    const dmlLast = {}; (STATE.data.DML_Cost_Daily || []).forEach(r => { const k = Cost.key(r.Unit) + "|" + r._d.slice(0, 7); if (!dmlLast[k] || r._d > dmlLast[k]) dmlLast[k] = r._d; });
    const srHas = {}; (STATE.data.Consumption_Master || []).forEach(r => { if (r.Unit_Beban) srHas[Cost.key(r.Unit_Beban) + "|" + r._d.slice(0, 7)] = true; });
    const bud = {}; (STATE.data.Budget_Master || []).forEach(r => { bud[String(r.Unit || "").trim() + "|" + dstr(r.Bulan).slice(0, 7)] = true; });
    const units = Object.values(x.units).filter(U => U.active).sort((a, b) => a.order - b.order);
    const closeRows = units.map(U => { const row = { unit: U.unit, name: U.names.join(" / ") };
      months.forEach(m => { const end = monthEnd(m), closed = today > addDays(end, CLOSE_DAY), late = today > addDays(end, LATE_SOURCES_DAY);
        const rv = revLast[U.unit + "|" + m] || "", ck = Cost.key(U.unit), hasCost = !COST_CENTER_ONLY.has(U.unit) && Dim.hasCost(U.unit, m);
        const dl = dmlLast[ck + "|" + m] || "", sr = !!srHas[ck + "|" + m], b = !!bud[U.unit + "|" + m];
        const issues = [];
        if (!rv) issues.push(t("no revenue")); else if (m < curM && rv < end) issues.push(t("revenue to {d}", { d: dateLabel(rv, true) }));
        if (!b && rv) issues.push(t("no budget"));
        if (hasCost) { if (!dl) issues.push(t("no DML")); else if (m < curM && dl < addDays(end, -1)) issues.push(t("DML to {d}", { d: dateLabel(dl, true) }));
          if (late && !sr && m < curM) issues.push(t("no store requisitions")); }
        const st = m === curM ? "open" : !issues.length ? (late ? "final" : closed ? "closing" : "open") : "issue";
        row[m] = { st, issues, hasCost }; });
      return row; });

    // ---- 3. daftar audit ----
    const C = STATE.data.Consumption_Master || [];
    const audit = [];
    const add = (kind, label, rows, note) => { if (!rows.length) return; audit.push({ kind, label, n: rows.length, amt: rows.reduce((s, r) => s + (Number(r.Amount) || 0), 0), note,
      units: [...new Set(rows.map(r => r.Unit_Beban || r.Storage_Raw || "?"))].slice(0, 8).join(", "), sample: rows.slice(0, 3).map(r => `${r._d} · ${r.Description || ""} · ${COA_OF(r.COA) || r.COA || ""}`).join(" | ") }); };
    add("crit", t("Balance-sheet COA issued through store"), C.filter(r => coaClass(r) === "BS"), t("Excluded from cost ratios; should be reclassified or posted to the balance sheet."));
    add("warn", t("Pre-opening COA"), C.filter(r => coaClass(r) === "PRE"), t("Excluded from cost ratios (pre-opening cost)."));
    add("warn", t("COA not yet assigned"), C.filter(r => String(r.Flag_Status || "").toUpperCase() === "COA_PENDING"), t("Lines waiting for a COA in the store working paper."));
    if (!scoped()) add("info", t("Charged to units not monitored"), C.filter(r => r.Unit_Beban && !Dim.monitored(r.Unit_Beban)), t("Codes not in DIM_UNIT (e.g. PW, PBR) are outside the dashboard."));
    add("warn", t("Lines without a charge-to unit"), C.filter(r => !r.Unit_Beban), t("Unit_Beban empty and no storage keyword matched."));
    const noCost = units.filter(U => !COST_CENTER_ONLY.has(U.unit) && !U.since).map(U => U.unit);
    const aliasOf = {}; Object.entries(x.alias).forEach(([a, u]) => (aliasOf[u] = aliasOf[u] || []).push(a));
    const reg = Object.values(x.units).sort((a, b) => a.order - b.order).map(U => ({ unit: U.unit, name: U.names.join(" / "), cluster: U.cluster, outlets: U.outlets.join(", "), costGroup: U.costGroup,
      since: U.since, aliases: (aliasOf[U.unit] || []).join(", "), st: !U.active ? "off" : COST_CENTER_ONLY.has(U.unit) ? "cc" : U.since ? "data" : "none" }));
    const ST = { data: t("Cost data"), none: t("No cost data"), cc: t("Cost center"), off: t("Inactive") }, kind = { data: "ok", none: "warn", cc: "info", off: "mute" };
    const nIssue = closeRows.reduce((s, r) => s + months.filter(m => r[m].st === "issue").length, 0);

    host.innerHTML = `
      <section class="grid g4">
        ${UI.kpi({ label: t("Sources Fresh"), value: t("{a} of {b}", { a: src.filter(r => r.st === "ok").length, b: src.length }), showRing: false, note: src.filter(r => r.st !== "ok").map(r => r.s).slice(0, 3).join(", ") || t("All sources up to date"), noteKind: src.some(r => r.st === "crit") ? "crit" : src.some(r => r.st === "warn") ? "warn" : "ok" })}
        ${UI.kpi({ label: t("Latest Actual Revenue"), value: lastAct ? dateLabel(lastAct) : DASH, showRing: false, note: lastAct ? tn(ageDays(lastAct), "{n} day ago", "{n} days ago") : "" })}
        ${UI.kpi({ label: t("Close Issues"), value: fmtInt(nIssue), showRing: false, note: t("Unit-months with gaps in the last two closed months"), noteKind: nIssue ? "warn" : "ok" })}
        ${UI.kpi({ label: t("Audit Items"), value: fmtInt(audit.reduce((s, a) => s + a.n, 0)), showRing: false, note: audit.length ? t("{n} lines need review", { n: fmtInt(audit.reduce((s, a) => s + a.n, 0)) }) : t("Nothing to review"), noteKind: audit.some(a => a.kind === "crit") ? "crit" : audit.length ? "warn" : "ok" })}
      </section>
      <section class="card" id="dsFresh"><div class="card-h"><div><h2>${esc(t("Data Freshness by Source"))}</h2><div class="sub">${esc(t("Today {d}", { d: dateLabel(today) }))}</div></div></div><div class="card-b"></div></section>
      <section class="card" id="dsClose"><div class="card-h"><div><h2>${esc(t("Period Close Status"))}</h2><div class="sub">${esc(t("Closing on day {a}; menu sales and store requisitions may arrive until day {b} of the next month", { a: CLOSE_DAY, b: LATE_SOURCES_DAY }))}</div></div></div><div class="card-b"></div>
        <div class="chart-legend" style="font-size:12px">${[["final", "ok", t("Final")], ["closing", "info", t("Closing")], ["open", "mute", t("Open")], ["issue", "warn", t("Gaps")]].map(([, k, l]) => UI.tag(l, k)).join(" ")} <span class="muted">${esc(t("Hover a status for its gaps. Cost checks apply only from each unit’s Cost_Data_Since."))}</span></div></section>
      <section class="card" id="dsAudit"><div class="card-h"><div><h2>${esc(t("Data Audit List"))}</h2><div class="sub">${esc(t("Store requisition lines excluded from or questionable in cost ratios"))}</div></div></div><div class="card-b"></div>
        ${noCost.length ? `<div class="muted" style="font-size:12px">${esc(t("Units without cost data (shown as “No data”, never 0%): {l}.", { l: noCost.join(", ") }))}</div>` : ""}</section>
      <section class="card" id="dsReg"><div class="card-h"><div><h2>${esc(t("Unit Registry"))}</h2><div class="sub">${esc(t("Source: DIM_UNIT. Codes not listed here are not monitored (e.g. PW, PBR)."))}</div></div><div class="card-tools"></div></div><div class="card-b"></div></section>`;

    host.querySelector("#dsFresh .card-b").appendChild(UI.table([
      { key: "s", label: t("Source") }, { key: "last", label: t("Latest data"), render: r => r.last ? esc(r.month ? monthLabel(r.last) : dateLabel(r.last)) : `<span class="muted">${DASH}</span>` },
      { key: "age", label: t("Age (days)"), type: "int" }, { key: "stL", label: t("Status"), render: r => UI.tag(r.stL, r.st) }, { key: "note", label: t("Note") },
    ], { rows: src, full: true }));
    const SL = { final: [t("Final"), "ok"], closing: [t("Closing"), "info"], open: [t("Open"), "mute"], issue: [t("Gaps"), "warn"] };
    host.querySelector("#dsClose .card-b").appendChild(UI.table([{ key: "unit", label: t("Unit"), render: r => `<b>${esc(r.unit)}</b><div class="muted" style="font-size:11px">${esc(r.name)}</div>` }]
      .concat(months.map(m => ({ key: m, label: monthLabel(m) + (m === curM ? " *" : ""), sortable: false, get: r => SL[r[m].st][0] + (r[m].issues.length ? ": " + r[m].issues.join(", ") : ""),
        render: r => `<span title="${esc(r[m].issues.join(", "))}">${UI.tag(SL[r[m].st][0], SL[r[m].st][1])}</span>${r[m].issues.length ? `<div class="muted" style="font-size:11px">${esc(r[m].issues.join(" · "))}</div>` : ""}` }))),
      { rows: closeRows, full: true }));
    host.querySelector("#dsAudit .card-b").appendChild(audit.length ? UI.table([
      { key: "label", label: t("Check"), render: r => UI.tag(r.label, r.kind) }, { key: "n", label: t("Lines"), type: "int" }, { key: "amt", label: t("Amount"), type: "money" },
      { key: "units", label: t("Units / storage") }, { key: "note", label: t("Note") }, { key: "sample", label: t("Examples"), hidden: true },
    ], { rows: audit, full: true }) : UI.node(`<div>${UI.empty(t("Nothing to review."))}</div>`));
    host.querySelector("#dsReg .card-b").appendChild(UI.table([
      { key: "unit", label: t("Unit"), render: r => UI.unitBadge(r.unit) }, { key: "name", label: t("Name") }, { key: "cluster", label: t("Cluster") },
      { key: "outlets", label: t("Outlets") }, { key: "aliases", label: t("Aliases") }, { key: "costGroup", label: t("Cost group") },
      { key: "since", label: t("Cost data since"), render: r => r.since ? esc(monthLabel(r.since)) : '<span class="muted">—</span>' },
      { key: "status", label: t("Status"), get: r => ST[r.st], render: r => UI.tag(ST[r.st], kind[r.st]) },
    ], { rows: reg, topN: null }));
  },
});
