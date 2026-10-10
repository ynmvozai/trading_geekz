// /health (para UptimeRobot), /alive (para Railway), /state (para el panel v3.0 de solo lectura) y el texto de "estado".
import http from "node:http";
import fs from "node:fs";
import { ENV, ORDER, NAMES, VERSION, PUBLIC_URL } from "./config.js";
import { S, flow, feed, big } from "./market.js";
import { Z, prox, zoneStatus } from "./zones.js";
import { bn, rest } from "./binance.js";
import { bot, hookStats } from "./discord.js";
import { A, sim, simStats } from "./alerts.js";
import { T } from "./tito.js";
import { openCount } from "./results.js";
import { kvGet } from "./store.js";
import { px, fullPR, shortPR } from "./util.js";
import { SENT, sentData } from "./sentiment.js";
import { CAL, IDX, idxLine, onTv, tvSecret } from "./macro.js";
import { sesEstado } from "./sesionny.js";

export const BOOT = Date.now();
const STALE_MS = 180000;

export function healthData() {
  const now = Date.now(), mercados = {};
  ORDER.forEach((k) => {
    mercados[k] = { precio: S[k].price, ultimo_dato: S[k].lastRecv ? new Date(S[k].lastRecv).toISOString() : null, hace_s: S[k].lastRecv ? Math.round((now - S[k].lastRecv) / 1000) : null, retraso_ms: S[k].lag == null ? null : Math.round(S[k].lag) };
  });
  const lastAny = Math.max(0, ...ORDER.map((k) => S[k].lastRecv));
  const stale = now - BOOT > 120000 && now - lastAny > STALE_MS;
  return {
    ok: !stale, version: VERSION, horas_encendido: +((now - BOOT) / 3600000).toFixed(2),
    binance: { conectado: bn.connected, bloqueado: bn.blocked, velas_rest: rest.ok == null ? "sin probar" : rest.ok ? "ok" : rest.lastError, region: process.env.RAILWAY_REPLICA_REGION || null, ultimo_error: bn.lastError || null, reconexiones: Math.max(0, bn.connects - 1) },
    mercados, discord_bot: bot.ready ? "conectado" : bot.lastError || "desconectado",
    alertas_pausadas: A.paused, zonas: Z.list.length, senales_en_seguimiento: openCount(),
  };
}

export function estadoText() {
  const h = healthData(), now = Date.now(), ck = (v) => (v ? "✅" : "❌");
  const L = ["📋 **Estado de Hot Zone** · " + VERSION + " · encendido " + (h.horas_encendido < 48 ? h.horas_encendido.toFixed(1) + " h" : (h.horas_encendido / 24).toFixed(1) + " días")];
  L.push(ck(h.binance.conectado && h.ok) + " Binance " + (h.binance.bloqueado ? "BLOQUEÓ la conexión desde esta región" : h.binance.conectado ? "conectado" : "desconectado (" + (h.binance.ultimo_error || "?") + ")") + (h.binance.reconexiones ? " · " + h.binance.reconexiones + " reconexiones" : ""));
  L.push((rest.ok ? "✅" : "❌") + " Velas de Binance (REST, para TITO): " + h.binance.velas_rest + (h.binance.region ? " · región del servidor: " + h.binance.region : ""));
  ORDER.forEach((k) => { const m = h.mercados[k]; L.push("   " + (NAMES[k] || k) + " " + px(m.precio, k) + " · último dato hace " + (m.hace_s == null ? "—" : m.hace_s + " s") + " · retraso " + (m.retraso_ms == null ? "—" : (m.retraso_ms / 1000).toFixed(2) + " s")); });
  L.push(ck(bot.ready) + " Bot de Discord " + h.discord_bot);
  L.push("Canales: #cryptoman " + ck(ENV.hooks.crypto) + " · #oro-índice " + ck(ENV.hooks.oro) + " · #agent " + ck(ENV.hooks.agent) + " · #ai-crypto " + ck(ENV.hooks.aicrypto) + " · #resultados " + (ENV.hooks.resultados ? "✅" : "❌ (va a #agent)"));
  L.push((A.paused ? "⏸️ Alertas PAUSADAS (escribe **reanudar alertas**)" : "✅ Alertas activas") + " · enviadas " + A.sent + (A.failed ? " · fallidas " + A.failed + " (" + A.lastErr + ")" : "") + " · última: " + (A.last ? A.last.txt + " · " + shortPR(A.last.t) : "ninguna todavía"));
  L.push("Zonas: " + Z.list.length + " (" + (Z.date || "sin cargar") + ") · señales en seguimiento: " + h.senales_en_seguimiento + " · Ai Crypto: " + simStats());
  L.push(ck(ENV.anthropicKey && !T.lastErr) + " Ai (TITO): " + (ENV.anthropicKey ? T.calls + " llamadas · " + Math.round(T.inTok / 1000) + "K tokens entrada · " + Math.round(T.outTok / 1000) + "K salida" + (T.lastErr ? " · último error: " + T.lastErr : "") : "falta ANTHROPIC_API_KEY") + " · mapa diario " + (kvGet("dailyOff", false) ? "apagado" : "7:48 AM") + (kvGet("lastDaily") ? " (último " + kvGet("lastDaily") + ")" : ""));
  L.push((SENT.crypto ? "✅" : "❌") + " Fear & Greed crypto: " + (SENT.crypto ? SENT.crypto.v + "/100 · " + SENT.crypto.label : "sin dato" + (SENT.lastErr.crypto ? " (" + SENT.lastErr.crypto + ")" : "")) + " · acciones (ref. oro): " + (SENT.stocks ? SENT.stocks.v + "/100 · " + SENT.stocks.label : "sin dato" + (SENT.lastErr.stocks ? " (" + SENT.lastErr.stocks + ")" : "")));
  L.push((CAL.t ? "✅" : "❌") + " Calendario USD: " + (CAL.t ? CAL.events.length + " eventos medio/alto" + (CAL.err ? " (" + CAL.err + ")" : "") : "sin dato" + (CAL.err ? " (" + CAL.err + ")" : "")) + " · plan sesión NY " + (kvGet("sessionOff", false) ? "apagado" : "8:15 AM ET L-V") + (kvGet("lastSession") ? " (último " + kvGet("lastSession") + ")" : ""));
  L.push((IDX.YM && IDX.NQ ? "✅" : "❌") + " Índices: " + idxLine() + " · #indices-zonas " + (ENV.hooks.indices ? "✅" : "❌ (falta WEBHOOK_INDICES, va a #agent)"));
  L.push(sesEstado());
  L.push("Discord: " + hookStats.sent + " mensajes enviados" + (hookStats.failed ? " · " + hookStats.failed + " fallidos" : ""));
  return L.join("\n");
}

export function stateData() {
  const now = Date.now();
  const mercados = {};
  ORDER.forEach((k) => { const f = flow(k, 300000, now); mercados[k] = { precio: S[k].price, retraso_ms: S[k].lag == null ? null : Math.round(S[k].lag), compras_5m: Math.round(f.buy), ventas_5m: Math.round(f.sell) }; });
  return {
    version: VERSION, hora: fullPR(now), t: now, ok: healthData().ok, pausadas: A.paused, zonas_fecha: Z.date,
    mercados, sentimiento: sentData(),
    zonas: Z.list.map((z, i) => ({ ...z, proximidad: S[z.sym].price ? +prox(z, S[z.sym].price).toFixed(2) : null, ahora: zoneStatus(z, i, S[z.sym].price)[0] })),
    ordenes: feed.slice(0, 300).map((o) => ({ t: o.t, sym: o.sym, side: o.side, usd: Math.round(o.usd), price: o.price, zn: o.zn, alert: o.alert })),
    grandes: big.slice(0, 20).map((o) => ({ t: o.t, sym: o.sym, side: o.side, usd: Math.round(o.usd), price: o.price, alert: o.alert })),
    ai_crypto: { resumen: simStats(), abiertas: sim.open, cerradas: sim.closed.slice(0, 30) },
  };
}

export function startHttp() {
  const panelFile = new URL("../panel/index.html", import.meta.url);
  const srv = http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
    if (u === "/alive") return json(200, { ok: true, version: VERSION });
    if (u.startsWith("/tv/")) {
      if (req.method !== "POST" || u.slice(4) !== tvSecret()) return json(404, { error: "no existe" });
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on("end", () => { const r = onTv(body.trim()); json(r.ok ? 200 : 400, r); });
      return;
    }
    if (u === "/health") { const h = healthData(); return json(h.ok ? 200 : 503, h); }
    if (u === "/state") return json(200, stateData());
    if (u === "/" || u === "/index.html") {
      try { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(fs.readFileSync(panelFile)); } catch { return json(404, { error: "sin panel" }); }
    }
    json(404, { error: "no existe", rutas: ["/health", "/state", "/alive", "/"], panel: PUBLIC_URL });
  });
  srv.listen(ENV.port, () => console.log("HTTP en el puerto", ENV.port));
  return srv;
}
