// Alertas a Discord: órdenes grandes en/cerca de zona, vigilancia de zonas, señales Ai Crypto.
import { ENV, NAMES, SYMS, WATCH } from "./config.js";
import { post } from "./discord.js";
import { S, flow, on } from "./market.js";
import { Z, nearZone, nearR, proxNear, prox, zDist, zkey } from "./zones.js";
import { kvGet, kvSet, feedSetAlert } from "./store.js";
import { usd, px, hhmmss, sideEs, fullPR, prParts } from "./util.js";
import { recordAlert } from "./results.js";
import { sentFor, sentRead, sentLine } from "./sentiment.js";
import { sesMirror } from "./sesionny.js";

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
    .then(() => { sesMirror((o.zone >= 0 ? "🔥 **HOT ZONE** · " : "📍 **CERCA DE ZONA** · ") + (NAMES[o.sym] || o.sym) + " · " + (o.side === "buy" ? "🟢 compra agresiva " : "🔴 venta agresiva ") + usd(o.usd) + " a " + px(o.price, o.sym) + " · " + (z.side === "buy" ? "zona de compra " : "zona de venta ") + z.name + " " + px(Math.min(z.lo, z.hi), o.sym) + " – " + px(Math.max(z.lo, z.hi), o.sym) + (z.sl ? " · SL " + px(z.sl, o.sym) : "") + (z.tp1 ? " · TP1 " + px(z.tp1, o.sym) : "")); setAlert(o, "enviada"); A.sent++; A.last = { t: Date.now(), txt: o.sym + " " + sideEs(o.side) + " " + usd(o.usd) }; kvSet("lastAlert", A.last); })
    .catch((e) => { setAlert(o, "falló"); A.failed++; A.lastErr = e.message; });
}

export function buildMessage(o) {
  const z = o.zone >= 0 ? Z.list[o.zone] : null, st = o.zone >= 0 ? Z.state[o.zone] : null, f = flow(o.sym, 300000, o.t), y = o.sym;
  const nzz = o.near ? Z.list[o.near.i] : null, hot = o.count >= 2;
  const pr = o.near ? proxNear(y, o.near.d) : 0;
  const title = (z ? "HOT ZONE" : nzz ? "CERCA DE ZONA (" + pr.toFixed(2) + "%)" : "ORDEN GRANDE") + " · " + y + " · " + sideEs(o.side) + " " + usd(o.usd);
  const fields = [
    { name: "Dinero de esta orden", value: usd(o.usd) + (o.over ? " (sobre el máximo de " + usd(o.max) + ")" : ""), inline: true },
    { name: "Precio", value: px(o.price, y), inline: true },
    { name: "Racha del mismo lado", value: o.count + (o.count === 1 ? " orden" : " órdenes seguidas") + " · " + usd(o.total), inline: true },
    { name: o.list.length > 1 ? "Las " + o.list.length + " órdenes de la racha" : "Orden", value: o.list.map((x, n) => (n + 1) + ". " + hhmmss(x.t) + " · " + usd(x.usd) + " · " + px(x.price, y)).join("\n"), inline: false },
    { name: "Flujo últimos 5 min", value: "Compras " + usd(f.buy) + " · Ventas " + usd(f.sell) + " · Neto " + usd(f.net), inline: false },
  ];
  if (nzz) {
    const lo = Math.min(nzz.lo, nzz.hi), hi = Math.max(nzz.lo, nzz.hi);
    fields.push({ name: "Zona más cercana", value: nzz.name + " " + (nzz.grade || "") + " · " + px(lo, y) + " – " + px(hi, y) + " · se espera que " + (nzz.side === "buy" ? "SUBA" : "BAJE") +
      " · proximidad " + pr.toFixed(2) + "% (100% = en la zona, 0% = a " + nearR(y) + "% de distancia) · " + (o.near.d * 100).toFixed(3) + "% del precio (" + px(Math.abs(o.price - (o.price < lo ? lo : hi)), y) + " de distancia)", inline: false });
  }
  if (z) {
    fields.push({ name: "Zona", value: z.name + " · " + px(z.lo, y) + " – " + px(z.hi, y) + " · esperas " + (z.side === "buy" ? "compra" : "venta"), inline: false });
    if (st) fields.push({ name: "Dinero dentro de la zona", value: "Compras " + usd(st.buy) + " · Ventas " + usd(st.sell), inline: false });
    fields.push({ name: "SL / TP1 / TP2", value: px(z.sl, y) + " / " + px(z.tp1, y) + " / " + px(z.tp2, y), inline: false });
  }
  const zz = z || nzz;
  if (zz) {
    const s = sentFor(y);
    fields.push({ name: "Sentimiento · Fear & Greed" + (y === "XAU" ? " (acciones EE. UU., referencia)" : " (crypto)"), value: (s ? sentLine(s) + "\n" : "") + sentRead(zz.side, s).txt, inline: false });
  }
  return {
    content: title + (hot ? " · racha de " + o.count : ""),
    embeds: [{ title, color: o.side === "buy" ? 0x3ecf8e : 0xf26d6d, fields, footer: { text: "Binance futuros " + SYMS[y].label + " · " + fullPR(o.t) + " · validar en tu gráfico" } }],
  };
}

// ---------- Vigilancia de zonas ----------
const watchState = {};
export function pbar(v) { const n = Math.round(v / 10); return "▰".repeat(n) + "▱".repeat(10 - n); }
export function watchLine(z, p) {
  const v = prox(z, p), d = zDist(z, p) * 100;
  return (v >= 100 ? "🎯" : v >= 80 ? "🔥" : v >= 50 ? "🟡" : "⚪") + " **" + (NAMES[z.sym] || z.sym) + " · " + z.name + " " + (z.grade || "") + "** · " + (z.side === "buy" ? "compra · se espera que SUBA" : "venta · se espera que BAJE") +
    "\n   " + px(Math.min(z.lo, z.hi), z.sym) + " – " + px(Math.max(z.lo, z.hi), z.sym) + " · precio " + px(p, z.sym) + " · " + (v >= 100 ? "EN LA ZONA" : "a " + d.toFixed(2) + "%") +
    "\n   " + pbar(v) + " **" + v.toFixed(2) + "%**" + (z.sl ? " · SL " + px(z.sl, z.sym) : "") + (z.tp1 ? " · TP1 " + px(z.tp1, z.sym) : "") + sentTag(z);
}
const TAGS = { "a favor": "✅ sentimiento a favor", contra: "⚠️ sentimiento en contra", neutral: "⚪ sentimiento neutral" };
function sentTag(z) { const r = sentRead(z.side, sentFor(z.sym)); return TAGS[r.tag] ? " · " + TAGS[r.tag] : "";
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
    return "**" + title + "**\n" + (any ? "Ninguna zona dentro del rango de vigilancia (" + syms.map((s) => s + " " + WATCH[s] + "%").join(" · ") + ")." : "Sin zonas cargadas para este canal. Pídele a TITO \"actualiza zonas\".");
  }
  ls.sort((a, b) => b.v - a.v);
  const s = sentFor(syms[0]);
  const sl = "🧭 Fear & Greed " + (syms[0] === "XAU" ? "(acciones EE. UU., referencia)" : "crypto") + ": " + (s ? sentLine(s) : "sin dato");
  return ("**" + title + "**\n" + sl + "\n" + ls.map((x) => x.t).join("\n") + "\n_Proximidad: 0% = lejos · 100% = en la zona. La entrada la validas tú._").slice(0, 1990);
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
      if (hk && !A.paused) post(hk, (lvl === 2 ? "🎯 **PRECIO EN LA ZONA**" : "🔥 **ACERCÁNDOSE A LA ZONA (80%+)**") + "\n" + watchLine(z, p)).catch(() => {});
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
  simPost("🤖 **Ai Crypto · SEÑAL REAL · ENTRADA** (sin ejecutar: tú decides)\n" + (NAMES[t.sym] || t.sym) + " · " + sideEs(t.side) + " en " + px(e, t.sym) + "\nZona " + t.zname + " (A++) · gatillo: orden de " + usd(o.usd) + "\nSL " + px(t.sl, t.sym) + " · TP " + px(t.tp, t.sym) + " · relación 1 : " + (Math.abs(t.tp - e) / R).toFixed(1) + "\nSin dinero real.");
}
function simCheck(sym, p, T) {
  for (let i = sim.open.length - 1; i >= 0; i--) {
    const t = sim.open[i]; if (t.sym !== sym) continue;
    const hitSL = t.side === "sell" ? p >= t.sl : p <= t.sl, hitTP = t.side === "sell" ? p <= t.tp : p >= t.tp;
    if (!hitSL && !hitTP) continue;
    t.out = hitSL ? "SL" : "TP"; t.exit = hitSL ? t.sl : t.tp; t.r = hitSL ? -1 : Math.abs(t.tp - t.entry) / t.R; t.end = T;
    sim.open.splice(i, 1); sim.closed.unshift(t); storeSim();
    simPost((hitSL ? "🔴" : "🟢") + " **Ai Crypto · SEÑAL REAL · RESULTADO " + t.out + "**\n" + (NAMES[t.sym] || t.sym) + " · " + sideEs(t.side) + " " + px(t.entry, t.sym) + " → " + px(t.exit, t.sym) + " · " + (t.r >= 0 ? "+" : "") + t.r.toFixed(1) + "R\n" + simStats());
  }
}
export function simStats() {
  const n = sim.closed.length, w = sim.closed.filter((t) => t.r > 0).length, r = sim.closed.reduce((a, t) => a + t.r, 0);
  return n ? n + " operaciones cerradas · " + Math.round(w / n * 100) + "% ganadoras · total " + (r >= 0 ? "+" : "") + r.toFixed(1) + "R" + (sim.open.length ? " · " + sim.open.length + " abiertas" : "")
    : "Sin operaciones cerradas todavía" + (sim.open.length ? " · " + sim.open.length + " abiertas" : "") + ".";
}
