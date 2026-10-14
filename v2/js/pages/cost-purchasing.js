/* Cost of Sales › Purchasing — dispersi harga per item master (Mapping_ID) antar supplier & unit, dari detail DML. */
"use strict";

const PUR = { preset: "mtd", from: "", to: "", cluster: "ALL", unit: "ALL", sup: "ALL", cat: "ALL", minSpread: 0, pick: "" };

FMD.page("cost/purchasing", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(90) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(420);
    try { await Cost.load("dml"); } catch (e) { if (!ctx.isStale()) host.innerHTML = UI.card({ body: UI.banner(t("Cost data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
    if (ctx.isStale()) return;
    let loading = false, err = "";
    const months = () => { const R = costRange(PUR), ms = []; for (let m = R.from.slice(0, 7); m <= R.to.slice(0, 7); m = addMonths(m, 1)) ms.push(m); return ms; };
    const ensure = async () => { const ms = months(); if (ms.every(m => DmlDetail.byMonth && DmlDetail.byMonth[m])) return;
      loading = true; draw(); try { await DmlDetail.ensure(ms); err = ""; } catch (e) { err = e.message; } loading = false; if (!ctx.isStale()) draw(); };

    const draw = () => {
      Cost.prep();
      const sc = costUnitScope({ cluster: PUR.cluster, units: PUR.unit === "ALL" ? [] : [PUR.unit] });
      if (PUR.unit !== "ALL" && !sc.avail.includes(PUR.unit)) PUR.unit = "ALL";
      const K = new Set(sc.keys);
      host.innerHTML = `
        <section class="card" style="padding:14px 18px;gap:10px"><div class="filters" id="puF1"></div><div class="filters" id="puF2"></div></section>
        <div id="puMsg"></div><section class="grid g4" id="puKpi"></section>
        <section class="card" id="puIns"><div class="card-h"><div><h2>${esc(t("Insights"))}</h2><div class="sub">${esc(t("Automated, rule-based"))}</div></div></div><div class="card-b"></div></section>
        <section class="card" id="puTbl"><div class="card-h"><div><h2>${esc(t("Price Dispersion Across Suppliers and Units"))}</h2><div class="sub">${esc(t("Average price paid per item master in the period · select an item for supplier and unit detail"))}</div></div><div class="card-tools"></div></div><div class="card-b"></div>
          <div class="muted" style="font-size:12px">${esc(t("Prices are compared within the same item master (Mapping_ID), assuming one unit of measure per item. Pack-size normalisation (Rp/kg, Rp/L) needs the item master and is not applied yet. Potential saving = quantity bought above the lowest price × the price difference."))}</div></section>
        <section class="card" id="puDet" style="display:none"><div class="card-h"><div><h2 id="puDetT"></h2></div></div><div class="card-b"></div></section>`;
      const R = costPeriodControls(host.querySelector("#puF1"), PUR, () => { draw(); ensure(); }, { threeM: true });
      const F2 = host.querySelector("#puF2");
      F2.appendChild(UI.clusterSelect(PUR.cluster, v => { PUR.cluster = v; PUR.unit = "ALL"; draw(); }));
      F2.appendChild(UI.select(t("Unit"), [["ALL", t("All units")]].concat(sc.avail.map(k => [k, k])), PUR.unit, v => { PUR.unit = v; draw(); }));
      const ms = months(), have = ms.every(m => DmlDetail.byMonth && DmlDetail.byMonth[m]);
      const base = have ? DmlDetail.rows(ms).filter(r => r._d >= R.from && r._d <= R.to && K.has(r._k) && r._p > 0 && r.Qty > 0) : [];
      const sups = [...new Set(base.map(r => String(r.Supplier || "").trim()).filter(Boolean))].sort(), cats = [...new Set(base.map(r => String(r.Kategori || "")).filter(Boolean))].sort();
      if (PUR.sup !== "ALL" && !sups.includes(PUR.sup)) PUR.sup = "ALL";
      F2.appendChild(UI.select(t("Supplier"), [["ALL", t("All suppliers")]].concat(sups.map(s => [s, s])), PUR.sup, v => { PUR.sup = v; draw(); }));
      F2.appendChild(UI.select(t("Category"), [["ALL", t("All categories")]].concat(cats.map(c => [c, c])), PUR.cat, v => { PUR.cat = v; draw(); }));
      F2.appendChild(UI.select(t("Minimum spread"), [[0, t("Any")], [0.1, "≥ 10%"], [0.2, "≥ 20%"], [0.5, "≥ 50%"]], PUR.minSpread, v => { PUR.minSpread = +v; draw(); }));
      const msg = []; if (loading) msg.push(UI.banner(t("Loading purchase lines…"), "info")); if (err) msg.push(UI.banner(t("Purchase lines could not be loaded: {e}", { e: err }), "crit"));
      host.querySelector("#puMsg").innerHTML = msg.join("");
      if (!have) { host.querySelector("#puTbl .card-b").innerHTML = UI.skeleton(240); host.querySelector("#puIns .card-b").innerHTML = ""; return; }

      // ---- agregasi item -> (supplier, unit) ----
      const lines = base.filter(r => PUR.cat === "ALL" || String(r.Kategori || "") === PUR.cat);
      const items = {};
      lines.forEach(r => { const id = r.Mapping_ID || r.Nama_Item, s = String(r.Supplier || "").trim() || t("(no supplier)");
        const I = (items[id] = items[id] || { id, name: r.Nama_Item, cat: r.Kategori || "", g: {}, amt: 0, qty: 0, lines: [] });
        const g = (I.g[s + "|" + r._k] = I.g[s + "|" + r._k] || { sup: s, unit: r._k, amt: 0, qty: 0, last: "", lastP: 0, n: 0 });
        g.amt += r._amt || 0; g.qty += r.Qty; g.n++; if (r._d >= g.last) { g.last = r._d; g.lastP = r._p; }
        I.amt += r._amt || 0; I.qty += r.Qty; I.lines.push(r); });
      const rows = Object.values(items).map(I => {
        const gs = Object.values(I.g).map(g => ({ ...g, avg: g.qty > 0 ? g.amt / g.qty : 0 })).filter(g => g.avg > 0);
        if (gs.length < 2) return null;
        const lo = gs.reduce((a, b) => b.avg < a.avg ? b : a), hi = gs.reduce((a, b) => b.avg > a.avg ? b : a);
        const save = I.lines.reduce((s, r) => s + Math.max(0, r._p - lo.avg) * r.Qty, 0);
        return { id: I.id, name: I.name, cat: I.cat, amt: I.amt, lo: lo.avg, loBy: lo.sup + " · " + lo.unit, hi: hi.avg, hiBy: hi.sup + " · " + hi.unit, spread: hi.avg / lo.avg - 1, save,
          units: [...new Set(gs.map(g => g.unit))].join(", "), nSup: new Set(gs.map(g => g.sup)).size, gs, supHit: PUR.sup === "ALL" || gs.some(g => g.sup === PUR.sup) };
      }).filter(r => r && r.supHit && r.spread >= PUR.minSpread);
      const totSave = rows.reduce((s, r) => s + r.save, 0), totAmt = lines.reduce((s, r) => s + (r._amt || 0), 0), wide = rows.filter(r => r.spread >= 0.2);
      host.querySelector("#puKpi").innerHTML = [
        UI.kpi({ label: t("Purchases Reviewed"), value: fmtRp(totAmt), showRing: false, note: t("{n} lines with price and quantity", { n: fmtInt(lines.length) }) }),
        UI.kpi({ label: t("Items With Price Variation"), value: fmtInt(rows.length), showRing: false, note: t("Bought at 2+ supplier/unit combinations") }),
        UI.kpi({ label: t("Spread ≥ 20%"), value: fmtInt(wide.length), showRing: false, note: t("Items with the widest price gap"), noteKind: wide.length ? "warn" : "" }),
        UI.kpi({ label: t("Potential Saving"), value: fmtRp(totSave), showRing: false, note: totAmt > 0 ? t("{p} of purchases reviewed, at the lowest observed price", { p: fmtPct(totSave / totAmt, 1) }) : "" }),
      ].join("");
      const topS = rows.slice().sort((a, b) => b.save - a.save).slice(0, 3);
      host.querySelector("#puIns .card-b").innerHTML = topS.length ? `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:1.55">` + topS.map(r =>
        `<li>${esc(t("{i} costs {p} more at {h} than at {l}; buying all of it at the lower price would have saved about {s} in this period.", { i: r.name, p: fmtPct(r.spread, 0), h: r.hiBy, l: r.loBy, s: fmtRp(r.save) }))}</li>`).join("") + `</ul>`
        : UI.empty(t("No items with price variation for the selected filters."));
      const tbl = UI.table([
        { key: "name", label: t("Item master"), render: r => `<b>${esc(r.name)}</b><div class="muted" style="font-size:11px">${esc(r.id)} · ${esc(r.cat)}</div>` },
        { key: "lo", label: t("Lowest avg. price"), type: "money", render: r => `<span class="num">${esc(fmtInt(r.lo))}</span><div class="muted" style="font-size:11px">${esc(r.loBy)}</div>` },
        { key: "hi", label: t("Highest avg. price"), type: "money", render: r => `<span class="num">${esc(fmtInt(r.hi))}</span><div class="muted" style="font-size:11px">${esc(r.hiBy)}</div>` },
        { key: "spread", label: t("Spread"), type: "pct", render: r => UI.tag("+" + fmtPct(r.spread, 0), r.spread >= 0.5 ? "crit" : r.spread >= 0.2 ? "warn" : "mute") },
        { key: "save", label: t("Potential saving"), type: "money" }, { key: "amt", label: t("Purchased"), type: "money" },
        { key: "nSup", label: t("Suppliers"), type: "int" }, { key: "units", label: t("Units") },
        { key: "loBy", label: t("Lowest at"), hidden: true }, { key: "hiBy", label: t("Highest at"), hidden: true }, { key: "id", label: "Mapping_ID", hidden: true },
      ], { rows, topN: 20, sort: { key: "save", dir: "desc" }, search: true, onRow: r => { PUR.pick = PUR.pick === r.id ? "" : r.id; draw(); }, emptyText: t("No items with price variation for the selected filters.") });
      host.querySelector("#puTbl .card-b").appendChild(tbl);
      const pk = rows.find(r => r.id === PUR.pick);
      if (pk) { const d = host.querySelector("#puDet"); d.style.display = ""; host.querySelector("#puDetT").textContent = t("{i} — by supplier and unit", { i: pk.name });
        d.querySelector(".card-b").appendChild(UI.table([{ key: "sup", label: t("Supplier") }, { key: "unit", label: t("Unit") }, { key: "avg", label: t("Avg. price"), type: "money", render: r => `<span class="num">${esc(fmtInt(r.avg))}</span>${r.avg === pk.lo ? " " + UI.tag(t("lowest"), "ok") : " " + UI.tag("+" + fmtPct(r.avg / pk.lo - 1, 0), "crit")}` },
          { key: "lastP", label: t("Last price"), type: "money", render: r => `<span class="num">${esc(fmtInt(r.lastP))}</span>` }, { key: "last", label: t("Last order"), type: "date" },
          { key: "qty", label: t("Qty"), type: "num" }, { key: "amt", label: t("Amount"), type: "money" }, { key: "n", label: t("Lines"), type: "int" }], { rows: pk.gs, sort: { key: "avg", dir: "asc" }, total: true })); }
    };
    draw();
    ensure();
  },
});
