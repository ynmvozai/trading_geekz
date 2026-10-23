// v4.35 (Yasser, 22 oct 2026): TITO manda su análisis en vivo del Dow y el Nasdaq a #agent 3 veces al día,
// lunes a viernes, a las 9:30 AM, 12:00 PM y 4:30 PM hora de Puerto Rico, con la gráfica de la entrada que propone.
// Esto reemplaza el tablero del open y el aviso antes del cierre que antes llegaban a #agent.
import { agent, agentFile } from "./discord.js";
import { aiAsk } from "./tito.js";
import { renderChart, extractCharts } from "./chart.js";
import { zonesFor } from "./zonasgraf.js";
import { kvGet, kvSet } from "./store.js";
import { prParts, log } from "./util.js";

export const SLOTS = [
  { k: "930", h: 9, m: 30, titulo: "🔔 9:30 AM · Abrió Nueva York", foco: "Abrió Nueva York. Di qué hizo el Dow y el Nasdaq en la pre-apertura y la primera vela de 15m, y qué zona de hoy está más cerca." },
  { k: "1200", h: 12, m: 0, titulo: "🕛 12:00 PM · Mitad de la sesión", foco: "Es mediodía. Resume cómo va la sesión desde las 9:30 (máximo, mínimo, qué zonas tocó o rompió) y si queda algún escenario válido para la tarde." },
  { k: "1630", h: 16, m: 30, titulo: "🏁 4:30 PM · Cierre de Nueva York", foco: "Ya cerró Nueva York. Resume el día (rango, cierre vs. apertura, qué zonas funcionaron o se rompieron) y deja los niveles a vigilar para mañana." },
];

export const repQ = (s) => `${s.titulo}
Escribe para Yasser en Discord el análisis EN VIVO del Dow (US30, futuros YM) y del Nasdaq (NAS100, futuros NQ) con los datos de [INDICES]. ${s.foco}
Formato: empieza con la línea "**${s.titulo}**". Luego, por mercado: precio actual, estructura en 1H y 15m, y dónde está frente a las zonas de hoy (zonas_hoy), diciendo si alguna quedó rota. Después, contexto en 2 viñetas (sentimiento, noticias de hoy del calendario con su hora PR, divergencia Dow/Nasdaq si la hay). Cierra con el mejor escenario (o "sin escenario claro, esperar" si no hay), con entrada, stop bajo/sobre una estructura real y meta, y su R:R.
Si propones un escenario, añade UN bloque [[GRAFICO]] de ese mercado en 15m con lado, entrada, stop, meta y la zona. Máximo 1500 caracteres. Las horas de las velas ya vienen en hora de Puerto Rico. Nunca inventes cifras; si un dato no está, dilo.`;

export async function sendWithCharts(t) {
  const ex = extractCharts(t);
  await agent(ex.txt);
  for (const sp of ex.specs.slice(0, 2)) {
    try { const g = await renderChart(sp, { zonas: zonesFor(sp.mercado) }); await agentFile(g.png, "tito-grafica.png", g.caption); }
    catch (e) { await agent("⚠️ No pude dibujar la gráfica: " + e.message); }
  }
}

export async function sendReport(s) {
  try {
    const pr = kvGet("planResumen", null);
    const extra = pr && pr.txt ? "[PLAN_NY_DE_HOY]\n" + pr.txt : "";
    const t = await aiAsk(repQ(s), extra, "(" + s.titulo + ")");
    await sendWithCharts(t);
  } catch (e) {
    log("Reporte", s.k, "falló:", e.message);
    await agent("**" + s.titulo + "**\n⚠️ El análisis no salió: " + e.message);
  }
}

// Lunes a viernes, dentro de los 15 min siguientes a cada hora, una vez por día y por hora.
export function reportTick(t = Date.now()) {
  const p = prParts(t);
  if (["Sat", "Sun"].includes(p.weekday) || kvGet("reportesOff", false)) return null;
  const mins = p.hour * 60 + p.minute;
  for (const s of SLOTS) {
    const m0 = s.h * 60 + s.m, key = "rep" + s.k;
    if (mins >= m0 && mins < m0 + 15 && kvGet(key) !== p.date) { kvSet(key, p.date); sendReport(s); return s.k; }
  }
  return null;
}
