// Sentimiento del mercado: Fear & Greed Index (data real, sin inventar).
// · Crypto (BTC, SOL): alternative.me — índice diario de miedo/codicia del mercado cripto.
// · Oro: CNN Fear & Greed (mercado de acciones de EE. UU.). Es referencia del ánimo general, no del oro en sí.
// Si una fuente falla, se dice "sin dato"; nunca se rellena.
import { log } from "./util.js";

export const SENT = {
  crypto: null, // { v, label, prev, week, t, fuente }
  stocks: null,
  lastErr: { crypto: "", stocks: "" },
};

export function labelEs(v) {
  if (v == null || !isFinite(v)) return "sin dato";
  if (v <= 24) return "Miedo extremo";
  if (v <= 44) return "Miedo";
  if (v <= 55) return "Neutral";
  if (v <= 75) return "Codicia";
  return "Codicia extrema";
}
export function emoji(v) {
  if (v == null) return "⚪";
  return v <= 24 ? "😱" : v <= 44 ? "😟" : v <= 55 ? "😐" : v <= 75 ? "😏" : "🤑";
}

async function fetchCrypto() {
  const r = await fetch("https://api.alternative.me/fng/?limit=8", { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const d = j && j.data;
  if (!Array.isArray(d) || !d.length) throw new Error("respuesta vacía");
  const v = +d[0].value;
  if (!isFinite(v)) throw new Error("valor inválido");
  return { v, label: labelEs(v), prev: d[1] ? +d[1].value : null, week: d[7] ? +d[7].value : null, t: +d[0].timestamp * 1000, fuente: "alternative.me (crypto)" };
}

async function fetchStocks() {
  const r = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const f = j && j.fear_and_greed;
  const v = f ? Math.round(+f.score) : NaN;
  if (!isFinite(v)) throw new Error("valor inválido");
  return { v, label: labelEs(v), prev: f.previous_close != null ? Math.round(+f.previous_close) : null, week: f.previous_1_week != null ? Math.round(+f.previous_1_week) : null, t: Date.parse(f.timestamp) || Date.now(), fuente: "CNN (acciones EE. UU.)" };
}

export async function refreshSentiment() {
  try { SENT.crypto = await fetchCrypto(); SENT.lastErr.crypto = ""; } catch (e) { SENT.lastErr.crypto = e.message; log("Fear & Greed crypto falló:", e.message); }
  try { SENT.stocks = await fetchStocks(); SENT.lastErr.stocks = ""; } catch (e) { SENT.lastErr.stocks = e.message; log("Fear & Greed CNN falló:", e.message); }
}

export function startSentiment() {
  refreshSentiment();
  setInterval(refreshSentiment, 30 * 60000); // el índice cambia una vez al día; se revisa cada 30 min
}

// Qué índice aplica a cada mercado.
export function sentFor(sym) {
  return sym === "XAU" ? SENT.stocks : SENT.crypto;
}

// Lectura contraria clásica: miedo extremo en zona de compra / codicia extrema en zona de venta = confluencia.
// Es contexto, no una orden. Devuelve { tag: "a favor" | "contra" | "neutral" | "sin dato", txt }.
export function sentRead(side, s) {
  if (!s || s.v == null) return { tag: "sin dato", txt: "Sentimiento: sin dato ahora." };
  const v = s.v, buy = side === "buy";
  if (buy && v <= 24) return { tag: "a favor", txt: "✅ Miedo extremo en zona de COMPRA: la masa vende con miedo; históricamente es cuando más rebotes aparecen (confluencia)." };
  if (!buy && v >= 76) return { tag: "a favor", txt: "✅ Codicia extrema en zona de VENTA: la masa compra con euforia; históricamente es cuando más correcciones aparecen (confluencia)." };
  if (buy && v >= 76) return { tag: "contra", txt: "⚠️ Codicia extrema en zona de COMPRA: comprar aquí es ir con la euforia. Más riesgo de trampa; exige mejor confirmación." };
  if (!buy && v <= 24) return { tag: "contra", txt: "⚠️ Miedo extremo en zona de VENTA: vender aquí es ir con el pánico. Riesgo de rebote fuerte; exige mejor confirmación." };
  if (buy && v <= 44) return { tag: "a favor", txt: "🟢 Miedo en zona de compra: el sentimiento acompaña la zona (confluencia moderada)." };
  if (!buy && v >= 56) return { tag: "a favor", txt: "🟢 Codicia en zona de venta: el sentimiento acompaña la zona (confluencia moderada)." };
  return { tag: "neutral", txt: "⚪ Sentimiento sin ventaja clara para esta zona." };
}

export function sentLine(s) {
  if (!s) return "sin dato";
  const ch = s.prev != null ? " · ayer " + s.prev : "";
  const wk = s.week != null ? " · hace 7 días " + s.week : "";
  return emoji(s.v) + " **" + s.v + "/100 · " + s.label + "**" + ch + wk;
}

export function sentimentText() {
  const L = ["🧭 **Sentimiento del mercado (Fear & Greed Index)**", "0 = miedo extremo · 100 = codicia extrema"];
  L.push("Crypto (BTC, SOL): " + (SENT.crypto ? sentLine(SENT.crypto) + " · fuente " + SENT.crypto.fuente : "sin dato" + (SENT.lastErr.crypto ? " (" + SENT.lastErr.crypto + ")" : "")));
  L.push("Acciones EE. UU. (referencia para oro e índices): " + (SENT.stocks ? sentLine(SENT.stocks) + " · fuente " + SENT.stocks.fuente : "sin dato" + (SENT.lastErr.stocks ? " (" + SENT.lastErr.stocks + ")" : "")));
  L.push("_Lectura contraria: el miedo extremo suele acompañar suelos y la codicia extrema techos, pero no marca el momento exacto. Es contexto para la zona, no una entrada._");
  return L.join("\n");
}

// Para TITO y /state.
export function sentData() {
  const f = (s, e) => (s ? { valor: s.v, nivel: s.label, ayer: s.prev, hace_7_dias: s.week, fuente: s.fuente } : { valor: null, nivel: "sin dato", error: e || null });
  return { crypto_btc_sol: f(SENT.crypto, SENT.lastErr.crypto), acciones_ref_oro: f(SENT.stocks, SENT.lastErr.stocks) };
}
