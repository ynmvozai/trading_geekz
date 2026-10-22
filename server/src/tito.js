// TITO: agente con Claude (Anthropic Messages API). Prompt copiado sin cambios del panel v2.4.
import { ENV, ORDER } from "./config.js";
import { AI_PROMPT, INDEX_MAP } from "./prompts.js";
import { S, flow, feed, zoneCap } from "./market.js";
import { Z, zoneStatus, isBroken } from "./zones.js";
import { B } from "./bias.js";
import { simStats } from "./alerts.js";
import { kl } from "./binance.js";
import { kvGet, kvSet } from "./store.js";
import { hhmmss, fullPR, sleep } from "./util.js";
import { sentData } from "./sentiment.js";
import { calForAi, refreshIdx, idxForAi } from "./macro.js";
import { idxZones } from "./sesionny.js";
import { idxBars } from "./chart.js";
import { fundForAi } from "./fundamental.js";

const SENT_NOTE = "\n\n# SESGO DE ORDER FLOW (TERMÓMETRO)\nEn [PANEL_HOT_ZONE] recibes sesgo_order_flow por mercado: COMPRADORES (+2 o más), VENDEDORES (−2 o menos) o NEUTRAL, con sus razones (estructura 1H, tendencia 4H con medias 20/50, neto de ballenas 4 h y zonas rotas) y atr_1h_pct (movimiento normal por hora). Regla: no propongas zonas en contra del sesgo como prioritarias; si lo haces, márcalas \"contra tendencia\". Una zona con estado ROTA ya no vale. Pon el stop a más de medio movimiento normal de 1 hora de la entrada (0.5 × atr_1h_pct).\n\n# SENTIMIENTO (FEAR & GREED INDEX)\nEn [PANEL_HOT_ZONE] recibes sentimiento_fear_greed: crypto_btc_sol (alternative.me, 0-100) y acciones_ref_oro (CNN, acciones de EE. UU.; para el oro es solo referencia del ánimo general). 0-24 miedo extremo, 25-44 miedo, 45-55 neutral, 56-75 codicia, 76-100 codicia extrema. Úsalo como factor de contexto en cada zona con lectura contraria: miedo extremo en zona de compra o codicia extrema en zona de venta = confluencia; lo opuesto = más riesgo, pide mejor confirmación. Menciona el valor, el de ayer y el de hace 7 días cuando aporte. Nunca lo uses como gatillo de entrada ni como certeza. Si viene null, di que no hay dato.\n\n# CALENDARIO E ÍNDICES (ACTUALIZACIÓN v3.2)\nYa tienes calendario conectado: [PANEL_HOT_ZONE].calendario_usd_7_dias trae los eventos USD de impacto medio y alto (Forex Factory, hora de PR). Úsalo para noticias; si dice sin dato, dilo. Esto reemplaza lo que dice arriba sobre no tener calendario. Cuando recibas [INDICES], son futuros reales de US30 (YM) y NAS100 (NQ): úsalos en vez de QQQUSDT.\n\n# MACRO FUNDAMENTAL (v4.5)\nEn [PANEL_HOT_ZONE].macro_fundamental tienes data real de FRED (Reserva Federal de St. Louis): inflación (general, subyacente, ritmo de 3 meses, PCE), empleo (desempleo, empleos por mes, solicitudes, regla de Sahm, PIB), Fed (tasa, ciclo, bono de 2 y 10 años, curva 10a−2a), dólar, VIX, liquidez y el régimen de cada mercado (tendencia alcista, bajista, consolidación o mixto). Úsalo cuando Yasser pregunte por inflación, recesión, la Fed, consolidación o el panorama; cita el dato y su fecha. Es contexto, nunca gatillo de entrada. Si viene sin dato, dilo.";

const CHART_NOTE = "[GRAFICA_E_INDICES · instrucciones del servidor v4.30]\n" +
  "0) Pares de Yasser en TradingView (lista 'Pares de Yasser'): GBEBROKERS:DJ30, GBEBROKERS:USTEC, GBEBROKERS:XAUUSD, COINBASE:BTCUSD, COINBASE:SOLUSD, COINBASE:ETHUSD y TVC:DXY. Tus datos: Dow y Nasdaq = futuros YM/NQ (él confirmó que coinciden con su gráfica), BTC/SOL/ETH/oro = Binance futuros, DXY = índice del dólar (Yahoo). Puede haber diferencias de unos puntos con su bróker o con Coinbase.\n" +
  "1) [INDICES] trae los futuros EN VIVO del Dow (YM) y del Nasdaq (NQ): precio, velas 15m y 1h reales, y zonas_hoy del Plan NY. Úsalos para contestar sobre el Dow y el Nasdaq; no digas que no tienes precio si vienen con datos. Son futuros: el CFD del bróker de Yasser (DJ30/USTEC) puede diferir unos puntos; dilo cuando des niveles exactos.\n" +
  "2) Cuando propongas una entrada o escenario con niveles, o Yasser pida ver la gráfica, añade AL FINAL de tu respuesta una línea exacta, sin nada más en esa línea:\n" +
  "[[GRAFICO]]{\"mercado\":\"US30|NAS100|BTC|SOL|ETH|ORO|DXY\",\"tf\":\"5m|15m|1h|4h\",\"lado\":\"compra|venta\",\"entrada\":0,\"stop\":0,\"meta\":0,\"zona\":[0,0]}[[/GRAFICO]]\n" +
  "con los números reales (los mismos de tu respuesta). El servidor dibuja la gráfica con las mismas velas que ves y la envía como imagen. Si solo pide ver la gráfica sin entrada, omite entrada/stop/meta. Máximo 2 gráficas.";

async function idxLive() {
  try { await refreshIdx(); } catch {}
  const base = idxForAi(), zs = idxZones();
  for (const [key, k] of [["US30_futuros_YM", "YM"], ["NAS100_futuros_NQ", "NQ"]]) {
    const o = base[key] || {};
    try { o.velas_15m = (await idxBars(k, "15m")).slice(-48).map((b) => [new Date(b[0]).toISOString().slice(5, 16).replace("T", " "), ...b.slice(1).map((v) => +v.toFixed(2))]); } catch (e) { o.velas_15m = "sin datos (" + e.message + ")"; }
    try { o.velas_1h = (await idxBars(k, "1h")).slice(-48).map((b) => [new Date(b[0]).toISOString().slice(5, 16).replace("T", " "), ...b.slice(1).map((v) => +v.toFixed(2))]); } catch {}
    o.zonas_hoy = zs.filter((z) => z.sym === (k === "YM" ? "US30" : "NQ"));
    delete o.velas_diarias_largas;
    base[key] = o;
  }
  try { const d = await idxBars("DXY", "1h"); base.DXY_indice_dolar = { precio: d.length ? +d[d.length - 1][4].toFixed(3) : null, velas_1h: d.slice(-36).map((b) => [new Date(b[0]).toISOString().slice(5, 16).replace("T", " "), ...b.slice(1).map((v) => +v.toFixed(3))]) }; } catch (e) { base.DXY_indice_dolar = "sin datos (" + e.message + ")"; }
  return base;
}

export const T = { calls: 0, errors: 0, lastErr: "", lastOk: 0, inTok: 0, outTok: 0 };
let hist = null;

export function panelData() {
  const now = Date.now(), out = { hora_PR: fullPR(now), mercados: {}, zonas: [], ordenes_1h: [], ai_crypto_senales: simStats(), sentimiento_fear_greed: sentData(), calendario_usd_7_dias: calForAi(), macro_fundamental: fundForAi(), sesgo_order_flow: Object.fromEntries(ORDER.map((k) => [k, B[k] ? { sesgo: B[k].label, puntaje: B[k].score, razones: B[k].reasons, atr_1h_pct: B[k].atrPct } : null])) };
  ORDER.forEach((k) => { const f = flow(k, 300000, now); out.mercados[k] = { precio: S[k].price, compras_5m: Math.round(f.buy), ventas_5m: Math.round(f.sell), retraso_datos_ms: S[k].lag == null ? null : Math.round(S[k].lag) }; });
  Z.list.forEach((z, i) => out.zonas.push({ mercado: z.sym, tipo: z.name, direccion: z.side === "buy" ? "Compra" : "Venta", bajo: z.lo, alto: z.hi, grado: z.grade || "", estado: isBroken(z) ? "ROTA (el precio pasó el stop: no la uses)" : z.estado || "", sl: z.sl, tp1: z.tp1, tp2: z.tp2, ahora: zoneStatus(z, i, S[z.sym].price)[0], capital_en_zona_24h: zoneCap(z, 86400000, 0), capital_cerca_1pct_4h: zoneCap(z, 14400000, 0.01) }));
  for (const o of feed) { if (out.ordenes_1h.length >= 25 || now - o.t > 3600000) break; if (o.usd < 1000000) continue; out.ordenes_1h.push([hhmmss(o.t), o.sym, o.side === "buy" ? "compra" : "venta", Math.round(o.usd), o.price]); }
  return out;
}

export async function aiAsk(question, extra = "", label = "") {
  if (!ENV.anthropicKey) throw new Error("falta ANTHROPIC_API_KEY en Railway");
  if (!hist) hist = kvGet("aiHist", []) || [];
  const syms = ["BTCUSDT", "SOLUSDT", "XAUUSDT", "ETHUSDT"];   // v4.32: ETH (está en su lista de TradingView); QQQ ya no hace falta
  const res = await Promise.all(syms.map((s) => Promise.all([kl(s, "4h", 42), kl(s, "1h", 36)])));
  const velas = {};
  syms.forEach((s, i) => { velas[s] = { "4h": res[i][0], "1h": res[i][1] }; });
  // v4.30 (Yasser): TITO ve el Dow y el Nasdaq en vivo cuando se lo piden: futuros YM/NQ (CNBC) + velas reales 15m y 1h (Yahoo).
  const ctx = "[PANEL_HOT_ZONE]\n" + JSON.stringify(panelData()) + "\n\n[VELAS]\n" + JSON.stringify(velas) + "\n\n[INDICES]\n" + JSON.stringify(await idxLive()) +
    "\n\n[MAPA_INDICES_VIEJO]\n(del 7 oct; solo referencia histórica, usa [INDICES])\n" + JSON.stringify(INDEX_MAP) + "\n\n" + CHART_NOTE + (extra ? "\n\n" + extra : "");
  const msgs = hist.slice(-8).concat([{ role: "user", content: ctx + "\n\n[PREGUNTA DE YASSER]\n" + question }]);
  const txt = await call(msgs, 1, false);
  hist.push({ role: "user", content: label || question }, { role: "assistant", content: txt });
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
