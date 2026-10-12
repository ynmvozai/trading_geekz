// v4.3 · Termómetro de sesgo (order flow) por mercado, de −4 (vendedores mandan) a +4 (compradores mandan).
// Todo con data real de Binance: velas 1H/4H (REST), órdenes grandes del feed y zonas rotas.
// Señales que suma (cada una vale +1 compradores / −1 vendedores / 0 neutral):
//  1) Estructura 1H: el último cierre rompe el máximo (o mínimo) de las 24 velas anteriores (sin contar las 2 últimas).
//  2) Tendencia 4H: media 20 vs media 50 de los cierres de 4 horas.
//  3) Ballenas 4 h: neto de órdenes grandes (≥ 1/3 del mínimo de alerta) mayor que 2 veces el mínimo de alerta.
//  4) Zonas rotas en las últimas 12 h: se rompió una de venta (+1) o una de compra (−1).
// También calcula el ATR 14 de 1H: el "movimiento normal por hora", que usa la regla del stop mínimo.
import { ORDER, SYMS, NAMES } from "./config.js";
import { kl } from "./binance.js";
import { feed } from "./market.js";
import { Z } from "./zones.js";
import { kvGet, kvSet } from "./store.js";
import { usd, log } from "./util.js";

export const B = {}; // sym → { score, label, reasons[], atr, atrPct, t }
const LABEL = (s) => (s >= 2 ? "COMPRADORES" : s <= -2 ? "VENDEDORES" : "NEUTRAL");
const ema = (arr, n) => { const k = 2 / (n + 1); let e = arr[0]; for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; };

export function atr14(c) { // c: [[t,o,h,l,c],...]
  if (!Array.isArray(c) || c.length < 16) return null;
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i][2] - c[i][3], Math.abs(c[i][2] - c[i - 1][4]), Math.abs(c[i][3] - c[i - 1][4])));
  const last = tr.slice(-14);
  return last.reduce((a, b) => a + b, 0) / last.length;
}

// Puntaje puro (se prueba sin red).
export function scoreOf(sym, h1, h4, now = Date.now()) {
  const R = [], s = [0, 0, 0, 0];
  if (Array.isArray(h1) && h1.length >= 30) {
    const last = h1[h1.length - 1][4], win = h1.slice(-27, -3);
    const hi = Math.max(...win.map((k) => k[2])), lo = Math.min(...win.map((k) => k[3]));
    if (last > hi) { s[0] = 1; R.push("✅ Cerró 1H arriba del máximo de las últimas 24 h (" + fmt(hi, sym) + ")"); }
    else if (last < lo) { s[0] = -1; R.push("🔻 Cerró 1H abajo del mínimo de las últimas 24 h (" + fmt(lo, sym) + ")"); }
  }
  if (Array.isArray(h4) && h4.length >= 50) {
    const cl = h4.map((k) => k[4]), e20 = ema(cl.slice(-60), 20), e50 = ema(cl.slice(-60), 50);
    if (e20 > e50 * 1.001) { s[1] = 1; R.push("✅ Tendencia 4H sube (media 20 arriba de la 50)"); }
    else if (e20 < e50 * 0.999) { s[1] = -1; R.push("🔻 Tendencia 4H baja (media 20 abajo de la 50)"); }
  }
  const minBig = (SYMS[sym].min || 0) / 3, cut = now - 4 * 3600000;
  let net = 0;
  for (const o of feed) { if (o.t < cut) break; if (o.sym === sym && o.usd >= minBig) net += o.side === "buy" ? o.usd : -o.usd; }
  const thr = 2 * (SYMS[sym].min || 0);
  if (net > thr) { s[2] = 1; R.push("✅ Ballenas 4 h: neto " + usd(net) + " en compras"); }
  else if (net < -thr) { s[2] = -1; R.push("🔻 Ballenas 4 h: neto " + usd(-net) + " en ventas"); }
  const br = (kvGet("zbrokenLog", []) || []).filter((x) => x.sym === sym && now - x.t < 12 * 3600000);
  const bs = br.filter((x) => x.side === "sell").length, bb = br.filter((x) => x.side === "buy").length;
  if (bs > bb) { s[3] = 1; R.push("✅ Se rompió una zona de venta en las últimas 12 h"); }
  else if (bb > bs) { s[3] = -1; R.push("🔻 Se rompió una zona de compra en las últimas 12 h"); }
  const score = s.reduce((a, b) => a + b, 0);
  return { score, label: LABEL(score), reasons: R, parts: s, net };
}
const fmt = (v, sym) => (sym === "BTC" ? Math.round(v).toLocaleString("en-US") : (+v).toLocaleString("en-US", { maximumFractionDigits: 2 }));

// Stop mínimo = la mitad del movimiento normal de una hora (0.5 × ATR 1H). Sin dato, respaldo fijo.
const FALLBACK = { BTC: 0.0015, SOL: 0.0035, XAU: 0.001 };
export function minStop(sym, price) { const b = B[sym]; return b && b.atr ? 0.5 * b.atr : price * (FALLBACK[sym] || 0.002); }
export const biasOf = (sym) => (B[sym] ? B[sym].label : "NEUTRAL");
// ¿La zona va contra el sesgo? (zona de venta con COMPRADORES mandando, o al revés)
export const againstBias = (sym, side) => { const l = biasOf(sym); return (side === "sell" && l === "COMPRADORES") || (side === "buy" && l === "VENDEDORES"); };

let notify = null; // (sym, txt) => void, lo conecta index.js
export function onBiasChange(fn) { notify = fn; }
export async function refreshBias() {
  for (const sym of ORDER) {
    try {
      const [h1, h4] = await Promise.all([kl(SYMS[sym].label, "1h", 60), kl(SYMS[sym].label, "4h", 60)]);
      if (!Array.isArray(h1)) continue;
      const r = scoreOf(sym, h1, h4), a = atr14(h1), lastP = h1[h1.length - 1][4];
      B[sym] = { ...r, atr: a, atrPct: a && lastP ? (a / lastP) * 100 : null, t: Date.now() };
      const prev = (kvGet("biasLabel", {}) || {})[sym];
      if (prev && prev !== r.label && notify) notify(sym, changeText(sym, prev));
      const m = kvGet("biasLabel", {}) || {}; m[sym] = r.label; kvSet("biasLabel", m);
    } catch (e) { log("Sesgo", sym, e.message); }
  }
}
export function changeText(sym, prev) {
  const b = B[sym], name = NAMES[sym] || sym;
  const head = b.label === "NEUTRAL" ? "⚖️ " + name + ": el control quedó NEUTRAL (" + (b.score > 0 ? "+" : "") + b.score + ")" : "🔄 " + name + ": cambió a " + b.label + " (" + (b.score > 0 ? "+" : "") + b.score + ")";
  const tail = b.label === "COMPRADORES" ? "Las señales de VENTA no cuentan hasta nuevo aviso." : b.label === "VENDEDORES" ? "Las señales de COMPRA no cuentan hasta nuevo aviso." : "Antes: " + prev.toLowerCase() + ". Cuentan compras y ventas.";
  return [head, ...b.reasons, "-# " + tail].join("\n");
}
export function biasText() {
  return ["🧭 Termómetro de sesgo (−4 vendedores · +4 compradores)", ...ORDER.map((s) => { const b = B[s]; if (!b) return "⚪ " + (NAMES[s] || s) + " · sin dato todavía";
    return (b.label === "COMPRADORES" ? "🟢" : b.label === "VENDEDORES" ? "🔴" : "⚪") + " " + (NAMES[s] || s) + " · " + b.label + " (" + (b.score > 0 ? "+" : "") + b.score + ")" + (b.atrPct ? " · movimiento normal por hora " + b.atrPct.toFixed(2) + "%" : "") + (b.reasons.length ? "\n   " + b.reasons.join("\n   ") : ""); }),
    "-# Se recalcula cada 15 min con velas reales de Binance."].join("\n");
}
export function startBias() { refreshBias(); setInterval(refreshBias, 15 * 60000); }
