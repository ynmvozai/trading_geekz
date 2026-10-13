// Canal #sesion-ny: lunes a viernes, 9:00 AM – 5:30 PM hora de Puerto Rico.
// Open y cierre de Nueva York se calculan en hora de NY (cambian solos con el horario de verano/invierno).
// BTC, SOL y Oro: zonas + órdenes grandes reales de Binance. US30 y NAS100: solo zonas (sin órdenes en vivo).
import { ENV, NAMES, ORDER } from "./config.js";
import { postLong } from "./discord.js";
import { S, feed } from "./market.js";
import { Z, prox, zDist, isBroken } from "./zones.js";
import { IDX, refreshIdx } from "./macro.js";
import { etParts } from "./sesion.js";
import { kvGet, kvSet } from "./store.js";
import { usd, px, prParts, splitLong, log } from "./util.js";
import { pf, dot, cerca, lado, ladoMin, flecha, espera, rango, niveles } from "./friendly.js";
import { sizeLine, nivelesMedidos } from "./risk.js";

export const SES = { sent: 0, failed: 0, lastErr: "" };
export const MKTS = ["BTC", "SOL", "XAU", "US30", "NQ"];
const MNAME = { ...NAMES, US30: "Dow", NQ: "Nasdaq" };
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
export function zonesOf(m) { return IDXK[m] ? idxZones().filter((z) => z.sym === m) : Z.list.filter((z) => z.sym === m && !isBroken(z)); }
export function proxOf(z, p) {
  if (IDXK[z.sym]) return Math.max(0, Math.min(100, (1 - zDist(z, p) / (IDX_RADIUS[z.sym] / 100)) * 100));
  return prox(z, p);
}
const fmt = (v, m) => (v == null || !isFinite(v) ? "—" : IDXK[m] ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : px(v, m));
const pct = (a, b) => (a && b ? ((a - b) / b) * 100 : null);
const sgn = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%");

export function topOrders(m, since, n = 3) {
  return feed.filter((o) => o.sym === m && o.t >= since).sort((a, b) => b.usd - a.usd).slice(0, n);
}
function flowSince(m, since) {
  let b = 0, s = 0;
  for (const o of feed) { if (o.t < since) break; if (o.sym !== m) continue; if (o.side === "buy") b += o.usd; else s += o.usd; }
  return { b, s };
}
const pfm = (v, m) => pf(v, m);
const chg = (p, op) => { const c = pct(p, op); return c == null ? "" : (c >= 0 ? "▲" : "▼") + Math.abs(c).toFixed(1) + "%"; };
// Zona más cercana de cada mercado, ordenados del más caliente al más frío.
function heat(m) {
  const p = priceOf(m); if (p == null) return { m, p, v: -1 };
  const z = zonesOf(m).map((z) => ({ z, v: proxOf(z, p) })).sort((a, b) => b.v - a.v)[0];
  return { m, p, z: z && z.z, v: z ? z.v : -1 };
}
function heatLine(h) {
  const f = (v) => pfm(v, h.m);
  if (h.p == null) return "⚪ " + MNAME[h.m] + " · sin dato ahora";
  if (!h.z) return "⚪ " + MNAME[h.m] + " " + f(h.p) + " · sin zona hoy";
  return dot(h.v) + " " + MNAME[h.m] + " " + f(h.p) + " · " + (h.v >= 100 ? "dentro de " + ladoMin(h.z.side) : h.v < 50 ? "lejos de zonas" : cerca(h.v) + " de " + ladoMin(h.z.side));
}
// Mercado con más flujo neto de ballenas (solo crypto y oro tienen órdenes en vivo).
function whaleLine(since) {
  let best = null;
  for (const m of MKTS) { if (IDXK[m]) continue; const fl = flowSince(m, since), net = fl.b - fl.s; if (fl.b + fl.s > 0 && (!best || Math.abs(net) > Math.abs(best.net))) best = { m, net }; }
  return best ? "🐋 Ballenas: ganan " + (best.net >= 0 ? "compradores" : "vendedores") + " en " + MNAME[best.m] + " (neto " + usd(Math.abs(best.net)) + ")" : "";
}
export function boardText(title, since, st) {
  const L = [title, ...MKTS.map(heat).sort((a, b) => b.v - a.v).map(heatLine)];
  const w = whaleLine(since); if (w) L.push(w);
  L.push("-# La decisión final siempre es tuya.");
  return L.join("\n");
}
// Radar: solo los mercados con algo que contar (a medio camino o más de una zona).
export function radarText(title, since, st) {
  const hs = MKTS.map(heat).filter((h) => h.v >= 50).sort((a, b) => b.v - a.v);
  if (!hs.length) return title + "\nTodo tranquilo: ningún mercado cerca de sus zonas.";
  return [title, ...hs.map((h) => { const op = st && st.open && st.open[h.m], c = op ? chg(h.p, op) : ""; return dot(h.v) + " " + MNAME[h.m] + (c ? " " + c : " " + pfm(h.p, h.m)) + " · " + (h.v >= 100 ? "en zona de " : cerca(h.v) + " de ") + ladoMin(h.z.side); })].join("\n");
}
export function closeText(st, since) {
  const L = ["🏁 Cerró Nueva York"];
  L.push(st.touched.length ? (st.touched.length === 1 ? "🎯 Hoy se tocó 1 zona: " : "🎯 Hoy se tocaron " + st.touched.length + " zonas: ") + st.touched.join(" · ") : "🎯 Hoy no se tocó ninguna zona");
  const ch = MKTS.map((m) => { const p = priceOf(m), op = st.open && st.open[m]; return p != null && op ? MNAME[m] + " " + chg(p, op) : null; }).filter(Boolean);
  if (ch.length) L.push("📊 " + ch.join(" · "));
  const next = MKTS.map(heat).filter((h) => h.z && h.v < 100 && !st.touched.includes(MNAME[h.m] + " " + ladoMin(h.z.side))).sort((a, b) => b.v - a.v)[0];
  if (next) L.push("📌 Mañana vigila: " + MNAME[next.m] + " " + ladoMin(next.z.side) + " " + rango(next.z, (v) => pfm(v, next.m)));
  const w = whaleLine(since); if (w) L.push(w);
  L.push("-# La decisión final siempre es tuya.");
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
  if (!st.posted.pre) { st.posted.pre = 1; save(st); sesPost(boardText(em < 9 * 60 + 30 ? "🗽 Nueva York abre en " + (9 * 60 + 30 - em) + " min" : "🗽 Sesión de Nueva York en curso", now - 2 * 3600000, st)); return; }
  // Open de NY: 9:30 AM ET.
  if (!st.posted.open && em >= 9 * 60 + 30 && em < 10 * 60) {
    st.posted.open = 1; MKTS.forEach((m) => { const p = priceOf(m); if (p != null) { st.open[m] = p; st.hi[m] = p; st.lo[m] = p; } }); save(st);
    sesPost(boardText("🔔 Abrió Nueva York", winStart, st)); return;
  }
  // Radar compacto cada hora (10:30 AM a 3:30 PM ET).
  if (em >= 10 * 60 + 30 && em < 16 * 60 && et.minute >= 30 && et.minute < 33) {
    const k = et.hour + ":30";
    if (!st.posted["r" + k]) { st.posted["r" + k] = 1; save(st); sesPost(radarText("📡 NY " + (et.hour % 12 || 12) + ":30 · desde el open", now - 3600000, st)); return; }
  }
  // Cierre de NY: 4:00 PM ET.
  if (!st.posted.close && em >= 16 * 60 && em < 17 * 60) {
    st.posted.close = 1; save(st);
    sesPost(closeText(st, st.open && Object.keys(st.open).length ? openT : winStart)); return;
  }
  // Alertas de zona 80% / 100% para los 5 mercados (cooldown 30 min).
  MKTS.forEach((m) => {
    const p = priceOf(m); if (p == null) return;
    zonesOf(m).forEach((z) => {
      const k = z.sym + "|" + z.lo + "|" + z.hi, v = proxOf(z, p), lvl = v >= 100 ? 2 : v >= 80 ? 1 : 0, prev = st.lvl[k];
      if (prev == null) { st.lvl[k] = lvl; return; }
      if (lvl > prev && now - (st.t[k] || 0) > 1800000) {
        st.t[k] = now;
        const tk = MNAME[m] + " " + ladoMin(z.side);
        if (lvl === 2 && !st.touched.includes(tk)) st.touched.push(tk);
        const f = (x) => pfm(x, m), n = (!IDXK[m] && nivelesMedidos(m, z, f)) || niveles(z, f), L = [];   // v4.21: stop medido en cripto y oro
        if (lvl === 2) { L.push(flecha(z.side) + " " + MNAME[m] + " entró a zona de " + lado(z.side) + " · " + fmt(p, m)); L.push(espera(z.side) + " · zona " + rango(z, f)); }
        else { L.push(flecha(z.side) + " " + MNAME[m] + " cerca de zona de " + lado(z.side) + " · " + fmt(p, m)); L.push("Falta poco (" + v.toFixed(0) + "%) · zona " + rango(z, f)); }
        if (n) L.push(n);
        if (!IDXK[m]) { const sz = sizeLine(m, z, f); if (sz) L.push(sz); }   // v4.19: tamaño solo cripto y oro
        if (IDXK[m]) L.push("-# Índice: solo zona, sin órdenes en vivo.");
        else L.push("-# ℹ️ Información, no señal de entrada: en 12 meses de datos las zonas no mostraron ventaja.");
        sesPost(L.join("\n"));
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
