// v4.28 · "Buenos días" de TITO en #agent: lunes a viernes, 8:30 AM hora de Puerto Rico (pedido de Yasser, 19 oct 2026).
// Un mensaje positivo + "alpha" del día (solo con datos reales del panel, velas y calendario) + un consejo de valor.
import { ENV } from "./config.js";
import { agent } from "./discord.js";
import { aiAsk } from "./tito.js";
import { calForAi } from "./macro.js";
import { biasText } from "./bias.js";
import { kvGet, kvSet } from "./store.js";
import { prParts, log } from "./util.js";

export const MORNING_Q = `Escribe el BUENOS DÍAS de hoy para Yasser en Discord. Máximo 900 caracteres. Formato exacto:
☀️ **Buenos días, Yasser**
(1 línea positiva y motivadora, distinta cada día, enfocada en disciplina, paciencia y proceso. Positiva: di lo que suma, sin frases construidas sobre negaciones.)

⚡ **Alpha de hoy**
• (2 o 3 viñetas cortas SOLO con datos del payload: qué hizo BTC/SOL/oro en la noche con su %, la zona más cercana al precio con su rango, la noticia de alto impacto de hoy con su hora si existe, y hacia dónde va el flujo de ballenas.)

💎 **Valor**
(1 línea práctica para hoy basada en sus reglas: máximo 2 trades, esperar el cierre de la vela antes de entrar, stop definido antes de entrar. En su diario, los días con el plan seguido sumaron +7,7 % y los días sin plan −2,8 %.)

-# Escenarios, no asesoría. La decisión final siempre es tuya.
Si un dato no está en el payload, no lo menciones. Nunca inventes cifras.`;

export async function sendMorning() {
  try {
    const t = await aiAsk(MORNING_Q, "[SESGO]\n" + biasText() + "\n\n[CALENDARIO_USD]\n" + JSON.stringify(calForAi()), "(buenos días)");
    await agent(t.slice(0, 1900));
  } catch (e) {
    log("Buenos días falló:", e.message);
    await agent("☀️ **Buenos días, Yasser**\nHoy es un día nuevo para ejecutar tu plan con calma.\n\n💎 **Valor**\nMáximo 2 trades, stop definido antes de entrar y espera el cierre de la vela.\n-# (El resumen con datos no salió: " + e.message + ")");
  }
}

// Lunes a viernes, 8:30–8:45 AM PR, una vez por día.
export function morningTick(t = Date.now()) {
  const p = prParts(t);
  if (["Sat", "Sun"].includes(p.weekday) || kvGet("morningOff", false)) return false;
  if (p.hour === 8 && p.minute >= 30 && p.minute < 45 && kvGet("lastMorning") !== p.date) { kvSet("lastMorning", p.date); sendMorning(); return true; }
  return false;
}
