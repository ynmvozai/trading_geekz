// v4.15 · Confirmación de 15 min tras el toque de zona · SOLO BTC, SOL y oro · solo mide y registra (no publica nada).
// Regla FIJA, aprobada por Yasser antes de ver datos (13 oct 2026):
//   Toque: el precio entra a una zona viva. k = vela de 5 min que contiene el toque.
//   Ventana: las 3 velas de 5 min siguientes (k+1, k+2, k+3) = 15 min.
//   1) FVG a favor: compra → mín(k+3) > máx(k+1); venta → máx(k+3) < mín(k+1).
//   2) BOS: cierre de k+2 rompe el último swing de 5 min (compra: máximo; venta: mínimo). Mismo swing que el estudio (fiveMin).
//   3) Volumen: la vela k+3 tiene más volumen (USD) que el promedio de las 12 velas de 5 min antes del toque.
//   4) Órdenes grandes (≥ ⅓ del mínimo de alerta) dentro de la zona (±0,1 %) entre el toque y el cierre de k+3: netas a favor.
//   Confirmada = 1 y 2 y 3 y 4. Se guarda cuál faltó.
// Resultado (para TODOS los toques, confirmados o no, para poder comparar): desde el cierre de k+3,
//   compra acierta si el precio sube 1 ancho de zona sobre el borde superior; falla si baja del borde inferior.
//   Venta: espejo. Sin resolver a las 24 h.
import { SYMS, ORDER } from "./config.js";
import { kvGet, kvSet } from "./store.js";
import { liveZones, zkey } from "./zones.js";
import { S, feed, on } from "./market.js";
import { klinesRaw } from "./binance.js";
import { fiveMin } from "./estudio.js";
import { log } from "./util.js";

const P = 300000, H24 = 24 * 3600000, COOLDOWN = 60 * 60000, MAX = 500, PAD = 0.001;
export const C15 = { n: 0, err: "" };

// ---------- Regla (pura, probada en test/confirm15.test.js) ----------
// F: velas de 5 min de fiveMin (t, o, h, l, c, v, sh, sl). orders: [{t, side, usd, price}].
export function evalTouch(F, tTouch, side, lo, hi, orders, minUsd) {
  const kOpen = Math.floor(tTouch / P) * P;
  let k = -1; for (let i = 0; i < F.n; i++) if (F.t[i] === kOpen) { k = i; break; }
  if (k < 0 || k + 3 >= F.n) return { ok: false, error: "faltan velas" };
  for (let j = 1; j <= 3; j++) if (F.t[k + j] - F.t[k] !== j * P) return { ok: false, error: "velas no seguidas" };
  const dir = side === "buy" ? 1 : -1;
  const fvg = dir === 1 ? F.l[k + 3] > F.h[k + 1] : F.h[k + 3] < F.l[k + 1];
  const sw = dir === 1 ? F.sh[k + 2] : F.sl[k + 2];
  const bos = Number.isFinite(sw) && (dir === 1 ? F.c[k + 2] > sw : F.c[k + 2] < sw);
  let sumV = 0, nV = 0; for (let i = Math.max(0, k - 12); i < k; i++) { sumV += F.v[i]; nV++; }
  const avgV = nV ? sumV / nV : 0;
  const vol = nV >= 6 && F.v[k + 3] > avgV;
  const tEnd = F.t[k + 3] + P, zlo = lo * (1 - PAD), zhi = hi * (1 + PAD);
  let buy = 0, sell = 0;
  for (const o of orders) {
    if (o.t < tTouch || o.t >= tEnd || o.usd < minUsd || o.price < zlo || o.price > zhi) continue;
    if (o.side === "buy") buy += o.usd; else sell += o.usd;
  }
  const net = buy - sell, ords = dir * net > 0;
  return { ok: true, fvg, bos, vol, ords, confirmada: fvg && bos && vol && ords, tEnd, close: F.c[k + 3], volK3: F.v[k + 3], volProm: avgV, buy, sell };
}

// Resultado con un precio nuevo. Devuelve "acierta", "falla" o null.
export function outcome(side, lo, hi, p) {
  const w = hi - lo;
  if (side === "buy") return p < lo ? "falla" : p >= hi + w ? "acierta" : null;
  return p > hi ? "falla" : p <= lo - w ? "acierta" : null;
}

// ---------- Registro ----------
let R = null;
const list = () => (R ||= kvGet("c15", []) || []);
const save = () => { while (R.length > MAX) R.shift(); kvSet("c15", R); };

// Toque: llamado por cada operación de Binance (BTC, SOL, oro). Ligero: solo compara con las zonas vivas del mercado.
let zcache = { t: 0, z: [] };
function zonesNow(now) { if (now - zcache.t > 15000) zcache = { t: now, z: liveZones().filter((z) => ORDER.includes(z.sym) && z.hi > 0) }; return zcache.z; }

let meas = null; // toques en medición de resultado (copia en memoria para no recorrer todo el registro en cada operación)
const measNow = () => (meas ||= list().filter((a) => a.status === "midiendo"));

export function onPrice(sym, p, T = Date.now()) {
  let dirty = false;
  for (const z of zonesNow(T)) {
    if (z.sym !== sym) continue;
    const lo = Math.min(z.lo, z.hi), hi = Math.max(z.lo, z.hi);
    if (p < lo || p > hi) continue;
    const key = zkey(z), arr = list();
    if (arr.some((x) => x.zkey === key && T - x.t < COOLDOWN)) continue;
    arr.push({ id: T.toString(36) + Math.random().toString(36).slice(2, 5), t: T, sym, zkey: key, name: z.name || "", side: z.side, lo, hi, status: "esperando" });
    C15.n++; dirty = true;
  }
  for (const a of measNow()) {
    if (a.sym !== sym || a.status !== "midiendo" || T < a.t_eval) continue;
    a.max = Math.max(a.max ?? p, p); a.min = Math.min(a.min ?? p, p);
    const r = outcome(a.side, a.lo, a.hi, p);
    if (r) { a.status = r; a.t_end = T; a.end_price = p; dirty = true; meas = null; }
  }
  if (dirty) save();
}

// Evalúa los toques cuya ventana ya cerró (cada 30 s) y cierra los resultados viejos.
let busy = false;
export async function c15Tick(now = Date.now()) {
  if (busy) return; busy = true;
  try {
    const arr = list(); let dirty = false;
    for (const a of arr) {
      if (a.status === "midiendo" && now - a.t_eval > H24) { a.status = "sin resolver"; a.t_end = now; dirty = true; continue; }
      if (a.status !== "esperando") continue;
      const kOpen = Math.floor(a.t / P) * P;
      if (now < kOpen + 4 * P + 30000) continue;                       // k+3 todavía abierta
      if (now - a.t > 6 * 3600000) { a.status = "sin datos"; dirty = true; continue; }
      try {
        const K = await klinesRaw(SYMS[a.sym].label, "5m", 40, kOpen - 30 * P);
        const closed = K.filter((c) => +c[0] + P <= now);
        const M = { t: closed.map((c) => +c[0]), o: closed.map((c) => +c[1]), h: closed.map((c) => +c[2]), l: closed.map((c) => +c[3]), c: closed.map((c) => +c[4]), v: closed.map((c) => +c[7]), n: closed.length };
        const F = fiveMin(M);
        const e = evalTouch(F, a.t, a.side, a.lo, a.hi, feed, SYMS[a.sym].min / 3);
        if (!e.ok) { a.status = "sin datos"; a.error = e.error; dirty = true; continue; }
        Object.assign(a, { fvg: e.fvg, bos: e.bos, vol: e.vol, ords: e.ords, confirmada: e.confirmada, buy: Math.round(e.buy), sell: Math.round(e.sell), close: e.close, t_eval: e.tEnd, status: "midiendo" });
        const r0 = outcome(a.side, a.lo, a.hi, S[a.sym].price ?? e.close);
        if (r0) { a.status = r0; a.t_end = now; a.end_price = S[a.sym].price ?? e.close; }
        dirty = true;
      } catch (err) { C15.err = err.message; log("c15", a.sym, err.message); }
    }
    if (dirty) { save(); meas = null; }
  } finally { busy = false; }
}

// ---------- Resumen (comando "confirmacion registro" en #agent) ----------
export function c15Summary() {
  const arr = list();
  const ev = arr.filter((a) => typeof a.confirmada === "boolean");
  const conf = ev.filter((a) => a.confirmada), nconf = ev.filter((a) => !a.confirmada);
  const res = (g) => { const d = g.filter((a) => a.status === "acierta" || a.status === "falla"); const w = d.filter((a) => a.status === "acierta").length; return d.length ? w + "/" + d.length + " (" + Math.round((w / d.length) * 100) + "%)" : "—"; };
  const cnt = (f) => ev.filter(f).length;
  const L = ["📐 **Confirmación 15 min · BTC, SOL y oro** (solo medición)",
    "Toques: " + arr.length + " · evaluados: " + ev.length + " · esperando: " + arr.filter((a) => a.status === "esperando").length + " · sin datos: " + arr.filter((a) => a.status === "sin datos").length,
    "Pasaron → FVG " + cnt((a) => a.fvg) + " · BOS " + cnt((a) => a.bos) + " · FVG+BOS " + cnt((a) => a.fvg && a.bos) + " · volumen " + cnt((a) => a.vol) + " · órdenes " + cnt((a) => a.ords) + " · **confirmadas " + conf.length + "**",
    "Resultado (1 ancho de zona, 24 h) · confirmadas: " + res(conf) + " · no confirmadas: " + res(nconf)];
  for (const s of ORDER) { const g = ev.filter((a) => a.sym === s); if (g.length) L.push("· " + s + ": " + g.length + " evaluados, " + g.filter((a) => a.confirmada).length + " confirmados, resultado confirmadas " + res(g.filter((a) => a.confirmada))); }
  L.push("-# Pocos casos no dicen nada todavía: la vara sigue siendo 50+ resueltas con resultado positivo.");
  return L.join("\n");
}

export function startC15() {
  on("trade", (sym, p, T) => { try { onPrice(sym, p, T); } catch (e) { C15.err = e.message; } });
  setInterval(() => { c15Tick().catch((e) => log("c15Tick", e.message)); }, 30000);
}
