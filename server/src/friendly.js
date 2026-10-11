// v3.8: piezas comunes para mensajes cortos y fáciles de leer (people friendly).
// Siempre data real: si no hay dato, la línea simplemente no sale.
import { sentFor, sentRead, emoji } from "./sentiment.js";

// Punto de color según qué tan cerca está el precio de la zona (0-100%).
export const dot = (v) => (v >= 100 ? "🎯" : v >= 80 ? "🔥" : v >= 50 ? "🟡" : "⚪");
export const lado = (side) => (side === "buy" ? "COMPRA" : "VENTA");
export const espera = (side) => (side === "buy" ? "se espera que SUBA 📈" : "se espera que BAJE 📉");
export const quien = (side) => (side === "buy" ? "🟢 COMPRAN" : "🔴 VENDEN");
export const rango = (z, f) => f(Math.min(z.lo, z.hi)) + "–" + f(Math.max(z.lo, z.hi));
export const niveles = (z, f) => [z.sl && "SL " + f(z.sl), z.tp1 && "TP1 " + f(z.tp1), z.tp2 && "TP2 " + f(z.tp2)].filter(Boolean).join(" · ");

// ¿La orden grande empuja hacia donde la zona espera?
export const empuje = (orderSide, zoneSide) => (orderSide === zoneSide
  ? "✅ La orden empuja **a favor** de la zona"
  : "⚠️ La orden empuja **en contra** de la zona (puede ser absorción: espera confirmación)");

// Ánimo del mercado (Fear & Greed) en una línea. Vacío si no hay dato.
const TAG = { "a favor": "a favor ✅", contra: "en contra ⚠️", neutral: "neutral" };
export function animo(zoneSide, sym) {
  const s = sentFor(sym);
  if (!s || s.v == null) return "";
  const r = sentRead(zoneSide, s);
  return emoji(s.v) + " Ánimo del mercado: " + s.v + " " + s.label + (TAG[r.tag] ? " · " + TAG[r.tag] : "") + (sym === "XAU" ? " (ref. acciones)" : "");
}
export function animoTag(zoneSide, sym) {
  const r = sentRead(zoneSide, sentFor(sym));
  return r.tag === "a favor" ? " ✅" : r.tag === "contra" ? " ⚠️" : "";
}
