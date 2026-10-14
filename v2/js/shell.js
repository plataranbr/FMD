/* FMD v2 — shell: login, sesi, tema, sidebar, router. Halaman mendaftar lewat FMD.page(id, {render}). */
"use strict";

const $ = id => document.getElementById(id);

/* ---------- Registry halaman (urutan = sidebar) ----------
   need = tab utama; item sidebar disembunyikan bila user tak punya akses. */
const PAGES = [
  ["overview/summary", "Overview", "Executive Summary", ["Revenue_Master"]],
  ["revenue/daily", "Revenue", "Daily & Projection", ["Revenue_Master"]],
  ["revenue/outlet", "Revenue", "By Outlet", ["Revenue_Master"]],
  ["revenue/events", "Revenue", "Events", ["Event_Pipeline"]],
  ["revenue/menu", "Revenue", "Menu Sales", ["Menu_Sales_Monthly"]],
  ["cost/summary", "Cost of Sales", "Summary", ["DML_Cost_Daily"]],
  ["cost/dml", "Cost of Sales", "Direct Purchases (DML)", ["DML_Master"]],
  ["cost/sr-ck", "Cost of Sales", "Store Requisitions & CK", ["Consumption_Master"]],
  ["cost/cross-unit", "Cost of Sales", "Cross-Unit Comparison", ["Consumption_Master"]],
  ["cost/cons-sales", "Cost of Sales", "Consumption vs Sales", ["Consumption_Master"]],
  ["cost/purchasing", "Cost of Sales", "Purchasing", ["DML_Master"]],
  ["opex/supplies", "Operating Expenses", "Supplies by Unit", ["Consumption_Master"]],
  ["opex/trend", "Operating Expenses", "Trend", ["Consumption_Master"]],
  ["data/status", "Data", "Status & Period Close", ["DIM_UNIT"]],
].map(([id, group, label, need]) => ({ id, group, label, need, render: null }));
const DEFAULT_PAGE = "overview/summary";

const FMD = {
  page(id, def) { const p = PAGES.find(x => x.id === id); if (!p) throw new Error("Unknown page " + id); Object.assign(p, def); },
  current: null,
  _cleanup: null,
  _seq: 0,
};

/* ---------- Tema ---------- */
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = isDark();
  const b = $("themeBtn");
  if (b) b.innerHTML = (dark
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>Light'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>Dark');
  document.dispatchEvent(new CustomEvent("fmd:theme", { detail: { dark } }));
}
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
}
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(); // utk Chart.js

/* ---------- Sesi (sessionStorage: hilang saat tab ditutup) ---------- */
function saveSession(r) {
  const s = { token: r.token, name: r.nama, role: r.role, email: r.email || "", allowed: r.allowed,
    exp: Date.now() + (r.ttl || 21600) * 1000 - 5 * 60 * 1000 };
  Store.set("sessionStorage", CFG.SESSION_KEY, JSON.stringify(s)); setState(s);
}
function loadSession() {
  try { const s = JSON.parse(Store.get("sessionStorage", CFG.SESSION_KEY) || "null");
    if (s && s.token && s.exp > Date.now()) { setState(s); return true; } } catch (e) {}
  Store.del("sessionStorage", CFG.SESSION_KEY); return false;
}
function setState(s) { Object.assign(STATE, { token: s.token, name: s.name, role: s.role, email: s.email, allowed: s.allowed }); }
function clearSession() {
  Store.del("sessionStorage", CFG.SESSION_KEY);
  Object.assign(STATE, { token: null, name: "", role: "", email: "", allowed: null, data: {}, ver: {}, lastActualDate: "" });
  memoClear(); Dim.reset();
}

/* ---------- Login: Google ID token + PIN (alur sama dengan FMD live) ---------- */
let GID = null;
function b64urlJson(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  return JSON.parse(decodeURIComponent(escape(atob(s)))); }
function initGoogle(tries = 0) {
  if (!(window.google && google.accounts && google.accounts.id)) {
    if (tries > 75) { $("loginErr").textContent = "Google sign-in could not load. Check your connection or ad blocker, then reload."; return; }
    return void setTimeout(() => initGoogle(tries + 1), 200);
  }
  google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onGoogle, auto_select: false, ux_mode: "popup" });
  google.accounts.id.renderButton($("gsiBtn"), { theme: isDark() ? "filled_black" : "outline", size: "large", text: "signin_with", shape: "pill", width: 280 });
}
function onGoogle(resp) {
  try { const p = b64urlJson(resp.credential.split(".")[1]); GID = { token: resp.credential, email: p.email || "" }; }
  catch (e) { $("loginErr").textContent = "Google sign-in failed. Please try again."; return; }
  $("loginErr").textContent = ""; $("gEmail").textContent = GID.email;
  $("gsiBox").classList.add("hidden"); $("pinBox").classList.remove("hidden"); $("pin").focus();
}
function resetGoogle() {
  GID = null; $("pin").value = "";
  $("pinBox").classList.add("hidden"); $("gsiBox").classList.remove("hidden");
  try { google.accounts.id.disableAutoSelect(); } catch (e) {}
}
async function doLogin() {
  const pin = $("pin").value.trim(), btn = $("loginBtn");
  $("loginErr").textContent = "";
  if (!GID) return void ($("loginErr").textContent = "Please sign in with Google first.");
  if (!pin) return void ($("loginErr").textContent = "Please enter your PIN.");
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    const r = await api({ action: "login", pin, idToken: GID.token });
    if (!r.ok) {
      $("loginErr").textContent = r.error || "Sign-in failed.";
      if (/expired|invalid|Google/i.test(r.error || "") && !/registered/i.test(r.error || "")) resetGoogle();
      return;
    }
    saveSession(r); $("pin").value = ""; GID = null;
    await startApp();
  } catch (e) { $("loginErr").textContent = "Connection failed: " + e.message; }
  finally { btn.disabled = false; btn.textContent = "Sign in"; }
}
function showLogin(msg) {
  $("app").classList.add("hidden"); $("login").classList.remove("hidden");
  resetGoogle(); $("loginErr").textContent = msg || "";
}
async function signOut() {
  const t = STATE.token; clearSession();
  if (t) api({ action: "logout", token: t }).catch(() => {});
  showLogin("");
}
document.addEventListener("fmd:session-expired", () => {
  if (!STATE.token) return;
  clearSession(); showLogin("Your session has expired. Please sign in again.");
});

/* ---------- Sidebar ---------- */
function visiblePages() { return PAGES.filter(p => p.need.every(allowedTab)); }
function renderNav() {
  const groups = [];
  visiblePages().forEach(p => { let g = groups.find(x => x.name === p.group); if (!g) groups.push(g = { name: p.group, items: [] }); g.items.push(p); });
  $("nav").innerHTML = groups.map(g => `<div class="nav-group"><h4>${esc(g.name)}</h4>${g.items.map(p =>
    `<a class="nav-item" href="#/${p.id}" data-id="${p.id}">${esc(p.label)}${p.render ? "" : '<span class="soon">soon</span>'}</a>`).join("")}</div>`).join("");
  $("userName").textContent = STATE.name || "—";
  $("userSub").textContent = STATE.email || STATE.role || "";
  $("avatar").textContent = (STATE.name || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
function markNav(id) { document.querySelectorAll(".nav-item").forEach(a => a.dataset.id === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")); }

/* ---------- Router (hash: #/group/page) ---------- */
function routeId() { const h = location.hash.replace(/^#\/?/, "").split("?")[0]; return h || DEFAULT_PAGE; }
async function route() {
  if (!STATE.token) return;
  const id = routeId(), seq = ++FMD._seq;
  let p = PAGES.find(x => x.id === id);
  if (!p) { location.replace("#/" + DEFAULT_PAGE); return; }
  document.body.classList.remove("nav-open");
  if (FMD._cleanup) { try { FMD._cleanup(); } catch (e) {} FMD._cleanup = null; }
  FMD.current = p; markNav(p.id);
  $("crumb").textContent = p.group; $("pageTitle").textContent = p.label;
  document.title = p.label + " · FMD";
  const host = $("view"); host.innerHTML = ""; window.scrollTo(0, 0);
  if (!p.need.every(allowedTab)) { host.innerHTML = UI.card({ body: UI.empty("Your account does not have access to this page. Contact Finance if you need it.") }); return; }
  if (!p.render) { host.innerHTML = placeholder(p); return; }
  try {
    const cleanup = await p.render(host, { isStale: () => seq !== FMD._seq });
    if (seq === FMD._seq && typeof cleanup === "function") FMD._cleanup = cleanup;
  } catch (e) {
    console.error(e);
    if (seq === FMD._seq) host.innerHTML = UI.card({ body: UI.banner("This page failed to load: " + e.message, "crit") });
  }
}
function placeholder(p) {
  return UI.card({ title: p.label, sub: p.group,
    body: `<div class="empty" style="display:flex;flex-direction:column;gap:12px;align-items:center">
      <span>This page is being rebuilt in the new layout. Until it is ready, please use the classic dashboard.</span>
      <a class="btn" href="${CFG.CLASSIC_URL}">Open classic dashboard</a></div>` });
}

/* ---------- Topbar: freshness & refresh ---------- */
function renderFresh() {
  const d = STATE.lastActualDate;
  $("fresh").innerHTML = d ? `<span class="dot" aria-hidden="true"></span>Revenue through <b>${esc(dateLabel(d))}</b>` : "";
  $("fresh").classList.toggle("hidden", !d);
}
async function refreshAll() {
  const b = $("refreshBtn"); b.disabled = true;
  try { await Data.load(Data.loaded(), true); UI.toast("Data is up to date"); route(); }
  catch (e) { UI.toast("Refresh failed: " + e.message); }
  finally { b.disabled = false; }
}
document.addEventListener("fmd:data", renderFresh);

/* ---------- Start ---------- */
async function startApp() {
  $("login").classList.add("hidden"); $("app").classList.remove("hidden");
  renderNav();
  try {
    const { missing } = await Data.load(["DIM_UNIT", "DIM_TANGGAL"]);
    if (missing.length) console.warn("Missing tabs", missing);
  } catch (e) {
    if (!STATE.token) return; // sesi kedaluwarsa -> sudah di layar login
    $("view").innerHTML = UI.card({ body: UI.banner("Could not load reference data: " + e.message, "crit") });
    return;
  }
  renderFresh();
  route();
}

function wire() {
  $("loginBtn").onclick = doLogin;
  $("pin").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  $("gSwitch").onclick = e => { e.preventDefault(); resetGoogle(); };
  $("signOut").onclick = signOut;
  $("themeBtn").onclick = () => { const t = isDark() ? "light" : "dark"; Store.set("localStorage", CFG.THEME_KEY, t); applyTheme(t); };
  $("refreshBtn").onclick = refreshAll;
  $("menuBtn").onclick = () => document.body.classList.toggle("nav-open");
  $("scrim").onclick = () => document.body.classList.remove("nav-open");
  window.addEventListener("hashchange", route);
  applyTheme(Store.get("localStorage", CFG.THEME_KEY));
  initGoogle();
  if (loadSession()) startApp(); else showLogin("");
}
document.addEventListener("DOMContentLoaded", wire);
