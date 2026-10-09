// Binance USDⓈ-M Futures: WebSocket aggTrade con reconexión (espera creciente) y REST de velas.
import WebSocket from "ws";
import { ENV, ORDER, SYMS } from "./config.js";
import { log } from "./util.js";

export const bn = { ws: null, connected: false, lastMsg: 0, connects: 0, lastError: "", blocked: false, gapFrom: 0 };
const BY_STREAM = Object.fromEntries(ORDER.map((k) => [SYMS[k].stream + "@aggTrade", k]));
let backoff = 1000, watchdogT = null;

export function binanceStart({ onTrade, onStatus, onReconnect }) {
  const url = ENV.binanceWs + "?streams=" + ORDER.map((k) => SYMS[k].stream + "@aggTrade").join("/");
  const open = () => {
    let ws;
    try { ws = new WebSocket(url, { handshakeTimeout: 15000 }); } catch (e) { return retry(e.message); }
    bn.ws = ws; bn.connects++;
    ws.on("unexpected-response", (req, res) => {
      bn.lastError = "HTTP " + res.statusCode;
      if (res.statusCode === 451 || res.statusCode === 403) { bn.blocked = true; onStatus && onStatus("blocked", res.statusCode); }
    });
    ws.on("open", () => {
      bn.connected = true; bn.lastMsg = Date.now(); backoff = 1000; bn.blocked = false;
      log("Binance WS conectado");
      onStatus && onStatus("open");
    });
    ws.on("message", (raw) => {
      const now = Date.now();
      let m; try { m = JSON.parse(raw); } catch { return; }
      const d = m && m.data, k = m && BY_STREAM[m.stream];
      if (!k || !d || !d.p) return;
      if (bn.gapFrom && onReconnect) { const g = bn.gapFrom; bn.gapFrom = 0; onReconnect(g, now); }
      bn.lastMsg = now;
      onTrade(k, parseFloat(d.p), parseFloat(d.q), d.T, d.m, now);
    });
    ws.on("ping", () => { bn.lastMsg = Math.max(bn.lastMsg, Date.now() - 1000); });
    ws.on("error", (e) => { bn.lastError = e.message; });
    ws.on("close", () => {
      if (bn.ws !== ws) return;
      bn.connected = false; bn.ws = null;
      if (!bn.gapFrom) bn.gapFrom = bn.lastMsg || Date.now();
      retry(bn.lastError || "cerrado");
    });
  };
  const retry = (why) => {
    log("Binance WS desconectado (" + why + "). Reintentando en", backoff / 1000, "s");
    onStatus && onStatus("closed", why);
    setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, 60000);
  };
  open();
  // Conectado pero sin datos 20 s: se fuerza la reconexión.
  clearInterval(watchdogT);
  watchdogT = setInterval(() => {
    if (bn.ws && bn.connected && Date.now() - bn.lastMsg > 20000) { log("Binance: sin datos 20 s, reconectando"); bn.lastError = "sin datos"; bn.ws.terminate(); }
  }, 5000);
}

export const rest = { ok: null, lastError: "", lastOk: 0 };
export async function klinesRaw(symbol, interval, limit, startTime) {
  const u = ENV.binanceRest + "/fapi/v1/klines?symbol=" + symbol + "&interval=" + interval + "&limit=" + limit + (startTime ? "&startTime=" + startTime : "");
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(15000) }); }
  catch (e) { rest.ok = false; rest.lastError = "red: " + e.message; throw new Error(rest.lastError); }
  if (!r.ok) {
    rest.ok = false;
    rest.lastError = "HTTP " + r.status + (r.status === 451 || r.status === 403 ? " (Binance bloquea la región del servidor)" : "");
    if (r.status === 451 || r.status === 403) bn.blocked = true;
    throw new Error(rest.lastError);
  }
  rest.ok = true; rest.lastOk = Date.now();
  return r.json();
}

// Formato del panel para TITO: [hora UTC, apertura, máximo, mínimo, cierre]
export async function kl(symbol, interval, n) {
  try {
    const a = await klinesRaw(symbol, interval, n);
    return a.map((k) => [new Date(k[0]).toISOString().slice(5, 16).replace("T", " "), +k[1], +k[2], +k[3], +k[4]]);
  } catch (e) { log("Velas", symbol, interval, "fallaron:", e.message); return "sin datos (" + e.message + ")"; }
}

// Prueba al arrancar: REST + respuesta clara si Binance bloquea la región.
export async function probeBinance() {
  try {
    const r = await fetch(ENV.binanceRest + "/fapi/v1/ping", { signal: AbortSignal.timeout(15000) });
    if (r.status === 451 || r.status === 403) { rest.ok = false; rest.lastError = "HTTP " + r.status + " (región bloqueada)"; return { ok: false, blocked: true, msg: "HTTP " + r.status }; }
    if (!r.ok) { rest.ok = false; rest.lastError = "HTTP " + r.status; return { ok: false, msg: "HTTP " + r.status }; }
    rest.ok = true; rest.lastOk = Date.now();
    return { ok: true };
  } catch (e) { rest.ok = false; rest.lastError = "red: " + e.message; return { ok: false, msg: e.message }; }
}
