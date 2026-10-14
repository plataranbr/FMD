/* FMD v2 — dua bahasa. Kunci = teks English (dengan {var}); terjemahan ID di i18n-id.js (I18N_ID).
   Teks yang belum diterjemahkan tampil dalam English dan dicatat di I18N_MISS (untuk uji). */
"use strict";

const LANG_KEY = "fmd.v2.lang";
let LANG = (() => { try { return localStorage.getItem(LANG_KEY) === "id" ? "id" : "en"; } catch (e) { return "en"; } })();
const I18N_MISS = new Set();

function t(s, vars) {
  let x = s;
  if (LANG === "id") {
    const tr = (typeof I18N_ID === "object" && I18N_ID[s]);
    if (tr) x = tr; else I18N_MISS.add(s);
  }
  return vars ? x.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : x;
}
/** Pilih bentuk tunggal/jamak English; ID tidak mengenal jamak (kunci tunggal & jamak boleh sama terjemahannya). */
const tn = (n, one, many, vars) => t(n === 1 ? one : many, { n, ...vars });
function setLang(l) {
  LANG = l === "id" ? "id" : "en";
  try { localStorage.setItem(LANG_KEY, LANG); } catch (e) {}
  document.documentElement.lang = LANG;
  applyStaticI18n();
  document.dispatchEvent(new CustomEvent("fmd:lang", { detail: { lang: LANG } }));
}
/** Elemen statis di index.html: data-i18n="English text" (isi), data-i18n-attr="aria-label" (atribut). */
function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n, attr = el.dataset.i18nAttr;
    if (attr) el.setAttribute(attr, t(key)); else el.textContent = t(key);
  });
}

const MONTHS_L = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
};
const MONTHS_FULL = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  id: ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"],
};
const DOW_L = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], id: ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"] };
const mShort = i => MONTHS_L[LANG][i];
const mFull = i => MONTHS_FULL[LANG][i];
const dowShort = i => DOW_L[LANG][i];
/** "A, B and C" / "A, B dan C" */
const joinList = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + (LANG === "id" ? " dan " : " and ") + a[a.length - 1];
