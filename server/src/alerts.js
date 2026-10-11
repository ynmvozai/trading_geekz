// Alertas a Discord: órdenes grandes en/cerca de zona, vigilancia de zonas, señales Ai Crypto.
import { ENV, NAMES, SYMS, WATCH } from "./config.js";
import { post } from "./discord.js";
import { S, on } from "./market.js";
import { Z, nearZone, nearR, proxNear, prox, zDist, zkey } from "./zones.js";
import { kvGet, kvSet, feedSetAlert } from "./store.js";
import { usd, px, sideEs, prParts } from "./util.js";
import { recordAlert } from "./results.js";
import { sentFor, emoji } from "./sentiment.js";
import { sesMirror } from "./sesionny.js";
import { dot, lado, espera, quien, rango, niveles, empuje, animo, animoTag } from "./friendly.js";

export const A = { paused: false, sent: 0, failed: 0, last: null, lastErr: "" };
export const hookOf = (sym) => (SYMS[sym].ch === "oro" ? ENV.hooks.oro : ENV.hooks.crypto);

export function initAlerts() {
  A.paused = !!kvGet("paused", false);
  A.last = kvGet("lastAlert", null);
  sim.open = (kvGet("sim", null) || {}).open || [];
  sim.closed = (kvGet("sim", null) || {}).closed || [];
  on("big", onBig);
  on("trade", (sym, p, T) => { if (sim.open.length) simCheck(sym, p, T); });
}
export function setPaused(v) { A.paused = v; kvSet("paused", v); }

function setAlert(o, t) { o.alert = t; if (o.fe) { o.fe.alert = t; try { feedSetAlert(o.fe); } catch {} } }

function onBig(o) {
  if (o.zone >= 0) simOpen(o, o.zone);
  const nz = o.zone < 0 ? nearZone(o.sym, o.price) : null;
  if (nz && nz.d <= nearR(o.sym) / 100) o.near = nz;
  if (o.zone < 0 && !o.near) { setAlert(o, "fuera de zona"); return; }
  const z = Z.list[o.zone >= 0 ? o.zone : o.near.i];
  recordAlert({ t: o.t, sym: o.sym, kind: o.zone >= 0 ? "orden_en_zona" : "orden_cerca", z, order_side: o.side, entry: o.price, prox: o.zone >= 0 ? 100 : proxNear(o.sym, o.near.d), usd: o.usd });
  if (A.paused) { setAlert(o, "pausada"); return; }
  const hk = hookOf(o.sym);
  if (!hk) { setAlert(o, "falta el webhook"); return; }
  setAlert(o, "en cola");
  post(hk, buildMessage(o))
    .then(() => { sesMirror(mirrorLine(o, z)); setAlert(o, "enviada"); A.sent++; A.last = { t: Date.now(), txt: o.sym + " " + sideEs(o.side) + " " + usd(o.usd) }; kvSet("lastAlert", A.last); })
    .catch((e) => { setAlert(o, "falló"); A.failed++; A.lastErr = e.message; });
}

export function buildMessage(o) {
  const y = o.sym, inZ = o.zone >= 0, z = inZ ? Z.list[o.zone] : o.near ? Z.list[o.near.i] : null;
  const name = NAMES[y] || y, f = (v) => px(v, y);
  const L = [inZ ? "🔥 **" + name + " · EN LA ZONA**" : z ? "📍 **" + name + " · CERCA DE ZONA (" + proxNear(y, o.near.d).toFixed(0) + "%)**" : "🐋 **" + name + "**"];
  L.push("🐋 Orden grande: " + quien(o.side) + " **" + usd(o.usd) + "** a " + f(o.price) + (o.count >= 2 ? " · " + o.count + " seguidas (" + usd(o.total) + ")" : ""));
  if (z) {
    L.push("🎯 Zona de " + lado(z.side) + " " + rango(z, f) + " → " + espera(z.side));
    const n = niveles(z, f); if (n) L.push(n);
    L.push(empuje(o.side, z.side));
    const a = animo(z.side, y); if (a) L.push(a);
  }
  L.push("_Tú validas la entrada._");
  return { content: L.join("\n") };
}
export function mirrorLine(o, z) {
  const f = (v) => px(v, o.sym);
  return (o.zone >= 0 ? "🔥 " : "📍 ") + "**" + (NAMES[o.sym] || o.sym) + "** · " + quien(o.side).toLowerCase() + " " + usd(o.usd) + " a " + f(o.price) + " · " + (o.zone >= 0 ? "en" : "cerca de") + " zona de " + lado(z.side).toLowerCase() + " " + rango(z, f) + (o.side === z.side ? " ✅" : " ⚠️");
}

// ---------- Vigilancia de zonas ----------
const watchState = {};
export function pbar(v) { const n = Math.round(v / 10); return "▰".repeat(n) + "▱".repeat(10 - n); }
export function watchLine(z, p) {
  const v = prox(z, p), f = (x) => px(x, z.sym);
  return dot(v) + " **" + (NAMES[z.sym] || z.sym) + "** " + lado(z.side).toLowerCase() + " " + rango(z, f) + " · " + (v >= 100 ? "**EN LA ZONA**" : "**" + v.toFixed(0) + "%**") + " · precio " + f(p) + (z.tp1 ? " · TP1 " + f(z.tp1) : "") + animoTag(z.side, z.sym);
}
export function watchText(syms, title) {
  const ls = [];
  Z.list.forEach((z) => {
    if (!syms.includes(z.sym)) return;
    const p = S[z.sym].price; if (!p) return;
    if (zDist(z, p) * 100 > WATCH[z.sym]) return; // solo zonas dentro del % de vigilancia
    ls.push({ v: prox(z, p), t: watchLine(z, p) });
  });
  if (!ls.length) {
    const any = Z.list.some((z) => syms.includes(z.sym));
    return "**" + title + "**\n" + (any ? "Todo tranquilo: ninguna zona cerca del precio ahora." : "Sin zonas cargadas. Pídele a TITO \"actualiza zonas\".");
  }
  ls.sort((a, b) => b.v - a.v);
  const s = sentFor(syms[0]);
  return ("**" + title + "**" + (s ? " · " + emoji(s.v) + " ánimo " + s.v + " " + s.label : "") + "\n" + ls.slice(0, 6).map((x) => x.t).join("\n") + "\n_% = qué tan cerca está el precio (100% = dentro). ✅/⚠️ = ánimo a favor/en contra._").slice(0, 1990);
}
export function zoneAlert(z, p, f) {
  const v = prox(z, p), name = NAMES[z.sym] || z.sym, L = [];
  L.push(v >= 100 ? "🎯 **" + name + " entró a la zona de " + lado(z.side) + "**" : "🔥 **" + name + " se acerca a la zona de " + lado(z.side) + " (" + v.toFixed(0) + "%)**");
  L.push("Zona " + rango(z, f) + " · precio " + f(p) + " → " + espera(z.side));
  const n = niveles(z, f); if (n) L.push(n);
  const a = animo(z.side, z.sym); if (a) L.push(a);
  L.push("_Tú validas la entrada._");
  return L.join("\n");
}
export function watchAll() {
  if (A.paused) return;
  if (ENV.hooks.crypto) post(ENV.hooks.crypto, watchText(["BTC", "SOL"], "🎯 Zonas en vigilancia · Crypto")).catch(() => {});
  if (ENV.hooks.oro) post(ENV.hooks.oro, watchText(["XAU"], "🎯 Zonas en vigilancia · Oro")).catch(() => {});
}
export function watchTick() {
  const pp = prParts(), key = pp.date + "T" + pp.hour;
  if (pp.hour >= 6 && pp.hour <= 22 && pp.minute < 2 && kvGet("watchHour") !== key) { kvSet("watchHour", key); watchAll(); }
  Z.list.forEach((z) => {
    const p = S[z.sym].price; if (!p) return;
    const v = prox(z, p), lvl = v >= 100 ? 2 : v >= 80 ? 1 : 0, k = zkey(z), st = watchState[k];
    if (!st) { watchState[k] = { lvl, t: 0 }; return; }
    if (lvl > st.lvl && Date.now() - st.t > 1800000) {
      if (lvl === 2) recordAlert({ t: Date.now(), sym: z.sym, kind: "precio_en_zona", z, entry: p, prox: 100 });
      const hk = hookOf(z.sym);
      if (hk && !A.paused) post(hk, zoneAlert(z, p, (x) => px(x, z.sym))).catch(() => {});
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
  if (!z || z.grade !== "A++" || o.side !== z.side) return;
  if (sim.open.some((t) => t.sym === o.sym && t.zname === z.name && t.lo === z.lo)) return;
  const e = o.price, R = Math.abs(e - z.sl);
  if (!(R > 0)) return;
  if (z.side === "sell" && !(z.sl > e && z.tp1 < e)) return;
  if (z.side === "buy" && !(z.sl < e && z.tp1 > e)) return;
  const t = { id: o.t + o.sym, sym: o.sym, side: z.side, zname: z.name, lo: z.lo, entry: e, sl: z.sl, tp: z.tp1, t: o.t, usd: o.usd, R };
  sim.open.push(t); storeSim();
  const f = (v) => px(v, t.sym);
  simPost("🤖 **Ai Crypto · Señal: " + (t.side === "buy" ? "COMPRAR " : "VENDER ") + (NAMES[t.sym] || t.sym) + "** a " + f(e) + "\nSL " + f(t.sl) + " · TP " + f(t.tp) + " · riesgo 1 : " + (Math.abs(t.tp - e) / R).toFixed(1) + " · gatillo: orden de " + usd(o.usd) + "\n_Señal con precio real, sin ejecutar. Tú decides._");
}
function simCheck(sym, p, T) {
  for (let i = sim.open.length - 1; i >= 0; i--) {
    const t = sim.open[i]; if (t.sym !== sym) continue;
    const hitSL = t.side === "sell" ? p >= t.sl : p <= t.sl, hitTP = t.side === "sell" ? p <= t.tp : p >= t.tp;
    if (!hitSL && !hitTP) continue;
    t.out = hitSL ? "SL" : "TP"; t.exit = hitSL ? t.sl : t.tp; t.r = hitSL ? -1 : Math.abs(t.tp - t.entry) / t.R; t.end = T;
    sim.open.splice(i, 1); sim.closed.unshift(t); storeSim();
    simPost((hitSL ? "🔴 **Ai Crypto · tocó SL**" : "🟢 **Ai Crypto · llegó al TP**") + " · " + (NAMES[t.sym] || t.sym) + " " + px(t.entry, t.sym) + " → " + px(t.exit, t.sym) + " · " + (t.r >= 0 ? "+" : "") + t.r.toFixed(1) + "R\n📊 " + simStats());
  }
}
export function simStats() {
  const n = sim.closed.length, w = sim.closed.filter((t) => t.r > 0).length, r = sim.closed.reduce((a, t) => a + t.r, 0);
  return n ? n + " operaciones cerradas · " + Math.round(w / n * 100) + "% ganadoras · total " + (r >= 0 ? "+" : "") + r.toFixed(1) + "R" + (sim.open.length ? " · " + sim.open.length + " abiertas" : "")
    : "Sin operaciones cerradas todavía" + (sim.open.length ? " · " + sim.open.length + " abiertas" : "") + ".";
}
