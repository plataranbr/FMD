/* Cost of Sales › Store Requisitions & CK */
"use strict";

const SRU = { preset: "prev", from: "", to: "", cluster: "ALL", unit: "ALL", cat: "ALL", tipe: "ALL", sub: "ALL", tab: "ratio", trfUnit: "", fgManual: true };

FMD.page("cost/sr-ck", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(90) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(420);
    let res;
    try { res = await Cost.load("sr"); } catch (e) { if (!ctx.isStale()) host.innerHTML = UI.card({ body: UI.banner(t("Cost data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
    if (ctx.isStale()) return;
    const SK = SUBCAT_L();

    const draw = () => {
      Cost.prep();
      const st = { cluster: SRU.cluster, units: SRU.unit === "ALL" ? [] : [SRU.unit] }, sc = costUnitScope(st);
      if (SRU.unit !== "ALL" && !sc.avail.includes(SRU.unit)) SRU.unit = "ALL";
      host.innerHTML = `
        <section class="card" style="padding:14px 18px;gap:10px"><div class="filters" id="srF1"></div><div class="filters" id="srF2"></div></section>
        <div id="srWarn"></div>
        <section class="grid g4" id="srKpi"></section>
        <section class="card" id="srMain"><div class="seg" role="tablist" id="srTabs" style="align-self:flex-start"></div><div class="muted" id="srNote" style="font-size:13px"></div><div class="card-b"></div></section>`;
      const R = costPeriodControls(host.querySelector("#srF1"), SRU, draw);
      const o = { from: R.from, to: R.to, gas: false, fgManual: SRU.fgManual, keys: new Set(sc.keys) };
      const F2 = host.querySelector("#srF2");
      F2.appendChild(UI.clusterSelect(SRU.cluster, v => { SRU.cluster = v; SRU.unit = "ALL"; draw(); }));
      F2.appendChild(UI.select(t("Unit"), [["ALL", t("All units")]].concat(sc.avail.map(k => [k, k])), SRU.unit, v => { SRU.unit = v; draw(); }));
      F2.appendChild(UI.select(t("Category"), [["ALL", t("Food + Beverage")], ["FOOD", t("Food")], ["BEVERAGE", t("Beverage")]], SRU.cat, v => { SRU.cat = v; draw(); }));
      F2.appendChild(UI.select(t("Type"), [["ALL", t("All types")], ["INITIAL", t("Own store (initial)")], ["TRANSFER", t("Transfer")]], SRU.tipe, v => { SRU.tipe = v; draw(); }));
      F2.appendChild(UI.select(t("Sub-category"), [["ALL", t("All")]].concat(Object.entries(SK)), SRU.sub, v => { SRU.sub = v; draw(); }));
      F2.appendChild(UI.select(t("CK FG source"), [["1", t("CK manual input")], ["0", t("Consumption (legacy)")]], SRU.fgManual ? "1" : "0", v => { SRU.fgManual = v === "1"; draw(); }));

      // ---- data ----
      const all = Cost.consDetail(o, "FB");
      const rows = all.filter(r => (SRU.cat === "ALL" || String(r.Kategori).toUpperCase() === SRU.cat) && (SRU.tipe === "ALL" || String(r.Tipe).toUpperCase() === SRU.tipe)
        && (SRU.sub === "ALL" || subKategoriOf(r) === SRU.sub));
      const per = {};
      all.forEach(r => { const k = Cost.key(r.Unit_Beban), x = (per[k] = per[k] || { F: 0, B: 0, fg: 0, inc: false }), a = Number(r.Amount) || 0;
        if (String(r.Kategori).toUpperCase() === "BEVERAGE") x.B += a; else x.F += a;
        if (subKategoriOf(r) !== "RAW") x.fg += a; if (String(r.Flag_Status || "").toUpperCase() === "INCOMPLETE") x.inc = true; });
      const ratio = Object.entries(per).map(([k, x]) => { const rv = Cost.rev(k, R.from, R.to);
        return { unit: k, name: Cost.name(k), ck: COST_CENTER_ONLY.has(k), F: x.F, B: x.B, tot: x.F + x.B, fg: x.fg, inc: x.inc, revFood: rv.revFood, revBev: rv.revBev, revTot: rv.revTot,
          pf: rv.revFood > 0 ? x.F / rv.revFood : null, pb: rv.revBev > 0 ? x.B / rv.revBev : null, pt: rv.revTot > 0 ? (x.F + x.B) / rv.revTot : null }; })
        .filter(r => r.tot > 0).sort((a, b) => Cost.order(a.unit) - Cost.order(b.unit));
      const T = Cost.totals(ratio, "SRT", r => r.tot, r => r.F, r => r.B);
      const prod = (STATE.data.CK_FG_Production || []).filter(r => { const d = dstr(r.Date); return d >= R.from && d <= R.to; });
      const trf = (STATE.data.CK_FG_Rows || []).filter(r => r._d >= R.from && r._d <= R.to);
      const tProd = prod.reduce((s, r) => s + (Number(r.Amount) || 0), 0), tTrf = trf.reduce((s, r) => s + (Number(r.Amount) || 0), 0);
      const consLast = (STATE.data.Consumption_Master || []).reduce((m, r) => r._d > m ? r._d : m, "");

      const warns = [];
      if (consLast && consLast < R.to) warns.push(["info", t("Store requisitions are recorded through {d}; later days have no requisition data yet.", { d: dateLabel(consLast) })]);
      if (SRU.fgManual && !trf.length) warns.push(["warn", t("CK manual FG input (CK_FG_Transfer) has no entries in this period, so FG transfers from CK are zero here, not a real decrease.")]);
      host.querySelector("#srWarn").innerHTML = warns.map(([k, w]) => UI.banner(w, k)).join("");
      host.querySelector("#srKpi").innerHTML = [
        UI.kpi({ label: t("Store Requisitions"), value: fmtRp(T.tot), showRing: false, note: t("Own store + transfers in · excl. CK") }),
        UI.kpi({ label: t("SR Cost Ratio"), value: T.pct == null ? DASH : fmtPct(T.pct, 1), showRing: false, note: T.pct == null ? "" : t("{x} vs {g} target", { x: fmtPts(T.pct - T.tgt), g: fmtPct(T.tgt, 0) }), noteKind: T.pct == null ? "" : T.pct > T.tgt ? "crit" : T.pct > T.tgt * 0.9 ? "warn" : "ok" }),
        UI.kpi({ label: t("CK Production"), value: fmtRp(tProd), showRing: false, note: t("Internal price · {n} lines", { n: fmtInt(prod.length) }) }),
        UI.kpi({ label: t("CK Transfers Out"), value: fmtRp(tTrf), showRing: false, note: t("{n} receiving units", { n: new Set(trf.map(r => r.Unit_Beban)).size }) }),
      ].join("");

      // ---- tabs ----
      const TABS = [["ratio", t("Cost ratio by unit")], ["top", t("Top consumption")], ["detail", t("Detail lines")], ["prod", t("CK production")], ["trf", t("CK transfers out")]];
      const tabs = host.querySelector("#srTabs");
      TABS.forEach(([k, l]) => { const b = UI.node(`<button type="button" role="tab" aria-pressed="${SRU.tab === k}">${esc(l)}</button>`); b.onclick = () => { SRU.tab = k; draw(); }; tabs.appendChild(b); });
      const box = host.querySelector("#srMain .card-b"), note = host.querySelector("#srNote");
      const revF = T.rF, revB = T.rB;

      if (SRU.tab === "ratio") {
        note.textContent = t("Consumption only (own store + transfers in, including CK FG) against F&B revenue · target {g}. Units without their own store show transfers in only; combined DML + SR ratios are on the Summary page.", { g: fmtPct(COST_TGT.SRT.F, 0) });
        const P = (key, cat) => r => r.ck ? csPill(r[key], 1) : csPillBtn(r[key], Cost.target("SRT", cat, r.revFood, r.revBev), r.unit, cat || "T");
        const tb = UI.table([
          { key: "unit", label: t("Unit"), render: r => `<b>${esc(r.unit)}</b>${r.ck ? " " + UI.tag(t("no revenue · excl."), "mute") : ""}${r.inc ? " " + UI.tag("INC", "crit") : ""}<div class="muted" style="font-size:11px">${esc(r.name || "")}</div>` },
          { key: "F", label: t("Food cost"), type: "money" }, { key: "revFood", label: t("Food revenue"), type: "money" }, { key: "pf", label: t("Food %"), type: "pct", render: P("pf", "F") },
          { key: "B", label: t("Bev. cost"), type: "money" }, { key: "revBev", label: t("Bev. revenue"), type: "money" }, { key: "pb", label: t("Bev. %"), type: "pct", render: P("pb", "B") },
          { key: "tot", label: t("Total"), type: "money" }, { key: "revTot", label: t("F&B revenue"), type: "money" }, { key: "pt", label: t("F&B %"), type: "pct", render: P("pt", null) },
          { key: "fg", label: t("Of which CK FG"), type: "money" },
        ], { rows: ratio, full: true, emptyText: t("No requisitions for the selected filters."), onRow: r => { if (!r.ck) { SRU.unit = r.unit; SRU.tab = "top"; draw(); } },
          total: () => ({ unit: t("Total (excl. CK)"), F: T.cF, revFood: T.rF, pf: T.pctF, B: T.cB, revBev: T.rB, pb: T.pctB, tot: T.tot, revTot: T.rev, pt: T.pct, fg: ratio.filter(r => !r.ck).reduce((s, r) => s + r.fg, 0) }) });
        box.appendChild(tb);
        const dayBox = UI.node(`<section class="card" style="display:none;margin-top:14px;padding:0"></section>`); box.appendChild(dayBox); wireDayPills(tb, dayBox, o, "SRT");
        const tr = tb.querySelector("tr.total"); if (tr) { const td = tr.querySelectorAll("td"); td[3].innerHTML = csPill(T.pctF, T.tgtF); td[6].innerHTML = csPill(T.pctB, T.tgtB); td[9].innerHTML = csPill(T.pct, T.tgt); }
      } else if (SRU.tab === "top") {
        note.textContent = t("Highest-value consumption items for the selected units and period. Compare the same item across units on the Cross-Unit Comparison page.");
        const agg = {};
        rows.forEach(r => { const sk = subKategoriOf(r), k = String(r.ArtNo || r.Description) + "|" + sk, bev = String(r.Kategori).toUpperCase() === "BEVERAGE";
          const x = (agg[k] = agg[k] || { item: String(r.Description || ""), art: String(r.ArtNo || ""), sub: SK[sk], dept: bev ? t("Bar") : t("Kitchen"), bev, qty: 0, amt: 0, last: "" });
          x.qty += Number(r.Qty) || 0; x.amt += Number(r.Amount) || 0; if (r._d > x.last) x.last = r._d; });
        box.appendChild(UI.table([
          { key: "item", label: t("Item") }, { key: "art", label: "Art No", hidden: true }, { key: "sub", label: t("Sub-category") }, { key: "dept", label: t("Dept.") },
          { key: "qty", label: t("Qty"), type: "num" }, { key: "amt", label: t("Amount"), type: "money" },
          { key: "pct", label: t("% of F/B revenue"), type: "pct", get: r => { const d = r.bev ? revB : revF; return d > 0 ? r.amt / d : null; }, render: r => { const d = r.bev ? revB : revF; return d > 0 ? `<span class="num">${esc(fmtPct(r.amt / d, 2))}</span> <span class="muted" style="font-size:11px">${esc(r.bev ? t("of Bev.") : t("of Food"))}</span>` : DASH; } },
          { key: "last", label: t("Last issue"), type: "date" },
        ], { rows: Object.values(agg), topN: 10, sort: { key: "amt", dir: "desc" }, search: true, emptyText: t("No requisitions for the selected filters.") }));
      } else if (SRU.tab === "detail") {
        note.textContent = t("All requisition and transfer lines matching the filters above, newest first. Quantities are not totalled because units of measure differ.");
        box.appendChild(UI.table([
          { key: "d", label: t("Date"), type: "date" }, { key: "src", label: t("Source") }, { key: "to", label: t("Charge to") }, { key: "tipe", label: t("Type") },
          { key: "item", label: t("Item") }, { key: "sub", label: t("Sub-cat.") }, { key: "kat", label: t("Cat.") }, { key: "qty", label: t("Qty"), type: "num" }, { key: "amt", label: t("Amount"), type: "money" },
          { key: "coa", label: "COA", hidden: true }, { key: "flag", label: t("Flag"), render: r => r.flag && r.flag !== "OK" ? UI.tag(r.flag, r.flag === "INCOMPLETE" ? "crit" : "warn") : `<span class="muted">${esc(r.flag || DASH)}</span>` },
        ], { rows: rows.map(r => ({ d: r._d, src: r.Unit_Sumber || "", to: r.Unit_Beban, tipe: String(r.Tipe || ""), item: r.Description || "", sub: SK[subKategoriOf(r)], kat: r.Kategori, qty: Number(r.Qty) || 0, amt: Number(r.Amount) || 0, coa: r.COA || "", flag: String(r.Flag_Status || (r.Src === "MANUAL" ? "CK input" : "")).toUpperCase() })),
          sort: { key: "d", dir: "desc" }, search: true, maxRender: 300, total: true, emptyText: t("No requisitions for the selected filters."),
          note: t("Up to 300 lines are displayed; Copy includes all filtered lines.") }));
      } else if (SRU.tab === "prod") {
        note.textContent = t("Finished goods produced by the Central Kitchen (CK team input), valued at internal price. The unit filter does not apply to this view.");
        box.appendChild(UI.table([
          { key: "d", label: t("Date"), type: "date" }, { key: "item", label: t("FG item") }, { key: "art", label: "Art No", hidden: true }, { key: "sub", label: t("Sub-category") },
          { key: "qty", label: t("Qty"), type: "num" }, { key: "price", label: t("Internal price"), type: "money" }, { key: "amt", label: t("Value"), type: "money" },
        ], { rows: prod.map(r => ({ d: dstr(r.Date), item: r.Description || "", art: String(r.Art_No || ""), sub: SK[subKategoriOf({ Unit_Sumber: "CK", ArtNo: String(r.Art_No || "") })], qty: Number(r.Qty) || 0, price: Number(r.Price) || 0, amt: Number(r.Amount) || 0 })),
          sort: { key: "d", dir: "desc" }, search: true, maxRender: 300, total: true, emptyText: t("No CK production in this period.") }));
      } else {
        note.textContent = t("FG transfers out of the Central Kitchen by receiving unit (CK team input). Select a unit for item quantities. Net FG movement (production − transfers out) should match the change in CK FG stock.");
        const by = {};
        trf.forEach(r => { const k = Cost.key(r.Unit_Beban), sk = subKategoriOf(r), x = (by[k] = by[k] || { unit: k, kit: 0, bak: 0, raw: 0, tot: 0, items: new Set() });
          const a = Number(r.Amount) || 0; if (sk === "FG_KITCHEN") x.kit += a; else if (sk === "FG_BAKERY") x.bak += a; else x.raw += a; x.tot += a; x.items.add(r.ArtNo); });
        const list = Object.values(by).map(x => ({ ...x, n: x.items.size, share: tTrf > 0 ? x.tot / tTrf : null }));
        box.appendChild(UI.table([
          { key: "unit", label: t("Receiving unit"), render: r => `<b>${esc(r.unit)}</b>${SRU.trfUnit === r.unit ? " " + UI.tag(t("selected"), "info") : ""}` },
          { key: "kit", label: t("FG Kitchen"), type: "money" }, { key: "bak", label: t("FG Bakery"), type: "money" }, { key: "raw", label: t("Other"), type: "money" },
          { key: "tot", label: t("Total value"), type: "money" }, { key: "share", label: t("Share of CK output"), type: "pct" }, { key: "n", label: t("Items"), type: "int" },
        ], { rows: list, full: true, sort: { key: "tot", dir: "desc" }, total: true, onRow: r => { SRU.trfUnit = SRU.trfUnit === r.unit ? "" : r.unit; draw(); },
          note: t("Net FG movement: {v}", { v: fmtRp(tProd - tTrf) }) }));
        if (SRU.trfUnit) {
          const it = {}; trf.filter(r => Cost.key(r.Unit_Beban) === SRU.trfUnit).forEach(r => { const x = (it[r.ArtNo] = it[r.ArtNo] || { item: r.Description || "", art: r.ArtNo, qty: 0, amt: 0, first: r._d, last: r._d });
            x.qty += r.Qty; x.amt += r.Amount; if (r._d < x.first) x.first = r._d; if (r._d > x.last) x.last = r._d; });
          box.appendChild(UI.node(`<h3 style="margin:14px 0 4px">${esc(t("Items transferred to {u}", { u: SRU.trfUnit }))}</h3>`));
          box.appendChild(UI.table([{ key: "item", label: t("Item") }, { key: "art", label: "Art No" }, { key: "qty", label: t("Qty"), type: "num" }, { key: "amt", label: t("Value"), type: "money" },
            { key: "first", label: t("First"), type: "date" }, { key: "last", label: t("Last"), type: "date" }], { rows: Object.values(it), sort: { key: "amt", dir: "desc" }, topN: 20, search: true, total: true }));
        }
      }
    };
    draw();
    const onTheme = () => draw();
    document.addEventListener("fmd:theme", onTheme);
    return () => document.removeEventListener("fmd:theme", onTheme);
  },
});
