// Canal #sesion-ny: lunes a viernes, 9:00 AM – 5:30 PM hora de Puerto Rico.
// Open y cierre de Nueva York se calculan en hora de NY (cambian solos con el horario de verano/invierno).
// BTC, SOL y Oro: zonas + órdenes grandes reales de Binance. US30 y NAS100: solo zonas (sin órdenes en vivo).
import { ENV, NAMES, ORDER } from "./config.js";
import { postLong } from "./discord.js";
import { S, feed } from "./market.js";
import { Z, prox, zDist } from "./zones.js";
import { IDX, refreshIdx } from "./macro.js";
import { etParts } from "./sesion.js";
import { kvGet, kvSet } from "./store.js";
import { usd, px, hhmmss, prParts, splitLong, log } from "./util.js";

export const SES = { sent: 0, failed: 0, lastErr: "" };
export const MKTS = ["BTC", "SOL", "XAU", "US30", "NQ"];
const MNAME = { ...NAMES, US30: "US30 (Dow)", NQ: "NAS100" };
const IDXK = { US30: "YM", NQ: "NQ" };
const IDX_RADIUS = { US30: 1.5, NQ: 1.5 }; // % para proximidad de índices

// ---------- Envío al canal ----------
async function botSend(content) {
  const r = await fetch("https://discord.com/api/v10/channels/" + ENV.sesionChannelId + "/messages", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bot " + ENV.botToken },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 403 ? " (el bot no tiene permiso de escribir en #sesion-ny)" : ""));
}
export async function sesPost(txt) {
  try {
    if (ENV.hooks.sesion) await postLong(ENV.hooks.sesion, txt);
    else if (ENV.botToken && ENV.sesionChannelId) { for (const part of splitLong(txt)) await botSend(part); }
    else throw new Error("falta WEBHOOK_SESION o DISCORD_BOT_TOKEN");
    SES.sent++; SES.lastErr = "";
  } catch (e) { SES.failed++; SES.lastErr = e.message; log("#sesion-ny falló:", e.message); }
}

// ---------- Ventana y estado del día ----------
export function inWindow(t = Date.now()) {
  const p = prParts(t), m = p.hour * 60 + p.minute;
  return !["Sat", "Sun"].includes(p.weekday) && m >= 9 * 60 && m < 17 * 60 + 30;
}
export const sesMirror = (txt) => (inWindow() ? sesPost(txt) : Promise.resolve());

function day() {
  const d = prParts().date;
  let st = kvGet("ses", null);
  if (!st || st.date !== d) st = { date: d, open: {}, hi: {}, lo: {}, touched: [], posted: {}, lvl: {}, t: {} };
  return st;
}
const save = (st) => kvSet("ses", st);

// ---------- Datos por mercado ----------
export function priceOf(m) {
  if (IDXK[m]) { const x = IDX[IDXK[m]]; return x ? +x.price : null; }
  return S[m] ? S[m].price : null;
}
export function idxZones() { const v = kvGet("idxZones", null); return (v && v.list) || []; }
export function setIdxZones(arr) {
  const list = (Array.isArray(arr) ? arr : []).filter((z) => z && IDXK[String(z.sym || "").toUpperCase()]).map((z) => {
    let lo = +z.lo, hi = +z.hi; if (lo > hi) [lo, hi] = [hi, lo];
    return { sym: String(z.sym).toUpperCase(), name: String(z.name || "Zona").slice(0, 40), grade: String(z.grade || "").slice(0, 4), side: z.side === "buy" ? "buy" : "sell", lo, hi, sl: +z.sl || 0, tp1: +z.tp1 || 0, tp2: +z.tp2 || 0, nota: String(z.nota || "").slice(0, 200) };
  }).filter((z) => z.lo > 0 && z.hi > 0);
  if (list.length) kvSet("idxZones", { date: prParts().date, list });
  return list.length;
}
export function zonesOf(m) { return IDXK[m] ? idxZones().filter((z) => z.sym === m) : Z.list.filter((z) => z.sym === m); }
export function proxOf(z, p) {
  if (IDXK[z.sym]) return Math.max(0, Math.min(100, (1 - zDist(z, p) / (IDX_RADIUS[z.sym] / 100)) * 100));
  return prox(z, p);
}
const fmt = (v, m) => (v == null || !isFinite(v) ? "—" : IDXK[m] ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : px(v, m));
const pct = (a, b) => (a && b ? ((a - b) / b) * 100 : null);
const sgn = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%");

// Dónde está una orden respecto a las zonas.
function where(o) {
  const zs = Z.list.filter((z) => z.sym === o.sym);
  let best = null;
  for (const z of zs) { const d = zDist(z, o.price); if (!best || d < best.d) best = { z, d }; }
  if (!best) return "sin zonas cargadas";
  const z = best.z, lado = z.side === "buy" ? "compra" : "venta";
  return best.d === 0 ? "**dentro** de " + z.name + " (" + lado + ")" : "a " + (best.d * 100).toFixed(2) + "% de " + z.name + " (" + lado + ")";
}
export function topOrders(m, since, n = 3) {
  return feed.filter((o) => o.sym === m && o.t >= since).sort((a, b) => b.usd - a.usd).slice(0, n);
}
function flowSince(m, since) {
  let b = 0, s = 0;
  for (const o of feed) { if (o.t < since) break; if (o.sym !== m) continue; if (o.side === "buy") b += o.usd; else s += o.usd; }
  return { b, s };
}

export function marketBlock(m, since, opts = {}) {
  const p = priceOf(m), st = opts.st, L = [];
  const op = st && st.open[m];
  L.push("**" + MNAME[m] + "** · " + fmt(p, m) + (op ? " · desde el open " + sgn(pct(p, op)) : "") + (st && st.hi[m] ? " · rango " + fmt(st.lo[m], m) + " – " + fmt(st.hi[m], m) : ""));
  if (p == null) { L.push("   sin dato de precio ahora"); return L.join("\n"); }
  const zs = zonesOf(m).map((z) => ({ z, v: proxOf(z, p) })).sort((a, b) => b.v - a.v).slice(0, opts.zones || 2);
  if (!zs.length) L.push("   Sin zonas cargadas" + (IDXK[m] ? " (llegan con el plan NY de 8:15 AM ET)" : ""));
  zs.forEach(({ z, v }) => L.push("   " + (v >= 100 ? "🎯" : v >= 80 ? "🔥" : v >= 50 ? "🟡" : "⚪") + " " + (z.side === "buy" ? "Compra" : "Venta") + " " + z.name + " " + (z.grade || "") + " · " + fmt(z.lo, m) + " – " + fmt(z.hi, m) + " · **" + v.toFixed(0) + "%**" + (z.sl ? " · SL " + fmt(z.sl, m) : "") + (z.tp1 ? " · TP1 " + fmt(z.tp1, m) : "")));
  if (IDXK[m]) { L.push("   _Solo zonas: este mercado no tiene órdenes en vivo._"); return L.join("\n"); }
  const top = topOrders(m, since, opts.orders || 3);
  if (!top.length) L.push("   Órdenes grandes: ninguna de $250K+ en este periodo.");
  else {
    const f = flowSince(m, since);
    L.push("   Órdenes más grandes (" + usd(f.b) + " compras · " + usd(f.s) + " ventas · neto " + usd(f.b - f.s) + "):");
    top.forEach((o) => L.push("   " + (o.side === "buy" ? "🟢 compra" : "🔴 venta") + " " + usd(o.usd) + " a " + px(o.price, m) + " · " + hhmmss(o.t) + " · " + (p ? (o.price > p ? "arriba" : "abajo") + " del precio " + Math.abs(pct(o.price, p)).toFixed(2) + "%" : "") + " · " + where(o)));
  }
  return L.join("\n");
}

export function boardText(title, since, st, opts = {}) {
  return title + "\n\n" + MKTS.map((m) => marketBlock(m, since, { st, ...opts })).join("\n\n") +
    "\n\n_Proximidad 0% = lejos · 100% = en la zona. 🟢/🔴 = quién empujó la orden (agresor), no una recomendación. Escenarios condicionales: la entrada la validas tú. La decisión final siempre es tuya._";
}

// Una línea por mercado: precio, cambio desde el open, zona más cercana y la orden más grande del periodo.
export function radarText(title, since, st) {
  const L = [title];
  MKTS.forEach((m) => {
    const p = priceOf(m), op = st && st.open && st.open[m];
    if (p == null) { L.push("**" + MNAME[m] + "** · sin dato"); return; }
    const z = zonesOf(m).map((z) => ({ z, v: proxOf(z, p) })).sort((a, b) => b.v - a.v)[0];
    let line = "**" + MNAME[m] + "** " + fmt(p, m) + (op ? " (" + sgn(pct(p, op)) + ")" : "");
    line += z ? " · " + (z.v >= 100 ? "🎯" : z.v >= 80 ? "🔥" : z.v >= 50 ? "🟡" : "⚪") + " " + (z.z.side === "buy" ? "compra" : "venta") + " " + fmt(z.z.lo, m) + "–" + fmt(z.z.hi, m) + " " + z.v.toFixed(0) + "%" : " · sin zonas";
    if (!IDXK[m]) { const o = topOrders(m, since, 1)[0]; line += o ? " · mayor: " + (o.side === "buy" ? "🟢 " : "🔴 ") + usd(o.usd) + " a " + px(o.price, m) + " (" + where(o) + ")" : " · sin órdenes de $250K+"; }
    else line += " · solo zona";
    L.push(line);
  });
  L.push("_🟢/🔴 = agresor de la orden, no recomendación. La decisión final siempre es tuya._");
  return L.join("\n");
}

// ---------- Ciclo (cada 30 s) ----------
let lastIdx = 0;
export function sesTick(now = Date.now()) {
  if (!inWindow(now)) return;
  if (now - lastIdx > 3 * 60000) { lastIdx = now; refreshIdx().catch(() => {}); }
  const st = day(), et = etParts(now), em = et.hour * 60 + et.minute;
  const winStart = (() => { const p = prParts(now); return now - ((p.hour * 60 + p.minute) - 9 * 60) * 60000; })();
  const openT = now - (em - (9 * 60 + 30)) * 60000;
  // Máximos y mínimos de la sesión (desde el open de NY).
  if (em >= 9 * 60 + 30 && em <= 16 * 60) MKTS.forEach((m) => { const p = priceOf(m); if (p == null) return; st.hi[m] = Math.max(st.hi[m] || p, p); st.lo[m] = Math.min(st.lo[m] || p, p); });
  // Pre-apertura: al abrir la ventana (9:00 AM PR).
  if (!st.posted.pre) { st.posted.pre = 1; save(st); sesPost(boardText("🗽 **Sesión NY · pre-apertura** (" + (em < 9 * 60 + 30 ? "el open es a las 9:30 AM hora de NY" : "sesión en curso") + ")", now - 2 * 3600000, st)); return; }
  // Open de NY: 9:30 AM ET.
  if (!st.posted.open && em >= 9 * 60 + 30 && em < 10 * 60) {
    st.posted.open = 1; MKTS.forEach((m) => { const p = priceOf(m); if (p != null) { st.open[m] = p; st.hi[m] = p; st.lo[m] = p; } }); save(st);
    sesPost(boardText("🔔 **OPEN DE NUEVA YORK** · precios de apertura y órdenes desde las 9:00 AM PR", winStart, st)); return;
  }
  // Radar compacto cada hora (10:30 AM a 3:30 PM ET).
  if (em >= 10 * 60 + 30 && em < 16 * 60 && et.minute >= 30 && et.minute < 33) {
    const k = et.hour + ":30";
    if (!st.posted["r" + k]) { st.posted["r" + k] = 1; save(st); sesPost(radarText("📡 **Radar NY · " + k + " ET** (última hora)", now - 3600000, st)); return; }
  }
  // Cierre de NY: 4:00 PM ET.
  if (!st.posted.close && em >= 16 * 60 && em < 17 * 60) {
    st.posted.close = 1; save(st);
    const touched = st.touched.length ? "\n**Zonas tocadas hoy:** " + st.touched.join(" · ") : "\n**Zonas tocadas hoy:** ninguna";
    sesPost(boardText("🏁 **CIERRE DE NUEVA YORK** · resumen de la sesión (desde el open) y zonas que quedan para mañana" + touched, st.open && Object.keys(st.open).length ? openT : winStart, st, { zones: 2, orders: 3 })); return;
  }
  // Alertas de zona 80% / 100% para los 5 mercados (cooldown 30 min).
  MKTS.forEach((m) => {
    const p = priceOf(m); if (p == null) return;
    zonesOf(m).forEach((z) => {
      const k = z.sym + "|" + z.lo + "|" + z.hi, v = proxOf(z, p), lvl = v >= 100 ? 2 : v >= 80 ? 1 : 0, prev = st.lvl[k];
      if (prev == null) { st.lvl[k] = lvl; return; }
      if (lvl > prev && now - (st.t[k] || 0) > 1800000) {
        st.t[k] = now;
        if (lvl === 2 && !st.touched.includes(MNAME[m] + " " + z.name)) st.touched.push(MNAME[m] + " " + z.name);
        sesPost((lvl === 2 ? "🎯 **PRECIO EN LA ZONA** · " : "🔥 **ACERCÁNDOSE (80%+)** · ") + MNAME[m] + " · " + (z.side === "buy" ? "compra (se espera que SUBA)" : "venta (se espera que BAJE)") +
          "\n" + z.name + " " + (z.grade || "") + " · " + fmt(z.lo, m) + " – " + fmt(z.hi, m) + " · precio " + fmt(p, m) + (z.sl ? " · SL " + fmt(z.sl, m) : "") + (z.tp1 ? " · TP1 " + fmt(z.tp1, m) : "") + (z.tp2 ? " · TP2 " + fmt(z.tp2, m) : "") +
          (IDXK[m] ? "\n_Índice: solo zona, sin órdenes en vivo._" : "") + "\n_La entrada la validas tú en tu temporalidad._");
      }
      st.lvl[k] = lvl;
    });
  });
  save(st);
}

export function sesEstado() {
  const dest = ENV.hooks.sesion ? "webhook" : ENV.botToken && ENV.sesionChannelId ? "bot (canal " + ENV.sesionChannelId + ")" : "sin destino";
  return (SES.lastErr ? "❌" : "✅") + " #sesion-ny (L-V 9:00 AM–5:30 PM PR): " + dest + " · enviados " + SES.sent + (SES.lastErr ? " · último error: " + SES.lastErr : "") + " · zonas de índices: " + idxZones().length;
}
