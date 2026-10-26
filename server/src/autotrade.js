// v4.37 · #auto-trade (Yasser, 26 oct 2026): prueba en papel de su idea "4H → 1H → entrada en 5 min", aparte de todo lo demás.
// REGLAS CONGELADAS (las mismas del backtest de 8 meses del 26 oct; no se cambian mirando resultados):
//   1) Sesgo 4H: cierre y EMA20 por encima de la EMA50 → solo compras; por debajo → solo ventas; mixto → nada.
//   2) Zona 1H: fair value gap (vela 1 y 3 sin tocarse), mínimo 0,05 % del precio, vale 48 h, se anula si una vela de 5 min cierra al otro lado.
//   3) Entrada 5 min: el precio toca la zona y, dentro de 1 hora, una vela de 5 min cierra rompiendo la vela anterior (a favor). Entra al cierre.
//   4) Stop: extremo del toque ± 0,05 %. Riesgo entre 0,15 % y 1,2 % (si no, se descarta).
//   5) Meta fija 1:2. Si en 24 h no toca nada, cierra al precio. Si en una vela toca stop y meta, cuenta stop.
//   6) Solo sesión de Nueva York (9:30 AM – 4:00 PM ET, lunes a viernes). Una operación abierta por mercado. Cada zona se usa una vez.
//   Medición: R bruto y R con comisión 0,1 % ida y vuelta. Vara: 50+ operaciones con R promedio (con comisión) > 0.
import { ENV, SYMS } from "./config.js";
import { klinesRaw } from "./binance.js";
import { botPostId, botFile, ensureChannel } from "./discord.js";
import { renderChart } from "./chart.js";
import { kvGet, kvSet } from "./store.js";
import { etParts, log } from "./util.js";

export const P = { minGap: 0.0005, life: 48, tapWin: 12, buf: 0.0005, minRisk: 0.0015, maxRisk: 0.012, m: 2, fee: 0.001, timeStop: 288 };
export const AT_SYMS = ["BTC", "SOL", "XAU"];
export const AT = { err: "", last: 0, chan: null };
const NM = { BTC: "BTC", SOL: "SOL", XAU: "Oro" };
const f = (v, sym) => Number(v).toLocaleString("en-US", { maximumFractionDigits: sym === "SOL" ? 2 : sym === "XAU" ? 2 : 0 });

const ema = (arr, n) => { const k = 2 / (n + 1); let e = null; return arr.map((v) => (e = e == null ? v : v * k + e * (1 - k))); };
// H4/H1/K5: [[t_apertura, o, h, l, c], …] solo velas cerradas.
export function biasSeries(H4) {
  const c = H4.map((b) => b[4]), e20 = ema(c, 20), e50 = ema(c, 50);
  return H4.map((b, i) => ({ t: b[0] + 14400000, v: i < 50 ? 0 : b[4] > e50[i] && e20[i] > e50[i] ? 1 : b[4] < e50[i] && e20[i] < e50[i] ? -1 : 0 }));
}
export function fvgZones(H1) {
  const z = [];
  for (let i = 2; i < H1.length; i++) {
    const a = H1[i - 2], c = H1[i], t = c[0] + 3600000;
    if (c[3] > a[2] && (c[3] - a[2]) / c[4] >= P.minGap) z.push({ side: 1, lo: a[2], hi: c[3], t });
    if (c[2] < a[3] && (a[3] - c[2]) / c[4] >= P.minGap) z.push({ side: -1, lo: c[2], hi: a[3], t });
  }
  return z;
}
// Recorre las velas de 5 min y devuelve todas las entradas que dispararían las reglas (sin filtrar por sesión).
export function scanEntries(K5, H1, H4) {
  const bias = biasSeries(H4), zones = fvgZones(H1), act = [], out = [];
  let bi = 0, zi = 0;
  for (let j = 1; j < K5.length; j++) {
    const b = K5[j], t = b[0];
    while (bi + 1 < bias.length && bias[bi + 1].t <= t) bi++;
    const bv = bias[bi] && bias[bi].t <= t ? bias[bi].v : 0;
    while (zi < zones.length && zones[zi].t <= t) act.push({ tap: null, ext: null, ...zones[zi++] });
    for (let k = act.length - 1; k >= 0; k--) {
      const z = act[k], buy = z.side > 0;
      if (t - z.t > P.life * 3600000 || (buy ? b[4] < z.lo : b[4] > z.hi)) { act.splice(k, 1); continue; }
      if (!z.tap) { if (buy ? b[3] <= z.hi : b[2] >= z.lo) { z.tap = j; z.ext = buy ? b[3] : b[2]; } continue; }
      z.ext = buy ? Math.min(z.ext, b[3]) : Math.max(z.ext, b[2]);
      if (j - z.tap > P.tapWin) { act.splice(k, 1); continue; }
      const trig = buy ? b[4] > K5[j - 1][2] : b[4] < K5[j - 1][3];
      if (!trig || bv !== z.side) continue;
      act.splice(k, 1);
      const e = b[4], sl = buy ? z.ext * (1 - P.buf) : z.ext * (1 + P.buf), R = Math.abs(e - sl);
      if (R / e < P.minRisk || R / e > P.maxRisk) continue;
      out.push({ side: z.side, t: t + 300000, e, sl, R, tp: e + z.side * P.m * R, zona: [z.lo, z.hi], zt: z.t });
    }
  }
  return out;
}
export function inNY(t) { const p = etParts(t), m = p.hour * 60 + p.minute; return !["Sat", "Sun"].includes(p.weekday) && m >= 570 && m < 960; }
// Resultado con las velas de 5 min posteriores a la entrada.
export function outcome(tr, K5after) {
  let n = 0;
  for (const b of K5after) {
    if (b[0] < tr.t) continue; n++;
    const buy = tr.side > 0, hs = buy ? b[3] <= tr.sl : b[2] >= tr.sl, ht = buy ? b[2] >= tr.tp : b[3] <= tr.tp;
    if (hs) return { how: "stop", exit: tr.sl, rb: -1, t_end: b[0] + 300000 };
    if (ht) return { how: "meta", exit: tr.tp, rb: P.m, t_end: b[0] + 300000 };
    if (n >= P.timeStop) return { how: "24 h", exit: b[4], rb: (buy ? b[4] - tr.e : tr.e - b[4]) / tr.R, t_end: b[0] + 300000 };
  }
  return null;
}
const netR = (tr, rb) => rb - (P.fee * tr.e) / tr.R;

const st = () => kvGet("autotrade", null) || { open: [], closed: [], seen: [] };
const save = (d) => { if (d.closed.length > 1000) d.closed.length = 1000; if (d.seen.length > 300) d.seen = d.seen.slice(-300); kvSet("autotrade", d); };
export function atRecord(d = st()) {
  const n = d.closed.length; if (!n) return "Primera operación cerrada";
  const w = d.closed.filter((x) => x.rb > 0).length, rb = d.closed.reduce((a, x) => a + x.rb, 0), rn = d.closed.reduce((a, x) => a + x.rn, 0);
  return "Récord Auto-Trade: " + w + " de " + n + " (" + Math.round((w / n) * 100) + "%) · R promedio " + (rn / n >= 0 ? "+" : "") + (rn / n).toFixed(2) + " con comisión (" + (rb / n >= 0 ? "+" : "") + (rb / n).toFixed(2) + " bruto) · faltan " + Math.max(0, 50 - n) + " para juzgar";
}

async function chan() {
  if (AT.chan) return AT.chan;
  const id = kvGet("autoTradeChannel", null) || (await ensureChannel("auto-trade", "Prueba en papel: sesgo 4H → FVG 1H → entrada 5 min · sesión NY · meta 1:2 · reglas congeladas", ENV.indicesChannelId));
  kvSet("autoTradeChannel", id); AT.chan = id; return id;
}
const kl = async (sym, iv, n, start) => (await klinesRaw(SYMS[sym].label, iv, n, start)).map((k) => [k[0], +k[1], +k[2], +k[3], +k[4]]);

async function postEntry(sym, tr) {
  const c = await chan(), buy = tr.side > 0;
  const txt = "🤖 **AUTO-TRADE · " + (buy ? "COMPRA " : "VENTA ") + NM[sym] + "** · " + f(tr.e, sym) +
    "\n🛑 Stop " + f(tr.sl, sym) + " (" + ((tr.R / tr.e) * 100).toFixed(2) + "%) · 🎯 Meta " + f(tr.tp, sym) + " (1:" + P.m + ")" +
    "\nSesgo 4H " + (buy ? "alcista" : "bajista") + " · FVG 1H " + f(tr.zona[0], sym) + " – " + f(tr.zona[1], sym) + " · entrada en 5 min" +
    "\n-# Prueba en papel con reglas fijas. No es una orden. " + atRecord();
  tr.msgId = await botPostId(c, txt);
  try {
    const g = await renderChart({ mercado: sym === "XAU" ? "ORO" : sym, tf: "5m", lado: buy ? "compra" : "venta", entrada: tr.e, stop: tr.sl, meta: tr.tp, zona: tr.zona }, { zonas: [] });
    await botFile(c, g.png, "auto-trade.png", "", tr.msgId);
  } catch (e) { log("Auto-Trade gráfica:", e.message); }
}
async function postClose(sym, tr, d) {
  const c = await chan(), ok = tr.rb > 0;
  const txt = (ok ? "✅ **Ganó** " : tr.how === "24 h" ? "⏳ **Cerró a las 24 h** " : "❌ **Tocó el stop** ") + NM[sym] + " · salida " + f(tr.exit, sym) +
    "\nResultado " + (tr.rb >= 0 ? "+" : "") + tr.rb.toFixed(2) + "R bruto · " + (tr.rn >= 0 ? "+" : "") + tr.rn.toFixed(2) + "R con comisión\n📊 " + atRecord(d);
  await botPostId(c, txt, tr.msgId).catch(() => botPostId(c, txt));
}

// Cada vela de 5 min: revisa las abiertas y, en sesión NY, busca entradas nuevas en la vela que acaba de cerrar.
export async function atTick(now = Date.now()) {
  if (kvGet("autoTradeOff", false) || !ENV.botToken) return;
  const barClose = Math.floor(now / 300000) * 300000;
  if (now - barClose < 15000 || AT.last === barClose) return;
  AT.last = barClose;
  const d = st();
  try {
    for (let i = d.open.length - 1; i >= 0; i--) {
      const tr = d.open[i], K = (await kl(tr.sym, "5m", 300, tr.t)).filter((b) => b[0] + 300000 <= barClose);
      const o = outcome(tr, K); if (!o) continue;
      Object.assign(tr, o); tr.rn = netR(tr, tr.rb);
      d.open.splice(i, 1); d.closed.unshift(tr); save(d);
      await postClose(tr.sym, tr, d);
    }
    if (!inNY(barClose)) { AT.err = ""; return; }
    for (const sym of AT_SYMS) {
      if (d.open.some((x) => x.sym === sym)) continue;
      const [K5, H1, H4] = await Promise.all([kl(sym, "5m", 900), kl(sym, "1h", 80), kl(sym, "4h", 150)]);
      const closed = (a, ms) => a.filter((b) => b[0] + ms <= barClose);
      const ent = scanEntries(closed(K5, 300000), closed(H1, 3600000), closed(H4, 14400000)).filter((x) => x.t === barClose && inNY(x.t));
      const tr = ent[0]; if (!tr) continue;
      const id = sym + "|" + tr.zt + "|" + tr.side;
      if (d.seen.includes(id)) continue;
      d.seen.push(id); Object.assign(tr, { id, sym }); d.open.push(tr); save(d);
      await postEntry(sym, tr); save(d);
    }
    AT.err = "";
  } catch (e) { AT.err = e.message; log("Auto-Trade:", e.message); }
}
export function atEstado() {
  const d = st();
  return (AT.err ? "⚠️" : "✅") + " Auto-Trade (4H→1H→5m, NY, 1:2): " + d.open.length + " abiertas · " + atRecord(d) + (AT.err ? " · error: " + AT.err : "");
}
export async function atStart() { try { await chan(); } catch (e) { AT.err = e.message; log("Auto-Trade canal:", e.message); } }
