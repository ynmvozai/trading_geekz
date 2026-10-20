// Hot Zone 24/7 · Trading_GeeKz (Visionary_GeeKz). Solo analiza y alerta: nunca opera dinero.
import { ENV, ORDER, SYMS, VERSION, mask } from "./config.js";
import { openStore, kvGet, kvSet } from "./store.js";
import { loadZones, Z } from "./zones.js";
import * as M from "./market.js";
import { initAlerts, watchAll, watchTick } from "./alerts.js";
import { loadResults, checkRange, expire, weeklyText } from "./results.js";
import { binanceStart, probeBinance, klinesRaw, bn } from "./binance.js";
import { botStart, agent, post, botPost, isAdmin } from "./discord.js";
import { onDiario, startDiario } from "./diario.js";
import { simStats } from "./alerts.js";
import { onAgentMessage, dailyTick } from "./commands.js";
import { startHttp, bootText, BOOT } from "./health.js";
import { log, prParts } from "./util.js";
import { startSentiment } from "./sentiment.js";
import { startMacro } from "./macro.js";
import { startMega, onLiq } from "./mega.js";
import { startBias, onBiasChange } from "./bias.js";
import { startFund } from "./fundamental.js";
import { runEstudio } from "./estudio.js";
import { hookOf } from "./alerts.js";
import { sesMirror, noteBias } from "./sesionny.js";
import { startWallets } from "./wallets.js";
import { sessionTick } from "./sesion.js";
import { sesTick } from "./sesionny.js";
import { startVg } from "./vgquant.js";
import { startC15 } from "./confirm15.js";
import { startSentCanal } from "./sentcanal.js";

log("Hot Zone", VERSION, "arrancando · datos en", ENV.dataDir);
log("Variables:", Object.entries(ENV.hooks).map(([k, v]) => k + "=" + mask(v)).join(" "), "bot=" + mask(ENV.botToken), "anthropic=" + mask(ENV.anthropicKey));

openStore();
loadZones();
M.loadMarket();
loadResults();
initAlerts();
startHttp();
startSentiment();
startMacro();
startVg();
startC15();
startSentCanal();

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
  onLiq: (sym, kind, amount, price, T) => onLiq(sym, kind, amount, price, T),
});
startMega();
startWallets();
// v4.5: el cambio de sesgo va solo al canal de su mercado (y a #sesion-ny en horario NY), ya no a #agent.
onBiasChange((sym, txt) => { noteBias(sym, txt); });   // v4.27: va en el resumen de cada hora de #sesion-ny
startBias();
startFund();
// v4.4: el estudio (fases 1, 2 y 3) arranca solo una vez después de esta actualización; luego se repite con el comando "estudio".
if (!kvGet("estudioV44", false)) { kvSet("estudioV44", Date.now()); setTimeout(() => runEstudio([1, 2, 3], agent), 90000); }
// v4.6: repite solo la Fase 1 una vez, ya con días de toda la semana.
else if (!kvGet("estudioV46", false)) { kvSet("estudioV46", Date.now()); setTimeout(() => runEstudio([1], agent), 90000); }
// v4.7: repite la Fase 2 una vez con las zonas sin mirar al futuro.
else if (!kvGet("estudioV47", false)) { kvSet("estudioV47", Date.now()); setTimeout(() => runEstudio([2], agent), 90000); }
// v4.8: repite la Fase 3 (TITO a ciegas) una vez, solo con velas cerradas.
else if (!kvGet("estudioV48", false)) { kvSet("estudioV48", Date.now()); setTimeout(() => runEstudio([3], agent), 90000); }
// v4.9: Fase 4 (ruptura de zona), una vez.
else if (!kvGet("estudioV49", false)) { kvSet("estudioV49", Date.now()); setTimeout(() => runEstudio([4], agent), 90000); }
// v4.10: TITO a ciegas ampliado (60 mañanas por mercado), una vez.
else if (!kvGet("estudioV410", false)) { kvSet("estudioV410", Date.now()); setTimeout(() => runEstudio([3], agent), 90000); }
// v4.11: Fase 5 (sesiones NY de Bitcoin con órdenes grandes), una vez.
else if (!kvGet("estudioV411", false)) { kvSet("estudioV411", Date.now()); setTimeout(() => runEstudio([5], agent), 90000); }
// v4.13: Fase 6 (validación independiente de la regla candidata), una vez.
else if (!kvGet("estudioV413", false)) { kvSet("estudioV413", Date.now()); setTimeout(() => runEstudio([6], agent), 90000); }
// v4.20: Fase 7 (cuánto entra el precio en la zona antes de reaccionar), una vez.
else if (!kvGet("estudioV420", false)) { kvSet("estudioV420", Date.now()); setTimeout(() => runEstudio([7], agent), 90000); }

// ---------- Bot de Discord (#agent) ----------
botStart(onAgentMessage, { [ENV.diarioChannelId]: (m) => onDiario(m, isAdmin(m), simStats()) });
startDiario();

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
setInterval(() => { try { sesTick(); } catch (e) { log("sesTick", e.message); } }, 30000);

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
  sessionTick();
  expire();
  const pp = prParts();
  // Latido diario 8:00 AM
  if (pp.hour === 8 && pp.minute < 5 && kvGet("lastBeat") !== pp.date) { kvSet("lastBeat", pp.date); log(bootText("Buenos días · sistema vivo")); }   // v4.24: #agent en silencio (solo responde y avisa fallos)
  // Resumen de resultados cada domingo 6:00 PM
  if (pp.weekday === "Sun" && pp.hour === 18 && kvGet("lastWeekly") !== pp.date) {
    kvSet("lastWeekly", pp.date);
    const txt = weeklyText(7);
    if (ENV.hooks.resultados) post(ENV.hooks.resultados, { content: txt.slice(0, 1990) }).catch(() => agent(txt));
    else botPost(ENV.resultadosChannelId, txt).catch((e) => agent(txt + "\n\n⚠️ No pude publicar en #resultados: " + e.message));
  }
}, 30000);

setInterval(() => { try { M.persistMarket(); } catch (e) { log("persist", e.message); } }, 60000);

// Mensajes al arrancar
setTimeout(() => {
  log(bootText("Sistema encendido"));   // v4.24: ya no se publica en #agent
  if (!Z.list.length) agent("⚠️ No hay zonas cargadas: escribe “actualiza zonas”.");
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
