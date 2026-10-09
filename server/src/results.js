// Historial de señales: cada alerta se guarda y se sigue con precio real hasta TP1, TP2 o SL (48 h máximo).
import { NAMES, ORDER } from "./config.js";
import { alertInsert, alertsOpen, alertUpdate, alertsSince } from "./store.js";
import { zkey } from "./zones.js";
import { px, shortPR } from "./util.js";

const H48 = 48 * 3600000;
let open = []; // seguimiento en memoria (copia de la base de datos)

export function loadResults() { open = alertsOpen(); }
export const openCount = () => open.length;

// Geometría válida: venta → SL arriba de la entrada y TP1 abajo; compra al revés.
function valid(side, e, sl, tp) { return sl > 0 && tp > 0 && (side === "sell" ? sl > e && tp < e : sl < e && tp > e); }

export function recordAlert({ t, sym, kind, z, order_side, entry, prox, usd }) {
  const a = { t, sym, kind, zone_name: z.name, grade: z.grade, side: z.side, order_side, entry, prox, usd, sl: z.sl, tp1: z.tp1, tp2: z.tp2, zkey: zkey(z) };
  if (open.some((x) => x.zkey === a.zkey)) { a.track = 0; a.status = "repetida"; }      // ya hay una señal abierta en esa zona
  else if (!valid(z.side, entry, z.sl, z.tp1)) { a.track = 0; a.status = "sin niveles"; } // SL/TP no cuadran con el precio
  else { a.track = 1; a.status = "abierta"; }
  a.id = alertInsert(a);
  if (a.track) open.push({ ...a, tp1_t: null });
  return a;
}

const rOf = (a, lvl) => Math.abs(lvl - a.entry) / Math.abs(a.entry - a.sl);

// hi/lo: rango de precio observado (una operación: hi = lo = precio). Si en un mismo rango
// se tocan SL y TP, se cuenta SL (criterio conservador).
export function checkRange(sym, lo, hi, T) {
  for (let i = open.length - 1; i >= 0; i--) {
    const a = open[i];
    if (a.sym !== sym || T < a.t) continue;
    const sell = a.side === "sell";
    const hitSL = sell ? hi >= a.sl : lo <= a.sl;
    const hitTP1 = sell ? lo <= a.tp1 : hi >= a.tp1;
    const tp2ok = valid(a.side, a.entry, a.sl, a.tp2) && (sell ? a.tp2 <= a.tp1 : a.tp2 >= a.tp1);
    const hitTP2 = tp2ok && (sell ? lo <= a.tp2 : hi >= a.tp2);
    let fin = null;
    if (a.status === "abierta") {
      if (hitSL) fin = { status: "SL", r: -1 };
      else if (hitTP1) {
        if (hitTP2) fin = { status: "TP2", r: rOf(a, a.tp2), tp1_t: T };
        else if (!tp2ok) fin = { status: "TP1", r: rOf(a, a.tp1), tp1_t: T };
        else { a.status = "tp1"; a.tp1_t = T; alertUpdate(a.id, { status: "tp1", tp1_t: T }); }
      }
    } else if (a.status === "tp1") {
      if (hitSL) fin = { status: "TP1", r: rOf(a, a.tp1), tp1_t: a.tp1_t };
      else if (hitTP2) fin = { status: "TP2", r: rOf(a, a.tp2), tp1_t: a.tp1_t };
    }
    if (fin) { alertUpdate(a.id, { ...fin, end_t: T }); open.splice(i, 1); }
  }
}

export function expire(now = Date.now()) {
  for (let i = open.length - 1; i >= 0; i--) {
    const a = open[i];
    if (now - a.t < H48) continue;
    if (a.status === "tp1") alertUpdate(a.id, { status: "TP1", r: rOf(a, a.tp1), tp1_t: a.tp1_t, end_t: now });
    else alertUpdate(a.id, { status: "sin resolver", end_t: now });
    open.splice(i, 1);
  }
}

// ---------- Resumen ----------
const tipo = (n) => (/order\s*block/i.test(n) ? "Order block" : /fair\s*value|gap|fvg/i.test(n) ? "Fair value gap" : "Otra");
function agg(rows) {
  const done = rows.filter((a) => ["TP1", "TP2", "SL"].includes(a.status));
  const n = done.length, tp1 = done.filter((a) => a.status !== "SL").length, tp2 = done.filter((a) => a.status === "TP2").length, sl = n - tp1;
  const rAvg = n ? done.reduce((s, a) => s + a.r, 0) / n : 0;
  const mins = done.map((a) => ((a.status === "SL" ? a.end_t : a.tp1_t || a.end_t) - a.t) / 60000);
  const tAvg = mins.length ? mins.reduce((s, x) => s + x, 0) / mins.length : 0;
  return { n, tp1, tp2, sl, rAvg, tAvg, nores: rows.filter((a) => a.status === "sin resolver").length };
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
const dur = (m) => (m >= 120 ? (m / 60).toFixed(1) + " h" : Math.round(m) + " min");
function line(label, s) {
  if (!s.n && !s.nores) return null;
  return "**" + label + "** · " + s.n + " resueltas · TP1 " + pct(s.tp1, s.n) + " · TP2 " + pct(s.tp2, s.n) + " · SL " + pct(s.sl, s.n) +
    " · R promedio " + (s.n ? (s.rAvg >= 0 ? "+" : "") + s.rAvg.toFixed(2) : "—") + (s.n ? " · tiempo medio " + dur(s.tAvg) : "") + (s.nores ? " · " + s.nores + " sin resolver" : "");
}

export function resultsText(days = 30) {
  const since = Date.now() - days * 86400000;
  const rows = alertsSince(since).filter((a) => a.track === 1);
  const L = ["📊 **Resultados de señales · últimos " + days + " días** (precio real de Binance; se cuenta lo que pasó primero)"];
  const all = agg(rows);
  if (!rows.length) return L[0] + "\nTodavía no hay señales registradas en este periodo.";
  L.push(line("Total", all));
  ORDER.forEach((k) => { const l = line(NAMES[k] || k, agg(rows.filter((a) => a.sym === k))); if (l) L.push(l); });
  ["A++", "A", "B"].forEach((g) => { const l = line("Grado " + g, agg(rows.filter((a) => a.grade === g))); if (l) L.push(l); });
  ["Order block", "Fair value gap", "Otra"].forEach((t) => { const l = line(t, agg(rows.filter((a) => tipo(a.zone_name) === t))); if (l) L.push(l); });
  const op = rows.filter((a) => a.status === "abierta" || a.status === "tp1");
  if (op.length) L.push("En seguimiento ahora: " + op.length + (op.length ? " (" + op.slice(0, 5).map((a) => a.sym + " " + a.zone_name + " " + px(a.entry, a.sym) + (a.status === "tp1" ? " ✅TP1" : "")).join(" · ") + ")" : ""));
  const last = rows.filter((a) => ["TP1", "TP2", "SL"].includes(a.status)).slice(0, 5);
  if (last.length) L.push("Últimas resueltas:\n" + last.map((a) => (a.status === "SL" ? "🔴" : "🟢") + " " + shortPR(a.t) + " · " + a.sym + " · " + a.zone_name + " " + (a.grade || "") + " · " + px(a.entry, a.sym) + " → " + a.status + " (" + (a.r >= 0 ? "+" : "") + a.r.toFixed(2) + "R)").join("\n"));
  L.push("_R = distancia al TP dividida entre la distancia al SL. SL = -1R. Números reales, sin ajustar._");
  return L.join("\n");
}
