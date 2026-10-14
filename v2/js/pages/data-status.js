/* Data › Status & Period Close — tahap shell: registri unit dari DIM_UNIT (cek whitelist, alias, cost group). */
"use strict";

FMD.page("data/status", {
  async render(host) {
    const x = Dim.x;
    if (!Object.keys(x.units).length) { host.innerHTML = UI.card({ body: UI.banner(t("DIM_UNIT is empty or not accessible for your account."), "warn") }); return; }
    const aliasOf = {}; Object.entries(x.alias).forEach(([a, u]) => (aliasOf[u] = aliasOf[u] || []).push(a));
    const ST = { data: t("Cost data"), none: t("No cost data"), cc: t("Cost center"), off: t("Inactive") };
    const rows = Object.values(x.units).sort((a, b) => a.order - b.order).map(U => {
      const st = !U.active ? "off" : COST_CENTER_ONLY.has(U.unit) ? "cc" : U.since ? "data" : "none";
      return { unit: U.unit, name: U.names.join(" / "), cluster: U.cluster, outlets: U.outlets.join(", "), costGroup: U.costGroup, since: U.since,
        aliases: (aliasOf[U.unit] || []).join(", "), active: U.active, st, status: ST[st] };
    });
    const kind = { data: "ok", none: "warn", cc: "info", off: "mute" };
    const nCost = rows.filter(r => r.st === "data").length, nNo = rows.filter(r => r.st === "none").length, nAct = rows.filter(r => r.active).length;
    const groups = Object.entries(x.costGroups).filter(([, m]) => m.length > 1);
    host.innerHTML = `
      <div class="grid g4">
        ${UI.kpi({ label: t("Monitored units"), value: String(nAct), note: t("{n} outlets · ring = share active", { n: Object.keys(x.outlets).length }), ratio: nAct / Math.max(1, rows.length), variant: "indigo" })}
        ${UI.kpi({ label: t("With cost data"), value: String(nCost), note: t("Cost_Data_Since filled"), ratio: nCost / Math.max(1, nCost + nNo) })}
        ${UI.kpi({ label: t("Without cost data"), value: String(nNo), note: t("Shown as “No data”, never 0%"), ratio: nNo / Math.max(1, nCost + nNo), variant: "pink" })}
        ${UI.kpi({ label: t("Shared cost groups"), value: String(groups.length), note: groups.map(([g]) => g).join(", ") || t("None"), ratio: groups.length ? 1 : 0 })}
      </div>
      ${UI.card({ title: t("Unit registry"), sub: t("Source: DIM_UNIT. Codes not listed here are not monitored (e.g. PW, PBR)."), id: "regCard" })}
      ${UI.banner(t("Freshness by source, period close status and the data audit list (balance-sheet COA, pre-opening, unmapped items) will be added in this page in a later step."), "info")}`;
    host.querySelector("#regCard .card-b").appendChild(UI.table([
      { key: "unit", label: t("Unit"), render: r => UI.unitBadge(r.unit) },
      { key: "name", label: t("Name") },
      { key: "cluster", label: t("Cluster") },
      { key: "outlets", label: t("Outlets") },
      { key: "aliases", label: t("Aliases") },
      { key: "costGroup", label: t("Cost group") },
      { key: "since", label: t("Cost data since"), render: r => r.since ? esc(monthLabel(r.since)) : '<span class="muted">—</span>' },
      { key: "status", label: t("Status"), render: r => UI.tag(r.status, kind[r.st]) },
    ], { rows, topN: null }));
  },
});
