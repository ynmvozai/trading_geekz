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
import { usd, px, prParts, splitLong, log } from "./util.js";
import { dot, lado, espera, quien, rango, niveles } from "./friendly.js";

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

// Dónde está una orden respecto a las zonas (corto).
function where(o) {
  let best = null;
  for (const z of Z.list.filter((z) => z.sym === o.sym)) { const d = zDist(z, o.price); if (!best || d < best.d) best = { z, d }; }
  if (!best) return "";
  return best.d === 0 ? "dentro de zona de " + best.z.side.replace("buy", "compra").replace("sell", "venta") : "";
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
  const p = priceOf(m), st = opts.st, op = st && st.open[m], f = (v) => fmt(v, m), L = [];
  L.push("**" + MNAME[m] + "** " + f(p) + (op ? " (" + sgn(pct(p, op)) + " desde el open)" : ""));
  if (p == null) return L[0] + " · sin dato ahora";
  const zs = zonesOf(m).map((z) => ({ z, v: proxOf(z, p) })).sort((a, b) => b.v - a.v).slice(0, opts.zones || 1);
  if (!zs.length) L.push("   Sin zonas" + (IDXK[m] ? " (llegan con el plan de las 8:15 AM NY)" : ""));
  zs.forEach(({ z, v }) => L.push("   " + dot(v) + " " + lado(z.side).toLowerCase() + " " + rango(z, f) + " · " + (v >= 100 ? "**EN LA ZONA**" : "**" + v.toFixed(0) + "%**") + (z.tp1 ? " · TP1 " + f(z.tp1) : "")));
  if (IDXK[m]) return L.join("\n");
  const o = topOrders(m, since, 1)[0];
  if (o) { const fl = flowSince(m, since), w = where(o); L.push("   🐋 Mayor orden: " + quien(o.side).toLowerCase() + " " + usd(o.usd) + " a " + px(o.price, m) + (w ? " (" + w + ")" : "") + " · ganan " + (fl.b >= fl.s ? "🟢 compradores" : "🔴 vendedores")); }
  return L.join("\n");
}

export function boardText(title, since, st, opts = {}) {
  return title + "\n\n" + MKTS.map((m) => marketBlock(m, since, { st, ...opts })).join("\n") +
    "\n\n_% = qué tan cerca está el precio de la zona (100% = dentro). 🟢/🔴 = quién empujó, no una recomendación. La decisión final siempre es tuya._";
}

// Una línea por mercado: precio, cambio desde el open y la zona más cercana.
export function radarText(title, since, st) {
  const L = [title];
  MKTS.forEach((m) => {
    const p = priceOf(m), op = st && st.open && st.open[m], f = (v) => fmt(v, m);
    if (p == null) { L.push("**" + MNAME[m] + "** · sin dato"); return; }
    const z = zonesOf(m).map((z) => ({ z, v: proxOf(z, p) })).sort((a, b) => b.v - a.v)[0];
    let line = (z ? dot(z.v) : "⚪") + " **" + MNAME[m] + "** " + f(p) + (op ? " (" + sgn(pct(p, op)) + ")" : "");
    if (z) line += " · " + lado(z.z.side).toLowerCase() + " " + rango(z.z, f) + " " + (z.v >= 100 ? "EN LA ZONA" : z.v.toFixed(0) + "%");
    if (!IDXK[m]) { const o = topOrders(m, since, 1)[0]; if (o) line += " · 🐋 " + (o.side === "buy" ? "🟢 " : "🔴 ") + usd(o.usd); }
    L.push(line);
  });
  L.push("_La decisión final siempre es tuya._");
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
  if (!st.posted.pre) { st.posted.pre = 1; save(st); sesPost(boardText("🗽 **Sesión NY · " + (em < 9 * 60 + 30 ? "abre en " + (9 * 60 + 30 - em) + " min" : "en curso") + "**", now - 2 * 3600000, st)); return; }
  // Open de NY: 9:30 AM ET.
  if (!st.posted.open && em >= 9 * 60 + 30 && em < 10 * 60) {
    st.posted.open = 1; MKTS.forEach((m) => { const p = priceOf(m); if (p != null) { st.open[m] = p; st.hi[m] = p; st.lo[m] = p; } }); save(st);
    sesPost(boardText("🔔 **Abrió Nueva York**", winStart, st)); return;
  }
  // Radar compacto cada hora (10:30 AM a 3:30 PM ET).
  if (em >= 10 * 60 + 30 && em < 16 * 60 && et.minute >= 30 && et.minute < 33) {
    const k = et.hour + ":30";
    if (!st.posted["r" + k]) { st.posted["r" + k] = 1; save(st); sesPost(radarText("📡 **Radar NY · " + k + " ET**", now - 3600000, st)); return; }
  }
  // Cierre de NY: 4:00 PM ET.
  if (!st.posted.close && em >= 16 * 60 && em < 17 * 60) {
    st.posted.close = 1; save(st);
    const touched = st.touched.length ? "\n🎯 Zonas tocadas hoy: " + st.touched.join(" · ") : "\n🎯 Zonas tocadas hoy: ninguna";
    sesPost(boardText("🏁 **Cerró Nueva York**" + touched, st.open && Object.keys(st.open).length ? openT : winStart, st, { zones: 2, orders: 3 })); return;
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
        const f = (v) => fmt(v, m), n = niveles(z, f);
        sesPost((lvl === 2 ? "🎯 **" + MNAME[m] + " entró a la zona de " + lado(z.side) + "**" : "🔥 **" + MNAME[m] + " se acerca a la zona de " + lado(z.side) + " (" + v.toFixed(0) + "%)**") +
          "\nZona " + rango(z, f) + " · precio " + f(p) + " → " + espera(z.side) + (n ? "\n" + n : "") + "\n_Tú validas la entrada._");
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
