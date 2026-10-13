// v4.19 · Tamaño de posición en las alertas (BTC, SOL, oro). Pedido de Yasser: riesgo fijo $100 por operación, cuenta $3,000.
// Regla (fija):
//   Entrada = borde de la zona donde se pondría la orden límite (venta: borde inferior; compra: borde superior).
//   Cantidad = riesgo ÷ distancia entrada–stop. Tamaño = cantidad × entrada. Apalancamiento = tamaño ÷ cuenta.
//   Comisión estimada = 0,1 % ida y vuelta sobre el tamaño. Pérdida real si toca el stop = riesgo + comisión.
//   Candado: stop a menos de 0,3 % de la entrada o apalancamiento mayor de 10x → "no operable" (no se da tamaño).
// Índices (Dow, Nasdaq): no se calcula; el tamaño del contrato depende del bróker.
import { kvGet, kvSet } from "./store.js";

export const FEE_RT = 0.001, MIN_STOP = 0.003, MAX_LEV = 10;
const UNIT = { BTC: { u: "BTC", d: 3 }, SOL: { u: "SOL", d: 2 }, XAU: { u: "oz", d: 2 } };

export function riskCfg() {
  const c = kvGet("riskCfg", null) || {};
  return { risk: c.risk > 0 ? c.risk : 100, account: c.account > 0 ? c.account : 3000 };
}
export function setRisk(k, v) {
  const c = { ...riskCfg() }; c[k] = v; kvSet("riskCfg", c); return c;
}

const money = (x) => "$" + Math.round(x).toLocaleString("en-US");

// Cálculo puro (probado). side: "buy"|"sell". Devuelve null si no hay datos para calcular.
export function sizeOf(sym, side, lo, hi, sl, cfg = riskCfg(), entry = null) {
  if (!UNIT[sym] || !(sl > 0)) return null;
  const e = entry > 0 ? entry : side === "sell" ? Math.min(lo, hi) : Math.max(lo, hi);
  const dist = side === "sell" ? sl - e : e - sl;
  if (!(dist > 0)) return { ok: false, entry: e, why: "el stop está del lado equivocado de la entrada" };
  const stopPct = dist / e, qty = cfg.risk / dist, notional = qty * e, lev = notional / cfg.account, fee = notional * FEE_RT;
  const r = { entry: e, stopPct, qty, notional, lev, fee, loss: cfg.risk + fee, risk: cfg.risk };
  if (stopPct < MIN_STOP || lev > MAX_LEV) return { ...r, ok: false, why: "stop a " + (stopPct * 100).toFixed(2) + " % → necesitarías " + lev.toFixed(1) + "x (máx. " + MAX_LEV + "x, stop mín. " + MIN_STOP * 100 + " %)" };
  return { ...r, ok: true };
}

// Línea para Discord. f = formateador de precio del mercado.
export function sizeLine(sym, z, f, entry = null) {
  if (!z) return "";
  const s = sizeOf(sym, z.side, z.lo, z.hi, z.sl, riskCfg(), entry);
  if (!s) return "";
  const where = entry > 0 ? "entrada " + f(s.entry) : "entrada en el borde " + f(s.entry);
  if (!s.ok) return "⛔ **No operable con " + money(s.risk || riskCfg().risk) + "**: " + s.why;
  const u = UNIT[sym];
  return "💵 Con " + money(s.risk) + " de riesgo (" + where + "): " + s.qty.toFixed(u.d) + " " + u.u + " · " + money(s.notional) + " · " + s.lev.toFixed(1) + "x · comisión ~" + money(s.fee) + " → si toca el stop pierdes ~" + money(s.loss);
}
