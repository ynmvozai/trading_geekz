// Hot Zone 24/7 · Trading_GeeKz (Visionary_GeeKz). Solo analiza y alerta: nunca opera dinero.
import { ENV, ORDER, SYMS, VERSION, mask } from "./config.js";
import { openStore, kvGet, kvSet } from "./store.js";
import { loadZones, Z } from "./zones.js";
import * as M from "./market.js";
import { initAlerts, watchAll, watchTick } from "./alerts.js";
import { loadResults, checkRange, expire, resultsText } from "./results.js";
import { binanceStart, probeBinance, klinesRaw, bn } from "./binance.js";
import { botStart, agent, post } from "./discord.js";
import { onAgentMessage, dailyTick } from "./commands.js";
import { startHttp, estadoText, BOOT } from "./health.js";
import { log, prParts } from "./util.js";

log("Hot Zone", VERSION, "arrancando · datos en", ENV.dataDir);
log("Variables:", Object.entries(ENV.hooks).map(([k, v]) => k + "=" + mask(v)).join(" "), "bot=" + mask(ENV.botToken), "anthropic=" + mask(ENV.anthropicKey));

openStore();
loadZones();
M.loadMarket();
loadResults();
initAlerts();
startHttp();

// ---------- Binance ----------
let blockedWarned = false;
function warnBlocked(why) {
  if (blockedWarned) return;
  blockedWarned = true;
  log("BINANCE BLOQUEÓ LA CONEXIÓN:", why);
  agent("🚫 **Binance bloqueó la conexión desde esta región** (" + why + (process.env.RAILWAY_REPLICA_REGION ? ", región " + process.env.RAILWAY_REPLICA_REGION : "") + "). Sin velas TITO no puede calcular zonas. Cambia la región del servicio en Railway a Europa (Ámsterdam) o Asia (Singapur): Settings → Deploy → Regions.");
}
probeBinance().then((r) => {
  if (r.ok) log("Binance REST OK");
  else if (r.blocked) warnBlocked("REST " + r.msg);
  else log("Binance REST falló:", r.msg);
});

// Al volver de un corte, se revisan velas de 1 minuto para no perder un TP/SL ocurrido durante el corte.
async function backfill(from, to) {
  if (to - from < 30000) return;
  log("Revisando velas 1m del corte de", Math.round((to - from) / 1000), "s");
  for (const k of ORDER) {
    try {
      const a = await klinesRaw(SYMS[k].label, "1m", Math.min(1000, Math.ceil((to - from) / 60000) + 1), from - 60000);
      for (const c of a) checkRange(k, +c[3], +c[2], +c[0] + 59999);
    } catch (e) { log("backfill", k, e.message); }
  }
}

binanceStart({
  onTrade: (sym, p, q, T, m, recv) => { M.onTrade(sym, p, q, T, m, recv); checkRange(sym, p, p, T); },
  onStatus: (st, why) => { if (st === "blocked") warnBlocked("WebSocket HTTP " + why); },
  onReconnect: (from, now) => { backfill(from, now); },
});

// ---------- Bot de Discord (#agent) ----------
botStart(onAgentMessage);

// ---------- Ciclos ----------
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  M.flushStale(now);
  if (bn.connected && now - lastTick < 2000) M.addMeasuredMs(now - lastTick);
  lastTick = now;
}, 250);
setInterval(() => M.gcSecs(), 10000);
setInterval(watchTick, 15000);

// Aviso si pasan más de 2 minutos sin datos de Binance (y aviso cuando vuelve).
let staleSince = 0;
setInterval(() => {
  const now = Date.now(), last = Math.max(BOOT, ...ORDER.map((k) => M.S[k].lastRecv));
  if (now - last > 120000 && !staleSince) {
    staleSince = last;
    agent("⚠️ **Sin datos de Binance hace " + Math.round((now - last) / 60000) + " min.** Reconectando solo" + (bn.lastError ? " (último error: " + bn.lastError + ")" : "") + ". Te aviso cuando vuelva.");
  } else if (staleSince && now - last < 10000) {
    agent("✅ Datos de Binance de vuelta tras " + Math.round((now - staleSince) / 60000) + " min de corte.");
    staleSince = 0;
  }
}, 15000);

setInterval(() => {
  dailyTick();
  expire();
  const pp = prParts();
  // Latido diario 8:00 AM
  if (pp.hour === 8 && pp.minute < 5 && kvGet("lastBeat") !== pp.date) { kvSet("lastBeat", pp.date); agent("🟢 Hot Zone sigue vivo\n" + estadoText()); }
  // Resumen de resultados cada domingo 6:00 PM
  if (pp.weekday === "Sun" && pp.hour === 18 && kvGet("lastWeekly") !== pp.date) {
    kvSet("lastWeekly", pp.date);
    const txt = "🗓️ **Resumen semanal**\n" + resultsText(7) + "\n\n" + resultsText(90).replace("📊 ", "");
    if (ENV.hooks.resultados) post(ENV.hooks.resultados, { content: txt.slice(0, 1990) }).catch(() => agent(txt)); else agent(txt);
  }
}, 30000);

setInterval(() => { try { M.persistMarket(); } catch (e) { log("persist", e.message); } }, 60000);

// Mensajes al arrancar
setTimeout(() => {
  agent("🟢 **Servidor Hot Zone encendido**\n" + estadoText() + (Z.list.length ? "" : "\n\n⚠️ No hay zonas cargadas. Escribe **actualiza zonas** (TITO las calcula con velas reales) o **cargar zonas** seguido del JSON."));
}, 20000);
setTimeout(watchAll, 40000);

function shutdown(sig) {
  log("Apagando por", sig);
  try { M.persistMarket(); } catch {}
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => log("Promesa rechazada:", e && e.message ? e.message : e));
process.on("uncaughtException", (e) => { log("Error no controlado:", e.stack || e.message); setTimeout(() => process.exit(1), 500); });
