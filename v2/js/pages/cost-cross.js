/* Cost of Sales › Cross-Unit Comparison (COGS) + Operating Expenses › Supplies by Unit (Non-COGS) — satu template, dua preset. */
"use strict";

const XU_STATE = {};
const HEAT_MIN_REV_30D = 50e6;   // pewarnaan hanya bila penyebut >= Rp 50 Mio per 30 hari (usulan handoff)

function crossPage(id, cls) {
  FMD.page(id, {
    async render(host, ctx) {
      const S = (XU_STATE[id] = XU_STATE[id] || { cls, preset: cls === "SUP" ? "prev" : "mtd", from: "", to: "", cluster: "ALL", units: [], src: "all", view: "cat", measure: "pct", topN: 20, q: "", open: "" });
      host.innerHTML = UI.skeleton(90) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(420);
      try { await Cost.load("cons"); } catch (e) { if (!ctx.isStale()) host.innerHTML = UI.card({ body: UI.banner(t("Cost data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
      if (ctx.isStale()) return;
      let loading = false, loadErr = "";
      const needDml = () => S.cls === "COGS" && S.src !== "sr";
      const ensure = async () => {
        if (!needDml()) return;
        const R = costRange(S), ms = []; for (let m = R.from.slice(0, 7); m <= R.to.slice(0, 7); m = addMonths(m, 1)) ms.push(m);
        if (ms.every(m => DmlDetail.byMonth && DmlDetail.byMonth[m])) return;
        loading = true; draw();
        try { await DmlDetail.ensure(ms); loadErr = ""; } catch (e) { loadErr = e.message; }
        loading = false; if (!ctx.isStale()) draw();
      };

      const draw = () => {
        Cost.prep();
        const sc = costUnitScope(S), keys = sc.keys.filter(k => !COST_CENTER_ONLY.has(k)), avail = sc.avail.filter(k => !COST_CENTER_ONLY.has(k));
        host.innerHTML = `
          <section class="card" style="padding:14px 18px;gap:10px"><div class="filters" id="xF1"></div><div id="xUnits"></div><div class="filters" id="xF2"></div></section>
          <div id="xMsg"></div>
          <div class="banner info" role="note" id="xBasis"></div>
          <section class="grid g4" id="xKpi"></section>
          <section class="card" id="xTbl"><div class="card-h"><div><h2 id="xTitle"></h2><div class="sub" id="xSub"></div></div><div class="card-tools" id="xTools"></div></div>
            <div class="chart-legend" style="font-size:12px"><span>${esc(t("Colour = intensity (% of revenue) vs the median of the same row:"))}</span><span class="lg"><span class="sw" style="background:var(--crit-bg);border:1px solid var(--crit)"></span>≥ +30%</span><span class="lg"><span class="sw" style="background:var(--warn-bg);border:1px solid var(--warn)"></span>+15–30%</span><span class="lg"><span class="sw" style="background:var(--info-bg);border:1px solid var(--info)"></span>≤ −30%</span></div>
            <div class="card-b"></div></section>`;
        const R = costPeriodControls(host.querySelector("#xF1"), S, () => { draw(); ensure(); }, { threeM: true });
        const days = daysBetween(R.from, R.to) + 1, minRev = HEAT_MIN_REV_30D * days / 30;
        const o = { from: R.from, to: R.to, gas: false, fgManual: true, keys: new Set(keys) };
        const F1 = host.querySelector("#xF1"), F2 = host.querySelector("#xF2");
        F1.appendChild(UI.clusterSelect(S.cluster, v => { S.cluster = v; S.units = []; draw(); }));
        const ul = UI.node(`<div class="field">${esc(t("Units shown"))}</div>`);
        ul.appendChild(UI.unitPicker(avail, sc.sel.filter(k => avail.includes(k)), v => { S.units = v.length === avail.length ? [] : v; draw(); })); host.querySelector("#xUnits").appendChild(ul);
        const segF = (lab, opts, key, after) => { const f = UI.node(`<label class="field">${esc(lab)}</label>`); f.appendChild(UI.seg(opts, S[key], v => { S[key] = v; S.open = ""; S.openU = ""; draw(); if (after) after(); }, lab)); F2.appendChild(f); };
        if (S.cls === "COGS") segF(t("Source"), [["all", t("DML + SR")], ["dml", "DML"], ["sr", "SR"]], "src", ensure);
        segF(t("View"), [["cat", t("Category")], ["item", t("Item")]], "view");
        segF(t("Measure"), [["pct", t("% of revenue")], ["amt", t("Amount")]].concat(S.view === "item" ? [["qty", t("Qty")], ["price", t("Unit price")]] : []), "measure");
        if (S.view !== "item" && (S.measure === "qty" || S.measure === "price")) S.measure = "pct";
        const q = UI.node(`<label class="field">${esc(t("Search"))}<input type="search" value="${esc(S.q)}" placeholder="${esc(S.view === "item" ? t("Item name") : t("Category"))}"></label>`);
        let qT; q.querySelector("input").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value.trim(); draw(); const i = host.querySelector("#xF2 input[type=search]"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); });
        F2.appendChild(q);

        // ---- baris sumber ----
        const lines = [];   // {k, cat, item, bev, amt, qty, src, who, price, d}
        const SK = SUBCAT_L();
        if (S.cls === "COGS") {
          if (S.src !== "dml") Cost.consDetail(o, "FB").forEach(r => { const bev = String(r.Kategori).toUpperCase() === "BEVERAGE", sk = subKategoriOf(r);
            lines.push({ k: Cost.key(r.Unit_Beban), cat: sk === "RAW" ? (bev ? t("Store requisition · Beverage") : t("Store requisition · Food")) : t("CK {s}", { s: SK[sk] }), item: String(r.Description || "").trim().toUpperCase(),
              bev, amt: Number(r.Amount) || 0, qty: Number(r.Qty) || 0, src: "SR", who: r.Unit_Sumber || "", d: r._d }); });
          if (S.src !== "sr") { const ms = []; for (let m = R.from.slice(0, 7); m <= R.to.slice(0, 7); m = addMonths(m, 1)) ms.push(m);
            if (ms.every(m => DmlDetail.byMonth && DmlDetail.byMonth[m])) DmlDetail.rows(ms).forEach(r => { if (!(r._d >= R.from && r._d <= R.to) || !o.keys.has(r._k)) return;
              lines.push({ k: r._k, cat: String(r.Kategori || t("Uncategorised")), item: String(r.Nama_Item || "").trim().toUpperCase(), bev: r.Bucket === "BAR", amt: r._amt || 0, qty: r.Qty, src: "DML", who: String(r.Supplier || "").trim(), price: r._p, d: r._d }); }); }
        } else {
          Cost.consDetail(o, "SUP").forEach(r => lines.push({ k: Cost.key(r.Unit_Beban), cat: supCategory(r.Kategori), item: String(r.Description || "").trim().toUpperCase(), bev: false, sup: true,
            amt: Number(r.Amount) || 0, qty: Number(r.Qty) || 0, src: "SR", who: r.Unit_Sumber || "", d: r._d, coa: COA_OF(r.COA) }));
        }
        const rev = {}; keys.forEach(k => (rev[k] = Cost.rev(k, R.from, R.to)));
        const den = (k, bev) => S.cls === "SUP" ? rev[k].revAll : bev ? rev[k].revBev : rev[k].revFood;

        // ---- pivot ----
        const piv = {};
        lines.forEach(l => { const rk = S.view === "item" ? l.item : l.cat; if (!rk) return;
          const p = (piv[rk] = piv[rk] || { name: rk, u: {}, bevAmt: 0, amt: 0, cats: {}, src: new Set() });
          const c = (p.u[l.k] = p.u[l.k] || { amt: 0, qty: 0 }); c.amt += l.amt; c.qty += l.qty; p.amt += l.amt; if (l.bev) p.bevAmt += l.amt; p.cats[l.cat] = (p.cats[l.cat] || 0) + l.amt; p.src.add(l.src); });
        const val = (p, k) => { const c = p.u[k]; if (!c || !c.amt) return null; const bev = p.bevAmt > p.amt / 2;
          if (S.measure === "amt") return c.amt; if (S.measure === "qty") return c.qty || null; if (S.measure === "price") return c.qty ? c.amt / c.qty : null;
          const d = den(k, bev); return d > 0 ? c.amt / d : null; };
        let list = Object.values(piv).filter(p => !S.q || p.name.toLowerCase().includes(S.q.toLowerCase())).map(p => {
          const vals = keys.map(k => val(p, k)), med = medianOf(vals);
          return { ...p, vals, med, bev: p.bevAmt > p.amt / 2, catMain: (Object.entries(p.cats).sort((a, b) => b[1] - a[1])[0] || [""])[0] };
        }).sort((a, b) => b.amt - a.amt);
        const totalRows = list.length; if (S.topN) list = list.slice(0, S.topN);
        const heat = (p, i) => { if (S.measure !== "pct" || p.med == null || p.med <= 0) return ""; const v = p.vals[i]; if (v == null) return "";
          const k = keys[i]; if (den(k, p.bev) < minRev) return ""; const d = v / p.med - 1; return d >= 0.3 ? "crit" : d >= 0.15 ? "warn" : d <= -0.3 ? "info" : ""; };
        const fv = v => v == null ? DASH : S.measure === "pct" ? fmtPct(v, 2) : S.measure === "qty" ? fmtNum(v) : S.measure === "price" ? fmtInt(v) : fmt(v);

        // ---- header, KPI ----
        const totAmt = lines.filter(l => o.keys.has(l.k)).reduce((s, l) => s + l.amt, 0);
        const totDen = keys.reduce((s, k) => s + (S.cls === "SUP" ? rev[k].revAll : rev[k].revTot), 0);
        let hot = 0; list.forEach(p => p.vals.forEach((v, i) => { if (heat(p, i) === "crit") hot++; }));
        host.querySelector("#xBasis").innerHTML = `<span><b>${esc(t("Basis:"))}</b> ${esc(S.cls === "COGS"
          ? t("COGS percentages use each unit’s own category revenue: Food items ÷ Food revenue (incl. events), Beverage items ÷ Beverage revenue. Store requisitions follow the Food/Beverage category on each line; direct purchases follow the requesting department (Bar = Beverage). PLCS and PKJ are compared as one cost group. Units without cost data are not shown.")
          : t("Non-COGS supplies issued from store, classified by the expense COA on each line (7xxx). Percentages use each unit’s total revenue. Direct purchases contain only food and beverage, so supplies come from store issues alone. Pre-opening and balance-sheet postings are excluded (see Data › Status)."))}</span>`;
        const msgs = [];
        if (loading) msgs.push(UI.banner(t("Loading purchase lines…"), "info"));
        if (loadErr) msgs.push(UI.banner(t("Purchase lines could not be loaded: {e}", { e: loadErr }), "crit"));
        const consLast = (STATE.data.Consumption_Master || []).reduce((m, r) => r._d > m ? r._d : m, "");
        if (consLast && consLast < R.to && (S.cls === "SUP" || S.src !== "dml")) msgs.push(UI.banner(t("Store requisitions are recorded through {d}; later days have no requisition data yet.", { d: dateLabel(consLast) }), "info"));
        host.querySelector("#xMsg").innerHTML = msgs.join("");
        host.querySelector("#xKpi").innerHTML = [
          UI.kpi({ label: S.cls === "COGS" ? t("Cost of Sales") : t("Supplies Issued"), value: fmtRp(totAmt), showRing: false, note: S.cls === "COGS" ? ({ all: t("DML + store requisitions"), dml: t("Direct purchases only"), sr: t("Store requisitions only") })[S.src] : t("Issued from store, by expense COA") }),
          UI.kpi({ label: t("Intensity"), value: totDen > 0 ? fmtPct(totAmt / totDen, 2) : DASH, showRing: false, note: S.cls === "COGS" ? t("of F&B revenue, all selected units") : t("of total revenue, all selected units") }),
          UI.kpi({ label: t("Units Compared"), value: fmtInt(keys.length), showRing: false, note: t("{n} rows ({v})", { n: fmtInt(totalRows), v: S.view === "item" ? t("items") : t("categories") }) }),
          UI.kpi({ label: t("High-Intensity Cells"), value: S.measure === "pct" ? fmtInt(hot) : DASH, showRing: false, note: S.measure === "pct" ? t("≥ 30% above the row median") : t("Switch the measure to % of revenue"), noteKind: hot ? "warn" : "" }),
        ].join("");
        host.querySelector("#xTitle").textContent = S.cls === "COGS" ? (S.view === "item" ? t("Items by Unit") : t("Categories by Unit")) : (S.view === "item" ? t("Supply Items by Unit") : t("Supply Categories by Unit"));
        host.querySelector("#xSub").textContent = dateLabel(R.from) + " – " + dateLabel(R.to) + " · " + t("select a row for its detail");

        // ---- tools ----
        const tools = host.querySelector("#xTools");
        tools.appendChild(UI.seg([[10, "Top 10"], [20, "Top 20"], [50, "Top 50"], [0, t("All")]], S.topN, v => { S.topN = +v; draw(); }, t("Rows shown")));
        const cp = UI.node(`<button type="button" class="btn">${esc(t("Copy all"))}</button>`);
        cp.onclick = () => { const cols = [{ key: "name", label: S.view === "item" ? t("Item") : t("Category") }].concat(keys.map((k, i) => ({ key: "v" + i, label: k, type: S.measure === "pct" ? "pct" : S.measure === "amt" ? "money" : "num" })), [{ key: "med", label: t("Median"), type: S.measure === "pct" ? "pct" : S.measure === "amt" ? "money" : "num" }]);
          const rs = list.map(p => { const x = { name: p.name, med: p.med }; p.vals.forEach((v, i) => (x["v" + i] = v)); return x; });
          copyText(toTSV(cols, rs)).then(() => UI.toast(t("Copied {n} rows — paste into Excel", { n: fmtInt(rs.length) }))); };
        tools.appendChild(cp);

        // ---- tabel ----
        const box = host.querySelector("#xTbl .card-b");
        if (!list.length) { box.innerHTML = UI.empty(loading ? t("Loading purchase lines…") : t("No data for the selected filters.")); return; }
        box.innerHTML = `<div class="tbl-wrap" style="max-height:none"><table class="tbl heat"><thead><tr><th>${esc(S.view === "item" ? t("Item") : t("Category"))}</th>${keys.map(k => `<th class="r">${esc(k)}</th>`).join("")}<th class="r">${esc(t("Median"))}</th></tr></thead><tbody>` +
          list.map((p, ri) => `<tr class="link-row" data-r="${ri}"><td><span class="caret">${S.open === p.name ? "▾" : "▸"}</span> <b>${esc(p.name)}</b><div class="muted" style="font-size:11px">${esc(S.view === "item" ? p.catMain : (p.bev ? t("Beverage") : S.cls === "SUP" ? t("Supplies") : t("Food")))} · ${esc([...p.src].join(" + "))}</div></td>` +
            p.vals.map((v, i) => `<td class="r ${heat(p, i) ? "h-" + heat(p, i) : ""}${S.open === p.name && S.openU === keys[i] ? " cell-on" : ""}" data-c="${i}" title="${esc(t("Detail for {u} only", { u: keys[i] }))}"><span class="num">${esc(fv(v))}</span>${S.measure === "pct" && p.u[keys[i]] ? `<div class="muted" style="font-size:10.5px">${esc(fmt(p.u[keys[i]].amt))}</div>` : ""}</td>`).join("") +
            `<td class="r"><span class="num">${esc(fv(p.med))}</span></td></tr>` + (S.open === p.name ? `<tr class="sub"><td colspan="${keys.length + 2}">${detail(p)}</td></tr>` : "")).join("") + `</tbody></table></div>
          <div class="tbl-foot"><span>${esc(t("Showing {a} of {b}", { a: fmtInt(list.length), b: fmtInt(totalRows) }))} · ${esc(t("Colour only where the unit’s revenue for the period is at least {v}.", { v: fmtRp(minRev) }))}</span></div>`;
        box.querySelectorAll("tr[data-r]").forEach(tr => tr.onclick = e => { const p = list[+tr.dataset.r], td = e.target.closest("td[data-c]"), u = td ? keys[+td.dataset.c] : "";
          if (S.open === p.name && (S.openU || "") === u) { S.open = ""; S.openU = ""; } else { S.open = p.name; S.openU = u; } draw(); });

        function detail(p) {
          const ls = lines.filter(l => (S.view === "item" ? l.item : l.cat) === p.name && (S.openU ? l.k === S.openU : o.keys.has(l.k)));
          const head = `<div style="font-weight:600;margin-bottom:6px">${esc(p.name)} · ${esc(S.openU ? S.openU : t("all units shown"))}${S.openU ? ` <span class="muted" style="font-weight:400">${esc(t("— select the row name for all units"))}</span>` : ` <span class="muted" style="font-weight:400">${esc(t("— select a unit’s value for that unit only"))}</span>`}</div>`;
          if (S.view === "cat") {   // item terbesar dalam kategori
            const it = {}; ls.forEach(l => { const x = (it[l.item] = it[l.item] || { amt: 0, qty: 0, u: {} }); x.amt += l.amt; x.qty += Number(l.qty) || 0; x.u[l.k] = (x.u[l.k] || 0) + l.amt; });
            const top = Object.entries(it).sort((a, b) => b[1].amt - a[1].amt).slice(0, 10);
            if (!top.length) return head + UI.empty(t("No lines for this unit."));
            return head + `<div class="muted" style="font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:4px">${esc(t("Largest items"))}</div>
              <div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>${esc(t("Item"))}</th><th class="r">${esc(t("Qty"))}</th><th class="r">${esc(t("Amount"))}</th><th class="r">${esc(t("Avg price"))}</th>${S.openU ? "" : `<th>${esc(t("Largest unit"))}</th>`}</tr></thead><tbody>` +
              top.map(([n, x]) => { const big = Object.entries(x.u).sort((a, b) => b[1] - a[1])[0];
                return `<tr><td>${esc(n)}</td><td class="r"><span class="num">${esc(x.qty ? fmtNum(x.qty) : DASH)}</span></td><td class="r"><span class="num">${esc(fmt(x.amt))}</span></td><td class="r"><span class="num">${esc(x.qty ? fmtInt(x.amt / x.qty) : DASH)}</span></td>${S.openU ? "" : `<td>${esc(big[0])}</td>`}</tr>`; }).join("") +
              `</tbody></table></div><div class="muted" style="font-size:11px;margin-top:4px">${esc(t("Qty is in each item’s own unit (kg, pcs, btl…) and is not added across items."))}</div>`;
          }
          const w = {}; ls.forEach(l => { const key = l.src + "|" + l.who + "|" + l.k, x = (w[key] = w[key] || { src: l.src, who: l.who, k: l.k, amt: 0, qty: 0, last: "", price: null });
            x.amt += l.amt; x.qty += l.qty; if (l.d >= x.last) { x.last = l.d; if (l.price) x.price = l.price; } });
          const ws = Object.values(w).sort((a, b) => b.amt - a.amt).slice(0, 12), ps = ws.map(x => x.price).filter(v => v > 0), mn = ps.length ? Math.min(...ps) : null;
          return head + `<div class="muted" style="font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:4px">${esc(t("Supplier (DML) or issuing store (SR)"))}</div>` + (ws.length ? "" : UI.empty(t("No lines for this unit."))) + ws.map(x =>
            `<div class="kv"><span>${UI.tag(x.src, x.src === "DML" ? "info" : "mute")} ${esc(x.who || DASH)} → <b>${esc(x.k)}</b></span><span class="num">${esc(t("Qty"))} ${esc(fmtNum(x.qty))} · ${esc(fmt(x.amt))}${x.price ? ` · @${esc(fmtInt(x.price))}` : x.qty ? ` · @${esc(fmtInt(x.amt / x.qty))}` : ""}${mn != null && x.price && ps.length > 1 ? " " + (x.price === mn ? UI.tag(t("lowest"), "ok") : UI.tag("+" + fmtPct((x.price - mn) / mn, 0), "crit")) : ""} <span class="muted">· ${esc(dateLabel(x.last, true))}</span></span></div>`).join("");
        }
      };
      draw();
      ensure();
      const onTheme = () => draw();
      document.addEventListener("fmd:theme", onTheme);
      return () => document.removeEventListener("fmd:theme", onTheme);
    },
  });
}
crossPage("cost/cross-unit", "COGS");
crossPage("opex/supplies", "SUP");
