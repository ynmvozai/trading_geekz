// v4.19 · Tamaño de posición en las alertas (BTC, SOL, oro). Pedido de Yasser: riesgo fijo $100 por operación, cuenta $3,000.
// v4.21 · Stop MEDIDO (Fase 7, 13 oct 2026) en lugar del stop de cada zona: borde lejano + margen por mercado.
//   Margen = lo que hizo falta para que el stop NO sacara ~80 % de los toques que sí reaccionaron (12 meses, velas de 1 min):
//   BTC +0,5 % · SOL +1,0 % · oro +0,3 % del precio, más allá del borde lejano de la zona.
// Regla (fija):
//   Entrada = borde cercano de la zona (venta: borde inferior; compra: borde superior), o el cierre confirmado si se pasa.
//   Stop = borde lejano ± margen. Cantidad = riesgo ÷ distancia entrada–stop. Tamaño = cantidad × entrada. Apalancamiento = tamaño ÷ cuenta.
//   Comisión estimada = 0,1 % ida y vuelta sobre el tamaño. Pérdida real si toca el stop = riesgo + comisión.
//   Candado: stop a menos de 0,3 % de la entrada o apalancamiento mayor de 10x → "no operable" (no se da tamaño).
// Índices (Dow, Nasdaq): no se calcula; el tamaño del contrato depende del bróker y no hay medición de margen.
import { kvGet, kvSet } from "./store.js";

export const FEE_RT = 0.001, MIN_STOP = 0.003, MAX_LEV = 10;
export const BUFFER = { BTC: 0.005, SOL: 0.01, XAU: 0.003 };
const UNIT = { BTC: { u: "BTC", d: 3 }, SOL: { u: "SOL", d: 2 }, XAU: { u: "oz", d: 2 } };

export function riskCfg() {
  const c = kvGet("riskCfg", null) || {};
  return { risk: c.risk > 0 ? c.risk : 100, account: c.account > 0 ? c.account : 3000 };
}
export function setRisk(k, v) {
  const c = { ...riskCfg() }; c[k] = v; kvSet("riskCfg", c); return c;
}

const money = (x) => "$" + Math.round(x).toLocaleString("en-US");

// Stop medido: borde lejano ± margen del mercado. null si el mercado no tiene medición.
export function measuredStop(sym, side, lo, hi) {
  const b = BUFFER[sym]; if (b == null) return null;
  const L = Math.min(lo, hi), U = Math.max(lo, hi);
  return side === "sell" ? U * (1 + b) : L * (1 - b);
}

// Cálculo puro (probado). side: "buy"|"sell". Devuelve null si el mercado no tiene medición.
export function sizeOf(sym, side, lo, hi, cfg = riskCfg(), entry = null) {
  const sl = measuredStop(sym, side, lo, hi);
  if (!UNIT[sym] || sl == null) return null;
  const e = entry > 0 ? entry : side === "sell" ? Math.min(lo, hi) : Math.max(lo, hi);
  const dist = side === "sell" ? sl - e : e - sl;
  if (!(dist > 0)) return { ok: false, entry: e, sl, risk: cfg.risk, why: "la entrada ya pasó el stop medido" };
  const stopPct = dist / e, qty = cfg.risk / dist, notional = qty * e, lev = notional / cfg.account, fee = notional * FEE_RT;
  const r = { entry: e, sl, dist, stopPct, qty, notional, lev, fee, loss: cfg.risk + fee, risk: cfg.risk };
  if (stopPct < MIN_STOP || lev > MAX_LEV) return { ...r, ok: false, why: "stop a " + (stopPct * 100).toFixed(2) + " % → necesitarías " + lev.toFixed(1) + "x (máx. " + MAX_LEV + "x, stop mín. " + MIN_STOP * 100 + " %)" };
  return { ...r, ok: true };
}

// R:R hasta una meta, descontando la comisión en R. null si no hay meta o está del lado equivocado.
export function rrTo(s, side, tp) {
  if (!s || !(tp > 0) || !(s.dist > 0)) return null;
  const gain = side === "sell" ? s.entry - tp : tp - s.entry;
  if (!(gain > 0)) return null;
  return gain / s.dist - (FEE_RT * s.entry) / s.dist;
}

// Línea de niveles con el stop medido (reemplaza al stop de la zona en cripto y oro).
export function nivelesMedidos(sym, z, f, entry = null) {
  const sl = measuredStop(sym, z.side, z.lo, z.hi);
  if (sl == null) return null;
  const pct = (BUFFER[sym] * 100).toLocaleString("es", { maximumFractionDigits: 1 });
  return ["🛑 Stop " + f(sl) + " (borde + " + pct + " %)", z.tp1 && "🎯 Meta " + f(z.tp1) + (z.tp2 ? " → " + f(z.tp2) : "")].filter(Boolean).join(" · ");
}

// Línea de tamaño para Discord. f = formateador de precio del mercado.
export function sizeLine(sym, z, f, entry = null) {
  if (!z) return "";
  const s = sizeOf(sym, z.side, z.lo, z.hi, riskCfg(), entry);
  if (!s) return "";
  if (!s.ok) return "⛔ **No operable con " + money(s.risk) + "**: " + s.why;
  const u = UNIT[sym], where = entry > 0 ? "entrada " + f(s.entry) : "entrada en el borde " + f(s.entry);
  const rr = rrTo(s, z.side, z.tp1);
  return "💵 Con " + money(s.risk) + " de riesgo (" + where + "): " + s.qty.toFixed(u.d) + " " + u.u + " · " + money(s.notional) + " · " + s.lev.toFixed(1) + "x · comisión ~" + money(s.fee) + " → si toca el stop pierdes ~" + money(s.loss) +
    (rr != null ? "\n-# R:R a la meta 1 (con comisión): " + rr.toFixed(2) + (rr < 1 ? " · la meta queda corta para este stop" : "") : "");
}
