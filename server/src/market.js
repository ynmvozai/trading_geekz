// Estado de mercado: precio, flujo por segundo, agregación de órdenes (250 ms), rachas y feed 24 h.
import { ORDER, SYMS, BUCKETS, BURST_MS, STREAK_MIN, FEED_MIN_USD } from "./config.js";
import { Z, zoneAt } from "./zones.js";
import { feedInsert, feedLoad, feedPrune, kvGet, kvSet } from "./store.js";

export const S = {};
ORDER.forEach((k) => { S[k] = { price: null, lag: null, lastT: 0, lastRecv: 0, secs: new Map(), bursts: { buy: null, sell: null }, streak: null }; });
export const big = [];     // órdenes sobre el mínimo (últimas 80)
export let feed = [];      // órdenes ≥ $250K, últimas 24 h (más reciente primero)
export let stats = {};
const listeners = { big: [], trade: [] };
export const on = (ev, fn) => listeners[ev].push(fn);

export const lim = (sym) => ({ min: SYMS[sym].min, max: SYMS[sym].max });
const stat = (sym) => stats[sym] || (stats[sym] = { ms: 0, c: [0, 0, 0, 0, 0], top: 0 });
export const prices = () => Object.fromEntries(ORDER.map((k) => [k, S[k].price]));

export function loadMarket() {
  feed = feedLoad(Date.now() - 86400000);
  stats = kvGet("stats", {}) || {};
}
export function persistMarket() {
  feedPrune(Date.now() - 86400000);
  kvSet("stats", stats);
}

export function flow(sym, msBack, now = Date.now()) {
  const from = Math.floor((now - msBack) / 1000);
  let b = 0, s = 0;
  S[sym].secs.forEach((v, k) => { if (k >= from) { b += v.buy; s += v.sell; } });
  return { buy: b, sell: s, net: b - s };
}

// Una operación de Binance aggTrade: p precio, q cantidad, T hora, m = vendedor agresor.
export function onTrade(sym, p, q, T, sellAggressor, recvAt = Date.now()) {
  const st8 = S[sym], side = sellAggressor ? "sell" : "buy", n = p * q;
  st8.price = p; st8.lastT = T; st8.lastRecv = recvAt;
  const lg = recvAt - T;
  if (lg > -5000 && lg < 600000) st8.lag = st8.lag == null ? lg : st8.lag * 0.95 + lg * 0.05;
  const k = Math.floor(T / 1000);
  let e = st8.secs.get(k); if (!e) st8.secs.set(k, (e = { buy: 0, sell: 0 })); e[side] += n;
  const zi = zoneAt(sym, p);
  for (let i = 0; i < Z.list.length; i++) {
    if (Z.list[i].sym !== sym) continue;
    const st = Z.state[i] || (Z.state[i] = { inside: false, buy: 0, sell: 0, since: 0 });
    if (i === zi) { if (!st.inside) { st.inside = true; st.buy = 0; st.sell = 0; st.since = T; } st[side] += n; }
    else if (st.inside) st.inside = false;
  }
  for (const fn of listeners.trade) fn(sym, p, T);
  const b = st8.bursts[side];
  if (b && T - b.first <= BURST_MS) { b.usd += n; b.qty += q; b.last = T; b.n++; }
  else { if (b) finalize(b); st8.bursts[side] = { sym, side, usd: n, qty: q, first: T, last: T, n: 1 }; }
}

export function flushStale(now = Date.now()) {
  ORDER.forEach((sym) => ["buy", "sell"].forEach((s) => {
    const b = S[sym].bursts[s];
    // now es la hora local; b.first es la hora de Binance: se compara con el retraso medido.
    if (b && now - (S[sym].lag || 0) - b.first > BURST_MS) { S[sym].bursts[s] = null; finalize(b); }
  }));
}

export function finalize(b) {
  const st8 = S[b.sym], L = lim(b.sym);
  if (st8.bursts[b.side] === b) st8.bursts[b.side] = null;
  if (b.usd >= BUCKETS[0]) { const sx = stat(b.sym); for (let i = 0; i < BUCKETS.length; i++) if (b.usd >= BUCKETS[i]) sx.c[i]++; if (b.usd > sx.top) sx.top = b.usd; }
  const vwap = b.usd / b.qty, zi = zoneAt(b.sym, vwap);
  let fe = null;
  if (b.usd >= FEED_MIN_USD) {
    fe = { t: b.first, sym: b.sym, side: b.side, usd: b.usd, price: vwap, zn: zi >= 0 && Z.list[zi] ? Z.list[zi].name : "", alert: "" };
    feed.unshift(fe); if (feed.length > 6000) feed.pop();
    try { feedInsert(fe); } catch {}
  }
  if (b.usd < L.min) return null;
  const win = STREAK_MIN * 60000, it = { t: b.first, usd: b.usd, price: vwap };
  let sk = st8.streak;
  if (sk && sk.side === b.side && b.first - sk.last <= win) { sk.count++; sk.usd += b.usd; sk.last = b.first; sk.list.push(it); if (sk.list.length > 8) sk.list.shift(); }
  else sk = st8.streak = { side: b.side, count: 1, usd: b.usd, last: b.first, list: [it] };
  const o = { sym: b.sym, t: b.first, side: b.side, usd: b.usd, price: vwap, zone: zi, count: sk.count, total: sk.usd, over: b.usd > L.max, max: L.max, alert: "—", list: sk.list.slice(), fe };
  big.unshift(o); if (big.length > 80) big.pop();
  for (const fn of listeners.big) fn(o);
  return o;
}

// Limpia segundos viejos (>16 min) del flujo.
export function gcSecs(now = Date.now()) {
  const cut = Math.floor((now - 960000) / 1000);
  ORDER.forEach((k) => S[k].secs.forEach((v, kk) => { if (kk < cut) S[k].secs.delete(kk); }));
}

export function addMeasuredMs(ms) { ORDER.forEach((k) => { stat(k).ms += ms; }); }

export function zoneCap(z, ms, pad) {
  const now = Date.now(), lo = Math.min(z.lo, z.hi) * (1 - pad), hi = Math.max(z.lo, z.hi) * (1 + pad);
  let c = 0, v = 0, n = 0;
  for (const o of feed) {
    if (now - o.t > ms) break;
    if (o.sym !== z.sym || o.price < lo || o.price > hi) continue;
    n++; if (o.side === "buy") c += o.usd; else v += o.usd;
  }
  return { ordenes: n, compras: Math.round(c), ventas: Math.round(v), neto: Math.round(c - v) };
}
