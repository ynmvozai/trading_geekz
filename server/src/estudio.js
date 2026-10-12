// v4.4 · Estudio de mercado hacia el pasado (backtest) con data REAL de Binance futuros. Corre en el servidor.
// Fase 1 · Ballenas: reconstruye las órdenes (ráfagas de 250 ms) con los aggTrades históricos de data.binance.vision
//          (1 día por semana durante 12 meses) y mide qué hizo el precio 15 min / 1 h / 4 h después.
// Fase 2 · Zonas + reglas: detecta order blocks y fair value gaps de 1H/4H con código (tu método) y simula
//          entradas con velas de 1 minuto: stop, meta, confirmación, filtro de tendencia. Afina con 8 meses, valida con 4.
// Fase 3 · Validación: resultados fuera de muestra, sentimiento (Fear & Greed) y TITO "a ciegas" en 20 días.
// Nunca inventa: si una fuente falla, el resultado dice "sin datos".
import zlib from "node:zlib";
import { Readable, Transform } from "node:stream";
import readline from "node:readline";
import { ENV, SYMS, NAMES, BURST_MS } from "./config.js";
import { klinesRaw } from "./binance.js";
import { kvGet, kvSet } from "./store.js";
import { log, sleep } from "./util.js";
import { parseAiZones } from "./zones.js";

export const EST = { running: false, fase: "", progreso: "", inicio: 0, error: "" };
const DAY = 86400000, H = 3600000;
const MARKETS = ["BTC", "SOL", "XAU"];
const FEE_RT = 0.001; // comisión ida y vuelta (taker 0.05 % × 2)

// ---------- Velas ----------
async function klinesRange(sym, interval, from, to) {
  const ms = { "1m": 60000, "1h": H, "4h": 4 * H, "1d": DAY }[interval], out = [];
  let t = from;
  while (t < to) {
    let a;
    for (let k = 0; k < 3; k++) { try { a = await klinesRaw(SYMS[sym].label, interval, 1500, t); break; } catch (e) { if (k === 2) throw e; await sleep(2000); } }
    if (!a || !a.length) break;
    for (const r of a) if (+r[0] < to) out.push([+r[0], +r[1], +r[2], +r[3], +r[4], +r[7]]);
    const last = +a[a.length - 1][0];
    if (last + ms <= t) break;
    t = last + ms;
    await sleep(120);
  }
  return out;
}
// 1 minuto en arreglos compactos: t, h, l, c
export async function minutes(sym, from, to) {
  const k = await klinesRange(sym, "1m", from, to), n = k.length;
  const M = { t: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), n };
  k.forEach((r, i) => { M.t[i] = r[0]; M.h[i] = r[2]; M.l[i] = r[3]; M.c[i] = r[4]; });
  return M;
}
function idxAt(M, t) { let lo = 0, hi = M.n - 1; if (hi < 0 || t < M.t[0]) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (M.t[m] <= t) lo = m; else hi = m - 1; } return lo; }
const emaArr = (v, n) => { const k = 2 / (n + 1), o = new Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
function atrArr(K, n = 14) { const o = new Array(K.length).fill(null); let s = 0; const tr = []; for (let i = 1; i < K.length; i++) { const t = Math.max(K[i][2] - K[i][3], Math.abs(K[i][2] - K[i - 1][4]), Math.abs(K[i][3] - K[i - 1][4])); tr.push(t); s += t; if (tr.length > n) s -= tr[tr.length - 1 - n]; if (tr.length >= n) o[i] = s / n; } return o; }
// Tendencia 4H (media 20 vs 50) vigente en el instante t: +1 sube, −1 baja, 0 plano
function trendFn(K4) { const c = K4.map((k) => k[4]), e20 = emaArr(c, 20), e50 = emaArr(c, 50); return (t) => { let i = -1; for (let lo = 0, hi = K4.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (K4[m][0] + 4 * H <= t) { i = m; lo = m + 1; } else hi = m - 1; } if (i < 50) return 0; return e20[i] > e50[i] * 1.001 ? 1 : e20[i] < e50[i] * 0.999 ? -1 : 0; }; }
const etHour = (t) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false, weekday: "short" }).formatToParts(new Date(t)); const g = (x) => (p.find((q) => q.type === x) || {}).value; return { h: +g("hour") % 24, m: +g("minute"), wd: g("weekday") }; };
const isNY = (t) => { const e = etHour(t), mm = e.h * 60 + e.m; return !["Sat", "Sun"].includes(e.wd) && mm >= 570 && mm < 960; };

// ---------- Fase 1 · Ballenas ----------
// Quita la cabecera del .zip (un solo archivo) y deja pasar los datos comprimidos.
function zipStrip() {
  let buf = Buffer.alloc(0), skip = -1;
  return new Transform({ transform(ch, _e, cb) {
    if (skip === 0) return cb(null, ch);
    buf = Buffer.concat([buf, ch]);
    if (skip < 0) { if (buf.length < 30) return cb(); skip = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28); }
    if (buf.length < skip) return cb();
    const rest = buf.subarray(skip); skip = 0; buf = null; cb(null, rest);
  } });
}
export async function dayBursts(sym, day, minBig) {
  const d = new Date(day).toISOString().slice(0, 10), label = SYMS[sym].label;
  const url = (process.env.BINANCE_DATA || "https://data.binance.vision") + "/data/futures/um/daily/aggTrades/" + label + "/" + label + "-aggTrades-" + d + ".zip";
  const r = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("HTTP " + r.status + " " + d);
  const inflate = zlib.createInflateRaw({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
  const src = Readable.fromWeb(r.body).pipe(zipStrip()).pipe(inflate);
  const rl = readline.createInterface({ input: src, crlfDelay: Infinity });
  const out = [], cur = { buy: null, sell: null };
  const close = (b) => { if (b && b.usd >= minBig) out.push({ t: b.first, side: b.side, usd: b.usd, px: b.usd / b.q }); };
  try {
    for await (const line of rl) {
      const c = line.charCodeAt(0); if (c < 48 || c > 57) continue;        // cabecera
      const f = line.split(","), p = +f[1], q = +f[2], T = +f[5], side = f[6] === "true" ? "sell" : "buy", n = p * q;
      const b = cur[side];
      if (b && T - b.first <= BURST_MS) { b.usd += n; b.q += q; }
      else { close(b); cur[side] = { side, first: T, usd: n, q }; }
    }
  } catch (e) { if (!out.length) throw e; }
  close(cur.buy); close(cur.sell);
  return out;
}
const tierOf = (usd, min) => (usd >= 5 * min ? "5×+ mínimo" : usd >= 2 * min ? "2–5× mínimo" : usd >= min ? "1–2× mínimo" : "⅓–1× mínimo");
function agg(rows) {
  const n = rows.length; if (!n) return null;
  const f = (k) => { const v = rows.map((r) => r[k]).filter((x) => x != null); return v.length ? { acierto: Math.round((v.filter((x) => x > 0).length / v.length) * 100), prom: +((v.reduce((a, b) => a + b, 0) / v.length) * 100).toFixed(3) } : null; };
  return { n, m15: f("r15"), h1: f("r60"), h4: f("r240") };
}
// v4.6: paso de 6 días (antes 7). Con 7 todos los días caían en el mismo día de la semana (sábados) y no había sesión NY.
export async function fase1(days = 365, step = 6) {
  const res = { fase: 1, generado: Date.now(), periodo_dias: days, muestra: "1 día cada " + step, mercados: {} };
  const end = Math.floor(Date.now() / DAY) * DAY - DAY, start = end - days * DAY;
  for (const sym of MARKETS) {
    const min = SYMS[sym].min, minBig = min / 3, all = [];
    EST.progreso = "Fase 1 · " + NAMES[sym] + " · descargando velas 4H";
    let K4 = []; try { K4 = await klinesRange(sym, "4h", start - 60 * 4 * H, end + DAY); } catch (e) { log("estudio 4h", e.message); }
    const trend = trendFn(K4);
    let dias = 0, sinDato = 0;
    const wd = {};
    for (let d = start; d < end; d += step * DAY) {
      EST.progreso = "Fase 1 · " + NAMES[sym] + " · día " + new Date(d).toISOString().slice(0, 10) + " (" + dias + " listos)";
      let bursts;
      try { bursts = await dayBursts(sym, d, minBig); } catch (e) { log("estudio aggTrades", sym, e.message); sinDato++; continue; }
      if (bursts == null) { sinDato++; continue; }
      let M; try { M = await minutes(sym, d, d + DAY + 5 * H); } catch (e) { sinDato++; continue; }
      for (const b of bursts) {
        const dir = b.side === "buy" ? 1 : -1, i0 = idxAt(M, b.t); if (i0 < 0) continue;
        const ret = (mins) => { const i = idxAt(M, b.t + mins * 60000); return i > i0 ? (dir * (M.c[i] - b.px)) / b.px : null; };
        const tr = trend(b.t);
        all.push({ usd: b.usd, side: b.side, r15: ret(15), r60: ret(60), r240: ret(240), tier: tierOf(b.usd, min), ny: isNY(b.t), alineada: tr === 0 ? "plana" : tr === dir ? "a favor" : "en contra", h: etHour(b.t).h });
      }
      dias++; { const w = new Date(d).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }); wd[w] = (wd[w] || 0) + 1; }
    }
    const by = (key) => { const g = {}; all.forEach((r) => { (g[r[key]] = g[r[key]] || []).push(r); }); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, agg(v)])); };
    const tiers = by("tier");
    // Mínimo recomendado: el escalón más chico donde, a 1 h, la orden acierta ≥ 55 % con 30+ casos.
    const orden = ["⅓–1× mínimo", "1–2× mínimo", "2–5× mínimo", "5×+ mínimo"], mult = { "⅓–1× mínimo": 1 / 3, "1–2× mínimo": 1, "2–5× mínimo": 2, "5×+ mínimo": 5 };
    const rec = orden.find((k) => tiers[k] && tiers[k].n >= 30 && tiers[k].h1 && tiers[k].h1.acierto >= 55);
    const megas = [15e6, 40e6, 100e6].map((v) => ({ desde: v, ...agg(all.filter((r) => r.usd >= v)) }));
    res.mercados[sym] = { dias_analizados: dias, dias_por_semana: wd, dias_sin_dato: sinDato, ordenes: all.length, minimo_actual: min, por_tamano: tiers, por_tendencia: by("alineada"),
      sesion_ny: agg(all.filter((r) => r.ny)), fuera_ny: agg(all.filter((r) => !r.ny)), mega_absoluto: megas,
      minimo_recomendado: rec ? Math.round(min * mult[rec]) : null, nota_recomendacion: rec ? "Escalón " + rec + ": acierta " + tiers[rec].h1.acierto + "% a 1 h con " + tiers[rec].n + " casos" : "Ningún tamaño llegó a 55 % de acierto a 1 h con 30+ casos: el tamaño solo no predice dirección" };
  }
  return res;
}

// ---------- Fase 2 · Zonas algorítmicas + simulación ----------
// Detecta order blocks (última vela contraria antes de un impulso que rompe estructura) y FVG (hueco de 3 velas).
export function detectZones(K, tf) {
  const A = atrArr(K), Z = [];
  for (let i = 12; i < K.length - 3; i++) {
    const a = A[i]; if (!a) continue;
    // FVG
    if (K[i + 1][3] - K[i - 1][2] > 0.1 * a) Z.push({ tf, tipo: "FVG", side: "buy", lo: K[i - 1][2], hi: K[i + 1][3], t0: K[i + 1][0] + 1, a });
    if (K[i - 1][3] - K[i + 1][2] > 0.1 * a) Z.push({ tf, tipo: "FVG", side: "sell", lo: K[i + 1][2], hi: K[i - 1][3], t0: K[i + 1][0] + 1, a });
    // Order block: vela i contraria (la ÚLTIMA antes del impulso: la siguiente ya es fuerte a favor) + impulso i+1..i+3 que cierra fuera del extremo de las 10 velas anteriores
    const prevHi = Math.max(...K.slice(i - 10, i).map((k) => k[2])), prevLo = Math.min(...K.slice(i - 10, i).map((k) => k[3]));
    const imp = K.slice(i + 1, i + 4), rng = imp.reduce((s, k) => s + (k[2] - k[3]), 0);
    if (K[i][4] < K[i][1] && K[i + 1][4] - K[i + 1][1] > 0.5 * a && imp.some((k) => k[4] > prevHi) && rng > 1.5 * a) Z.push({ tf, tipo: "OB", side: "buy", lo: K[i][3], hi: K[i][2], t0: K[i + 3][0] + 1, a });
    if (K[i][4] > K[i][1] && K[i + 1][1] - K[i + 1][4] > 0.5 * a && imp.some((k) => k[4] < prevLo) && rng > 1.5 * a) Z.push({ tf, tipo: "OB", side: "sell", lo: K[i][3], hi: K[i][2], t0: K[i + 3][0] + 1, a });
  }
  // Grado A si un OB se cruza con un FVG del mismo lado; si no, B.
  Z.forEach((z) => { z.grado = Z.some((w) => w !== z && w.side === z.side && w.tipo !== z.tipo && Math.abs(w.t0 - z.t0) < 6 * (tf === "4H" ? 4 * H : H) && w.lo < z.hi && w.hi > z.lo) ? "A" : "B"; });
  return Z;
}
// Simula una zona: primera llegada por el lado correcto, entrada, stop, meta. Devuelve null si no hubo entrada.
export function simZone(M, z, p) {
  const far = z.side === "buy" ? z.lo : z.hi, near = z.side === "buy" ? z.hi : z.lo, dir = z.side === "buy" ? 1 : -1;
  // Primer toque del borde cercano (se calcula una vez por zona y se guarda).
  if (z._touch === undefined) {
    let i = idxAt(M, z.t0), tEnd = z.t0 + 7 * DAY; z._touch = null;
    if (i >= 0) for (; i < M.n && M.t[i] < tEnd; i++) {
      if (dir === 1 ? M.l[i] < far : M.h[i] > far) break;               // la atravesó entera sin entrar limpio: se descarta
      if (dir === 1 ? M.l[i] <= near : M.h[i] >= near) { z._touch = i; break; }
    }
  }
  if (z._touch == null) return null;
  const i = z._touch;
  let e = near, iE = i;
  if (p.confirm === "rechazo") {                                        // cierre de 15 min de vuelta fuera de la zona, en 4 h
    let ok = false;
    for (let j = i; j < M.n && M.t[j] < M.t[i] + 4 * H; j++) {
      if (dir === 1 ? M.l[j] < far - p.k * z.a : M.h[j] > far + p.k * z.a) return null;
      if ((M.t[j] + 60000) % (15 * 60000) === 0 && (dir === 1 ? M.c[j] > near : M.c[j] < near)) { e = M.c[j]; iE = j; ok = true; break; }
    }
    if (!ok) return null;
  }
  const sl = far - dir * p.k * z.a, risk = Math.abs(e - sl);
  if (!(risk > 0) || risk < 0.5 * z.a) return { skip: "stop" };
  const tp = e + dir * p.R * risk, costR = (FEE_RT * e) / risk;
  for (let j = iE + 1; j < M.n && M.t[j] < M.t[iE] + 3 * DAY; j++) {
    const hitSL = dir === 1 ? M.l[j] <= sl : M.h[j] >= sl, hitTP = dir === 1 ? M.h[j] >= tp : M.l[j] <= tp;
    if (hitSL) return { t: M.t[iE], r: -1 - costR, win: false };
    if (hitTP) return { t: M.t[iE], r: p.R - costR, win: true };
  }
  const jl = Math.min(M.n - 1, idxAt(M, M.t[iE] + 3 * DAY));
  return { t: M.t[iE], r: (dir * (M.c[jl] - e)) / risk - costR, win: false, tiempo: true };
}
function stats(tr) {
  const n = tr.length; if (!n) return { n: 0 };
  const w = tr.filter((x) => x.win).length, R = tr.reduce((a, b) => a + b.r, 0);
  let eq = 0, peak = 0, dd = 0, racha = 0, peor = 0;
  tr.slice().sort((a, b) => a.t - b.t).forEach((x) => { eq += x.r; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); racha = x.r < 0 ? racha + 1 : 0; peor = Math.max(peor, racha); });
  return { n, acierto: Math.round((w / n) * 100), R_prom: +(R / n).toFixed(3), R_total: +R.toFixed(1), caida_max_R: +dd.toFixed(1), peor_racha: peor };
}
export async function fase2(days = 365) {
  const res = { fase: 2, generado: Date.now(), periodo_dias: days, mercados: {} };
  const end = Math.floor(Date.now() / H) * H, start = end - days * DAY, cut = start + Math.round(days * 8 / 12) * DAY;
  let fng = {};
  try { const j = await (await fetch("https://api.alternative.me/fng/?limit=" + (days + 10), { signal: AbortSignal.timeout(20000) })).json(); (j.data || []).forEach((d) => { fng[new Date(+d.timestamp * 1000).toISOString().slice(0, 10)] = +d.value; }); } catch {}
  const grid = [];
  for (const tf of ["1H", "4H"]) for (const k of [0.25, 0.5, 1]) for (const R of [1, 1.5, 2, 3]) for (const confirm of ["toque", "rechazo"]) for (const tend of [false, true]) grid.push({ tf, k, R, confirm, tend });
  for (const sym of MARKETS) {
    EST.progreso = "Fase 2 · " + NAMES[sym] + " · velas 1H/4H";
    let K1, K4, M;
    try { K1 = await klinesRange(sym, "1h", start - 30 * DAY, end); K4 = await klinesRange(sym, "4h", start - 60 * DAY, end); }
    catch (e) { res.mercados[sym] = { error: "sin datos: " + e.message }; continue; }
    EST.progreso = "Fase 2 · " + NAMES[sym] + " · velas de 1 minuto (puede tardar)";
    try { M = await minutes(sym, Math.max(start, K1[0] ? K1[0][0] : start), end); } catch (e) { res.mercados[sym] = { error: "sin velas 1m: " + e.message }; continue; }
    if (M.n < 1000) { res.mercados[sym] = { error: "muy poca historia" }; continue; }
    const trend = trendFn(K4), Zs = { "1H": detectZones(K1, "1H").filter((z) => z.t0 >= M.t[0]), "4H": detectZones(K4, "4H").filter((z) => z.t0 >= M.t[0]) };
    EST.progreso = "Fase 2 · " + NAMES[sym] + " · simulando " + grid.length + " combinaciones";
    const rows = [];
    for (const p of grid) {
      const tr = [];
      let cnt = 0;
      for (const z of Zs[p.tf]) {
        if (++cnt % 300 === 0) await sleep(0);                         // cede turno: las alertas en vivo siguen
        if (p.tend) { const t = trend(z.t0); if (t !== (z.side === "buy" ? 1 : -1)) continue; }
        const s = simZone(M, z, p); if (!s || s.skip) continue;
        tr.push({ ...s, side: z.side, grado: z.grado, tipo: z.tipo, ny: isNY(s.t), fng: fng[new Date(s.t).toISOString().slice(0, 10)] });
      }
      rows.push({ p, ent: stats(tr.filter((x) => x.t < cut)), val: stats(tr.filter((x) => x.t >= cut)), tr });
      await sleep(0);
    }
    // Mejor combinación = mayor R promedio en ENTRENAMIENTO con 40+ operaciones; se reporta su validación aparte.
    const ok = rows.filter((r) => r.ent.n >= 40).sort((a, b) => b.ent.R_prom - a.ent.R_prom);
    const best = ok[0], hi = rows.filter((r) => r.ent.n >= 40 && r.ent.acierto >= 68).sort((a, b) => b.ent.R_prom - a.ent.R_prom)[0];
    const detalle = (r) => { if (!r) return null; const v = r.tr.filter((x) => x.t >= cut); const g = (f) => stats(v.filter(f));
      const fb = (x) => (x == null ? "sin dato" : x <= 24 ? "miedo extremo" : x <= 44 ? "miedo" : x <= 55 ? "neutral" : x <= 75 ? "codicia" : "codicia extrema");
      const porF = {}; v.forEach((x) => { const k = (x.side === "buy" ? "compra · " : "venta · ") + fb(x.fng); (porF[k] = porF[k] || []).push(x); });
      return { reglas: r.p, entrenamiento: r.ent, validacion: r.val, validacion_por: { compras: g((x) => x.side === "buy"), ventas: g((x) => x.side === "sell"), grado_A: g((x) => x.grado === "A"), grado_B: g((x) => x.grado === "B"), OB: g((x) => x.tipo === "OB"), FVG: g((x) => x.tipo === "FVG"), sesion_NY: g((x) => x.ny), fuera_NY: g((x) => !x.ny) },
        sentimiento: Object.fromEntries(Object.entries(porF).map(([k, a]) => [k, stats(a)])) }; };
    res.mercados[sym] = { zonas_detectadas: { "1H": Zs["1H"].length, "4H": Zs["4H"].length }, minutos: M.n, corte_validacion: new Date(cut).toISOString().slice(0, 10),
      mejor: detalle(best), mejor_68: detalle(hi), top10: ok.slice(0, 10).map((r) => ({ reglas: r.p, entrenamiento: r.ent, validacion: r.val })) };
    M = null;
  }
  return res;
}

// ---------- Fase 3 · TITO a ciegas (20 días) ----------
async function askZones(sym, K4, K1, KD) {
  const q = "Eres analista de order blocks y fair value gaps 1H/4H. Con SOLO estas velas reales (formato [hora UTC, apertura, máximo, mínimo, cierre]) marca hasta 3 zonas vigentes de " + sym +
    " para las próximas 24 horas: la más cercana por encima (sell) y por debajo (buy) del último precio, con SL más allá del swing que protege la zona (a más de medio ATR de 1H) y TP1. Responde SOLO con un bloque ```json``` así: [{\"sym\":\"" + sym + "\",\"name\":\"Order block 1H\",\"grade\":\"A\",\"side\":\"sell\",\"lo\":0,\"hi\":0,\"sl\":0,\"tp1\":0,\"tp2\":0}]\n[VELAS_4H]" + JSON.stringify(K4) + "\n[VELAS_1H]" + JSON.stringify(K1) + "\n[VELAS_DIARIAS]" + JSON.stringify(KD);
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": ENV.anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: ENV.aiModel, max_tokens: 4000, messages: [{ role: "user", content: q }] }), signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error("Ai HTTP " + r.status);
  const j = await r.json(), txt = (j.content || []).map((c) => c.text || "").join("");
  return parseAiZones(txt).arr || [];
}
export async function fase3(dias = 20) {
  const res = { fase: 3, generado: Date.now(), tito: {} };
  if (!ENV.anthropicKey) { res.tito = { error: "falta ANTHROPIC_API_KEY" }; return res; }
  const end = Math.floor(Date.now() / DAY) * DAY - 2 * DAY;
  for (const sym of ["BTC", "SOL"]) {
    const tr = [];
    for (let n = 0; n < dias / 2; n++) {
      const d0 = end - n * 9 * DAY + 12 * H + 15 * 60000;                    // ~8:15 AM hora de NY, cada 9 días hacia atrás
      EST.progreso = "Fase 3 · TITO a ciegas · " + NAMES[sym] + " · " + new Date(d0).toISOString().slice(0, 10);
      try {
        const [K4, K1, KD] = await Promise.all([klinesRange(sym, "4h", d0 - 42 * 4 * H, d0), klinesRange(sym, "1h", d0 - 48 * H, d0), klinesRange(sym, "1d", d0 - 30 * DAY, d0)]);
        const fmt = (K) => K.map((k) => [new Date(k[0]).toISOString().slice(5, 16), k[1], k[2], k[3], k[4]]);
        const zones = await askZones(sym, fmt(K4), fmt(K1), fmt(KD));
        const M = await minutes(sym, d0, d0 + 3 * DAY), a = atrArr(K1).filter(Boolean).pop() || 0;
        for (const z of zones) {
          if (!(z.lo > 0 && z.hi > 0 && z.sl > 0 && z.tp1 > 0)) continue;
          const lo = Math.min(z.lo, z.hi), hi = Math.max(z.lo, z.hi), side = z.side === "buy" ? "buy" : "sell", dir = side === "buy" ? 1 : -1, near = side === "buy" ? hi : lo;
          let i = 0; for (; i < M.n && M.t[i] < d0 + DAY; i++) if (dir === 1 ? M.l[i] <= near : M.h[i] >= near) break;
          if (i >= M.n || M.t[i] >= d0 + DAY) continue;
          const risk = Math.abs(near - z.sl), reward = Math.abs(z.tp1 - near);
          if (!(risk > 0) || (dir === 1 ? z.sl >= near || z.tp1 <= near : z.sl <= near || z.tp1 >= near)) continue;
          let out = null;
          for (let j = i + 1; j < M.n; j++) { if (dir === 1 ? M.l[j] <= z.sl : M.h[j] >= z.sl) { out = { win: false, r: -1 }; break; } if (dir === 1 ? M.h[j] >= z.tp1 : M.l[j] <= z.tp1) { out = { win: true, r: reward / risk }; break; } }
          if (out) tr.push({ ...out, t: M.t[i], stop_vs_atr: +(risk / (a || 1)).toFixed(2), filtro_v43: risk >= 0.5 * a });
        }
      } catch (e) { log("estudio fase3", e.message); }
      await sleep(500);
    }
    res.tito[sym] = { todas: stats(tr), con_filtro_stop_v43: stats(tr.filter((x) => x.filtro_v43)), stop_promedio_en_ATR: tr.length ? +(tr.reduce((s, x) => s + x.stop_vs_atr, 0) / tr.length).toFixed(2) : null };
  }
  return res;
}

// ---------- Orquestador ----------
export function estudioData() { return { estado: EST, fase1: kvGet("estudio1", null), fase2: kvGet("estudio2", null), fase3: kvGet("estudio3", null) }; }
export async function runEstudio(fases, notify) {
  if (EST.running) return notify("⏳ El estudio ya está corriendo: " + EST.progreso);
  EST.running = true; EST.inicio = Date.now(); EST.error = "";
  try {
    for (const f of fases) {
      EST.fase = "Fase " + f;
      await notify("🔬 Estudio · arrancó la Fase " + f + (f === 1 ? " (ballenas, 12 meses, 1 día por semana)" : f === 2 ? " (zonas + reglas, 12 meses de velas de 1 minuto)" : " (TITO a ciegas, 20 días)") + ". Te aviso al terminar.");
      const r = f === 1 ? await fase1() : f === 2 ? await fase2() : await fase3();
      kvSet("estudio" + f, r);
      await notify("✅ Estudio · Fase " + f + " lista en " + Math.round((Date.now() - EST.inicio) / 60000) + " min.\n" + resumen(f, r));
    }
  } catch (e) { EST.error = e.message; log("estudio", e.message); await notify("⚠️ Estudio detenido: " + e.message); }
  finally { EST.running = false; EST.progreso = "terminado"; }
}
function resumen(f, r) {
  if (f === 1) return MARKETS.map((s) => { const m = r.mercados[s]; if (!m) return ""; const t = m.por_tamano || {}; return "• " + NAMES[s] + ": " + m.ordenes + " órdenes en " + m.dias_analizados + " días · " + m.nota_recomendacion; }).join("\n");
  if (f === 2) return MARKETS.map((s) => { const m = r.mercados[s]; if (!m || !m.mejor) return "• " + NAMES[s] + ": " + ((m && m.error) || "sin combinación con 40+ operaciones"); const b = m.mejor; return "• " + NAMES[s] + ": mejor regla " + b.reglas.tf + " · stop " + b.reglas.k + "×ATR · meta " + b.reglas.R + "R · " + b.reglas.confirm + (b.reglas.tend ? " · con tendencia" : "") + " → validación " + b.validacion.acierto + "% acierto, " + b.validacion.R_prom + "R por operación (" + b.validacion.n + " ops)"; }).join("\n");
  return Object.entries(r.tito || {}).map(([s, v]) => "• TITO " + (NAMES[s] || s) + ": " + (v.error || (v.todas.n + " zonas tocadas · " + v.todas.acierto + "% acierto · " + v.todas.R_prom + "R por operación"))).join("\n");
}
