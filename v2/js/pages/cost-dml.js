/* Cost of Sales › Direct Purchases (DML) */
"use strict";

const DMU = { preset: "mtd", cluster: "ALL", unit: "ALL", dept: "ALL", cat: "ALL", sup: "ALL", from: "", to: "", topN: 10, spike: false, fresh: false, routine: false, routineDays: 3 };
const DEPT_L = () => ({ KITCHEN: t("Kitchen"), BAR: t("Bar"), EVENT: t("Event") });

function dmRange() {
  const last = STATE.lastActualDate || dstr(new Date()), m = last.slice(0, 7);
  if (DMU.preset === "mtd") { DMU.from = m + "-01"; DMU.to = last; }
  else if (DMU.preset === "prev") { const pm = addMonths(m, -1); DMU.from = pm + "-01"; DMU.to = monthEnd(pm); }
  if (!DMU.from) { DMU.from = m + "-01"; DMU.to = last; }
  return { from: DMU.from, to: DMU.to };
}
function monthsIn(from, to) { const out = []; for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) out.push(m); return out; }

FMD.page("cost/dml", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(90) + `<div class="grid g4">${UI.skeleton(100).repeat(4)}</div>` + UI.skeleton(420);
    try { await Cost.load("dml"); } catch (e) { if (!ctx.isStale()) host.innerHTML = UI.card({ body: UI.banner(t("Cost data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
    if (ctx.isStale()) return;
    let loadErr = "", loading = false;

    const ensure = async () => {
      const R = dmRange(), need = monthsIn(R.from, R.to);
      if (need.every(m => DmlDetail.byMonth && DmlDetail.byMonth[m])) return;
      loading = true; draw();
      try { await DmlDetail.ensure(need); loadErr = ""; } catch (e) { loadErr = e.message; }
      loading = false; if (!ctx.isStale()) draw();
    };

    const draw = () => {
      Cost.prep();
      const R = dmRange(), months = monthsIn(R.from, R.to), DL = DEPT_L();
      const avail = Cost.allKeys().filter(k => !Cost.hidden(k) && (DMU.cluster === "ALL" || Cost.cluster(k) === DMU.cluster)).sort((a, b) => Cost.order(a) - Cost.order(b));
      if (DMU.unit !== "ALL" && !avail.includes(DMU.unit)) DMU.unit = "ALL";
      const keys = DMU.unit === "ALL" ? avail : [DMU.unit], K = new Set(keys);
      const o = { from: R.from, to: R.to, gas: false, fgManual: true, keys: K };   // tanpa LPG = default tab DML lama
      const sumRows = Cost.summary(o).filter(r => r.dml > 0);
      const T = Cost.totals(sumRows, "DML", r => r.dml, r => r.dmlK + r.dmlE, r => r.dmlB);
      const have = months.every(m => DmlDetail.byMonth && DmlDetail.byMonth[m]);
      const cad = cadenceMap();
      const base = have ? DmlDetail.rows(months).filter(r => r._d >= R.from && r._d <= R.to && K.has(r._k)
        && (DMU.dept === "ALL" || r.Bucket === DMU.dept) && (DMU.cat === "ALL" || String(r.Kategori || "") === DMU.cat)) : [];
      const cats = [...new Set((have ? DmlDetail.rows(months) : []).map(r => String(r.Kategori || "")).filter(Boolean))].sort();
      const sups = [...new Set(base.map(r => String(r.Supplier || "").trim()).filter(Boolean))].sort();
      if (DMU.sup !== "ALL" && !sups.includes(DMU.sup)) DMU.sup = "ALL";
      const lastOf = r => { const c = cad[cadKey(r.Unit, r.Mapping_ID, r.Nama_Item)]; return c && c.Last_Order ? dstr(c.Last_Order) : ""; };
      const firstOf = r => { const c = cad[cadKey(r.Unit, r.Mapping_ID, r.Nama_Item)]; return c && c.First_Order ? dstr(c.First_Order) : ""; };
      const intOf = r => { const c = cad[cadKey(r.Unit, r.Mapping_ID, r.Nama_Item)]; return c ? Number(c.interval_median) : NaN; };
      const totAmt = base.reduce((s, r) => s + (r._amt || 0), 0), spikes = base.filter(r => r._spike), spAmt = spikes.reduce((s, r) => s + (r._amt || 0), 0);
      const supAmt = {}; base.forEach(r => { const s = String(r.Supplier || "").trim() || t("(no supplier)"); supAmt[s] = (supAmt[s] || 0) + (r._amt || 0); });
      const topSup = Object.entries(supAmt).sort((a, b) => b[1] - a[1])[0];
      const noAmt = base.filter(r => r._amt == null).length;
      const prevM = addMonths(months[0], -1), loaded = DmlDetail.loaded();

      host.innerHTML = `
        <section class="card" style="padding:14px 18px;gap:10px"><div class="filters" id="dmF1"></div><div class="filters" id="dmF2"></div>
          <div class="chips" style="align-items:center"><span class="muted" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${esc(t("Detail loaded"))}</span>
            ${loaded.length ? loaded.map(m => UI.tag(monthLabel(m) + (months.includes(m) ? "" : " · " + t("cached")), months.includes(m) ? "info" : "mute")).join(" ") : UI.tag(t("none"), "mute")}
            ${loading ? `<span class="muted" style="font-size:12px">${esc(t("Loading purchase lines…"))}</span>` : `<button type="button" class="chip" id="dmMore" style="border-style:dashed">+ ${esc(t("Load {m}", { m: monthLabel(prevM) }))}</button>`}
            <span class="muted" style="font-size:12px;margin-left:auto">${esc(t("Lines are cached until the source changes."))}</span></div></section>
        ${loadErr ? UI.banner(t("Purchase lines could not be loaded: {e}", { e: loadErr }), "crit") : ""}
        ${noAmt ? UI.banner(t("{n} purchase lines have no amount yet (price not filled in); they count as zero.", { n: fmtInt(noAmt) }), "warn") : ""}
        <section class="grid g4">
          ${UI.kpi({ label: t("Direct Purchases"), value: have ? fmtRp(totAmt) : DASH, showRing: false, note: have ? t("{n} lines · {i} items", { n: fmtInt(base.length), i: fmtInt(new Set(base.map(r => r.Nama_Item)).size) }) : t("Loading…") })}
          ${UI.kpi({ label: t("DML Cost Ratio"), value: T.pct == null ? DASH : fmtPct(T.pct, 1), showRing: false, note: T.pct == null ? "" : t("{x} vs {g} target · excl. CK", { x: fmtPts(T.pct - T.tgt), g: fmtPct(T.tgt, 0) }), noteKind: T.pct == null ? "" : T.pct > T.tgt ? "crit" : T.pct > T.tgt * 0.9 ? "warn" : "ok" })}
          ${UI.kpi({ label: t("Price Spikes"), value: have ? fmtInt(spikes.length) : DASH, showRing: false, note: have && spikes.length ? t("{a} of purchase value", { a: fmtRp(spAmt) }) : t("Lines flagged above recent price"), noteKind: spikes.length ? "warn" : "" })}
          ${UI.kpi({ label: t("Suppliers"), value: have ? fmtInt(Object.keys(supAmt).length) : DASH, showRing: false, note: topSup && totAmt > 0 ? t("Largest: {s} ({p})", { s: topSup[0], p: fmtPct(topSup[1] / totAmt, 0) }) : "" })}
        </section>
        <section class="card" id="dmRatio"><div class="card-h"><div><h2>${esc(t("DML per Unit & Cost Ratio"))}</h2><div class="sub">${esc(dateLabel(R.from) + " – " + dateLabel(R.to))} · ${esc(t("direct purchases only, before store requisitions · target {g}", { g: fmtPct(COST_TGT.DML.F, 0) }))}</div></div><div class="card-tools"></div></div><div class="card-b"></div>
          <div class="muted" style="font-size:12px">${esc(t("From the daily DML summary (DML_Cost_Daily), excluding LPG. Department and category filters apply to the sections below, not to this table."))}</div></section>
        <section class="card" id="dmTop"><div class="card-h"><div><h2>${esc(t("Top Purchases"))}</h2><div class="sub">${esc(t("Grouped by item; rows below each item are suppliers with their latest price"))}</div></div><div class="card-tools" id="dmTopT"></div></div><div class="card-b"></div></section>
        <section class="card" id="dmLines"><div class="card-h"><div><h2>${esc(t("Purchase Lines"))}</h2></div><div class="card-tools" id="dmLinesT"></div></div><div class="card-b"></div></section>`;

      // ---- filter ----
      const F1 = host.querySelector("#dmF1"), F2 = host.querySelector("#dmF2");
      const pf = UI.node(`<label class="field">${esc(t("Period"))}</label>`);
      pf.appendChild(UI.seg([["mtd", t("Month to date")], ["prev", t("Last month")], ["custom", t("Custom")]], DMU.preset, v => { DMU.preset = v; draw(); ensure(); }, t("Period"))); F1.appendChild(pf);
      const dIn = (lab, val, on) => { const el = UI.node(`<label class="field">${esc(lab)}<input type="date" value="${esc(val)}"></label>`);
        el.querySelector("input").addEventListener("change", e => { if (!e.target.value) return; DMU.preset = "custom"; on(e.target.value); draw(); ensure(); }); return el; };
      F1.appendChild(dIn(t("From"), R.from, v => (DMU.from = v))); F1.appendChild(dIn(t("To"), R.to, v => (DMU.to = v)));
      F2.appendChild(UI.clusterSelect(DMU.cluster, v => { DMU.cluster = v; DMU.unit = "ALL"; draw(); }));
      F2.appendChild(UI.select(t("Unit"), [["ALL", t("All units")]].concat(avail.map(k => [k, k])), DMU.unit, v => { DMU.unit = v; draw(); }));
      F2.appendChild(UI.select(t("Department"), [["ALL", t("All departments")]].concat(Object.entries(DL)), DMU.dept, v => { DMU.dept = v; draw(); }));
      F2.appendChild(UI.select(t("Category"), [["ALL", t("All categories")]].concat(cats.map(c => [c, c])), DMU.cat, v => { DMU.cat = v; draw(); }));
      const more = host.querySelector("#dmMore"); if (more) more.onclick = () => { DMU.preset = "custom"; DMU.from = prevM + "-01"; draw(); ensure(); };

      // ---- rasio per unit ----
      const P = (key, cat) => r => csPill(r[key], Cost.target("DML", cat, r.revFood, r.revBev));
      const rr = sumRows.map(r => ({ ...r, f: r.dmlK + r.dmlE, b: r.dmlB, pf: r.revFood > 0 ? (r.dmlK + r.dmlE) / r.revFood : null, pb: r.revBev > 0 ? r.dmlB / r.revBev : null, pt: r.revTot > 0 ? r.dml / r.revTot : null }));
      const rt = UI.table([
        { key: "unit", label: t("Unit"), render: r => `<b>${esc(r.unit)}</b>${r.ck ? " " + UI.tag(t("no revenue · excl."), "mute") : ""}<div class="muted" style="font-size:11px">${esc(r.name || "")}</div>` },
        { key: "f", label: t("Food cost"), type: "money" }, { key: "revFood", label: t("Food revenue"), type: "money" }, { key: "pf", label: t("Food %"), type: "pct", render: P("pf", "F") },
        { key: "b", label: t("Bev. cost"), type: "money" }, { key: "revBev", label: t("Bev. revenue"), type: "money" }, { key: "pb", label: t("Bev. %"), type: "pct", render: P("pb", "B") },
        { key: "dml", label: t("Total"), type: "money" }, { key: "revTot", label: t("F&B revenue"), type: "money" }, { key: "pt", label: t("F&B %"), type: "pct", render: P("pt", null) },
      ], { rows: rr, full: true, emptyText: t("No cost data for the selected filters."), onRow: r => { if (r.ck) return; DMU.unit = DMU.unit === r.unit ? "ALL" : r.unit; draw(); },
        total: () => ({ unit: t("Total (excl. CK)"), f: T.cF, revFood: T.rF, pf: T.pctF, b: T.cB, revBev: T.rB, pb: T.pctB, dml: T.tot, revTot: T.rev, pt: T.pct }) });
      host.querySelector("#dmRatio .card-b").appendChild(rt);
      const trT = rt.querySelector("tr.total"); if (trT) { const tds = trT.querySelectorAll("td"); tds[3].innerHTML = csPill(T.pctF, T.tgtF); tds[6].innerHTML = csPill(T.pctB, T.tgtB); tds[9].innerHTML = csPill(T.pct, T.tgt); }

      if (!have) { ["#dmTop", "#dmLines"].forEach(s => (host.querySelector(s + " .card-b").innerHTML = loadErr ? UI.empty(t("Purchase lines are not available.")) : UI.skeleton(220))); return; }

      // ---- top purchases (item -> supplier) ----
      const rF = T.rF, rB = T.rB;
      const items = {};
      base.filter(r => DMU.sup === "ALL" || String(r.Supplier || "").trim() === DMU.sup).forEach(r => {
        const n = r.Nama_Item || t("(no name)"), s = String(r.Supplier || "").trim() || t("(no supplier)"), a = r._amt || 0;
        const I = (items[n] = items[n] || { name: n, qty: 0, amt: 0, last: "", kat: {}, bk: {}, sup: {} });
        I.qty += r.Qty; I.amt += a; if (r._d > I.last) I.last = r._d; const kt = String(r.Kategori || ""); if (kt) I.kat[kt] = (I.kat[kt] || 0) + a; I.bk[r.Bucket] = (I.bk[r.Bucket] || 0) + a;
        const S = (I.sup[s] = I.sup[s] || { name: s, qty: 0, amt: 0, last: "", price: null }); S.qty += r.Qty; S.amt += a; if (r._d >= S.last) { S.last = r._d; S.price = r._p; }
      });
      const top = Object.values(items).sort((a, b) => b.amt - a.amt);
      const dom = o => (Object.entries(o).sort((a, b) => b[1] - a[1])[0] || [""])[0];
      const pctRev = I => { const bev = dom(I.bk) === "BAR", den = bev ? rB : rF; return { p: den > 0 ? I.amt / den : null, lab: bev ? t("of Bev.") : t("of Food") }; };
      const topT = host.querySelector("#dmTopT");
      topT.appendChild(UI.select(t("Supplier"), [["ALL", t("All suppliers")]].concat(sups.map(s => [s, s])), DMU.sup, v => { DMU.sup = v; draw(); }));
      topT.appendChild(UI.seg([[10, "Top 10"], [20, "Top 20"], [50, "Top 50"], [0, t("All")]], DMU.topN, v => { DMU.topN = +v; draw(); }, t("Rows shown")));
      const shown = DMU.topN ? top.slice(0, DMU.topN) : top;
      const cp = UI.node(`<button type="button" class="btn">${esc(t("Copy all"))}</button>`);
      cp.onclick = () => { const flat = []; shown.forEach((I, i) => { const pr = pctRev(I);
          flat.push({ rank: i + 1, item: I.name, sup: "", kat: dom(I.kat), price: "", last: I.last, qty: I.qty, amt: I.amt, pct: pr.p });
          Object.values(I.sup).sort((a, b) => b.amt - a.amt).forEach(S => flat.push({ rank: "", item: I.name, sup: S.name, kat: "", price: S.price, last: S.last, qty: S.qty, amt: S.amt, pct: "" })); });
        copyText(toTSV([{ key: "rank", label: "#" }, { key: "item", label: t("Item") }, { key: "sup", label: t("Supplier") }, { key: "kat", label: t("Category") }, { key: "price", label: t("Last price"), type: "money" },
          { key: "last", label: t("Last order") }, { key: "qty", label: t("Qty"), type: "num" }, { key: "amt", label: t("Amount"), type: "money" }, { key: "pct", label: t("% of F/B revenue"), type: "pct" }], flat))
          .then(() => UI.toast(t("Copied {n} rows — paste into Excel", { n: fmtInt(flat.length) }))); };
      topT.appendChild(cp);
      host.querySelector("#dmTop .card-b").innerHTML = shown.length ? `<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>#</th><th>${esc(t("Item / supplier"))}</th><th>${esc(t("Category"))}</th><th class="r">${esc(t("Last price"))}</th><th>${esc(t("Last order"))}</th><th class="r">${esc(t("Qty"))}</th><th class="r">${esc(t("Amount"))}</th><th class="r">${esc(t("% of F/B revenue"))}</th></tr></thead><tbody>` +
        shown.map((I, i) => { const ss = Object.values(I.sup).sort((a, b) => b.amt - a.amt), pr = pctRev(I), ps = ss.map(s => s.price).filter(p => p > 0), mn = ps.length ? Math.min(...ps) : null;
          return `<tr style="font-weight:600"><td>${i + 1}</td><td>${esc(I.name)}</td><td style="font-weight:400">${esc(dom(I.kat))}</td><td></td><td>${esc(dateLabel(I.last, true))}</td><td class="r"><span class="num">${esc(fmtNum(I.qty))}</span></td><td class="r"><span class="num" data-raw="${Math.round(I.amt)}">${esc(fmt(I.amt))}</span></td><td class="r"><span class="num">${esc(pr.p == null ? DASH : fmtPct(pr.p, 2))}</span> <span class="muted" style="font-size:11px;font-weight:400">${esc(pr.lab)}</span></td></tr>` +
            ss.map(S => { const tg = mn != null && ps.length > 1 && S.price > 0 ? (S.price === mn ? UI.tag(t("lowest"), "ok") : UI.tag("+" + fmtPct((S.price - mn) / mn, 0), "crit")) : "";
              return `<tr class="sub"><td></td><td style="padding-left:22px">${esc(S.name)}</td><td></td><td class="r"><span class="num">${esc(S.price ? fmtInt(S.price) : DASH)}</span> ${tg}</td><td>${esc(dateLabel(S.last, true))}</td><td class="r"><span class="num">${esc(fmtNum(S.qty))}</span></td><td class="r"><span class="num" data-raw="${Math.round(S.amt)}">${esc(fmt(S.amt))}</span></td><td></td></tr>`; }).join(""); }).join("") + `</tbody></table></div>
          <div class="tbl-foot"><span>${esc(t("Showing {a} of {b}", { a: fmtInt(shown.length), b: fmtInt(top.length) }))} · ${esc(t("Last price = price on the supplier’s latest order; % compares with the lowest current supplier."))}</span></div>`
        : UI.empty(t("No purchases for the selected filters."));

      // ---- purchase lines ----
      const LT = host.querySelector("#dmLinesT");
      const chip = (k, lab) => { const b = UI.node(`<button type="button" class="chip" aria-pressed="${DMU[k]}">${esc(lab)}</button>`); b.onclick = () => { DMU[k] = !DMU[k]; draw(); }; return b; };
      LT.appendChild(chip("spike", t("Price spike"))); LT.appendChild(chip("fresh", t("New item"))); LT.appendChild(chip("routine", t("Routine (ordered every ≤ {n} days)", { n: DMU.routineDays })));
      const lines = base.filter(r => (!DMU.spike || r._spike) && (!DMU.fresh || (firstOf(r) && firstOf(r) >= R.from)) && (!DMU.routine || (isFinite(intOf(r)) && intOf(r) <= DMU.routineDays)))
        .map(r => ({ d: r._d, unit: r.Unit, dept: DL[r.Bucket] || r.Bucket, item: r.Nama_Item || "", kat: r.Kategori || "", sup: r.Supplier || "", qty: r.Qty, price: r._p, amt: r._amt, last: lastOf(r), spike: r._spike, raw: String(r.Flag_Raw || "") }));
      host.querySelector("#dmLines .card-b").appendChild(UI.table([
        { key: "d", label: t("Date"), type: "date" }, { key: "unit", label: t("Unit") }, { key: "dept", label: t("Dept.") }, { key: "item", label: t("Item") }, { key: "kat", label: t("Category") }, { key: "sup", label: t("Supplier") },
        { key: "qty", label: t("Qty"), type: "num" }, { key: "price", label: t("Price"), type: "money", hidden: true }, { key: "amt", label: t("Amount"), type: "money" },
        { key: "last", label: t("Last order"), type: "date" },
        { key: "raw", label: t("Flag"), render: r => (r.spike ? UI.tag("SPIKE", "crit") + " " : "") + (r.raw ? `<span class="muted" style="font-size:11px">${esc(r.raw)}</span>` : "") },
      ], { rows: lines, sort: { key: "d", dir: "desc" }, search: true, maxRender: 300, total: true, emptyText: t("No purchase lines for the selected filters."),
        note: t("Search matches item, unit, department, category and supplier. Up to 300 lines are displayed; Copy includes all filtered lines.") }));
    };
    draw();
    ensure();
    const onTheme = () => draw();
    document.addEventListener("fmd:theme", onTheme);
    return () => document.removeEventListener("fmd:theme", onTheme);
  },
});
