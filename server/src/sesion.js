// Plan de la sesión de Nueva York: TITO lo arma con data real y cada parte va a su canal.
// Crypto → #cryptoman · Oro → #oro-índice · Índices → #indices-zonas (WEBHOOK_INDICES) · resumen → #agent.
import { ENV } from "./config.js";
import { postLong, agent } from "./discord.js";
import { aiAsk } from "./tito.js";
import { kl } from "./binance.js";
import { prices } from "./market.js";
import { applyAiZones } from "./zones.js";
import { ZONES_Q } from "./prompts.js";
import { idxForAi, calForAi } from "./macro.js";
import { kvGet, kvSet } from "./store.js";
import { log } from "./util.js";

export const SESSION_Q = `Haz el PLAN DE LA SESIÓN DE NUEVA YORK de hoy con la data real del payload ([PANEL_HOT_ZONE], [VELAS], [VELAS_DIARIAS], [INDICES], [CALENDARIO_USD] y el sentimiento Fear & Greed).
Método (en este orden): 1) tendencia HTF diaria/4H y estructura (máximos y mínimos más bajos o más altos); 2) liquidez objetivo (máximos/mínimos iguales, máximo y mínimo del día anterior); 3) BOS; 4) FVG / order blocks 1H-4H; 5) sesión NY. Para US30 aplica la regla overnight de 300 puntos. Los índices son US30 (futuros YM) y NAS100 (futuros NQ).
Para cada mercado: sesgo (comprador/vendedor/rango) en una línea con el porqué, y 1-2 zonas ordenadas por prioridad: dirección esperada, rango exacto, SL, TP1, TP2 y la R aproximada al TP1. Marca con ⭐ la zona de mayor probabilidad del día (a favor de la tendencia HTF). Si hay noticias de alto impacto hoy, dilo con la hora y la regla de no entrar 30 min antes. Menciona el Fear & Greed cuando sume o reste a una zona.
FORMATO OBLIGATORIO (sin texto antes de [[RESUMEN]]):
[[RESUMEN]] 3-4 líneas: las 3 zonas prioritarias del día entre todos los mercados y las noticias de riesgo.
[[CRYPTO]] BTC y SOL.
[[ORO]] Oro (XAUUSDT).
[[INDICES]] US30 y NAS100. Si [INDICES] dice "sin dato", escribe que hoy no hay datos de índices y no inventes niveles.
Cada sección máximo 1,500 caracteres, negritas en los niveles clave, cierra cada sección con: "Escenarios condicionales, no asesoría financiera. La decisión final siempre es tuya."
Solo precios que salen de las velas; nunca inventes. ` + ZONES_Q;

export function splitSections(txt) {
  const out = {}, re = /\[\[(RESUMEN|CRYPTO|ORO|INDICES)\]\]/g;
  const marks = [];
  let m;
  while ((m = re.exec(txt))) marks.push({ k: m[1], i: m.index, end: m.index + m[0].length });
  marks.forEach((mk, n) => { out[mk.k] = txt.slice(mk.end, n + 1 < marks.length ? marks[n + 1].i : txt.length).trim(); });
  return out;
}

let running = false;
export async function runSession(manual = false) {
  if (running) return agent("⏳ El plan de sesión ya se está preparando.");
  running = true;
  try {
    if (!ENV.anthropicKey) return agent("⚠️ El plan de sesión NY no salió: falta ANTHROPIC_API_KEY en Railway.");
    if (manual) await agent("🗽 Preparando el plan de la sesión de Nueva York con data real… (1-2 min)");
    const syms = ["BTCUSDT", "SOLUSDT", "XAUUSDT"];
    const d = await Promise.all(syms.map((s) => kl(s, "1d", 30)));
    const diarias = {}; syms.forEach((s, i) => { diarias[s] = d[i]; });
    const extra = "[VELAS_DIARIAS]\n" + JSON.stringify(diarias) + "\n\n[INDICES]\n" + JSON.stringify(idxForAi()) + "\n\n[CALENDARIO_USD]\n" + JSON.stringify(calForAi());
    const t = await aiAsk(SESSION_Q, extra, "(plan de la sesión de Nueva York)");
    const r = applyAiZones(t, prices());
    const s = splitSections(r.txt);
    if (!s.CRYPTO && !s.ORO && !s.INDICES) { await agent("🗽 **Plan de sesión NY**\n" + r.txt); return; }
    const head = (x) => "🗽 **Plan sesión NY · " + x + "**\n";
    const send = (hook, title, body) => (body ? (hook ? postLong(hook, head(title) + body) : agent(head(title) + body)) : Promise.resolve());
    await send(ENV.hooks.crypto, "Crypto", s.CRYPTO);
    await send(ENV.hooks.oro, "Oro", s.ORO);
    await send(ENV.hooks.indices, "Índices", s.INDICES);
    await agent("🗽 **Plan de la sesión de Nueva York**\n" + (s.RESUMEN || "") +
      "\n\nDetalle en #cryptoman, #oro-índice" + (ENV.hooks.indices ? " y #indices-zonas" : " (índices aquí abajo: falta WEBHOOK_INDICES)") + "." +
      (r.n ? "\n✅ " + r.n + " zonas de BTC/SOL/oro cargadas: las alertas ya las vigilan." : r.err ? "\n⚠️ No pude leer las zonas (" + r.err + ")." : ""));
    kvSet("lastSession", etParts().date);
  } catch (e) {
    log("Plan de sesión falló:", e.message);
    await agent("⚠️ El plan de sesión NY falló: " + e.message);
  } finally { running = false; }
}

// Hora de Nueva York (cambia sola con el horario de verano/invierno).
export function etParts(t = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const o = {};
  for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, hour: +o.hour, minute: +o.minute, weekday: o.weekday };
}

// Lunes a viernes, 8:15 AM hora de Nueva York (antes de las noticias de 8:30 y de la apertura de 9:30).
export function sessionTick(t = Date.now()) {
  if (kvGet("sessionOff", false)) return false;
  const et = etParts(t);
  if (["Sat", "Sun"].includes(et.weekday)) return false;
  if (et.hour === 8 && et.minute >= 15 && et.minute < 40 && kvGet("lastSession") !== et.date) { kvSet("lastSession", et.date); runSession(false); return true; }
  return false;
}
