/* Cost of Sales › Consumption vs Sales — dua panel (bahan terpakai vs menu terjual), rasio indikatif tanpa resep. */
"use strict";

const CVS = { month: "", cluster: "ALL", unit: "ALL",
  L: { g: "food", src: "both", n: 10, q: "", sel: new Set() }, R: { g: "food", cat: "ALL", n: 10, q: "", sel: new Set() } };
const isBevFb = fb => /BEV|WINE|SPIRIT|BEER/i.test(fb || "");

FMD.page("cost/cons-sales", {
  async render(host, ctx) {
    host.innerHTML = UI.skeleton(90) + `<div class="grid g2">${UI.skeleton(420).repeat(2)}</div>`;
    try { await Cost.load("cons"); } catch (e) { if (!ctx.isStale()) host.innerHTML = UI.card({ body: UI.banner(t("Cost data could not be loaded: {e}", { e: e.message }), "crit") }); return; }
    if (ctx.isStale()) return;
    let menuErr = "", dmlErr = "", busy = 0;
    const ensure = async () => {
      const m = CVS.month; busy++; draw();
      await Promise.all([
        Menu.load().catch(e => (menuErr = e.message)),
        (DmlDetail.byMonth && DmlDetail.byMonth[m] ? Promise.resolve() : DmlDetail.ensure([m])).catch(e => (dmlErr = e.message)),
      ]);
      busy--; if (!ctx.isStale()) draw();
    };

    const draw = () => {
      Cost.prep();
      const months = costMonths(); if (!months.includes(CVS.month)) CVS.month = months[0];
      const R = monthRange(CVS.month);
      const sc = costUnitScope({ cluster: CVS.cluster, units: CVS.unit === "ALL" ? [] : [CVS.unit] });
      const avail = sc.avail.filter(k => !COST_CENTER_ONLY.has(k)); if (CVS.unit !== "ALL" && !avail.includes(CVS.unit)) CVS.unit = "ALL";
      const keys = CVS.unit === "ALL" ? avail : [CVS.unit], K = new Set(keys);
      const o = { from: R.from, to: R.to, gas: false, fgManual: true, keys: K };
      let rF = 0, rB = 0; keys.forEach(k => { const v = Cost.rev(k, R.from, R.to); rF += v.revFood; rB += v.revBev; });

      // ---- kiri: konsumsi ----
      const L = {};
      const addL = (name, cat, bev, src, qty, amt) => { const k = name.toUpperCase().trim(); if (!k) return; const x = (L[k] = L[k] || { name: k, cat, bev, src: new Set(), qty: 0, amt: 0, srcAmt: {} });
        x.src.add(src); x.qty += qty; x.amt += amt; x.srcAmt[src] = (x.srcAmt[src] || 0) + amt; };
      Cost.consDetail(o, "FB").forEach(r => addL(String(r.Description || ""), t("Store req."), String(r.Kategori).toUpperCase() === "BEVERAGE", "SR", Number(r.Qty) || 0, Number(r.Amount) || 0));
      const dmlOk = DmlDetail.byMonth && DmlDetail.byMonth[CVS.month];
      if (dmlOk) DmlDetail.rows([CVS.month]).forEach(r => { if (!(r._d >= R.from && r._d <= R.to) || !K.has(r._k)) return; addL(String(r.Nama_Item || ""), String(r.Kategori || ""), r.Bucket === "BAR", "DML", r.Qty, r._amt || 0); });
      const leftAll = Object.values(L).map(x => ({ ...x, amt: CVS.L.src === "both" ? x.amt : (x.srcAmt[CVS.L.src === "dml" ? "DML" : "SR"] || 0) })).filter(x => x.amt !== 0);

      // ---- kanan: penjualan menu ----
      const ok = Menu.loaded, mKey = u => Cost.key((Dim.x.outlets[u] && Dim.x.outlets[u].unit) || u);
      const Rm = {};
      if (ok) Menu.items.forEach(r => { if (r.m !== CVS.month || !K.has(mKey(r.u))) return; const k = r.u + "|" + itemKey(r);
        const x = (Rm[k] = Rm[k] || { name: itemName(r), cat: cgLabel(r.cg), unit: r.u, bev: isBevFb(r.fb), ev: isEventItem(r), qty: 0, amt: 0 }); x.qty += r.sold; x.amt += r.rev; });
      const rightAll = Object.values(Rm).filter(x => x.amt !== 0);

      host.innerHTML = `
        <section class="card" style="padding:14px 18px;gap:10px"><div class="filters" id="cvF"></div><span class="muted" style="font-size:12px">${esc(t("Both panels follow the month and unit above; each panel has its own filters."))}</span></section>
        <div id="cvMsg"></div>
        <section class="grid g2"><div class="card cs-panel" id="cvL"></div><div class="card cs-panel" id="cvR"></div></section>
        <section class="banner info" style="align-items:center;gap:18px;flex-wrap:wrap" id="cvRatio"></section>`;
      const F = host.querySelector("#cvF");
      F.appendChild(UI.select(t("Month"), months.map(m => [m, monthLabel(m) + (m === (STATE.lastActualDate || "").slice(0, 7) ? " " + t("(MTD)") : "")]), CVS.month, v => { CVS.month = v; CVS.L.sel.clear(); CVS.R.sel.clear(); draw(); ensure(); }));
      F.appendChild(UI.clusterSelect(CVS.cluster, v => { CVS.cluster = v; CVS.unit = "ALL"; draw(); }));
      F.appendChild(UI.select(t("Unit"), [["ALL", t("All units in cluster")]].concat(avail.map(k => [k, k + " — " + Cost.name(k)])), CVS.unit, v => { CVS.unit = v; CVS.L.sel.clear(); CVS.R.sel.clear(); draw(); }));
      const msg = [];
      if (busy) msg.push(UI.banner(t("Loading menu sales and purchase lines…"), "info"));
      if (menuErr) msg.push(UI.banner(t("Menu data could not be loaded: {e}", { e: menuErr }), "crit"));
      if (dmlErr) msg.push(UI.banner(t("Purchase lines could not be loaded: {e}", { e: dmlErr }), "crit"));
      host.querySelector("#cvMsg").innerHTML = msg.join("");

      const sums = {};
      const panel = (side, el, data, isL) => {
        const P = CVS[side], pass = x => (P.g === "all" || (P.g === "bev") === x.bev) && (isL || P.cat === "ALL" || x.cat === P.cat);
        const filt = data.filter(pass), q = P.q.toLowerCase();
        const shown = filt.filter(x => !q || x.name.toLowerCase().includes(q)).sort((a, b) => b.amt - a.amt), top = P.n ? shown.slice(0, P.n) : shown;
        const sel = filt.filter(x => P.sel.has(x.name + "|" + (x.unit || ""))), sA = sel.reduce((s, x) => s + x.amt, 0), sF = sel.filter(x => !x.bev).reduce((s, x) => s + x.amt, 0), sB = sA - sF;
        sums[side] = sA;
        const share = x => { const d = x.bev ? rB : rF; return d > 0 ? fmtPct(x.amt / d, 1) : DASH; };
        const basis = P.g === "food" ? t("÷ Food revenue ({v})", { v: fmtRp(rF) }) : P.g === "bev" ? t("÷ Beverage revenue ({v})", { v: fmtRp(rB) })
          : t("÷ F&B revenue · Food {a} · Bev. {b}", { a: rF > 0 ? fmtPct(sF / rF, 1) : DASH, b: rB > 0 ? fmtPct(sB / rB, 1) : DASH });
        const selPct = P.g === "food" ? (rF > 0 ? sF / rF : null) : P.g === "bev" ? (rB > 0 ? sB / rB : null) : (rF + rB > 0 ? sA / (rF + rB) : null);
        const cats = [...new Set(data.filter(x => P.g === "all" || (P.g === "bev") === x.bev).map(x => x.cat))].sort();
        el.innerHTML = `<div class="card-h"><div><h2>${esc(isL ? t("Top Consumption") : t("Top Selling"))}</h2><div class="sub">${esc(isL ? t("Ingredients used: direct purchases and store requisitions") : t("Menu items sold (Sales Item)"))}</div></div><div class="card-tools" data-t></div></div>
          <div class="filters" data-f></div>
          <div class="filters"><label class="field" style="flex:1">${esc(t("Search"))}<input type="search" value="${esc(P.q)}" placeholder="${esc(isL ? t("Search ingredient") : t("Search menu item"))}"></label>
            <button type="button" class="btn" data-all style="align-self:flex-end">${esc(t("Select shown"))}</button><button type="button" class="btn" data-clr style="align-self:flex-end">${esc(t("Clear"))}</button></div>
          <div class="cs-row cs-head"><span></span><span>${esc(isL ? t("Ingredient") : t("Menu item"))}</span><span style="text-align:right">${esc(isL ? t("Qty") : t("Sold"))}</span><span style="text-align:right">${esc(isL ? t("Amount") : t("Revenue"))}</span><span style="text-align:right">${esc(t("% of rev."))}</span></div>
          <div class="cs-list">${top.length ? top.map((x, i) => { const id = x.name + "|" + (x.unit || ""), on = P.sel.has(id);
            return `<label class="cs-row${on ? " on" : ""}" data-i="${i}"><input type="checkbox" ${on ? "checked" : ""}><span><span style="font-weight:500">${esc(x.name)}</span><span class="muted" style="display:block;font-size:11px">${esc(x.cat)}${isL ? " · " + [...x.src].join(" + ") : (CVS.unit === "ALL" || keys.length > 1 ? " · " + x.unit : "")}${!isL && x.ev ? " · " + t("event") : ""}</span></span>
              <span class="num" style="text-align:right">${esc(fmtNum(x.qty))}</span><span class="num" style="text-align:right;font-weight:600">${esc(fmt(x.amt))}</span><span class="num muted" style="text-align:right">${esc(share(x))}</span></label>`; }).join("")
            : UI.empty(busy ? t("Loading…") : t("No data for the selected filters."))}</div>
          <div class="cs-sum"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span>${esc(t("Selected {n} items", { n: sel.length }))}</span><span class="num" style="font-size:18px;font-weight:700">${esc(fmtRp(sA))}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:12px"><span>${esc((isL ? t("Selected cost") : t("Selected sales")) + " " + basis)}</span><span class="num" style="color:var(--accent);font-weight:600">${esc(selPct == null ? DASH : fmtPct(selPct, 1))}</span></div></div>`;
        const tl = el.querySelector("[data-t]"), ff = el.querySelector("[data-f]");
        const cp = UI.node(`<button type="button" class="btn">${esc(t("Copy all"))}</button>`);
        cp.onclick = () => copyText(toTSV([{ key: "name", label: isL ? t("Ingredient") : t("Menu item") }, { key: "cat", label: t("Category") }, { key: "unit", label: t("Unit") }, { key: "qty", label: isL ? t("Qty") : t("Sold"), type: "num" }, { key: "amt", label: isL ? t("Amount") : t("Revenue"), type: "money" }, { key: "sel", label: t("Selected") }],
          shown.map(x => ({ ...x, unit: x.unit || "", sel: P.sel.has(x.name + "|" + (x.unit || "")) ? "Y" : "" })))).then(() => UI.toast(t("Copied {n} rows — paste into Excel", { n: fmtInt(shown.length) })));
        tl.appendChild(cp);
        ff.appendChild(UI.seg([["food", t("Food")], ["bev", t("Beverage")], ["all", t("All")]], P.g, v => { P.g = v; P.cat = "ALL"; draw(); }, t("Group")));
        if (isL) ff.appendChild(UI.seg([["both", t("DML + SR")], ["dml", "DML"], ["sr", "SR"]], P.src, v => { P.src = v; draw(); }, t("Source")));
        else ff.appendChild(UI.select(t("Category"), [["ALL", t("All categories")]].concat(cats.map(c => [c, c])), P.cat, v => { P.cat = v; draw(); }));
        ff.appendChild(UI.seg([[10, "Top 10"], [20, "20"], [50, "50"], [0, t("All")]], P.n, v => { P.n = +v; draw(); }, t("Rows shown")));
        let qT; el.querySelector("input[type=search]").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { P.q = e.target.value.trim(); draw();
          const i = host.querySelector(`#cv${side} input[type=search]`); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); });
        el.querySelector("[data-all]").onclick = () => { top.forEach(x => P.sel.add(x.name + "|" + (x.unit || ""))); draw(); };
        el.querySelector("[data-clr]").onclick = () => { P.sel.clear(); draw(); };
        el.querySelectorAll(".cs-row[data-i] input").forEach(cb => cb.onchange = e => { const x = top[+e.target.closest(".cs-row").dataset.i], id = x.name + "|" + (x.unit || ""); e.target.checked ? P.sel.add(id) : P.sel.delete(id); draw(); });
      };
      panel("L", host.querySelector("#cvL"), leftAll, true);
      panel("R", host.querySelector("#cvR"), rightAll, false);
      host.querySelector("#cvRatio").innerHTML = `<div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:12px">${esc(t("Selected consumption ÷ selected sales"))}</span><span class="num" style="font-size:24px;font-weight:700">${esc(sums.R > 0 ? fmtPct(sums.L / sums.R, 1) : DASH)}</span></div>
        <div style="flex:1;min-width:260px;font-size:13px;line-height:1.55">${esc(t("Indicative only. Ingredients and menu items are not linked by recipe, so the ratio is meaningful only when the selected ingredients are used mainly by the selected menu items (for example, beef cuts against beef dishes)."))}</div>`;
    };
    if (!CVS.month) CVS.month = (STATE.lastActualDate || dstr(new Date())).slice(0, 7);
    draw();
    ensure();
  },
});
