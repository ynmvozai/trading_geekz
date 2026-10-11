// v3.9: piezas comunes para mensajes cortos y fáciles de leer (people friendly).
// Reglas: la primera línea va sin ** ni _ (el celular los muestra tal cual), lo importante arriba,
// "Stop / Meta" en vez de SL / TP, sin ".00". Siempre data real: si no hay dato, la línea no sale.
import { px } from "./util.js";
import { sentFor, sentRead, emoji } from "./sentiment.js";

// Precio amigable: Bitcoin sin decimales; los demás sin ".00" / ".0" al final.
export function pf(v, sym) {
  if (v == null || !isFinite(v)) return "—";
  if (sym === "BTC") return Math.round(v).toLocaleString("en-US");
  if (sym === "US30" || sym === "NQ") return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/\.0+$/, "");
  return px(v, sym).replace(/\.0+$/, "");
}

// Qué tan cerca está el precio de la zona (0-100%), en palabras y con color.
export const dot = (v) => (v >= 100 ? "🎯" : v >= 80 ? "🔥" : v >= 50 ? "🟡" : "⚪");
export const cerca = (v) => (v >= 100 ? "dentro" : v >= 80 ? "muy cerca" : v >= 50 ? "a medio camino" : "lejos");
export const lado = (side) => (side === "buy" ? "COMPRA" : "VENTA");
export const ladoMin = (side) => (side === "buy" ? "compra" : "venta");
export const flecha = (side) => (side === "buy" ? "🟢" : "🔴");
export const espera = (side) => (side === "buy" ? "Se espera que suba 📈" : "Se espera que baje 📉");
export const rango = (z, f) => f(Math.min(z.lo, z.hi)) + "–" + f(Math.max(z.lo, z.hi));
// "🛑 Stop 4,215 · 🎯 Meta 4,180 → 4,148"
export const niveles = (z, f) => [z.sl && "🛑 Stop " + f(z.sl), z.tp1 && "🎯 Meta " + f(z.tp1) + (z.tp2 ? " → " + f(z.tp2) : "")].filter(Boolean).join(" · ");

// ¿La orden grande empuja hacia donde la zona espera?
export const empuje = (orderSide, zoneSide) => (orderSide === zoneSide ? "empuja a favor ✅" : "⚠️ Ojo: empuja en contra de la zona. Espera confirmación.");

// Ánimo del mercado (Fear & Greed) en una línea. Vacío si no hay dato.
export function animo(zoneSide, sym) {
  const s = sentFor(sym);
  if (!s || s.v == null) return "";
  const r = sentRead(zoneSide, s), lbl = String(s.label || "").toLowerCase();
  if (sym === "XAU") return emoji(s.v) + " Ánimo general: " + lbl + " (" + s.v + ")" + (r.tag === "a favor" ? " · acompaña la " + ladoMin(zoneSide) : r.tag === "contra" ? " · va en contra" : "");
  return emoji(s.v) + " Ánimo: " + lbl + " (" + s.v + ")" + (r.tag === "a favor" ? " · acompaña la " + ladoMin(zoneSide) : r.tag === "contra" ? " · va en contra ⚠️" : "");
}

// Nombres de noticias en español (Forex Factory las da en inglés). Si no está, se deja el original.
const NEWS = [
  [/non-?farm|nfp/i, "empleo de EE. UU. (nóminas)"], [/unemployment rate/i, "tasa de desempleo"], [/unemployment claims|jobless/i, "solicitudes de desempleo"],
  [/core cpi/i, "inflación subyacente (IPC)"], [/\bcpi\b/i, "inflación (IPC)"], [/core ppi|\bppi\b/i, "precios al productor (IPP)"],
  [/core pce|\bpce\b/i, "inflación PCE"], [/fomc.*(statement|rate)|federal funds|fed.*rate/i, "decisión de tasas de la Fed"], [/fomc.*minutes/i, "minutas de la Fed"],
  [/fomc|powell|fed chair/i, "Fed (discurso / conferencia)"], [/advance gdp|prelim gdp|final gdp|\bgdp\b/i, "crecimiento (PIB)"],
  [/retail sales/i, "ventas minoristas"], [/ism.*manufacturing/i, "manufactura ISM"], [/ism.*services/i, "servicios ISM"],
  [/jolts/i, "ofertas de empleo (JOLTS)"], [/adp/i, "empleo privado ADP"], [/consumer sentiment|consumer confidence/i, "confianza del consumidor"],
];
export const newsEs = (t) => { for (const [re, es] of NEWS) if (re.test(t)) return es; return t; };
