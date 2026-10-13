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
// v4.7: cada zona existe recién cuando CIERRA la vela que la confirma (antes se activaba al abrir: entradas imposibles en vivo).
export function detectZones(K, tf) {
  const A = atrArr(K), Z = [], TF = tf === "4H" ? 4 * H : tf === "1D" ? DAY : H;
  for (let i = 12; i < K.length - 3; i++) {
    const a = A[i]; if (!a) continue;
    // FVG
    if (K[i + 1][3] - K[i - 1][2] > 0.1 * a) Z.push({ tf, tipo: "FVG", side: "buy", lo: K[i - 1][2], hi: K[i + 1][3], t0: K[i + 1][0] + TF, a });
    if (K[i - 1][3] - K[i + 1][2] > 0.1 * a) Z.push({ tf, tipo: "FVG", side: "sell", lo: K[i + 1][2], hi: K[i - 1][3], t0: K[i + 1][0] + TF, a });
    // Order block: vela i contraria (la ÚLTIMA antes del impulso: la siguiente ya es fuerte a favor) + impulso i+1..i+3 que cierra fuera del extremo de las 10 velas anteriores
    const prevHi = Math.max(...K.slice(i - 10, i).map((k) => k[2])), prevLo = Math.min(...K.slice(i - 10, i).map((k) => k[3]));
    const imp = K.slice(i + 1, i + 4), rng = imp.reduce((s, k) => s + (k[2] - k[3]), 0);
    if (K[i][4] < K[i][1] && K[i + 1][4] - K[i + 1][1] > 0.5 * a && imp.some((k) => k[4] > prevHi) && rng > 1.5 * a) Z.push({ tf, tipo: "OB", side: "buy", lo: K[i][3], hi: K[i][2], t0: K[i + 3][0] + TF, a });
    if (K[i][4] > K[i][1] && K[i + 1][1] - K[i + 1][4] > 0.5 * a && imp.some((k) => k[4] < prevLo) && rng > 1.5 * a) Z.push({ tf, tipo: "OB", side: "sell", lo: K[i][3], hi: K[i][2], t0: K[i + 3][0] + TF, a });
  }
  // Grado A si un OB se cruza con un FVG del mismo lado; si no, B.
  Z.forEach((z) => { z.grado = Z.some((w) => w !== z && w.side === z.side && w.tipo !== z.tipo && Math.abs(w.t0 - z.t0) < 6 * TF && w.lo < z.hi && w.hi > z.lo) ? "A" : "B"; });
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

// ---------- Fase 4 · Ruptura de zona (v4.9) ----------
// Hipótesis: con meta de 3R el rebote acertó 5–16 % (menos que el azar): el precio atraviesa las zonas.
// Se opera la RUPTURA: cierre de vela del marco más allá del borde lejano (dentro de 7 días desde t0), entrada a ese cierre,
// stop del otro lado de la zona (borde cercano ± k × ATR), meta R × riesgo, máximo 3 días, comisión incluida. Sin mirar al futuro.
export function breakIdx(K, z, TF) {
  const buy = z.side === "buy", far = buy ? z.lo : z.hi;
  let lo = 0, hi = K.length; while (lo < hi) { const m = (lo + hi) >> 1; if (K[m][0] < z.t0) lo = m + 1; else hi = m; }
  for (let i = lo; i < K.length && K[i][0] < z.t0 + 7 * DAY; i++) if (buy ? K[i][4] < far : K[i][4] > far) return i;
  return -1;
}
export function simBreak(M, K, z, p, TF) {
  if (z._brk === undefined) z._brk = breakIdx(K, z, TF);
  if (z._brk < 0) return null;
  const buy = z.side === "buy", dir = buy ? -1 : 1, near = buy ? z.hi : z.lo, kb = K[z._brk], tE = kb[0] + TF, e = kb[4];
  const iE = idxAt(M, tE); if (iE < 0 || M.t[iE] < kb[0]) return null;
  const sl = near - dir * p.k * z.a, risk = Math.abs(e - sl);
  if (!(risk > 0) || risk < 0.5 * z.a || (dir === 1 ? sl >= e : sl <= e)) return { skip: "stop" };
  const tp = e + dir * p.R * risk, costR = (FEE_RT * e) / risk;
  for (let j = iE + 1; j < M.n && M.t[j] < tE + 3 * DAY; j++) {
    const hitSL = dir === 1 ? M.l[j] <= sl : M.h[j] >= sl, hitTP = dir === 1 ? M.h[j] >= tp : M.l[j] <= tp;
    if (hitSL) return { t: tE, r: -1 - costR, win: false, dir };
    if (hitTP) return { t: tE, r: p.R - costR, win: true, dir };
  }
  const jl = Math.min(M.n - 1, idxAt(M, tE + 3 * DAY));
  return { t: tE, r: (dir * (M.c[jl] - e)) / risk - costR, win: false, tiempo: true, dir };
}
export async function fase4(days = 365) {
  const res = { fase: 4, generado: Date.now(), periodo_dias: days, hipotesis: "ruptura de zona", mercados: {} };
  const end = Math.floor(Date.now() / H) * H, start = end - days * DAY, cut = start + Math.round(days * 8 / 12) * DAY;
  const grid = [];
  for (const tf of ["1H", "4H"]) for (const k of [0, 0.25, 0.5]) for (const R of [1, 1.5, 2, 3]) for (const tend of [false, true]) grid.push({ tf, k, R, tend });
  for (const sym of MARKETS) {
    EST.progreso = "Fase 4 · " + NAMES[sym] + " · velas 1H/4H";
    let K1, K4, M;
    try { K1 = await klinesRange(sym, "1h", start - 30 * DAY, end); K4 = await klinesRange(sym, "4h", start - 60 * DAY, end); }
    catch (e) { res.mercados[sym] = { error: "sin datos: " + e.message }; continue; }
    EST.progreso = "Fase 4 · " + NAMES[sym] + " · velas de 1 minuto (puede tardar)";
    try { M = await minutes(sym, Math.max(start, K1[0] ? K1[0][0] : start), end); } catch (e) { res.mercados[sym] = { error: "sin velas 1m: " + e.message }; continue; }
    if (M.n < 1000) { res.mercados[sym] = { error: "muy poca historia" }; continue; }
    const trend = trendFn(K4), KK = { "1H": K1, "4H": K4 }, Zs = { "1H": detectZones(K1, "1H").filter((z) => z.t0 >= M.t[0]), "4H": detectZones(K4, "4H").filter((z) => z.t0 >= M.t[0]) };
    EST.progreso = "Fase 4 · " + NAMES[sym] + " · simulando " + grid.length + " combinaciones";
    const rows = [];
    for (const p of grid) {
      const tr = []; let cnt = 0;
      for (const z of Zs[p.tf]) {
        if (++cnt % 300 === 0) await sleep(0);
        const s = simBreak(M, KK[p.tf], z, p, p.tf === "4H" ? 4 * H : H); if (!s || s.skip) continue;
        if (p.tend && trend(s.t) !== s.dir) continue;
        tr.push({ ...s, tipo: z.tipo, side: s.dir === 1 ? "buy" : "sell", ny: isNY(s.t) });
      }
      rows.push({ p, ent: stats(tr.filter((x) => x.t < cut)), val: stats(tr.filter((x) => x.t >= cut)), tr });
      await sleep(0);
    }
    const ok = rows.filter((r) => r.ent.n >= 50).sort((a, b) => b.ent.R_prom - a.ent.R_prom), best = ok[0];
    const pasa = rows.filter((r) => r.ent.n >= 50 && r.ent.R_prom > 0 && r.val.n >= 30 && r.val.R_prom > 0).sort((a, b) => b.val.R_prom - a.val.R_prom);
    const det = (r) => { if (!r) return null; const v = r.tr.filter((x) => x.t >= cut), g = (f) => stats(v.filter(f));
      return { reglas: r.p, entrenamiento: r.ent, validacion: r.val, validacion_por: { compras: g((x) => x.side === "buy"), ventas: g((x) => x.side === "sell"), OB: g((x) => x.tipo === "OB"), FVG: g((x) => x.tipo === "FVG"), sesion_NY: g((x) => x.ny), fuera_NY: g((x) => !x.ny) } }; };
    res.mercados[sym] = { corte_validacion: new Date(cut).toISOString().slice(0, 10), mejor: det(best), positivas_en_ambos: pasa.length, mejor_validada: det(pasa[0]),
      top10: ok.slice(0, 10).map((r) => ({ reglas: r.p, entrenamiento: r.ent, validacion: r.val })) };
    M = null;
  }
  return res;
}

// ---------- Fase 5 · Sesiones NY (v4.11) ----------
// Regla fijada con Yasser ANTES de ver resultados (12 oct 2026). No se ajusta después de ver la data.
//  Ventanas (hora de NY, L–V): apertura = estudio previo 8:00–9:30, disparo 9:30–10:30 · cierre = estudio previo 14:00–15:00, disparo 15:00–16:00.
//  Zonas de sesión: OB/FVG de 1H (vigente 7 días) y 4H (14 días). Una zona muere cuando una vela de 1 min cierra más allá de su borde lejano.
//  Disparo con velas de 5 min (hechas con las de 1 min):
//   1) una vela toca la zona;
//   2) se forma un FVG de 5 min a favor que se completa entre 5 y 15 min después del cierre de la vela del toque, y la vela del medio
//      (impulso) cierra más allá del swing (HH/LL) más reciente = BOS;
//   3) confirmación: en las 3 velas siguientes, una vela que supera el extremo de la anterior, cierra más allá y tiene MÁS volumen que ella.
//  Entrada al cierre de la confirmación. Stop: borde lejano de la zona o el extremo barrido desde el toque (el más lejano).
//  Meta principal 2R (se reportan 1R y 3R). Máximo 4 h. Comisión incluida. Una operación por ventana.
//  Órdenes grandes = ráfagas de 250 ms ≥ percentil 99 de los 30 días anteriores (sin el día en curso).
//  Acumulación = desde el inicio del estudio previo hasta la entrada, solo con precio dentro de la zona.
//  REGLA COMPLETA = disparo + órdenes grandes netas a favor. Delta = compras − ventas (todo) dentro de la zona en la acumulación.
//  A++ = al inicio del estudio previo, el precio está dentro o a ≤ 0.5 % de una zona 1D/4H vigente (position).
//  Afinado = primeros 8 meses · validación = últimos 4. Vara: R promedio positivo con 50+ operaciones en validación.
export const SES_WIN = [{ k: "apertura", pre: 480, ini: 570, fin: 630 }, { k: "cierre", pre: 840, ini: 900, fin: 960 }];
const ZLIFE = { "1H": 7 * DAY, "4H": 14 * DAY, "1D": 30 * DAY };
// Minuto `mins` de NY en la fecha cuyo 00:00 UTC es dayUtc → instante UTC (maneja horario de verano).
export function etToUtc(dayUtc, mins) {
  for (const off of [4, 5]) { const t = dayUtc + (mins + off * 60) * 60000, e = etHour(t); if (e.h * 60 + e.m === mins) return t; }
  return null;
}
async function minutesV(sym, from, to) {
  const k = await klinesRange(sym, "1m", from, to), n = k.length;
  const M = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), n };
  k.forEach((r, i) => { M.t[i] = r[0]; M.o[i] = r[1]; M.h[i] = r[2]; M.l[i] = r[3]; M.c[i] = r[4]; M.v[i] = r[5]; });
  return M;
}
// Velas de 5 min alineadas al reloj a partir de las de 1 min (con volumen en USD).
export function fiveMin(M) {
  const T = [], O = [], Hh = [], L = [], C = [], V = []; let cur = -1;
  for (let i = 0; i < M.n; i++) {
    const b = Math.floor(M.t[i] / 300000) * 300000;
    if (b !== cur) { cur = b; T.push(b); O.push(M.o[i]); Hh.push(M.h[i]); L.push(M.l[i]); C.push(M.c[i]); V.push(M.v[i]); }
    else { const j = T.length - 1; if (M.h[i] > Hh[j]) Hh[j] = M.h[i]; if (M.l[i] < L[j]) L[j] = M.l[i]; C[j] = M.c[i]; V[j] += M.v[i]; }
  }
  const n = T.length, F = { t: Float64Array.from(T), o: Float64Array.from(O), h: Float64Array.from(Hh), l: Float64Array.from(L), c: Float64Array.from(C), v: Float64Array.from(V), n };
  // Swing (fractal de 2 velas a cada lado) más reciente YA confirmado antes de abrir la vela k.
  F.sh = new Float64Array(n).fill(NaN); F.sl = new Float64Array(n).fill(NaN);
  let sh = NaN, sl = NaN;
  for (let k = 0; k < n; k++) {
    const s = k - 3;
    if (s >= 2) {
      if (F.h[s] > F.h[s - 1] && F.h[s] > F.h[s - 2] && F.h[s] > F.h[s + 1] && F.h[s] > F.h[s + 2]) sh = F.h[s];
      if (F.l[s] < F.l[s - 1] && F.l[s] < F.l[s - 2] && F.l[s] < F.l[s + 1] && F.l[s] < F.l[s + 2]) sl = F.l[s];
    }
    F.sh[k] = sh; F.sl[k] = sl;
  }
  return F;
}
function zoneLife(M, z) {
  const far = z.side === "buy" ? z.lo : z.hi, tEnd = z.t0 + ZLIFE[z.tf];
  z.end = tEnd;
  for (let i = Math.max(0, idxAt(M, z.t0)); i < M.n && M.t[i] < tEnd; i++) if (M.t[i] >= z.t0 && (z.side === "buy" ? M.c[i] < far : M.c[i] > far)) { z.end = M.t[i] + 60000; break; }
}
// Busca la primera señal de la ventana [iniT, finT). Devuelve null si no hubo.
export function sessionSignal(F, zones, iniT, finT) {
  const P = 300000, cont = (a, b) => b < F.n && F.t[b] - F.t[a] === (b - a) * P;
  const k1 = idxAt(F, iniT); if (k1 < 0) return null;
  const vivas = zones.filter((z) => z.t0 <= finT && z.end > iniT);
  let best = null;
  for (let k0 = F.t[k1] < iniT ? k1 + 1 : k1; k0 < F.n && F.t[k0] + P <= finT; k0++) {
    if (best && F.t[k0] >= best.tE) break;
    for (const z of vivas) {
      if (!(z.t0 <= F.t[k0] && z.end > F.t[k0])) continue;
      if (!(F.l[k0] <= z.hi && F.h[k0] >= z.lo)) continue;                 // 1) toca la zona
      const dir = z.side === "buy" ? 1 : -1;
      for (let j = k0 - 1; j <= k0 + 1; j++) {                             // 2) FVG que termina 5–15 min después del toque
        if (j < 3 || !cont(j, j + 2)) continue;
        const a = j, b = j + 1, c = j + 2;
        const fvg = dir === 1 ? F.l[c] > F.h[a] : F.h[c] < F.l[a];
        const bos = dir === 1 ? F.c[b] > F.sh[b] : F.c[b] < F.sl[b];        // NaN → false
        if (!fvg || !bos) continue;
        for (let m = c + 1; m <= c + 3; m++) {                              // 3) confirmación con más volumen
          if (!cont(c, m) || F.t[m] + P > finT) break;
          const ok = dir === 1 ? F.h[m] > F.h[m - 1] && F.c[m] > F.h[m - 1] : F.l[m] < F.l[m - 1] && F.c[m] < F.l[m - 1];
          if (!ok || !(F.v[m] > F.v[m - 1])) continue;
          const tE = F.t[m] + P;
          if (!best || tE < best.tE) {
            let ext = dir === 1 ? z.lo : z.hi;
            for (let x = k0; x <= m; x++) ext = dir === 1 ? Math.min(ext, F.l[x]) : Math.max(ext, F.h[x]);
            best = { tE, e: F.c[m], sl: ext, dir, z, tToque: F.t[k0] };
          }
          break;
        }
      }
    }
  }
  return best;
}
function simSes(M, s, R) {
  const risk = Math.abs(s.e - s.sl); if (!(risk > 0) || (s.dir === 1 ? s.sl >= s.e : s.sl <= s.e)) return null;
  const tp = s.e + s.dir * R * risk, costR = (FEE_RT * s.e) / risk;
  let j = idxAt(M, s.tE); if (j < 0) return null; if (M.t[j] < s.tE) j++;
  for (; j < M.n && M.t[j] < s.tE + 4 * H; j++) {
    if (s.dir === 1 ? M.l[j] <= s.sl : M.h[j] >= s.sl) return { r: -1 - costR, win: false };
    if (s.dir === 1 ? M.h[j] >= tp : M.l[j] <= tp) return { r: R - costR, win: true };
  }
  const jl = Math.min(M.n - 1, j - 1);
  return { r: (s.dir * (M.c[jl] - s.e)) / risk - costR, win: false, tiempo: true };
}
// Histograma logarítmico de tamaños de ráfaga (para el percentil 99 de 30 días sin guardar millones de valores).
const HB = 40, binOf = (usd) => Math.max(0, Math.min(479, Math.floor(Math.log10(Math.max(1, usd)) * HB)));
export function p99(hists) {
  let tot = 0; for (const h of hists) for (let i = 0; i < 480; i++) tot += h[i];
  if (!tot) return null;
  let acc = 0; const lim = tot * 0.01;
  for (let i = 479; i >= 0; i--) { for (const h of hists) acc += h[i]; if (acc >= lim) return Math.pow(10, i / HB); }
  return null;
}
async function dayTrades(sym, day, onTrade) {
  const d = new Date(day).toISOString().slice(0, 10), label = SYMS[sym].label;
  const url = (process.env.BINANCE_DATA || "https://data.binance.vision") + "/data/futures/um/daily/aggTrades/" + label + "/" + label + "-aggTrades-" + d + ".zip";
  const r = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error("HTTP " + r.status + " " + d);
  const inflate = zlib.createInflateRaw({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
  const rl = readline.createInterface({ input: Readable.fromWeb(r.body).pipe(zipStrip()).pipe(inflate), crlfDelay: Infinity });
  let n = 0;
  try {
    for await (const line of rl) {
      const c = line.charCodeAt(0); if (c < 48 || c > 57) continue;
      const f = line.split(","); onTrade(+f[1], +f[2], +f[5], f[6] === "true" ? -1 : 1);
      if (++n % 200000 === 0) await sleep(0);
    }
  } catch (e) { if (!n) throw e; }
  return n > 0;
}
export async function fase5(days = 365, markets = ["BTC"]) {
  const res = { fase: 5, generado: Date.now(), periodo_dias: days, regla: "Sesiones NY: zona 1H/4H + FVG 5m con BOS + confirmación con más volumen; regla completa = + órdenes grandes (p99 30 días) netas a favor en la acumulación", mercados: {} };
  const end = Math.floor(Date.now() / DAY) * DAY - DAY, start = end - days * DAY, cut = start + Math.round(days * 8 / 12) * DAY;
  for (const sym of markets) {
    EST.progreso = "Fase 5 · " + NAMES[sym] + " · velas 1H/4H/1D";
    let K1, K4, KD, M;
    try { K1 = await klinesRange(sym, "1h", start - 30 * DAY, end + DAY); K4 = await klinesRange(sym, "4h", start - 60 * DAY, end + DAY); KD = await klinesRange(sym, "1d", start - 120 * DAY, end + DAY); }
    catch (e) { res.mercados[sym] = { error: "sin datos: " + e.message }; continue; }
    EST.progreso = "Fase 5 · " + NAMES[sym] + " · velas de 1 minuto (puede tardar)";
    try { M = await minutesV(sym, start - 31 * DAY, end + DAY); } catch (e) { res.mercados[sym] = { error: "sin velas 1m: " + e.message }; continue; }
    if (M.n < 1000) { res.mercados[sym] = { error: "muy poca historia" }; continue; }
    const F = fiveMin(M), trend = trendFn(K4);
    const Z1 = detectZones(K1, "1H"), Z4 = detectZones(K4, "4H"), ZD = detectZones(KD, "1D");
    for (const z of [...Z1, ...Z4, ...ZD]) zoneLife(M, z);
    const ZS = [...Z1, ...Z4], ZP = [...Z4, ...ZD];
    // 1) Señales (solo velas; no mira el futuro: cada zona existe desde el cierre de la vela que la confirma).
    const sig = []; let ventanas = 0;
    for (let d = start; d < end; d += DAY) {
      for (const W of SES_WIN) {
        const preT = etToUtc(d, W.pre), iniT = etToUtc(d, W.ini), finT = etToUtc(d, W.fin);
        if (preT == null || ["Sat", "Sun"].includes(etHour(preT).wd)) continue;
        ventanas++;
        const ip = idxAt(M, preT - 60000); if (ip < 0) continue;
        const px = M.c[ip];
        const aplus = ZP.some((z) => z.t0 <= preT && z.end > preT && (px >= z.lo && px <= z.hi ? 0 : Math.min(Math.abs(px - z.lo), Math.abs(px - z.hi)) / px) <= 0.005);
        const s = sessionSignal(F, ZS, iniT, finT); if (!s) continue;
        const out = { 1: simSes(M, s, 1), 2: simSes(M, s, 2), 3: simSes(M, s, 3) }; if (!out[2]) continue;
        sig.push({ t: s.tE, dia: d, ses: W.k, dir: s.dir, tf: s.z.tf, tipo: s.z.tipo, lo: s.z.lo, hi: s.z.hi, preT, e: s.e, sl: s.sl, aplus, tend: trend(s.tE) === s.dir, out, delta: null, big: null });
      }
      if ((d / DAY) % 20 === 0) await sleep(0);
    }
    // 2) Órdenes grandes y delta con las operaciones reales (data.binance.vision), día por día, en orden.
    const hist = new Map(); let bajados = 0, sinDato = 0;
    for (let d = start - 30 * DAY; d < end; d += DAY) {
      const wd = new Date(d).getUTCDay(); if (wd === 0 || wd === 6) continue;
      const delDia = sig.filter((x) => x.dia === d);
      EST.progreso = "Fase 5 · " + NAMES[sym] + " · operaciones del " + new Date(d).toISOString().slice(0, 10) + " (" + bajados + " días listos, " + sig.length + " señales)";
      const prev = []; for (let q = d - 30 * DAY; q < d; q += DAY) if (hist.has(q)) prev.push(hist.get(q));
      const thr = prev.length >= 5 ? p99(prev) : null;
      const h = new Float64Array(480), cur = { 1: null, "-1": null }, inZ = delDia.map(() => []);
      delDia.forEach((x) => { x.delta = 0; });
      const close = (b) => { if (!b) return; h[binOf(b.usd)]++; const px = b.usd / b.q; delDia.forEach((x, i) => { if (b.first >= x.preT && b.first < x.t && px >= x.lo && px <= x.hi) inZ[i].push(b); }); };
      let ok;
      try {
        ok = await dayTrades(sym, d, (p, q, T, side) => {
          const n = p * q, b = cur[side];
          if (b && T - b.first <= BURST_MS) { b.usd += n; b.q += q; } else { close(b); cur[side] = { side, first: T, usd: n, q }; }
          for (const x of delDia) if (T >= x.preT && T < x.t && p >= x.lo && p <= x.hi) x.delta += side * n;
        });
      } catch (e) { log("estudio fase5", e.message); ok = false; }
      close(cur[1]); close(cur["-1"]);
      if (!ok) { sinDato++; delDia.forEach((x) => { x.delta = null; }); continue; }
      bajados++; hist.set(d, h);
      delDia.forEach((x, i) => {
        if (thr == null) return;
        const g = inZ[i].filter((b) => b.usd >= thr), net = g.reduce((s, b) => s + b.side * b.usd, 0);
        x.big = { n: g.length, neto: Math.round(net), umbral: Math.round(thr) };
      });
      for (const q of [...hist.keys()]) if (q < d - 31 * DAY) hist.delete(q);
    }
    // 3) Resultados
    const conR = (arr, R) => arr.filter((x) => x.out[R]).map((x) => ({ t: x.t, r: x.out[R].r, win: x.out[R].win }));
    const bigFav = (x) => x.big && x.big.n > 0 && Math.sign(x.big.neto) === x.dir, deltaFav = (x) => x.delta != null && Math.sign(x.delta) === x.dir;
    const grupos = { base: () => true, completa: bigFav, delta_a_favor: deltaFav, completa_y_delta: (x) => bigFav(x) && deltaFav(x), grandes_en_contra: (x) => x.big && x.big.n > 0 && Math.sign(x.big.neto) === -x.dir,
      A_plus: (x) => x.aplus, sin_A_plus: (x) => !x.aplus, completa_A_plus: (x) => bigFav(x) && x.aplus, con_tendencia: (x) => x.tend, apertura: (x) => x.ses === "apertura", cierre: (x) => x.ses === "cierre", compras: (x) => x.dir === 1, ventas: (x) => x.dir === -1 };
    const tabla = {};
    for (const [g, f] of Object.entries(grupos)) { const a = sig.filter(f); tabla[g] = Object.fromEntries([1, 2, 3].map((R) => [R + "R", { entrenamiento: stats(conR(a.filter((x) => x.t < cut), R)), validacion: stats(conR(a.filter((x) => x.t >= cut), R)) }])); }
    const v = tabla.completa["2R"].validacion, semanas = (end - start) / (7 * DAY);
    res.mercados[sym] = { corte_validacion: new Date(cut).toISOString().slice(0, 10), ventanas, dias_con_operaciones: bajados, dias_sin_dato: sinDato,
      zonas: { "1H": Z1.length, "4H": Z4.length, "1D": ZD.length }, senales: sig.length, senales_por_semana: +(sig.length / semanas).toFixed(2),
      completa_por_semana: +(sig.filter(bigFav).length / semanas).toFixed(2), pasa: v.n >= 50 && v.R_prom > 0, tabla,
      ultimas: sig.slice(-40).map((x) => ({ fecha: new Date(x.t).toISOString().slice(0, 16), ses: x.ses, dir: x.dir === 1 ? "compra" : "venta", zona: x.tf + " " + x.tipo, A_plus: x.aplus, grandes: x.big, delta: x.delta == null ? null : Math.round(x.delta), R2: +x.out[2].r.toFixed(2) })) };
    M = null;
  }
  return res;
}

// ---------- Diagnóstico v4.12 · solo lectura: dónde cae cada candidato (no cambia reglas, no toca alertas) ----------
// Cuenta, por ventana de sesión, cuántas pasan cada etapa. Compara la regla actual (FVG desde 1 vela antes del toque)
// con la regla escrita (FVG que empieza entre 5 y 15 min después del toque).
export async function diagFase5(days = 365, sym = "BTC") {
  const end = Math.floor(Date.now() / DAY) * DAY - DAY, start = end - days * DAY;
  const K1 = await klinesRange(sym, "1h", start - 30 * DAY, end + DAY), K4 = await klinesRange(sym, "4h", start - 60 * DAY, end + DAY);
  EST.progreso = "Diagnóstico · " + NAMES[sym] + " · velas de 1 minuto";
  const M = await minutesV(sym, start - 31 * DAY, end + DAY);
  const F = fiveMin(M), P = 300000;
  const Z1 = detectZones(K1, "1H"), Z4 = detectZones(K4, "4H");
  for (const z of [...Z1, ...Z4]) zoneLife(M, z);
  const ZS = [...Z1, ...Z4];
  const cont = (a, b) => b < F.n && F.t[b] - F.t[a] === (b - a) * P;
  const fvgAt = (j, dir) => dir === 1 ? F.l[j + 2] > F.h[j] : F.h[j + 2] < F.l[j];
  const c = { ventanas: 0, con_zona_viva: 0, con_toque: 0, fvg_regla_actual: 0, fvg_regla_escrita: 0, bos_con_fvg_escrito: 0, bos_con_fvg_actual: 0, confirmacion_precio_con_fvg_actual: 0, confirmacion_con_volumen_con_fvg_actual: 0, senal_del_codigo: 0, zonas_distintas_tocadas: 0 };
  const zonasVistas = new Set(), tocadasPorVentana = [];
  for (let d = start; d < end; d += DAY) {
    for (const W of SES_WIN) {
      const preT = etToUtc(d, W.pre), iniT = etToUtc(d, W.ini), finT = etToUtc(d, W.fin);
      if (preT == null || ["Sat", "Sun"].includes(etHour(preT).wd)) continue;
      c.ventanas++;
      const vivas = ZS.filter((z) => z.t0 <= finT && z.end > iniT);
      if (vivas.length) c.con_zona_viva++;
      const k1 = idxAt(F, iniT); if (k1 < 0) continue;
      let flags = { toque: false, fvgA: false, fvgE: false, bosE: false, bosA: false, conP: false, conV: false };
      const tocadas = new Set();
      for (let k = F.t[k1] < iniT ? k1 + 1 : k1; k < F.n && F.t[k] + P <= finT; k++) {
        for (const z of vivas) {
          if (!(z.t0 <= F.t[k] && z.end > F.t[k])) continue;
          if (!(F.l[k] <= z.hi && F.h[k] >= z.lo)) continue;
          const dir = z.side === "buy" ? 1 : -1, key = z.tf + z.tipo + z.side + z.lo + "|" + z.t0;
          flags.toque = true; tocadas.add(key); zonasVistas.add(key);
          // regla actual: FVG con inicio en k-1, k, k+1
          for (let j = k - 1; j <= k + 1; j++) {
            if (j < 3 || !cont(j, j + 2) || !fvgAt(j, dir)) continue;
            flags.fvgA = true;
            const bos = dir === 1 ? F.c[j + 1] > F.sh[j + 1] : F.c[j + 1] < F.sl[j + 1];
            if (bos) flags.bosA = true;
            for (let m = j + 3; m <= j + 5; m++) {
              if (!cont(j + 2, m)) break;
              const okP = dir === 1 ? F.h[m] > F.h[m - 1] && F.c[m] > F.h[m - 1] : F.l[m] < F.l[m - 1] && F.c[m] < F.l[m - 1];
              if (okP) { flags.conP = true; if (F.v[m] > F.v[m - 1]) { flags.conV = true; break; } }
            }
          }
          // regla escrita: el FVG empieza en la vela siguiente al toque (dentro de 5–15 min después del cierre del toque)
          if (cont(k + 1, k + 3) && fvgAt(k + 1, dir)) {
            flags.fvgE = true;
            const bos = dir === 1 ? F.c[k + 2] > F.sh[k + 2] : F.c[k + 2] < F.sl[k + 2];
            if (bos) flags.bosE = true;
          }
        }
      }
      if (flags.toque) c.con_toque++;
      if (flags.fvgA) c.fvg_regla_actual++;
      if (flags.fvgE) c.fvg_regla_escrita++;
      if (flags.bosE) c.bos_con_fvg_escrito++;
      if (flags.bosA) c.bos_con_fvg_actual++;
      if (flags.conP) c.confirmacion_precio_con_fvg_actual++;
      if (flags.conV) c.confirmacion_con_volumen_con_fvg_actual++;
      if (sessionSignal(F, ZS, iniT, finT)) c.senal_del_codigo++;
      tocadasPorVentana.push(tocadas.size);
    }
  }
  c.zonas_distintas_tocadas = zonasVistas.size;
  const multi = tocadasPorVentana.filter((x) => x > 1).length;
  const semanas = (end - start) / (7 * DAY);
  return { fase: "diagnóstico", generado: Date.now(), sym, periodo_dias: days, embudo: c, ventanas_con_mas_de_una_zona_tocada: multi, señales_por_semana_codigo: +(c.senal_del_codigo / semanas).toFixed(2), nota: "Solo lectura. Regla actual = FVG desde una vela antes del toque; regla escrita = FVG desde la vela siguiente. No modifica reglas ni alertas." };
}

// ---------- Fase 6 · Validación independiente de la regla candidata (v4.13) ----------
// Regla CONGELADA con Yasser el 12 oct 2026, antes de ver resultados (después del diagnóstico de solo lectura, que no miró resultados):
//  Ventanas NY: disparo 9:30–10:30 y 15:00–16:00 (hora de NY, L–V). Zonas OB/FVG de 1H (7 días) y 4H (14 días) del código.
//  1) Una vela de 5 min (k) toca una zona viva.  2) FVG a favor con las velas k+1, k+2, k+3 (empieza DESPUÉS del toque).
//  3) BOS: la vela del medio (k+2) cierra más allá del swing más reciente ya confirmado.
//  Entrada al cierre de k+3 (debe cerrar dentro de la ventana). Stop: extremo de la vela que tocó/barrió la zona (k).
//  Meta principal 2R (también se reportan 1R y 3R, definidos antes). Máximo 4 h. Si stop y meta caen en el mismo minuto: stop.
//  Costes: 0.1 % comisión + 0.04 % deslizamiento, ida y vuelta (0.14 % del precio).
//  Independencia: una operación por ventana; una zona se consume con su primera operación.
//  Filtro aparte (no es la regla principal): confirmación = en las 3 velas siguientes, una vela supera el extremo de la anterior,
//  cierra más allá y con más volumen; entrada al cierre de esa vela, mismo stop.
//  Datos NO usados antes para resultados de esta regla: SOL últimos 12 meses y BTC de hace 13 a 24 meses.
//  Vara: R promedio estrictamente positivo con 50+ operaciones (combinado), mostrando cada mercado por separado.
const COST6 = 0.0014;
export function setupSignal(F, zones, iniT, finT, used) {
  const P = 300000, cont = (a, b) => b < F.n && F.t[b] - F.t[a] === (b - a) * P;
  const k1 = idxAt(F, iniT); if (k1 < 0) return null;
  const vivas = zones.filter((z) => z.t0 <= finT && z.end > iniT && !(used && used.has(z)));
  for (let k = F.t[k1] < iniT ? k1 + 1 : k1; k + 3 < F.n && F.t[k + 3] + P <= finT; k++) {
    if (!cont(k, k + 3)) continue;
    for (const z of vivas) {
      if (!(z.t0 <= F.t[k] && z.end > F.t[k])) continue;
      if (!(F.l[k] <= z.hi && F.h[k] >= z.lo)) continue;
      const dir = z.side === "buy" ? 1 : -1;
      const fvg = dir === 1 ? F.l[k + 3] > F.h[k + 1] : F.h[k + 3] < F.l[k + 1];
      const bos = dir === 1 ? F.c[k + 2] > F.sh[k + 2] : F.c[k + 2] < F.sl[k + 2];
      if (!fvg || !bos) continue;
      const e = F.c[k + 3], sl = dir === 1 ? F.l[k] : F.h[k];
      if (!(dir * (e - sl) > 0)) continue;
      return { tE: F.t[k + 3] + P, e, sl, dir, z, k };
    }
  }
  return null;
}
export function confirmOf(F, s, finT) {
  const P = 300000, d = s.dir;
  for (let m = s.k + 4; m <= s.k + 6 && m < F.n; m++) {
    if (F.t[m] - F.t[s.k + 3] !== (m - s.k - 3) * P || F.t[m] + P > finT) break;
    const ok = d === 1 ? F.h[m] > F.h[m - 1] && F.c[m] > F.h[m - 1] : F.l[m] < F.l[m - 1] && F.c[m] < F.l[m - 1];
    if (ok && F.v[m] > F.v[m - 1] && d * (F.c[m] - s.sl) > 0) return { ...s, tE: F.t[m] + P, e: F.c[m] };
  }
  return null;
}
function simCost(M, s, R, cost) {
  const risk = Math.abs(s.e - s.sl); if (!(risk > 0)) return null;
  const tp = s.e + s.dir * R * risk, costR = (cost * s.e) / risk;
  let j = idxAt(M, s.tE); if (j < 0) return null; if (M.t[j] < s.tE) j++;
  for (; j < M.n && M.t[j] < s.tE + 4 * H; j++) {
    if (s.dir === 1 ? M.l[j] <= s.sl : M.h[j] >= s.sl) return { r: -1 - costR, win: false };
    if (s.dir === 1 ? M.h[j] >= tp : M.l[j] <= tp) return { r: R - costR, win: true };
  }
  const jl = Math.min(M.n - 1, j - 1);
  return { r: (s.dir * (M.c[jl] - s.e)) / risk - costR, win: false, tiempo: true };
}
export function statsX(tr) {
  const b = stats(tr); if (!b.n) return b;
  const r = tr.map((x) => x.r).sort((a, c) => a - c), n = r.length, m = r.reduce((a, c) => a + c, 0) / n;
  const sd = n > 1 ? Math.sqrt(r.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1)) : 0;
  const g = r.filter((x) => x > 0).reduce((a, c) => a + c, 0), l = -r.filter((x) => x < 0).reduce((a, c) => a + c, 0);
  return { ...b, mediana_R: +r[n >> 1].toFixed(3), profit_factor: l ? +(g / l).toFixed(2) : null, ic95_R: [+(m - 1.96 * sd / Math.sqrt(n)).toFixed(3), +(m + 1.96 * sd / Math.sqrt(n)).toFixed(3)] };
}
export async function fase6() {
  const res = { fase: 6, generado: Date.now(), regla: "Sesiones NY: toque de zona 1H/4H → FVG 5m que empieza después del toque → BOS; entrada al cierre del FVG; stop en el extremo de la vela del toque; 2R; máx. 4 h", costes: "0.14 % del precio ida y vuelta", mercados: {} };
  const hoy = Math.floor(Date.now() / DAY) * DAY - DAY;
  const plan = [{ sym: "SOL", end: hoy, et: "SOL · últimos 12 meses" }, { sym: "BTC", end: hoy - 365 * DAY, et: "BTC · hace 13 a 24 meses" }];
  const todo = { base: { 1: [], 2: [], 3: [] }, conf: { 1: [], 2: [], 3: [] } };
  for (const p of plan) {
    const start = p.end - 365 * DAY;
    EST.progreso = "Fase 6 · " + p.et + " · velas 1H/4H";
    let K1, K4, M;
    try { K1 = await klinesRange(p.sym, "1h", start - 30 * DAY, p.end + DAY); K4 = await klinesRange(p.sym, "4h", start - 60 * DAY, p.end + DAY); }
    catch (e) { res.mercados[p.et] = { error: "sin datos: " + e.message }; continue; }
    EST.progreso = "Fase 6 · " + p.et + " · velas de 1 minuto (puede tardar)";
    try { M = await minutesV(p.sym, start - 31 * DAY, p.end + DAY); } catch (e) { res.mercados[p.et] = { error: "sin velas 1m: " + e.message }; continue; }
    if (M.n < 1000) { res.mercados[p.et] = { error: "muy poca historia" }; continue; }
    const F = fiveMin(M), Z1 = detectZones(K1, "1H"), Z4 = detectZones(K4, "4H");
    for (const z of [...Z1, ...Z4]) zoneLife(M, z);
    const ZS = [...Z1, ...Z4], used = new Set(), ops = [];
    let ventanas = 0;
    for (let d = start; d < p.end; d += DAY) {
      for (const W of SES_WIN) {
        const preT = etToUtc(d, W.pre), iniT = etToUtc(d, W.ini), finT = etToUtc(d, W.fin);
        if (preT == null || ["Sat", "Sun"].includes(etHour(preT).wd)) continue;
        ventanas++;
        const s = setupSignal(F, ZS, iniT, finT, used); if (!s) continue;
        used.add(s.z);
        const c = confirmOf(F, s, finT);
        ops.push({ t: s.tE, ses: W.k, dir: s.dir, tf: s.z.tf, base: { 1: simCost(M, s, 1, COST6), 2: simCost(M, s, 2, COST6), 3: simCost(M, s, 3, COST6) }, conf: c ? { 1: simCost(M, c, 1, COST6), 2: simCost(M, c, 2, COST6), 3: simCost(M, c, 3, COST6) } : null });
      }
      if ((d / DAY) % 20 === 0) await sleep(0);
    }
    const R = (k, n) => ops.filter((o) => o[k] && o[k][n]).map((o) => ({ t: o.t, r: o[k][n].r, win: o[k][n].win, ses: o.ses }));
    for (const n of [1, 2, 3]) { todo.base[n].push(...R("base", n)); todo.conf[n].push(...R("conf", n)); }
    const semanas = 365 / 7;
    res.mercados[p.et] = { ventanas, operaciones: ops.length, por_semana: +(ops.length / semanas).toFixed(2),
      regla: Object.fromEntries([1, 2, 3].map((n) => [n + "R", statsX(R("base", n))])),
      con_confirmacion_volumen: Object.fromEntries([1, 2, 3].map((n) => [n + "R", statsX(R("conf", n))])),
      por_sesion_2R: { apertura: statsX(R("base", 2).filter((x) => x.ses === "apertura")), cierre: statsX(R("base", 2).filter((x) => x.ses === "cierre")) },
      ultimas: ops.slice(-15).map((o) => ({ fecha: new Date(o.t).toISOString().slice(0, 16), ses: o.ses, dir: o.dir === 1 ? "compra" : "venta", zona: o.tf, R2: o.base[2] ? +o.base[2].r.toFixed(2) : null })) };
    M = null;
  }
  const comb = Object.fromEntries([1, 2, 3].map((n) => [n + "R", statsX(todo.base[n])]));
  res.combinado = { regla: comb, con_confirmacion_volumen: Object.fromEntries([1, 2, 3].map((n) => [n + "R", statsX(todo.conf[n])])) };
  res.pasa = comb["2R"].n >= 50 && comb["2R"].R_prom > 0;
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
// v4.10: por defecto 60 mañanas por mercado, una cada 6 días (≈ 12 meses). Vara: R promedio positivo con 50+ operaciones.
export async function fase3(manianas = 60, paso = 6) {
  const res = { fase: 3, generado: Date.now(), tito: {} };
  if (!ENV.anthropicKey) { res.tito = { error: "falta ANTHROPIC_API_KEY" }; return res; }
  const end = Math.floor(Date.now() / DAY) * DAY - 2 * DAY;
  for (const sym of ["BTC", "SOL"]) {
    const tr = [];
    for (let n = 0; n < manianas; n++) {
      const d0 = end - n * paso * DAY + 12 * H + 15 * 60000;                 // ~8:15 AM hora de NY, cada `paso` días hacia atrás
      EST.progreso = "Fase 3 · TITO a ciegas · " + NAMES[sym] + " · " + new Date(d0).toISOString().slice(0, 10);
      try {
        // v4.8: solo velas CERRADAS antes de d0 (antes entraban la vela de 1H, la de 4H y la diaria en curso, con su futuro).
        const cerr = (K, ms) => K.filter((k) => k[0] + ms <= d0);
        const [K4, K1, KD] = await Promise.all([klinesRange(sym, "4h", d0 - 42 * 4 * H, d0).then((K) => cerr(K, 4 * H)), klinesRange(sym, "1h", d0 - 48 * H, d0).then((K) => cerr(K, H)), klinesRange(sym, "1d", d0 - 30 * DAY, d0).then((K) => cerr(K, DAY))]);
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
          const costR = (FEE_RT * near) / risk;                               // v4.8: comisión incluida, igual que la Fase 2
          for (let j = i + 1; j < M.n; j++) { if (dir === 1 ? M.l[j] <= z.sl : M.h[j] >= z.sl) { out = { win: false, r: -1 - costR }; break; } if (dir === 1 ? M.h[j] >= z.tp1 : M.l[j] <= z.tp1) { out = { win: true, r: reward / risk - costR }; break; } }
          if (out) tr.push({ ...out, t: M.t[i], stop_vs_atr: +(risk / (a || 1)).toFixed(2), filtro_v43: risk >= 0.5 * a });
        }
      } catch (e) { log("estudio fase3", e.message); }
      await sleep(500);
    }
    res.tito[sym] = { todas: stats(tr), con_filtro_stop_v43: stats(tr.filter((x) => x.filtro_v43)), stop_promedio_en_ATR: tr.length ? +(tr.reduce((s, x) => s + x.stop_vs_atr, 0) / tr.length).toFixed(2) : null };
  }
  return res;
}

// ---------- Fase 7 · Penetración en la zona antes de reaccionar (v4.20) ----------
// Pedido de Yasser (13 oct 2026): olvidar el stop de cada zona y medir cuánto margen hace falta. Regla de medición FIJA:
//  Zonas OB/FVG de 1H (vida 7 días) y 4H (14 días), mismas que el resto del estudio. Un toque por zona: el primero.
//  Toque válido: al confirmarse la zona el precio está del lado correcto (compra: por encima; venta: por debajo) y luego llega al borde.
//  Entrada = borde cercano (compra: borde superior; venta: borde inferior). Ancho W = hi − lo.
//  Reacción = el precio se aleja a favor de la entrada al menos U = max(W, 0,5 × ATR 1H) dentro de 48 h.
//  Penetración = lo más lejos que fue el precio en contra de la entrada ANTES de reaccionar (o en 48 h si no reaccionó).
//  Se reporta en % del precio, en dólares, en anchos de zona, en ATR 1H y lo que pasó del borde lejano.
//  Prueba de stops: stop = borde lejano + b % del precio; % de toques que SÍ reaccionaban y que ese stop habría sacado antes.
export const BUF7 = [0, 0.001, 0.002, 0.003, 0.005, 0.01];
export function penetracion(M, K1, zones, now = Infinity) {
  const A1 = atrArr(K1), out = [];
  const atrAt = (t) => { let lo = 0, hi = K1.length - 1, i = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (K1[m][0] + H <= t) { i = m; lo = m + 1; } else hi = m - 1; } for (let j = i; j >= 0; j--) if (A1[j]) return A1[j]; return null; };
  for (const z of zones) {
    const life = ZLIFE[z.tf] || 7 * DAY, buy = z.side === "buy", W = z.hi - z.lo, E = buy ? z.hi : z.lo;
    if (!(W > 0)) continue;
    let i = idxAt(M, z.t0); if (i < 0) continue; if (M.t[i] < z.t0) i++;
    if (i >= M.n) continue;
    if (buy ? M.c[i] <= E : M.c[i] >= E) continue;                       // nació tocada o del lado equivocado
    let k = -1;
    for (let j = i; j < M.n && M.t[j] < z.t0 + life; j++) if (buy ? M.l[j] <= E : M.h[j] >= E) { k = j; break; }
    if (k < 0) continue;
    const atr = atrAt(M.t[k]); if (!atr) continue;
    const U = Math.max(W, 0.5 * atr), end = M.t[k] + 2 * DAY;
    if (end > now) continue;                                              // ventana de 48 h incompleta
    let worst = E, react = false, tR = null;
    for (let j = k; j < M.n && M.t[j] < end; j++) {
      if (buy) { if (M.l[j] < worst) worst = M.l[j]; if (M.h[j] >= E + U && j > k) { react = true; tR = M.t[j]; break; } }
      else { if (M.h[j] > worst) worst = M.h[j]; if (M.l[j] <= E - U && j > k) { react = true; tR = M.t[j]; break; } }
    }
    const pen = Math.abs(E - worst);
    out.push({ tf: z.tf, tipo: z.tipo, side: z.side, t: M.t[k], E, W, atr, pen, penPct: pen / E, penW: pen / W, penAtr: pen / atr, farPct: Math.max(0, pen - W) / E, wPct: W / E, react, mins: react ? (tR - M.t[k]) / 60000 : null });
  }
  return out;
}
const pctl = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
const r4 = (x, d = 3) => (x == null ? null : +x.toFixed(d));
export function resumenPen(T) {
  const R = T.filter((x) => x.react), qs = [0.5, 0.75, 0.8, 0.9, 0.95];
  const dist = (f, d = 3) => Object.fromEntries([["prom", r4(R.length ? R.reduce((s, x) => s + f(x), 0) / R.length : null, d)], ...qs.map((q) => ["p" + Math.round(q * 100), r4(pctl(R.map(f), q), d)])]);
  const stops = BUF7.map((b) => {
    const out = R.filter((x) => x.farPct > b).length;                       // la reacción llegó DESPUÉS de pasar este stop
    return { margen_pct_mas_alla_del_borde: +(b * 100).toFixed(1), te_sacaba_antes_de_reaccionar_pct: R.length ? +((out / R.length) * 100).toFixed(1) : null };
  });
  return {
    toques: T.length, reaccionan: R.length, reaccionan_pct: T.length ? +((R.length / T.length) * 100).toFixed(1) : null,
    minutos_hasta_reaccion_mediana: r4(pctl(R.map((x) => x.mins), 0.5), 0),
    ancho_zona_pct: dist((x) => x.wPct * 100),
    entra_pct_del_precio: dist((x) => x.penPct * 100),
    entra_en_anchos_de_zona: dist((x) => x.penW, 2),
    entra_en_ATR1H: dist((x) => x.penAtr, 2),
    pasa_borde_lejano_pct: dist((x) => x.farPct * 100),
    entra_en_dolares: dist((x) => x.pen, 2),
    stops,
  };
}
export async function fase7(days = 365) {
  const res = { fase: 7, generado: Date.now(), periodo_dias: days, regla: "Toque de zona 1H/4H (primero por zona) · entrada en el borde · reacción = se aleja a favor max(1 ancho, 0,5 ATR 1H) en 48 h · penetración = lo más lejos en contra antes de reaccionar", mercados: {} };
  const end = Math.floor(Date.now() / DAY) * DAY, start = end - days * DAY;
  for (const sym of MARKETS) {
    EST.progreso = "Fase 7 · " + NAMES[sym] + " · velas 1H/4H";
    let K1, K4, M;
    try { K1 = await klinesRange(sym, "1h", start - 30 * DAY, end); K4 = await klinesRange(sym, "4h", start - 60 * DAY, end); }
    catch (e) { res.mercados[sym] = { error: "sin datos: " + e.message }; continue; }
    EST.progreso = "Fase 7 · " + NAMES[sym] + " · velas de 1 minuto (puede tardar)";
    try { M = await minutes(sym, start, end); } catch (e) { res.mercados[sym] = { error: "sin velas 1m: " + e.message }; continue; }
    if (M.n < 10000) { res.mercados[sym] = { error: "muy poca historia (" + M.n + " velas de 1 min)" }; continue; }
    const Z = [...detectZones(K1, "1H"), ...detectZones(K4, "4H")].filter((z) => z.t0 >= start);
    const T = penetracion(M, K1, Z, end);
    res.mercados[sym] = { desde: new Date(M.t[0]).toISOString().slice(0, 10), todas: resumenPen(T), "1H": resumenPen(T.filter((x) => x.tf === "1H")), "4H": resumenPen(T.filter((x) => x.tf === "4H")), OB: resumenPen(T.filter((x) => x.tipo === "OB")), FVG: resumenPen(T.filter((x) => x.tipo === "FVG")) };
    M = null; await sleep(0);
  }
  return res;
}

// ---------- Orquestador ----------
export function estudioData() { return { estado: EST, fase1: kvGet("estudio1", null), fase2: kvGet("estudio2", null), fase3: kvGet("estudio3", null), fase4: kvGet("estudio4", null), fase5: kvGet("estudio5", null), fase6: kvGet("estudio6", null), fase7: kvGet("estudio7", null) }; }
export async function runEstudio(fases, notify) {
  if (EST.running) return notify("⏳ El estudio ya está corriendo: " + EST.progreso);
  EST.running = true; EST.inicio = Date.now(); EST.error = "";
  try {
    for (const f of fases) {
      EST.fase = "Fase " + f;
      await notify("🔬 Estudio · arrancó la Fase " + f + (f === 1 ? " (ballenas, 12 meses, 1 día por semana)" : f === 2 ? " (zonas + reglas, 12 meses de velas de 1 minuto)" : f === 4 ? " (ruptura de zona, 12 meses de velas de 1 minuto)" : f === 7 ? " (cuánto entra el precio en la zona antes de reaccionar: BTC, SOL y oro, 12 meses de velas de 1 minuto)" : f === 6 ? " (validación independiente de la regla candidata: SOL últimos 12 meses y BTC de hace 13 a 24 meses)" : f === 5 ? " (sesiones NY de Bitcoin: zona + FVG/BOS + volumen + órdenes grandes, 12 meses; descarga las operaciones reales día por día, puede tardar 1–2 h)" : " (TITO a ciegas, 60 mañanas por mercado, ~120 consultas a Anthropic)") + ". Te aviso al terminar.");
      const r = f === 1 ? await fase1() : f === 2 ? await fase2() : f === 4 ? await fase4() : f === 5 ? await fase5() : f === 6 ? await fase6() : f === 7 ? await fase7() : await fase3();
      kvSet("estudio" + f, r);
      await notify("✅ Estudio · Fase " + f + " lista en " + Math.round((Date.now() - EST.inicio) / 60000) + " min.\n" + resumen(f, r));
    }
  } catch (e) { EST.error = e.message; log("estudio", e.message); await notify("⚠️ Estudio detenido: " + e.message); }
  finally { EST.running = false; EST.progreso = "terminado"; }
}
function resumen(f, r) {
  if (f === 7) return Object.entries(r.mercados || {}).map(([s, m]) => { if (m.error) return "• " + NAMES[s] + ": " + m.error; const t = m.todas, st = (b) => (t.stops.find((x) => x.margen_pct_mas_alla_del_borde === b) || {}).te_sacaba_antes_de_reaccionar_pct;
    return "• " + NAMES[s] + ": " + t.toques + " toques · reaccionan " + t.reaccionan_pct + "% · antes de reaccionar entra " + t.entra_pct_del_precio.p50 + "% (mediana) / " + t.entra_pct_del_precio.p80 + "% (80 %) / " + t.entra_pct_del_precio.p90 + "% (90 %)\n  pasa el borde lejano: mediana " + t.pasa_borde_lejano_pct.p50 + "% · 80 % " + t.pasa_borde_lejano_pct.p80 + "% · 90 % " + t.pasa_borde_lejano_pct.p90 + "%\n  stop en el borde lejano te sacaba antes de reaccionar " + st(0) + "% de las veces · +0,2 % → " + st(0.2) + "% · +0,5 % → " + st(0.5) + "%"; }).join("\n") + "\n-# Solo medición: no es una regla de entrada. Detalle completo en el panel del estudio.";
  if (f === 1) return MARKETS.map((s) => { const m = r.mercados[s]; if (!m) return ""; const t = m.por_tamano || {}; return "• " + NAMES[s] + ": " + m.ordenes + " órdenes en " + m.dias_analizados + " días · " + m.nota_recomendacion; }).join("\n");
  if (f === 2) return MARKETS.map((s) => { const m = r.mercados[s]; if (!m || !m.mejor) return "• " + NAMES[s] + ": " + ((m && m.error) || "sin combinación con 40+ operaciones"); const b = m.mejor; return "• " + NAMES[s] + ": mejor regla " + b.reglas.tf + " · stop " + b.reglas.k + "×ATR · meta " + b.reglas.R + "R · " + b.reglas.confirm + (b.reglas.tend ? " · con tendencia" : "") + " → validación " + b.validacion.acierto + "% acierto, " + b.validacion.R_prom + "R por operación (" + b.validacion.n + " ops)"; }).join("\n");
  if (f === 4) return MARKETS.map((s) => { const m = r.mercados[s]; if (!m || !m.mejor) return "• " + NAMES[s] + ": " + ((m && m.error) || "sin combinación con 50+ operaciones"); const b = m.mejor_validada || m.mejor, q = b.reglas;
    return "• " + NAMES[s] + ": " + (m.mejor_validada ? "✅ " : "❌ ") + q.tf + " · stop " + q.k + "×ATR · meta " + q.R + "R" + (q.tend ? " · con tendencia" : "") + " → afinado " + b.entrenamiento.R_prom + "R · validación " + b.validacion.acierto + "% acierto, " + b.validacion.R_prom + "R por operación (" + b.validacion.n + " ops)" + (m.mejor_validada ? "" : " · ninguna positiva en ambos periodos"); }).join("\n");
  if (f === 6) { const L = (v) => (v && v.n ? v.n + " ops · " + v.acierto + "% · " + v.R_prom + "R (IC95 " + v.ic95_R.join(" a ") + ")" : "sin operaciones");
    return Object.entries(r.mercados || {}).map(([k, m]) => "• " + k + ": " + (m.error || L(m.regla["2R"]) + " · " + m.por_semana + " por semana")).join("\n") + "\n• Combinado 2R: " + (r.pasa ? "✅ " : "❌ ") + L(r.combinado.regla["2R"]) + "\n  con confirmación de volumen: " + L(r.combinado.con_confirmacion_volumen["2R"]) + "\n-# Regla congelada antes de correr. Vara: R promedio positivo con 50+ operaciones, costes incluidos (0.14 %)."; }
  if (f === 5) return Object.entries(r.mercados || {}).map(([s, m]) => { if (m.error) return "• " + NAMES[s] + ": " + m.error; const t = m.tabla, l = (g) => { const v = t[g]["2R"].validacion; return v.n ? v.acierto + "% · " + v.R_prom + "R (" + v.n + " ops)" : "sin operaciones"; };
    return "• " + NAMES[s] + ": " + (m.pasa ? "✅ " : "❌ ") + "regla completa 2R en validación → " + l("completa") + "\n  señales por semana: " + m.senales_por_semana + " (completa: " + m.completa_por_semana + ")\n  solo disparo: " + l("base") + " · delta a favor: " + l("delta_a_favor") + " · A++: " + l("A_plus") + " · sin A++: " + l("sin_A_plus"); }).join("\n") + "\n-# Vara: R promedio positivo con 50+ operaciones en los 4 meses de validación, comisión incluida.";
  return Object.entries(r.tito || {}).map(([s, v]) => "• TITO " + (NAMES[s] || s) + ": " + (v.error || ((v.todas.n >= 50 && v.todas.R_prom > 0 ? "✅ " : "❌ ") + v.todas.n + " zonas tocadas · " + v.todas.acierto + "% acierto · " + v.todas.R_prom + "R por operación" + (v.todas.n < 50 ? " (menos de 50: muestra corta)" : "")))).join("\n") + "\n-# Vara: R promedio positivo con 50+ operaciones.";
}
