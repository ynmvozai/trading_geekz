// Macro: calendario económico de USD (Forex Factory, gratis) e índices (futuros del Dow YM y Nasdaq NQ).
// Data real; si una fuente falla se dice "sin dato", nunca se rellena.
import { ENV } from "./config.js";
import { post, agent, idxPost } from "./discord.js";
import { kvGet, kvSet } from "./store.js";
import crypto from "node:crypto";
import { log, etParts } from "./util.js";

const TZ = "America/Puerto_Rico";
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", accept: "application/json,text/csv,*/*" };

// ---------- Calendario USD ----------
export const CAL = { events: [], t: 0, err: "" };

export function parseCal(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter((e) => e && e.country === "USD" && (e.impact === "High" || e.impact === "Medium"))
    .map((e) => ({ title: String(e.title || ""), t: Date.parse(e.date), impact: e.impact, forecast: e.forecast || "", previous: e.previous || "" }))
    .filter((e) => isFinite(e.t))
    .sort((a, b) => a.t - b.t);
}

export async function refreshCal() {
  const urls = ["https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://nfs.faireconomy.media/ff_calendar_nextweek.json"];
  const all = [];
  let ok = 0, err = "";
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      all.push(...parseCal(await r.json())); ok++;
    } catch (e) { err = e.message; }
  }
  if (ok) {
    const seen = new Set();
    CAL.events = all.filter((e) => { const k = e.title + e.t; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.t - b.t);
    CAL.t = Date.now(); CAL.err = ok < urls.length ? "semana próxima: " + err : "";
  } else { CAL.err = err || "sin respuesta"; log("Calendario falló:", CAL.err); }
}

const fmtPR = (t) => new Date(t).toLocaleString("es-PR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function calUpcoming(days = 7, now = Date.now()) {
  return CAL.events.filter((e) => e.t >= now - 3600000 && e.t <= now + days * 86400000);
}

export function calText(days = 7) {
  if (!CAL.t) return "📅 Calendario USD: sin dato ahora" + (CAL.err ? " (" + CAL.err + ")" : "") + ".";
  const ev = calUpcoming(days);
  if (!ev.length) return "📅 **Calendario USD (" + days + " días)**\nSin catalizadores macro de USD de impacto medio o alto programados.";
  return ("📅 **Calendario USD · próximos " + days + " días** (hora de PR · fuente Forex Factory)\n" +
    ev.map((e) => (e.impact === "High" ? "🔴" : "🟠") + " " + fmtPR(e.t) + " · **" + e.title + "**" + (e.forecast ? " · pronóstico " + e.forecast : "") + (e.previous ? " · anterior " + e.previous : "")).join("\n") +
    "\n_🔴 alto impacto: evita entrar 30 min antes. Analiza la reacción, no adivines el dato._").slice(0, 1990);
}

export function calForAi() {
  if (!CAL.t) return { estado: "sin dato", error: CAL.err || null };
  return calUpcoming(7).map((e) => ({ hora_PR: fmtPR(e.t), evento: e.title, impacto: e.impact === "High" ? "alto" : "medio", pronostico: e.forecast || null, anterior: e.previous || null }));
}

// Aviso 30 min antes de cada noticia de alto impacto de USD (una vez por evento).
export function calTick(now = Date.now()) {
  for (const e of CAL.events) {
    if (e.impact !== "High") continue;
    const dt = e.t - now;
    if (dt > 30 * 60000 || dt < 25 * 60000) continue;
    const k = "calWarn:" + e.title + ":" + e.t;
    if (kvGet(k)) continue;
    kvSet(k, 1);
    const txt = "⚠️ **Noticia de alto impacto USD en 30 min** · " + fmtPR(e.t) + "\n**" + e.title + "**" + (e.forecast ? " · pronóstico " + e.forecast : "") + (e.previous ? " · anterior " + e.previous : "") +
      "\nSugerencia: pausa entradas nuevas hasta ver la reacción. Después de la noticia, analiza solo la reacción técnica y la absorción de liquidez.";
    for (const h of [ENV.hooks.crypto, ENV.hooks.oro]) if (h) post(h, txt).catch(() => {});
    idxPost(txt).catch(() => {});
    agent(txt);
  }
}

// ---------- Índices: futuros YM (Dow) y NQ (Nasdaq) ----------
export const IDX = { YM: null, NQ: null, err: { YM: "", NQ: "" } }; // { price, daily:[[fecha,o,h,l,c]], h1:[[...]], fuente, t }
const YAHOO = { YM: "YM=F", NQ: "NQ=F" }, STOOQ = { YM: "ym.f", NQ: "nq.f" };

export function parseYahoo(j) {
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !Array.isArray(r.timestamp)) throw new Error("respuesta vacía");
  const q = r.indicators.quote[0], out = [];
  r.timestamp.forEach((ts, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].every((v) => v != null && isFinite(v))) out.push([new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " "), +o.toFixed(2), +h.toFixed(2), +l.toFixed(2), +c.toFixed(2)]);
  });
  return { bars: out, price: r.meta && r.meta.regularMarketPrice };
}
export function parseStooq(csv) {
  const lines = String(csv || "").trim().split(/\r?\n/);
  if (lines.length < 2 || !/^Date,Open,High,Low,Close/i.test(lines[0])) throw new Error("CSV inválido");
  return lines.slice(1).map((l) => l.split(",")).filter((a) => a.length >= 5 && isFinite(+a[4])).map((a) => [a[0], +a[1], +a[2], +a[3], +a[4]]);
}

async function yahoo(sym, interval, range) {
  const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?interval=" + interval + "&range=" + range, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Yahoo HTTP " + r.status);
  return parseYahoo(await r.json());
}

export async function refreshIdx() {
  for (const k of ["YM", "NQ"]) {
    if (IDX[k] && /^TradingView/.test(IDX[k].fuente || "") && Date.now() - IDX[k].t < 20 * 60000) continue; // TradingView manda en vivo
    try {
      const d = await yahoo(YAHOO[k], "1d", "2mo");
      let h1 = [];
      try { h1 = (await yahoo(YAHOO[k], "1h", "5d")).bars.slice(-60); } catch {}
      const last = d.bars[d.bars.length - 1];
      IDX[k] = { price: d.price || (last && last[4]), daily: d.bars.slice(-30), h1, fuente: "Yahoo (" + YAHOO[k] + ")", t: Date.now() };
      IDX.err[k] = "";
    } catch (e1) {
      try {
        const r = await fetch("https://stooq.com/q/d/l/?s=" + STOOQ[k] + "&i=d", { headers: UA, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error("Stooq HTTP " + r.status);
        const bars = parseStooq(await r.text()).slice(-30);
        if (!bars.length) throw new Error("Stooq sin barras");
        IDX[k] = { price: bars[bars.length - 1][4], daily: bars, h1: [], fuente: "Stooq (" + STOOQ[k] + ", diario)", t: Date.now() };
        IDX.err[k] = "";
      } catch (e2) { IDX.err[k] = e1.message + " · " + e2.message; log("Índice", k, "falló:", IDX.err[k]); }
    }
  }
}

export function idxForAi() {
  const f = (k, n) => (IDX[k] ? { precio: IDX[k].price, fuente: IDX[k].fuente, velas_diarias: IDX[k].daily, velas_1h: IDX[k].h1 } : { estado: "sin dato", error: IDX.err[k] || null, nombre: n });
  return { US30_futuros_YM: f("YM", "Dow"), NAS100_futuros_NQ: f("NQ", "Nasdaq") };
}

export function idxLine() {
  const f = (k, n) => n + " " + (IDX[k] ? IDX[k].price + " (" + IDX[k].fuente + ")" : "sin dato" + (IDX.err[k] ? " (" + IDX.err[k] + ")" : ""));
  return f("YM", "US30/YM") + " · " + f("NQ", "NQ");
}

// ---------- TradingView (tus gráficos DJ30 / USTEC) por webhook ----------
// Alerta de TradingView cada 5 min con: {"s":"{{ticker}}","o":{{open}},"h":{{high}},"l":{{low}},"c":{{close}},"t":"{{time}}"}
export const TV = { n: 0, last: null, err: "", rejected: 0, lastIp: "" };
// IPs oficiales desde donde TradingView envía webhooks (tradingview.com/support/solutions/43000529348).
export const TV_IPS = ["52.89.214.238", "34.212.75.30", "54.218.53.128", "52.32.178.7"];
export function tvIpOk(xff, remote) {
  const parts = String(xff || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = (parts.length ? parts[parts.length - 1] : String(remote || "")).replace(/^::ffff:/, "");
  return { ok: TV_IPS.includes(ip), ip };
}
export function tvSecret() {
  let s = kvGet("tvSecret", null);
  if (!s) { s = crypto.randomBytes(12).toString("hex"); kvSet("tvSecret", s); }
  return s;
}
export function tvSym(s) {
  s = String(s || "").toUpperCase();
  if (/US30|DJ30|DJI|\bYM|DOW|WS30/.test(s)) return "YM";
  if (/USTEC|NAS|NQ|NDX|US100|USTECH/.test(s)) return "NQ";
  return null;
}
function tvRebuild(k) {
  const bars = kvGet("tv5:" + k, []) || [], daily = kvGet("tvD:" + k, {}) || {};
  const h1 = new Map();
  for (const b of bars) { const hk = b[0].slice(0, 13); const x = h1.get(hk); if (!x) h1.set(hk, [hk.replace("T", " ") + ":00", b[1], b[2], b[3], b[4]]); else { x[2] = Math.max(x[2], b[2]); x[3] = Math.min(x[3], b[3]); x[4] = b[4]; } }
  const last = bars[bars.length - 1];
  if (!last) return;
  IDX[k] = { price: last[4], daily: Object.keys(daily).sort().slice(-30).map((d) => [d, ...daily[d]]), h1: [...h1.values()].slice(-60), fuente: "TradingView (" + (kvGet("tvTicker:" + k, "") || k) + ")", t: kvGet("tvT:" + k, Date.now()) };
  IDX.err[k] = "";
}
export function onTv(body) {
  let o = body;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { const a = o.split(/[,;\s]+/); o = { s: a[0], o: a[1], h: a[2], l: a[3], c: a[4], t: a[5] }; } }
  const k = tvSym(o && (o.s || o.sym || o.ticker));
  const c = +o.c, op = +(o.o ?? c), h = +(o.h ?? c), l = +(o.l ?? c);
  if (!k || !(c > 0)) { TV.err = "mensaje inválido"; return { ok: false, error: "mensaje inválido: necesito s (ticker) y c (precio)" }; }
  const prev = IDX[k] && IDX[k].price;
  if (prev && Math.abs(c - prev) / prev > 0.08) { TV.err = "precio fuera de rango (" + c + " vs " + prev + ")"; return { ok: false, error: TV.err }; }
  const tt = Date.parse(o.t) || Date.now(), iso = new Date(tt).toISOString().slice(0, 16);
  const bars = kvGet("tv5:" + k, []) || [];
  const i = bars.findIndex((b) => b[0] === iso), bar = [iso, op, h, l, c];
  if (i >= 0) bars[i] = bar; else bars.push(bar);
  bars.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  while (bars.length > 600) bars.shift();
  kvSet("tv5:" + k, bars);
  const d = etParts(tt).date, daily = kvGet("tvD:" + k, {}) || {}, x = daily[d];
  daily[d] = x ? [x[0], Math.max(x[1], h), Math.min(x[2], l), c] : [op, h, l, c];
  const keys = Object.keys(daily).sort(); while (keys.length > 60) delete daily[keys.shift()];
  kvSet("tvD:" + k, daily);
  kvSet("tvTicker:" + k, String(o.s || o.sym || o.ticker).slice(0, 30));
  kvSet("tvT:" + k, Date.now());
  TV.n++; TV.last = { k, c, t: Date.now() }; TV.err = "";
  tvRebuild(k);
  return { ok: true, sym: k, price: c };
}
export function tvLoad() { for (const k of ["YM", "NQ"]) tvRebuild(k); }

export function startMacro() {
  tvLoad();
  refreshCal(); refreshIdx();
  setInterval(refreshCal, 3 * 3600000);
  setInterval(refreshIdx, 15 * 60000);
  setInterval(() => { try { calTick(); } catch (e) { log("calTick", e.message); } }, 60000);
}
