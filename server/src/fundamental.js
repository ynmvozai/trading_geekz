// v4.5 · #macro-fundamental: análisis fundamental con data real.
// Fuentes: FRED (Reserva Federal de St. Louis, CSV público sin clave) y velas diarias de Binance (Bitcoin y oro).
// Nada se inventa: si una serie no llega, se dice "sin dato".
import { ENV } from "./config.js";
import { botPost, post } from "./discord.js";
import { klinesRaw } from "./binance.js";
import { kvGet, kvSet } from "./store.js";
import { log, prParts } from "./util.js";

const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", accept: "text/csv,*/*" };
export const FUND = { data: null, t: 0, err: "", sent: 0, lastErr: "" };

// Series de FRED que usamos (id → frecuencia)
export const SERIES = {
  CPIAUCSL: "m", CPILFESL: "m", PCEPILFE: "m", UNRATE: "m", SAHMREALTIME: "m", PAYEMS: "m", M2SL: "m",
  ICSA: "w", WALCL: "w", A191RL1Q225SBEA: "q",
  DFF: "d", DGS2: "d", DGS10: "d", T10Y2Y: "d", DTWEXBGS: "d", VIXCLS: "d", SP500: "d", NASDAQCOM: "d",
};
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesDe = (d) => MES[+d.slice(5, 7) - 1] + " " + d.slice(0, 4);

export function parseFred(csv) {
  const out = [];
  for (const line of String(csv || "").trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(",");
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v !== "." && v !== "" && isFinite(+v)) out.push([d, +v]);
  }
  return out;
}

async function fred(id, desde) {
  const r = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + id + "&cosd=" + desde, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(id + " HTTP " + r.status);
  const s = parseFred(await r.text());
  if (!s.length) throw new Error(id + " vacío");
  return s;
}

// ---------- Cálculos puros (se prueban sin red) ----------
const last = (s) => (s && s.length ? s[s.length - 1] : null);
const back = (s, n) => (s && s.length > n ? s[s.length - 1 - n] : null);
export function yoy(s) { const a = last(s), b = back(s, 12); return a && b ? (a[1] / b[1] - 1) * 100 : null; }
export function ann3(s) { const a = last(s), b = back(s, 3); return a && b ? ((a[1] / b[1]) ** 4 - 1) * 100 : null; }
// Valor de hace ~N días en una serie diaria/semanal (por fecha)
export function ago(s, days) {
  if (!s || !s.length) return null;
  const lim = new Date(Date.parse(last(s)[0]) - days * 86400000).toISOString().slice(0, 10);
  for (let i = s.length - 1; i >= 0; i--) if (s[i][0] <= lim) return s[i];
  return null;
}
const sma = (arr, n) => (arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : null);

// Régimen de un mercado con cierres diarios: tendencia alcista, bajista, consolidación o mixta.
export function marketRegime(closes) {
  if (!Array.isArray(closes) || closes.length < 210) return { estado: "sin dato", txt: "sin dato" };
  const c = closes[closes.length - 1], s50 = sma(closes, 50), s200 = sma(closes, 200);
  const rng = (i) => { const w = closes.slice(i - 20, i); return (Math.max(...w) - Math.min(...w)) / w[w.length - 1]; };
  const now = rng(closes.length), hist = [];
  for (let i = closes.length - 250 > 20 ? closes.length - 250 : 20; i < closes.length; i += 5) hist.push(rng(i));
  hist.sort((a, b) => a - b);
  const med = hist[Math.floor(hist.length / 2)];
  const d50 = (c / s50 - 1) * 100, ch20 = (c / closes[closes.length - 21] - 1) * 100;
  let estado;
  if (now < med * 0.7 && Math.abs(d50) < 3) estado = "consolidación";
  else if (c > s50 && s50 > s200) estado = "tendencia alcista";
  else if (c < s50 && s50 < s200) estado = "tendencia bajista";
  else estado = "mixto";
  const txt = estado + (estado === "consolidación" ? " (rango de 20 días " + (now * 100).toFixed(1) + "%, más estrecho de lo normal)" : "") +
    " · " + (c > s200 ? "arriba" : "abajo") + " de su media de 200 días · " + (ch20 >= 0 ? "+" : "") + ch20.toFixed(1) + "% en 1 mes";
  return { estado, txt, d50, ch20, rango20: now * 100 };
}

// Lectura completa a partir de las series ya bajadas.
export function analyze(S, mk = {}) {
  const R = { fechas: {} };
  // Inflación (subyacente: sin comida ni energía)
  const coreY = yoy(S.CPILFESL), core3 = ann3(S.CPILFESL), headY = yoy(S.CPIAUCSL), pceY = yoy(S.PCEPILFE);
  let inflTend = null;
  if (coreY != null && core3 != null) inflTend = core3 > coreY + 0.3 ? "acelerando" : core3 < coreY - 0.3 ? "bajando" : "estable";
  R.inflacion = { general_yoy: headY, subyacente_yoy: coreY, subyacente_3m_anualizada: core3, pce_subyacente_yoy: pceY, tendencia: inflTend,
    nivel: coreY == null ? null : coreY >= 3.5 ? "alta" : coreY >= 2.5 ? "arriba de la meta" : "cerca de la meta" };
  if (S.CPILFESL) R.fechas.inflacion = last(S.CPILFESL)[0];
  // Empleo y recesión
  const sahm = last(S.SAHMREALTIME), un = last(S.UNRATE);
  const pay3 = S.PAYEMS && S.PAYEMS.length > 3 ? (last(S.PAYEMS)[1] - back(S.PAYEMS, 3)[1]) / 3 : null; // miles por mes
  const cl4 = S.ICSA && S.ICSA.length >= 30 ? S.ICSA.slice(-4).reduce((a, b) => a + b[1], 0) / 4 : null;
  const cl4old = S.ICSA && S.ICSA.length >= 30 ? S.ICSA.slice(-30, -26).reduce((a, b) => a + b[1], 0) / 4 : null;
  const clCh = cl4 && cl4old ? (cl4 / cl4old - 1) * 100 : null;
  const gdp = last(S.A191RL1Q225SBEA);
  let riesgo = null;
  if (sahm || pay3 != null || clCh != null) {
    const s = sahm ? sahm[1] : 0;
    if (s >= 0.5 || (clCh != null && clCh > 20 && pay3 != null && pay3 < 50)) riesgo = "ALTO";
    else if (s >= 0.3 || (pay3 != null && pay3 < 75) || (clCh != null && clCh > 15) || (gdp && gdp[1] < 1)) riesgo = "MEDIO";
    else riesgo = "BAJO";
  }
  R.empleo = { desempleo: un ? un[1] : null, sahm: sahm ? sahm[1] : null, empleos_3m_miles_por_mes: pay3, solicitudes_desempleo_4sem: cl4, cambio_solicitudes_6m_pct: clCh, pib_trimestral_anualizado: gdp ? gdp[1] : null, pib_trimestre: gdp ? gdp[0] : null, riesgo_recesion: riesgo };
  if (un) R.fechas.empleo = un[0];
  // Fed y tasas
  const dff = last(S.DFF), dff90 = ago(S.DFF, 90), d2 = last(S.DGS2), d10 = last(S.DGS10), curva = last(S.T10Y2Y);
  const fedCh = dff && dff90 ? dff[1] - dff90[1] : null;
  const curvaMin = S.T10Y2Y && S.T10Y2Y.length ? Math.min(...S.T10Y2Y.slice(-500).map((x) => x[1])) : null;
  R.fed = { tasa: dff ? dff[1] : null, cambio_90d: fedCh, ciclo: fedCh == null ? null : fedCh <= -0.2 ? "recortando" : fedCh >= 0.2 ? "subiendo" : "en pausa",
    bono_2a: d2 ? d2[1] : null, bono_10a: d10 ? d10[1] : null,
    mercado_espera: dff && d2 ? (d2[1] < dff[1] - 0.25 ? "recortes" : d2[1] > dff[1] + 0.25 ? "subidas" : "tasas parecidas") : null,
    curva_10a_2a: curva ? curva[1] : null, curva_se_desinvirtio: curva && curvaMin != null ? curva[1] > 0 && curvaMin < 0 : null };
  // Dólar, miedo, liquidez
  const usd = last(S.DTWEXBGS), usd90 = ago(S.DTWEXBGS, 90), vix = last(S.VIXCLS), wal = last(S.WALCL), wal90 = ago(S.WALCL, 90);
  R.dolar = { cambio_3m_pct: usd && usd90 ? (usd[1] / usd90[1] - 1) * 100 : null };
  R.vix = vix ? vix[1] : null;
  R.liquidez = { balance_fed_3m_pct: wal && wal90 ? (wal[1] / wal90[1] - 1) * 100 : null, m2_yoy: yoy(S.M2SL) };
  // Mercados
  R.mercados = {
    "S&P 500": S.SP500 ? marketRegime(S.SP500.map((x) => x[1])) : { estado: "sin dato", txt: "sin dato" },
    Nasdaq: S.NASDAQCOM ? marketRegime(S.NASDAQCOM.map((x) => x[1])) : { estado: "sin dato", txt: "sin dato" },
    Bitcoin: marketRegime(mk.BTC), Oro: marketRegime(mk.XAU),
  };
  // Régimen (cuadrante crecimiento × inflación)
  const crec = riesgo == null ? null : riesgo === "BAJO" ? "firme" : riesgo === "MEDIO" ? "enfriándose" : "débil";
  let reg = null;
  if (crec && inflTend) {
    const sube = inflTend === "acelerando";
    reg = crec === "firme" ? (sube ? "REFLACIÓN" : "GOLDILOCKS") : sube ? "ESTANFLACIÓN" : "DESACELERACIÓN";
  }
  R.crecimiento = crec;
  R.regimen = reg;
  return R;
}

const REG = {
  GOLDILOCKS: ["Goldilocks: la economía crece y la inflación se calma", "Históricamente suele favorecer a las acciones y a cripto; el oro depende más del dólar y de las tasas."],
  "REFLACIÓN": ["Reflación: la economía crece pero la inflación vuelve a subir", "Suele empujar tasas y dólar hacia arriba: presión para Nasdaq y cripto; el oro aguanta si la inflación sorprende."],
  "ESTANFLACIÓN": ["Estanflación en riesgo: la economía se enfría y la inflación sube", "Históricamente es el entorno más difícil para las acciones; el oro suele defenderse mejor."],
  "DESACELERACIÓN": ["Desaceleración: la economía se enfría y la inflación baja", "El mercado suele adelantar recortes de la Fed: el oro y los bonos tienden a subir; acciones y cripto con más altibajos."],
};
const pct = (v, d = 1) => (v == null ? "sin dato" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
const num = (v, d = 2) => (v == null ? "sin dato" : v.toFixed(d));

export function panoramaText(R = FUND.data) {
  if (!R) return "🌎 Panorama macro: sin dato todavía" + (FUND.err ? " (" + FUND.err + ")" : "") + ".";
  const I = R.inflacion, E = R.empleo, F = R.fed, L = [];
  const pp = prParts();
  L.push("🌎 Panorama macro · " + pp.date);
  if (R.regimen) L.push("**Régimen: " + REG[R.regimen][0] + "**");
  L.push("🔥 Inflación " + (I.general_yoy == null ? "sin dato" : I.general_yoy.toFixed(1) + "% general") + " · subyacente (sin comida ni energía) " + (I.subyacente_yoy == null ? "sin dato" : I.subyacente_yoy.toFixed(1) + "%") + (I.tendencia ? " · " + I.tendencia + " (ritmo de 3 meses " + num(I.subyacente_3m_anualizada, 1) + "%)" : "") + " · meta de la Fed 2%" + (R.fechas.inflacion ? " · dato de " + mesDe(R.fechas.inflacion) : ""));
  L.push("👷 Empleo: desempleo " + (E.desempleo == null ? "sin dato" : E.desempleo.toFixed(1) + "%") + (E.empleos_3m_miles_por_mes == null ? "" : " · " + (E.empleos_3m_miles_por_mes >= 0 ? "+" : "") + Math.round(E.empleos_3m_miles_por_mes) + " mil empleos/mes (promedio 3 meses)") + (E.cambio_solicitudes_6m_pct == null ? "" : " · solicitudes de desempleo " + pct(E.cambio_solicitudes_6m_pct, 0) + " vs hace 6 meses"));
  if (E.riesgo_recesion) L.push((E.riesgo_recesion === "ALTO" ? "🔴" : E.riesgo_recesion === "MEDIO" ? "🟠" : "🟢") + " Riesgo de recesión " + E.riesgo_recesion + " · regla de Sahm " + num(E.sahm) + " (0.50 o más = señal)" + (E.pib_trimestral_anualizado == null ? "" : " · PIB " + E.pib_trimestral_anualizado.toFixed(1) + "% anualizado"));
  L.push("🏦 Fed: tasa " + num(F.tasa) + "% · " + (F.ciclo || "sin dato") + (F.mercado_espera ? " · el mercado espera " + F.mercado_espera + " (bono de 2 años " + num(F.bono_2a) + "%)" : ""));
  L.push("📉 Curva de bonos 10a − 2a: " + (F.curva_10a_2a == null ? "sin dato" : (F.curva_10a_2a > 0 ? "+" : "") + F.curva_10a_2a.toFixed(2)) + (F.curva_10a_2a == null ? "" : F.curva_10a_2a < 0 ? " · invertida (alerta clásica de recesión)" : F.curva_se_desinvirtio ? " · volvió a positivo tras estar invertida: históricamente varias recesiones llegaron después de ese giro" : " · normal"));
  const dol = R.dolar.cambio_3m_pct;
  L.push("💵 Dólar " + pct(dol) + " en 3 meses" + (dol == null ? "" : dol > 2 ? " · más fuerte: presión para oro y cripto" : dol < -2 ? " · más débil: viento a favor de oro y cripto" : " · estable"));
  L.push("😰 VIX (miedo en acciones) " + num(R.vix, 1) + (R.vix == null ? "" : R.vix < 15 ? " · calma" : R.vix < 20 ? " · normal" : R.vix < 30 ? " · tensión" : " · pánico"));
  L.push("💧 Liquidez: balance de la Fed " + pct(R.liquidez.balance_fed_3m_pct) + " en 3 meses · dinero M2 " + pct(R.liquidez.m2_yoy) + " anual");
  L.push("");
  L.push("**Cómo están los mercados**");
  for (const [k, v] of Object.entries(R.mercados)) L.push("• " + k + ": " + v.txt);
  if (R.regimen) {
    L.push(""); L.push("📚 " + REG[R.regimen][1]);
    const choque = F.mercado_espera === "subidas" && R.regimen === "DESACELERACIÓN" ? "Ojo: hoy los bonos esperan SUBIDAS de tasa, no recortes; eso pesa más en el corto plazo."
      : F.mercado_espera === "recortes" && R.regimen === "REFLACIÓN" ? "Ojo: hoy los bonos esperan RECORTES de tasa; si la inflación sigue subiendo, eso puede cambiar rápido." : "";
    if (choque) L.push("⚠️ " + choque);
  }
  L.push("-# Fuente: FRED (Reserva Federal de St. Louis) y Binance. Es contexto para decidir, no una señal de entrada.");
  return L.join("\n");
}

// Para TITO (respuestas en #agent y plan diario): compacto.
export function fundForAi() {
  const R = FUND.data;
  if (!R) return { estado: "sin dato", error: FUND.err || null };
  return { regimen: R.regimen, crecimiento: R.crecimiento, inflacion: R.inflacion, empleo: R.empleo, fed: R.fed, dolar_3m_pct: R.dolar.cambio_3m_pct, vix: R.vix, liquidez: R.liquidez,
    mercados: Object.fromEntries(Object.entries(R.mercados).map(([k, v]) => [k, v.txt])), fechas: R.fechas, actualizado: new Date(FUND.t).toISOString() };
}

// ---------- Red ----------
export async function refreshFund() {
  const desde = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10), S = {}, errs = [];
  for (const id of Object.keys(SERIES)) {
    try { S[id] = await fred(id, desde); } catch (e) { errs.push(e.message); }
  }
  const mk = {};
  for (const [k, sym] of [["BTC", "BTCUSDT"], ["XAU", "XAUUSDT"]]) {
    try { mk[k] = (await klinesRaw(sym, "1d", 400)).map((x) => +x[4]); } catch (e) { errs.push(sym + " " + e.message); }
  }
  if (Object.keys(S).length < 6) { FUND.err = errs.slice(0, 3).join(" · ") || "sin respuesta"; log("Macro FRED falló:", FUND.err); return null; }
  const prev = FUND.data;
  FUND.data = analyze(S, mk); FUND.t = Date.now(); FUND.err = errs.length ? errs.length + " series sin dato" : "";
  FUND.series = S;
  return prev;
}

async function send(txt) {
  try {
    if (ENV.hooks.macro) await post(ENV.hooks.macro, { content: txt.slice(0, 1990) });
    else await botPost(ENV.macroChannelId, txt);
    FUND.sent++; FUND.lastErr = "";
  } catch (e) { FUND.lastErr = e.message; log("#macro-fundamental falló:", e.message); }
}
export const fundSend = send;

// Aviso corto cuando sale un dato nuevo (inflación, empleo, PCE, PIB).
const NUEVOS = [
  ["CPILFESL", "🔥 Inflación subyacente (CPI)", (S) => yoy(S.CPILFESL), (v, p) => v.toFixed(1) + "% anual" + (p != null ? " (antes " + p.toFixed(1) + "%)" : "")],
  ["UNRATE", "👷 Desempleo", (S) => last(S.UNRATE)[1], (v, p) => v.toFixed(1) + "%" + (p != null ? " (antes " + p.toFixed(1) + "%)" : "")],
  ["PCEPILFE", "🔥 Inflación PCE subyacente (la que mira la Fed)", (S) => yoy(S.PCEPILFE), (v, p) => v.toFixed(1) + "% anual" + (p != null ? " (antes " + p.toFixed(1) + "%)" : "")],
  ["A191RL1Q225SBEA", "🏭 PIB", (S) => last(S.A191RL1Q225SBEA)[1], (v, p) => v.toFixed(1) + "% anualizado" + (p != null ? " (antes " + p.toFixed(1) + "%)" : "")],
];
export function newDataTexts(S, seen) {
  const out = [];
  for (const [id, name, val, fmt] of NUEVOS) {
    if (!S[id] || !S[id].length) continue;
    const d = last(S[id])[0];
    if (!seen[id]) { seen[id] = d; continue; }      // primera vez: solo memoriza
    if (seen[id] === d) continue;
    seen[id] = d;
    const v = val(S), p = val({ [id]: S[id].slice(0, -1) });
    if (v == null) continue;
    out.push(name + " de " + mesDe(d) + ": " + fmt(v, p));
  }
  return out;
}

export async function fundTick(now = Date.now()) {
  const pp = prParts(now);
  if (kvGet("macroOff", false)) return;
  // Datos nuevos: revisa a las 9:00, 11:00 y 15:00 PR los días de semana.
  if (!/Sat|Sun/.test(pp.weekday) && [9, 11, 15].includes(pp.hour) && pp.minute < 5 && kvGet("macroChk") !== pp.date + pp.hour) {
    kvSet("macroChk", pp.date + pp.hour);
    await refreshFund();
    if (FUND.series) {
      const seen = kvGet("macroSeen", {}) || {}, nuevos = newDataTexts(FUND.series, seen);
      kvSet("macroSeen", seen);
      if (nuevos.length) {
        const R = FUND.data;
        await send(["🆕 Dato nuevo de la economía", ...nuevos, R.regimen ? "Régimen ahora: " + REG[R.regimen][0] : "", "-# Escribe “macro” en #agent para el panorama completo."].filter(Boolean).join("\n"));
      }
    }
  }
  // Panorama completo: lunes 8:30 AM PR.
  if (pp.weekday === "Mon" && pp.hour === 8 && pp.minute >= 30 && kvGet("macroWeekly") !== pp.date) {
    kvSet("macroWeekly", pp.date);
    await refreshFund();
    await send(panoramaText());
  }
}

export function fundEstado() {
  if (!FUND.t && !FUND.err) return "⏳ Macro (#macro-fundamental): leyendo FRED…";
  return (FUND.data && !FUND.lastErr ? "✅" : "❌") + " Macro (#macro-fundamental): " + (FUND.data ? "régimen " + (FUND.data.regimen || "sin dato") + " · actualizado " + new Date(FUND.t).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "sin dato" + (FUND.err ? " (" + FUND.err + ")" : "")) +
    " · enviados " + FUND.sent + (FUND.lastErr ? " · último error: " + FUND.lastErr : "") + (kvGet("macroOff", false) ? " · apagado" : "");
}

export function startFund() {
  // Primera lectura y memoria de fechas (sin publicar) al arrancar; luego refresca cada 6 h.
  setTimeout(async () => {
    await refreshFund();
    if (FUND.series) { const seen = kvGet("macroSeen", {}) || {}; newDataTexts(FUND.series, seen); kvSet("macroSeen", seen); }
  }, 30000);
  setInterval(() => { refreshFund().catch(() => {}); }, 6 * 3600000);
  setInterval(() => { fundTick().catch((e) => log("fundTick", e.message)); }, 60000);
}
