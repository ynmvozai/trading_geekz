// TITO: agente con Claude (Anthropic Messages API). Prompt copiado sin cambios del panel v2.4.
import { ENV, ORDER } from "./config.js";
import { AI_PROMPT, INDEX_MAP } from "./prompts.js";
import { S, flow, feed, zoneCap } from "./market.js";
import { Z, zoneStatus } from "./zones.js";
import { simStats } from "./alerts.js";
import { kl } from "./binance.js";
import { kvGet, kvSet } from "./store.js";
import { hhmmss, fullPR, sleep } from "./util.js";
import { sentData } from "./sentiment.js";

const SENT_NOTE = "\n\n# SENTIMIENTO (FEAR & GREED INDEX)\nEn [PANEL_HOT_ZONE] recibes sentimiento_fear_greed: crypto_btc_sol (alternative.me, 0-100) y acciones_ref_oro (CNN, acciones de EE. UU.; para el oro es solo referencia del ánimo general). 0-24 miedo extremo, 25-44 miedo, 45-55 neutral, 56-75 codicia, 76-100 codicia extrema. Úsalo como factor de contexto en cada zona con lectura contraria: miedo extremo en zona de compra o codicia extrema en zona de venta = confluencia; lo opuesto = más riesgo, pide mejor confirmación. Menciona el valor, el de ayer y el de hace 7 días cuando aporte. Nunca lo uses como gatillo de entrada ni como certeza. Si viene null, di que no hay dato.";

export const T = { calls: 0, errors: 0, lastErr: "", lastOk: 0, inTok: 0, outTok: 0 };
let hist = null;

export function panelData() {
  const now = Date.now(), out = { hora_PR: fullPR(now), mercados: {}, zonas: [], ordenes_1h: [], ai_crypto_senales: simStats(), sentimiento_fear_greed: sentData() };
  ORDER.forEach((k) => { const f = flow(k, 300000, now); out.mercados[k] = { precio: S[k].price, compras_5m: Math.round(f.buy), ventas_5m: Math.round(f.sell), retraso_datos_ms: S[k].lag == null ? null : Math.round(S[k].lag) }; });
  Z.list.forEach((z, i) => out.zonas.push({ mercado: z.sym, tipo: z.name, direccion: z.side === "buy" ? "Compra" : "Venta", bajo: z.lo, alto: z.hi, grado: z.grade || "", estado: z.estado || "", sl: z.sl, tp1: z.tp1, tp2: z.tp2, ahora: zoneStatus(z, i, S[z.sym].price)[0], capital_en_zona_24h: zoneCap(z, 86400000, 0), capital_cerca_1pct_4h: zoneCap(z, 14400000, 0.01) }));
  for (const o of feed) { if (out.ordenes_1h.length >= 25 || now - o.t > 3600000) break; if (o.usd < 1000000) continue; out.ordenes_1h.push([hhmmss(o.t), o.sym, o.side === "buy" ? "compra" : "venta", Math.round(o.usd), o.price]); }
  return out;
}

export async function aiAsk(question) {
  if (!ENV.anthropicKey) throw new Error("falta ANTHROPIC_API_KEY en Railway");
  if (!hist) hist = kvGet("aiHist", []) || [];
  const syms = ["BTCUSDT", "SOLUSDT", "XAUUSDT", "QQQUSDT"];
  const res = await Promise.all(syms.map((s) => Promise.all([kl(s, "4h", 42), kl(s, "1h", 36)])));
  const velas = {};
  syms.forEach((s, i) => { velas[s] = { "4h": res[i][0], "1h": res[i][1] }; });
  const ctx = "[PANEL_HOT_ZONE]\n" + JSON.stringify(panelData()) + "\n\n[VELAS]\n" + JSON.stringify(velas) + "\n\n[MAPA_INDICES]\n" + JSON.stringify(INDEX_MAP);
  const msgs = hist.slice(-8).concat([{ role: "user", content: ctx + "\n\n[PREGUNTA DE YASSER]\n" + question }]);
  const txt = await call(msgs, 1, false);
  hist.push({ role: "user", content: question }, { role: "assistant", content: txt });
  if (hist.length > 16) hist = hist.slice(-16);
  kvSet("aiHist", hist);
  return txt;
}

async function call(msgs, attempt, plain) {
  T.calls++;
  const body = { model: ENV.aiModel, max_tokens: 16000, system: AI_PROMPT + SENT_NOTE, messages: msgs };
  if (!plain) { body.thinking = { type: "between_tools" }; body.output_config = { effort: attempt >= 2 ? "low" : "medium" }; }
  let r, j;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": ENV.anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(300000),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    if (attempt < 4) { await sleep(4000 * attempt); return call(msgs, attempt + 1, plain); }
    return fail("Fallo de red del servidor hacia Anthropic (" + e.message + ")");
  }
  const msg = (j.error && j.error.message) || "HTTP " + r.status;
  if (!r.ok) {
    if (/credit|balance|billing|payment/i.test(msg)) return fail("SIN CRÉDITO en la API de Anthropic. Recarga en console.anthropic.com → Billing.");
    if (r.status === 401) return fail("La llave de Anthropic no es válida (401). Cámbiala en Railway → Variables → ANTHROPIC_API_KEY.");
    if (r.status === 400 && !plain) return call(msgs, attempt, true);
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await sleep(5000 * attempt); return call(msgs, attempt + 1, plain); }
    return fail(msg);
  }
  if (j.usage) { T.inTok += j.usage.input_tokens || 0; T.outTok += j.usage.output_tokens || 0; }
  const txt = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  if (!txt) {
    if (attempt < 3) return call(msgs, attempt + 1, plain);
    return fail("Claude no devolvió texto tras 3 intentos (motivo: " + (j.stop_reason || "desconocido") + ")");
  }
  T.lastOk = Date.now();
  return txt;
}
function fail(m) { T.errors++; T.lastErr = m; throw new Error(m); }
