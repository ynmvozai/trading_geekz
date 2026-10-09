import { SYMS, TZ } from "./config.js";

export function usd(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(0) + "K";
  return s + "$" + a.toFixed(0);
}
export function px(v, sym) {
  if (v == null || !isFinite(v)) return "—";
  const d = (SYMS[sym] || SYMS.BTC).dec;
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const hhmmss = (t) => new Date(t).toLocaleTimeString("es-PR", { hour12: false, timeZone: TZ });
export const fullPR = (t) => new Date(t).toLocaleString("es-PR", { timeZone: TZ });
export const shortPR = (t) => new Date(t).toLocaleString("es-PR", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const sideEs = (s) => (s === "buy" ? "COMPRA" : "VENTA");

// Hora de Puerto Rico como partes numéricas (independiente de la TZ del servidor).
export function prParts(t = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const o = {};
  for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, hour: +o.hour, minute: +o.minute, weekday: o.weekday };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// Divide textos largos para Discord (límite 2,000 caracteres).
export function splitLong(txt, max = 1900) {
  const parts = [];
  let t = String(txt || "");
  while (t.length > max) {
    let cut = t.lastIndexOf("\n", max);
    if (cut < 500) cut = max;
    parts.push(t.slice(0, cut));
    t = t.slice(cut);
  }
  if (t.trim()) parts.push(t);
  return parts;
}
