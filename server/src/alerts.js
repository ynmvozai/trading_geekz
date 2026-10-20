// Alertas a Discord: órdenes grandes en/cerca de zona, vigilancia de zonas, señales Ai Crypto.
import { ENV, NAMES, SYMS, WATCH } from "./config.js";
import { post } from "./discord.js";
import { S, on } from "./market.js";
import { Z, nearZone, nearR, proxNear, prox, zDist, zkey, isBroken, checkBroken } from "./zones.js";
import { againstBias, biasOf, minStop } from "./bias.js";
import { kvGet, kvSet, feedSetAlert } from "./store.js";
import { usd, px, sideEs, prParts } from "./util.js";
import { recordAlert } from "./results.js";
import { sesMirror, inWindow } from "./sesionny.js";
import { pf, dot, cerca, lado, ladoMin, flecha, espera, rango, niveles, empuje, animo } from "./friendly.js";
import { sizeLine, nivelesMedidos, measuredStop, FEE_RT } from "./risk.js";

export const A = { paused: false, sent: 0, failed: 0, last: null, lastErr: "" };
export const hookOf = (sym) => (SYMS[sym].ch === "oro" ? ENV.hooks.oro : ENV.hooks.crypto);

export function initAlerts() {
  A.paused = !!kvGet("paused", false);
  A.last = kvGet("lastAlert", null);
  sim.open = (kvGet("sim", null) || {}).open || [];
  sim.closed = (kvGet("sim", null) || {}).closed || [];
  on("big", onBig);
  on("trade", (sym, p, T) => {
    if (sim.open.length) simCheck(sym, p, T);
    for (const { z, stop } of checkBroken(sym, p, T)) brokenPost(z, stop, p);
  });
}
export function setPaused(v) { A.paused = v; kvSet("paused", v); }

function setAlert(o, t) { o.alert = t; if (o.fe) { o.fe.alert = t; try { feedSetAlert(o.fe); } catch {} } }

// Varias órdenes grandes del mismo lado en la misma zona en 2 min = un solo mensaje + un "siguen…" al final.
const GROUP_MS = 120000, groups = new Map();
function onBig(o) {
  const nz = o.zone < 0 ? nearZone(o.sym, o.price) : null;
  if (nz && nz.d <= nearR(o.sym) / 100) o.near = nz;
  if (o.zone < 0 && !o.near) { setAlert(o, "fuera de zona"); return; }
  const z = Z.list[o.zone >= 0 ? o.zone : o.near.i];
  // v4.3: cuenta como señal solo si la orden empuja a favor de la zona y la zona no va contra el sesgo.
  o.noCuenta = o.side !== z.side ? "la orden va en contra de la zona" : againstBias(o.sym, z.side) ? "va contra el sesgo (" + biasOf(o.sym).toLowerCase() + " mandan)" : "";
  if (!o.noCuenta) recordAlert({ t: o.t, sym: o.sym, kind: o.zone >= 0 ? "orden_en_zona" : "orden_cerca", z, order_side: o.side, entry: o.price, prox: o.zone >= 0 ? 100 : proxNear(o.sym, o.near.d), usd: o.usd });
  if (A.paused) { setAlert(o, "pausada"); return; }
  if (o.zone >= 0 && !o.noCuenta) simOpen(o, o.zone);   // v4.27 (Yasser): Ai Crypto vuelve a operar en práctica
  // v4.27 (Yasser, menos ruido): las ballenas de BTC/SOL ya no salen una por una en #sesion-ny; van en el resumen de cada hora.
  // Oro → #oro-índice (siempre), igual que antes.
  const hk = o.sym === "XAU" ? ENV.hooks.oro : null;
  if (!hk) { setAlert(o, "resumen horario"); return; }
  const gk = o.sym + "|" + o.side + "|" + zkey(z), g = groups.get(gk), now = Date.now();
  if (g && now - g.t < GROUP_MS) {
    g.n++; g.usd += o.usd; g.price = o.price; setAlert(o, "agrupada");
    if (!g.timer) g.timer = setTimeout(() => flushGroup(gk, hk), g.t + GROUP_MS - now);
    return;
  }
  groups.set(gk, { t: now, n: 0, usd: 0, price: o.price, timer: null, sym: o.sym, side: o.side });
  setAlert(o, "en cola");
  const msg = buildMessage(o);
  (hk ? post(hk, msg) : Promise.resolve())
    .then(() => { setAlert(o, "enviada"); A.sent++; A.last = { t: Date.now(), txt: o.sym + " " + sideEs(o.side) + " " + usd(o.usd) }; kvSet("lastAlert", A.last); })
    .catch((e) => { setAlert(o, "falló"); A.failed++; A.lastErr = e.message; });
}
function flushGroup(gk, hk) {
  const g = groups.get(gk); if (!g) return;
  g.timer = null;
  if (!g.n) return;
  const txt = "➕ " + (NAMES[g.sym] || g.sym) + ": siguen " + (g.side === "buy" ? "COMPRANDO" : "VENDIENDO") + " · +" + usd(g.usd) + " en " + g.n + (g.n === 1 ? " orden más" : " órdenes más") + " · " + pf(g.price, g.sym);
  groups.set(gk, { ...g, t: Date.now(), n: 0, usd: 0 });
  if (A.paused) return;
  if (hk) post(hk, txt).then(() => A.sent++).catch(() => {});
}

function brokenPost(z, stop, p) {
  const f = (v) => pf(v, z.sym), name = NAMES[z.sym] || z.sym;
  const txt = "❌ " + name + ": se rompió la zona de " + lado(z.side) + " " + rango(z, f) + "\nEl precio pasó el stop (" + f(stop) + ") · ahora " + px(p, z.sym) + ". Ya no se vigila ni cuenta señales." +
    "\n-# Si el precio vuelve y la respeta, puede servir como zona de " + (z.side === "sell" ? "compra" : "venta") + ".";
  if (!A.paused) sesMirror(txt);   // v4.23: solo #sesion-ny (pasa poco: se deja)
}

// v4.22 · Decisión de Yasser (13 oct 2026): las alertas de zona son INFORMACIÓN, no señal de entrada.
// En 12 meses de datos (estudio, Fases 2–8) entrar en el borde de las zonas no mostró ventaja después de comisión.
export const INFO_FOOT = "-# ℹ️ Información, no señal de entrada: en 12 meses de datos las zonas no mostraron ventaja.";
export function buildMessage(o) {
  const y = o.sym, inZ = o.zone >= 0, z = inZ ? Z.list[o.zone] : o.near ? Z.list[o.near.i] : null;
  const name = NAMES[y] || y, f = (v) => pf(v, y);
  const L = ["ℹ️ INFO · 🐋 " + name + ": ballena " + (o.side === "buy" ? "COMPRÓ " : "VENDIÓ ") + usd(o.count >= 2 ? o.total : o.usd) + (o.count >= 2 ? " en " + o.count + " órdenes" : "") + " · " + f(o.price)];
  if (z) {
    const where = inZ ? "Dentro de zona de " + lado(z.side) : "Cerca de zona de " + lado(z.side) + " (" + proxNear(y, o.near.d).toFixed(0) + "%)";
    L.push(o.side === z.side ? where + " → " + empuje(o.side, z.side) : where + "\n" + empuje(o.side, z.side));
    const n = nivelesMedidos(y, z, f) || niveles(z, f); if (n) L.push(n);   // v4.21: stop medido
    if (o.side === z.side) { const sz = sizeLine(y, z, f); if (sz) L.push(sz); }   // v4.19: tamaño solo si la orden empuja a favor
    const a = animo(z.side, y); if (a) L.push(a);
    L.push(INFO_FOOT + (o.noCuenta ? " · " + o.noCuenta + "." : ""));   // v4.22: todas son información
  }
  return { content: L.join("\n") };
}
export function mirrorLine(o, z) {
  const f = (v) => pf(v, o.sym);
  return "🐋 " + (NAMES[o.sym] || o.sym) + ": ballena " + (o.side === "buy" ? "compró " : "vendió ") + usd(o.usd) + " · " + f(o.price) + " · " + (o.zone >= 0 ? "dentro de" : "cerca de") + " zona de " + ladoMin(z.side) + (o.side === z.side ? " ✅" : " ⚠️");
}

// ---------- Vigilancia de zonas ----------
const watchState = {};
export function pbar(v) { const n = Math.round(v / 10); return "▰".repeat(n) + "▱".repeat(10 - n); }
export function watchLine(z, p) {
  const v = prox(z, p), f = (x) => pf(x, z.sym);
  return dot(v) + " " + (NAMES[z.sym] || z.sym) + " → " + ladoMin(z.side) + " " + rango(z, f) + " · " + cerca(v);
}
// Resumen de cada hora: solo zonas a medio camino o más. Devuelve "" si no hay nada que contar.
export function watchText(syms, title) {
  const ls = [];
  Z.list.forEach((z) => {
    if (!syms.includes(z.sym) || isBroken(z)) return;
    const p = S[z.sym].price; if (!p) return;
    const v = prox(z, p); if (v < 50) return;
    ls.push({ v, t: watchLine(z, p) });
  });
  if (!ls.length) return "";
  ls.sort((a, b) => b.v - a.v);
  const pp = prParts(), h = pp.hour % 12 || 12;
  return ("⏰ " + title + " · " + h + ":00 " + (pp.hour < 12 ? "AM" : "PM") + "\n" + ls.slice(0, 6).map((x) => x.t).join("\n")).slice(0, 1990);
}
export function watchAll() {
  return;   // v4.23: los tableros por hora ya no salen en #cryptoman ni #oro-índice (#sesion-ny tiene los suyos)
  if (A.paused) return;
  const c = watchText(["BTC", "SOL"], "Crypto"), g = watchText(["XAU"], "Oro");
  if (c && ENV.hooks.crypto) post(ENV.hooks.crypto, c).catch(() => {});
  if (g && ENV.hooks.oro) post(ENV.hooks.oro, g).catch(() => {});
}
export function zoneAlert(z, p) {
  const v = prox(z, p), name = NAMES[z.sym] || z.sym, f = (x) => pf(x, z.sym), L = [];
  if (v >= 100) { L.push("ℹ️ INFO · " + flecha(z.side) + " " + name + " entró a zona de " + lado(z.side) + " · " + px(p, z.sym)); L.push(espera(z.side) + " · zona " + rango(z, f)); }
  else { L.push("ℹ️ INFO · " + flecha(z.side) + " " + name + " cerca de zona de " + lado(z.side) + " · " + px(p, z.sym)); L.push("Falta poco (" + v.toFixed(0) + "%) · zona " + rango(z, f)); }
  const n = nivelesMedidos(z.sym, z, f) || niveles(z, f); if (n) L.push(n);   // v4.21: stop medido
  const sz = sizeLine(z.sym, z, f); if (sz) L.push(sz);   // v4.19
  const a = animo(z.side, z.sym); if (a) L.push(a);
  L.push(INFO_FOOT);
  return L.join("\n");
}
export function watchTick() {
  const pp = prParts(), key = pp.date + "T" + pp.hour;
  if (pp.hour >= 6 && pp.hour <= 22 && pp.minute < 2 && kvGet("watchHour") !== key) { kvSet("watchHour", key); watchAll(); }
  Z.list.forEach((z) => {
    const p = S[z.sym].price; if (!p || isBroken(z)) return;
    const v = prox(z, p), lvl = v >= 100 ? 2 : v >= 80 ? 1 : 0, k = zkey(z), st = watchState[k];
    if (!st) { watchState[k] = { lvl, t: 0 }; return; }
    if (lvl > st.lvl && Date.now() - st.t > 1800000) {
      if (lvl === 2 && !againstBias(z.sym, z.side)) recordAlert({ t: Date.now(), sym: z.sym, kind: "precio_en_zona", z, entry: p, prox: 100 });
      // v4.23: el aviso de zona sale solo en #sesion-ny (sesionny.js), no en #cryptoman ni #oro-índice.
      st.t = Date.now();
    }
    st.lvl = lvl;
  });
}

// ---------- Ai Crypto: señales con precio real (sin ejecutar) ----------
export const sim = { open: [], closed: [] };
function storeSim() { if (sim.closed.length > 500) sim.closed.length = 500; kvSet("sim", sim); }
function simPost(txt) { if (ENV.hooks.aicrypto && !A.paused) post(ENV.hooks.aicrypto, txt).catch(() => {}); }
function simOpen(o, zi) {
  const z = Z.list[zi];
  if (!z || z.grade !== "A++" || o.side !== z.side || isBroken(z) || againstBias(o.sym, z.side)) return;
  if (sim.open.some((t) => t.sym === o.sym && t.zname === z.name && t.lo === z.lo)) return;
  // v4.27: stop medido (Fase 7: borde lejano + margen) en lugar del stop de la zona, y comisión 0,1 % en el resultado.
  const e = o.price, sl = measuredStop(o.sym, z.side, z.lo, z.hi) ?? z.sl, R = Math.abs(e - sl);
  if (!(R > 0) || R < minStop(o.sym, e)) return;      // stop demasiado pegado: el ruido normal lo toca
  if (z.side === "sell" && !(sl > e && z.tp1 < e)) return;
  if (z.side === "buy" && !(sl < e && z.tp1 > e)) return;
  const t = { id: o.t + o.sym, sym: o.sym, side: z.side, zname: z.name, lo: z.lo, entry: e, sl, tp: z.tp1, t: o.t, usd: o.usd, R, fee: (FEE_RT * e) / R };
  sim.open.push(t); storeSim();
  const f = (v) => pf(v, t.sym), k = Math.abs(t.tp - e) / R;
  simPost("🤖 Señal Ai: " + (t.side === "buy" ? "COMPRAR " : "VENDER ") + (NAMES[t.sym] || t.sym) + " · " + f(e) + "\n🛑 Stop " + f(t.sl) + " · 🎯 Meta " + f(t.tp) + "\nPuede ganar " + k.toFixed(1) + " veces lo que arriesga · práctica, no se ejecuta");
}
function simCheck(sym, p, T) {
  for (let i = sim.open.length - 1; i >= 0; i--) {
    const t = sim.open[i]; if (t.sym !== sym) continue;
    const hitSL = t.side === "sell" ? p >= t.sl : p <= t.sl, hitTP = t.side === "sell" ? p <= t.tp : p >= t.tp;
    if (!hitSL && !hitTP) continue;
    t.out = hitSL ? "SL" : "TP"; t.exit = hitSL ? t.sl : t.tp; t.r = (hitSL ? -1 : Math.abs(t.tp - t.entry) / t.R) - (t.fee || 0); t.end = T;
    sim.open.splice(i, 1); sim.closed.unshift(t); storeSim();
    simPost((hitSL ? "❌ Señal Ai tocó el stop: " + (NAMES[t.sym] || t.sym) + "\nResultado " + t.r.toFixed(2) + "R (con comisión)" : "✅ Señal Ai ganó: " + (NAMES[t.sym] || t.sym) + " llegó a la meta\nResultado +" + t.r.toFixed(2) + "R (con comisión)") + "\n📊 " + simRecord());
  }
}
export function simRecord() {
  const n = sim.closed.length, w = sim.closed.filter((t) => t.r > 0).length;
  const r = sim.closed.reduce((a, t) => a + t.r, 0);
  return n ? "Récord: " + w + " de " + n + " ganadas (" + Math.round(w / n * 100) + "%) · R promedio " + (r / n >= 0 ? "+" : "") + (r / n).toFixed(2) + " · vara: 50+ con R promedio > 0" : "Primera señal cerrada";
}
export function simStats() {
  const n = sim.closed.length, w = sim.closed.filter((t) => t.r > 0).length, r = sim.closed.reduce((a, t) => a + t.r, 0);
  return n ? n + " operaciones cerradas · " + Math.round(w / n * 100) + "% ganadoras · total " + (r >= 0 ? "+" : "") + r.toFixed(1) + "R" + (sim.open.length ? " · " + sim.open.length + " abiertas" : "")
    : "Sin operaciones cerradas todavía" + (sim.open.length ? " · " + sim.open.length + " abiertas" : "") + ".";
}
