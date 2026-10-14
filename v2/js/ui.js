/* FMD v2 — komponen UI bersama. String HTML untuk yang statis, Element untuk yang interaktif. */
"use strict";

const UI = (() => {
  const node = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  let toastT = null;
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800);
  }

  /* KPI card dengan ring. ratio 0..n (dibatasi 100% untuk ring). variant: orange | indigo | plain | pink */
  function kpi({ label, value, note = "", ratio = null, ringText, variant = "plain", title = "" }) {
    const C = 2 * Math.PI * 26;
    const r = isNum(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    const ring = { orange: ["rgba(255,255,255,.35)", "#FFFFFF"], indigo: ["rgba(255,255,255,.25)", "#FFFFFF"],
      pink: ["var(--pink-soft)", "var(--pink)"], plain: ["var(--track)", "var(--accent)"] }[variant] || ["var(--track)", "var(--accent)"];
    const cls = variant === "orange" || variant === "indigo" ? variant : "";
    const txt = ringText ?? (isNum(ratio) ? Math.round(ratio * 100) + "%" : DASH);
    return `<div class="kpi ${cls}" ${title ? `title="${esc(title)}"` : ""}>
      <div class="kpi-txt"><div class="kpi-l">${esc(label)}</div><div class="kpi-v num">${esc(value)}</div><div class="kpi-n">${esc(note)}</div></div>
      <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="26" fill="none" stroke="${ring[0]}" stroke-width="6"/>
        <circle cx="32" cy="32" r="26" fill="none" stroke="${ring[1]}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * r).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>
        <text x="32" y="36" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">${esc(txt)}</text>
      </svg></div>`;
  }

  function card({ title = "", sub = "", body = "", cls = "", id = "" }) {
    return `<section class="card ${cls}" ${id ? `id="${id}"` : ""}>
      ${title ? `<div class="card-h"><div><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div><div class="card-tools"></div></div>` : ""}
      <div class="card-b">${body}</div></section>`;
  }
  const tag = (text, kind = "mute") => `<span class="tag ${kind}">${esc(text)}</span>`;
  const empty = text => `<div class="empty">${esc(text)}</div>`;
  const banner = (text, kind = "info") => `<div class="banner ${kind}" role="note">${esc(text)}</div>`;
  const skeleton = (h = 120) => `<div class="skel" style="min-height:${h}px" aria-hidden="true"></div>`;

  /* Segmented control. opts: [[value,label]] */
  function seg(opts, value, onChange, aria = "") {
    const el = node(`<div class="seg" role="group" aria-label="${esc(aria)}">${opts.map(([v, l]) =>
      `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(l)}</button>`).join("")}</div>`);
    el.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
      onChange(b.dataset.v);
    });
    return el;
  }

  /* Dropdown berlabel. opts: [[value,label]] */
  function select(label, opts, value, onChange) {
    const el = node(`<label class="field">${esc(label)}<select>${opts.map(([v, l]) =>
      `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`);
    el.querySelector("select").addEventListener("change", e => onChange(e.target.value));
    return el;
  }

  /** Filter cluster dari DIM_UNIT.Grup */
  function clusterSelect(value, onChange) {
    return select("Cluster", [["ALL", "All clusters"]].concat(Dim.x.clusters.map(c => [c, c])), value || "ALL", onChange);
  }

  /** Multi-select unit (chip). selected kosong = semua. */
  function unitPicker(units, selected, onChange, labelFn = u => u) {
    let sel = new Set(selected && selected.length ? selected : units);
    const el = node(`<div class="chips" role="group" aria-label="Units"></div>`);
    const draw = () => {
      const all = sel.size === units.length;
      el.innerHTML = `<button type="button" class="chip" data-a="all" aria-pressed="${all}">All</button>` +
        units.map(u => `<button type="button" class="chip" data-u="${esc(u)}" aria-pressed="${!all && sel.has(u)}" title="${esc(Dim.unitName(u) || u)}">${esc(labelFn(u))}</button>`).join("");
    };
    el.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.a === "all") sel = new Set(units);
      else {
        const u = b.dataset.u;
        if (sel.size === units.length) sel = new Set([u]);           // dari "All": klik = pilih satu
        else if (sel.has(u)) { sel.delete(u); if (!sel.size) sel = new Set(units); }
        else sel.add(u);
      }
      draw(); onChange([...sel]);
    });
    draw();
    el.value = () => [...sel];
    return el;
  }

  /* ---------- Tabel: sort, Top N, total, Copy ke Excel ----------
     cols: [{key,label,type:'money'|'pct'|'int'|'num'|'text'|'date', get?, render?, align?, sortable?}]
     opts: {rows, topN:10|20|50|0(=All)|null(tanpa kontrol), sort:{key,dir}, total:true|row|fn(rows), name, emptyText, maxRender} */
  function table(cols, opts = {}) {
    const st = { rows: opts.rows || [], topN: opts.topN === undefined ? null : opts.topN,
      sort: opts.sort || null, maxRender: opts.maxRender || 1000 };
    const el = node(`<div class="tbl-box"><div class="tbl-foot" data-top></div><div class="tbl-wrap"><table class="tbl"><thead></thead><tbody></tbody></table></div><div class="tbl-foot" data-bot></div></div>`);
    const val = (c, r) => c.get ? c.get(r) : r[c.key];
    const isNumT = t => t === "money" || t === "pct" || t === "int" || t === "num";
    const cell = (c, r) => {
      if (c.render) return c.render(r);
      const v = val(c, r);
      switch (c.type) {
        case "money": return isNum(v) ? `<span class="num" data-raw="${Math.round(v)}" title="${fmtInt(v)}">${fmt(v)}</span>` : DASH;
        case "pct": return `<span class="num">${fmtPct(v)}</span>`;
        case "int": return `<span class="num">${fmtInt(v)}</span>`;
        case "num": return `<span class="num">${isNum(v) ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : DASH}</span>`;
        case "date": return esc(dateLabel(dstr(v)));
        default: return esc(v ?? "");
      }
    };
    const sorted = () => {
      if (!st.sort) return st.rows;
      const c = cols.find(x => x.key === st.sort.key); if (!c) return st.rows;
      const d = st.sort.dir === "asc" ? 1 : -1, n = isNumT(c.type);
      return st.rows.slice().sort((a, b) => {
        let x = val(c, a), y = val(c, b);
        if (n) { x = isNum(x) ? +x : -Infinity; y = isNum(y) ? +y : -Infinity; return (x - y) * d; }
        return String(x ?? "").localeCompare(String(y ?? ""), "en", { numeric: true }) * d;
      });
    };
    const shownRows = all => st.topN ? all.slice(0, st.topN) : all;
    const totalRow = () => {
      const t = opts.total; if (!t) return null;
      if (typeof t === "function") return t(st.rows);
      if (t === true) { const o = {}; cols.forEach((c, i) => {
        if (i === 0) o[c.key] = "Total";
        else if (c.type === "money" || c.type === "int") o[c.key] = st.rows.reduce((s, r) => s + (Number(val(c, r)) || 0), 0); });
        o.__total = true; return o; }
      return t;
    };
    function draw() {
      const all = sorted(), shown = shownRows(all), render = shown.slice(0, st.maxRender), tot = totalRow();
      el.querySelector("thead").innerHTML = "<tr>" + cols.map(c => {
        const s = c.sortable !== false, on = st.sort && st.sort.key === c.key;
        return `<th class="${isNumT(c.type) || c.align === "r" ? "r" : ""} ${s ? "sortable" : ""}" data-k="${esc(c.key)}" ${on ? `aria-sort="${st.sort.dir === "asc" ? "ascending" : "descending"}"` : ""}>${esc(c.label)}${on ? `<span class="arr">${st.sort.dir === "asc" ? "▲" : "▼"}</span>` : ""}</th>`;
      }).join("") + "</tr>";
      const tr = (r, cls = "") => `<tr class="${cls}">` + cols.map(c => `<td class="${isNumT(c.type) || c.align === "r" ? "r" : ""}">${(cls && c.key === cols[0].key) ? esc(r[c.key]) : (cls && r[c.key] === undefined ? "" : cell(c, r))}</td>`).join("") + "</tr>";
      el.querySelector("tbody").innerHTML = render.length
        ? render.map(r => tr(r)).join("") + (tot ? tr(tot, "total") : "")
        : `<tr><td colspan="${cols.length}">${empty(opts.emptyText || "No data for the selected filters.")}</td></tr>`;
      const capped = shown.length > render.length;
      const top = el.querySelector("[data-top]");
      top.innerHTML = `<span>${all.length ? `Showing ${fmtInt(render.length)} of ${fmtInt(all.length)}${capped ? " (use Copy for the full list)" : ""}` : ""}</span><span class="card-tools"></span>`;
      const tools = top.querySelector(".card-tools");
      if (st.topN !== null) tools.appendChild(seg([[10, "Top 10"], [20, "Top 20"], [50, "Top 50"], [0, "All"]], st.topN, v => { st.topN = +v; draw(); }, "Rows shown"));
      if (opts.copy !== false) {
        const b = node(`<button type="button" class="btn" title="Copy as tab-separated text, ready to paste into Excel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy ${shown.length === all.length ? "all" : fmtInt(shown.length)}</button>`);
        b.onclick = () => {
          const rows = shown.concat(tot ? [tot] : []);
          copyText(toTSV(cols.filter(c => c.copy !== false), rows)).then(() => toast(`Copied ${fmtInt(shown.length)} rows — paste into Excel`));
        };
        tools.appendChild(b);
      }
      el.querySelector("[data-bot]").innerHTML = opts.note ? `<span>${esc(opts.note)}</span>` : "";
    }
    el.querySelector("thead").addEventListener("click", e => {
      const th = e.target.closest("th.sortable"); if (!th) return;
      const k = th.dataset.k, c = cols.find(x => x.key === k);
      st.sort = st.sort && st.sort.key === k ? { key: k, dir: st.sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: isNumT(c.type) ? "desc" : "asc" };
      draw();
    });
    el.update = rows => { st.rows = rows || []; draw(); };
    draw();
    return el;
  }

  /* Warna badge unit konsisten per kode (hash) */
  const BADGE = ["#2B2F9E", "#B85F12", "#C2306B", "#1F6B47", "#5B3FB0", "#0E6A85"];
  function unitBadge(code) { let h = 0; for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `<span class="ubadge" style="background:${BADGE[h % BADGE.length]}">${esc(code)}</span>`; }

  /* klik angka uang -> salin integer bersih (perilaku FMD lama) */
  document.addEventListener("click", e => {
    const n = e.target.closest(".num[data-raw]"); if (!n) return;
    copyText(n.dataset.raw).then(() => toast("Copied: " + Number(n.dataset.raw).toLocaleString("en-US")));
  });

  return { node, toast, kpi, card, tag, empty, banner, skeleton, seg, select, clusterSelect, unitPicker, table, unitBadge };
})();
