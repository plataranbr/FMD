/* Data › Status & Period Close — tahap shell: registri unit dari DIM_UNIT (cek whitelist, alias, cost group). */
"use strict";

FMD.page("data/status", {
  async render(host) {
    const x = Dim.x;
    if (!Object.keys(x.units).length) { host.innerHTML = UI.card({ body: UI.banner("DIM_UNIT is empty or not accessible for your account.", "warn") }); return; }
    const aliasOf = {}; Object.entries(x.alias).forEach(([a, u]) => (aliasOf[u] = aliasOf[u] || []).push(a));
    const rows = Object.values(x.units).sort((a, b) => a.order - b.order).map(U => ({
      unit: U.unit, name: U.names.join(" / "), cluster: U.cluster, outlets: U.outlets.join(", "),
      costGroup: U.costGroup, since: U.since, aliases: (aliasOf[U.unit] || []).join(", "), active: U.active,
      status: !U.active ? "Inactive" : COST_CENTER_ONLY.has(U.unit) ? "Cost center" : U.since ? "Cost data" : "No cost data",
    }));
    const kind = s => ({ "Cost data": "ok", "No cost data": "warn", "Cost center": "info", Inactive: "mute" }[s]);
    const nCost = rows.filter(r => r.status === "Cost data").length, nNo = rows.filter(r => r.status === "No cost data").length;
    const groups = Object.entries(x.costGroups).filter(([, m]) => m.length > 1);

    host.innerHTML = `
      <div class="grid g4">
        ${UI.kpi({ label: "Monitored units", value: String(rows.filter(r => r.active).length), note: Object.keys(x.outlets).length + " outlets · ring = share active", ratio: rows.filter(r => r.active).length / Math.max(1, rows.length), variant: "indigo" })}
        ${UI.kpi({ label: "With cost data", value: String(nCost), note: "Cost_Data_Since filled", ratio: nCost / Math.max(1, nCost + nNo) })}
        ${UI.kpi({ label: "Without cost data", value: String(nNo), note: "Shown as “No data”, never 0%", ratio: nNo / Math.max(1, nCost + nNo), variant: "pink" })}
        ${UI.kpi({ label: "Shared cost groups", value: String(groups.length), note: groups.map(([g]) => g).join(", ") || "None", ratio: groups.length ? 1 : 0 })}
      </div>
      ${UI.card({ title: "Unit registry", sub: "Source: DIM_UNIT. Codes not listed here are not monitored (e.g. PW, PBR).", id: "regCard" })}
      ${UI.banner("Freshness by source, period close status and the data audit list (balance-sheet COA, pre-opening, unmapped items) will be added in this page in a later step.", "info")}`;

    const tbl = UI.table([
      { key: "unit", label: "Unit", render: r => UI.unitBadge(r.unit) },
      { key: "name", label: "Name" },
      { key: "cluster", label: "Cluster" },
      { key: "outlets", label: "Outlets" },
      { key: "aliases", label: "Aliases" },
      { key: "costGroup", label: "Cost group" },
      { key: "since", label: "Cost data since", render: r => r.since ? esc(monthLabel(r.since)) : '<span class="muted">—</span>' },
      { key: "status", label: "Status", render: r => UI.tag(r.status, kind(r.status)) },
    ], { rows, topN: null, name: "units" });
    host.querySelector("#regCard .card-b").appendChild(tbl);
  },
});
