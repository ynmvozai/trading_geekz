// v4.18 · Canal #sentimiento: UNA lista con el sentimiento de cada par, en un solo mensaje que se edita cada 15 min.
// Al cambiar el día (hora PR) publica un mensaje nuevo, así queda el historial diario en el canal.
// Datos reales, sin inventar (si una fuente falla se dice "sin dato"):
//  · BTC, SOL, oro: posicionamiento de la multitud en Binance Futuros por par —
//      % de cuentas en largo (globalLongShortAccountRatio 1h), largo/corto de los traders grandes (topLongShortPositionRatio 1h)
//      y funding actual (premiumIndex). Más el Fear & Greed que aplica (cripto para BTC/SOL; CNN para oro).
//  · Dow y Nasdaq: no hay dato gratis por par; se usa el Fear & Greed de CNN (acciones de EE. UU.) y se dice.
// Lectura contraria: multitud muy cargada a un lado = combustible para el movimiento contrario. Es contexto, no entrada.
import { ENV, SYMS, NAMES } from "./config.js";
import { SENT, emoji } from "./sentiment.js";
import { kvGet, kvSet } from "./store.js";
import { log, prParts, splitLong } from "./util.js";

export const SC = { sent: 0, edits: 0, err: "", t: 0, data: {} };
const PAIRS = ["BTC", "SOL", "XAU"];

async function j(path) {
  const r = await fetch(ENV.binanceRest + path, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
export async function pairData(sym) {
  const s = SYMS[sym].label, out = { sym };
  try { const a = await j("/futures/data/globalLongShortAccountRatio?symbol=" + s + "&period=1h&limit=1"); if (a && a[0]) out.longPct = +a[0].longAccount * 100; } catch (e) { out.errLS = e.message; }
  try { const a = await j("/futures/data/topLongShortPositionRatio?symbol=" + s + "&period=1h&limit=1"); if (a && a[0]) out.topRatio = +a[0].longShortRatio; } catch (e) { out.errTop = e.message; }
  try { const a = await j("/fapi/v1/premiumIndex?symbol=" + s); if (a && a.lastFundingRate != null) out.funding = +a.lastFundingRate * 100; } catch (e) { out.errF = e.message; }
  return out;
}

// Lectura de la multitud (pura, probada). Devuelve { tag, txt }.
export function crowdRead(d) {
  if (!d || d.longPct == null) return { tag: "sin dato", txt: "⚪ sin dato de posicionamiento" };
  const L = d.longPct, f = d.funding;
  if (L >= 65 || (L >= 60 && f != null && f >= 0.03)) return { tag: "multitud larga", txt: "🔴 Multitud cargada en LARGOS: riesgo de barrida hacia abajo (lectura contraria)" };
  if (L <= 35 || (L <= 40 && f != null && f <= -0.01)) return { tag: "multitud corta", txt: "🟢 Multitud cargada en CORTOS: riesgo de barrida hacia arriba (lectura contraria)" };
  if (L >= 55) return { tag: "inclinada a largos", txt: "🟠 Inclinada a largos, sin exceso" };
  if (L <= 45) return { tag: "inclinada a cortos", txt: "🟡 Inclinada a cortos, sin exceso" };
  return { tag: "equilibrada", txt: "⚪ Equilibrada" };
}

const fg = (s, nombre) => (s && s.v != null ? emoji(s.v) + " " + nombre + " " + s.v + "/100 " + s.label + (s.prev != null ? " (ayer " + s.prev + ")" : "") : "⚪ " + nombre + " sin dato");
const pct = (x) => (x == null ? "—" : x.toFixed(0) + "%");
const fund = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(4) + "%");

// Texto del mensaje (puro, probado). data: { BTC:{...}, SOL:{...}, XAU:{...} }, sent: { crypto, stocks }.
export function listText(data, sent, now = Date.now()) {
  const p = prParts(now), hh = String(p.hour).padStart(2, "0") + ":" + String(p.minute).padStart(2, "0");
  const L = ["🧭 **Sentimiento por par** · " + p.date + " · actualizado " + hh + " (hora PR)", ""];
  for (const k of PAIRS) {
    const d = data[k] || {}, c = crowdRead(d);
    L.push("**" + NAMES[k] + "** · " + c.txt);
    L.push("-# Cuentas en largo " + pct(d.longPct) + " · traders grandes L/C " + (d.topRatio == null ? "—" : d.topRatio.toFixed(2)) + " · funding " + fund(d.funding) + " · " + fg(k === "XAU" ? sent.stocks : sent.crypto, k === "XAU" ? "F&G acciones (ref.)" : "F&G cripto"));
  }
  for (const [k, n] of [["US30", "Dow"], ["NQ", "Nasdaq"]]) {
    L.push("**" + n + "** · " + fg(sent.stocks, "F&G acciones EE. UU."));
    L.push("-# Sin dato de posicionamiento por par (no hay fuente gratis); referencia general del mercado.");
  }
  L.push("", "-# Lectura contraria: multitud muy cargada a un lado suele ser combustible para el lado contrario. No marca el momento exacto; es contexto para tus zonas, no una entrada.");
  return L.join("\n");
}

// ---------- Publicar: un mensaje vivo por día (el bot lo edita) ----------
async function api(method, path, body) {
  const r = await fetch("https://discord.com/api/v10" + path, {
    method, headers: { "content-type": "application/json", authorization: "Bot " + ENV.botToken },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 403 ? " (el bot no tiene permiso en #sentimiento)" : ""));
  return r.json();
}
export async function sentTick(now = Date.now()) {
  const ch = ENV.sentimientoChannelId;
  if (!ENV.botToken || !ch) { SC.err = "falta DISCORD_BOT_TOKEN o SENTIMIENTO_CHANNEL_ID"; return; }
  const data = {};
  for (const k of PAIRS) { try { data[k] = await pairData(k); } catch (e) { data[k] = { err: e.message }; } }
  SC.data = data; SC.t = now;
  const txt = splitLong(listText(data, SENT, now))[0];
  const day = prParts(now).date, st = kvGet("sentMsg", null);
  try {
    if (st && st.day === day && st.id) {
      try { await api("PATCH", "/channels/" + ch + "/messages/" + st.id, { content: txt, allowed_mentions: { parse: [] } }); SC.edits++; SC.err = ""; return; }
      catch (e) { if (!/HTTP 404/.test(e.message)) throw e; }                 // lo borraron: se publica uno nuevo
    }
    const m = await api("POST", "/channels/" + ch + "/messages", { content: txt, allowed_mentions: { parse: [] } });
    kvSet("sentMsg", { day, id: m.id }); SC.sent++; SC.err = "";
  } catch (e) { SC.err = e.message; log("#sentimiento:", e.message); }
}
export function startSentCanal() {
  setTimeout(() => sentTick().catch(() => {}), 60000);                       // espera a que carguen los índices
  setInterval(() => sentTick().catch(() => {}), 15 * 60000);
}
