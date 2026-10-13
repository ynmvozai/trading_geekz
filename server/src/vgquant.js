// v4.14 · Alertas de VG QUANT (TradingView) por webhook propio → registro y seguimiento de la zona.
// v4.16: TradingView manda la alerta AQUÍ (un solo webhook por alerta); el servidor la reenvía a #indices-zonas tal cual,
// la registra y publica el resultado en #resultados. Si no la entiende, igual la reenvía (no se pierde ninguna). No opera, no cambia zonas ni alertas existentes. La regla de resultado está fijada aquí, antes de ver datos.
// Regla (fija): zona de OFERTA ("baja"): acierta si el precio cae 1 ancho de zona por debajo de su borde inferior;
// falla si cierra por encima del borde superior. Zona de DEMANDA ("sube"): espejo. Sin resolver a las 24 h.
import { kvGet, kvSet } from "./store.js";
import { IDX, tvSym } from "./macro.js";
import { log } from "./util.js";
import { idxPost, resPost } from "./discord.js";

const MAX = 300;
const H24 = 24 * 3600000;
const DEDUPE = 60 * 60000;
const STALE = 20 * 60000;
export const VG = { n: 0, err: "", lastRaw: "" };

// ---------- Lectura del mensaje ----------
const num = (s) => {
  let x = String(s).trim();
  if (x.includes(".") && x.includes(",")) x = x.replace(/,/g, "");
  else x = x.replace(/,/g, ".");
  return +x;
};
const DIR = (s) => (/OFERTA|VENTA|SELL|SUPPLY|BAJ/i.test(s) ? "baja" : /DEMANDA|COMPRA|BUY|DEMAND|SUB/i.test(s) ? "sube" : null);

// Acepta JSON {"sym","tf","dir","lo","hi","prob","session","price"} o el texto del mensaje de Discord.
export function parseVg(body) {
  const raw = String(body || "").trim();
  let o = null;
  try { const j = JSON.parse(raw); if (j && typeof j === "object") o = { sym: j.sym || j.s || j.ticker, tf: j.tf || j.interval, dir: j.dir || j.side, lo: j.lo, hi: j.hi, prob: j.prob ?? j.probabilidad, session: j.session || j.sesion, price: j.price ?? j.precio }; } catch {}
  if (!o) {
    const m = (re) => { const x = raw.match(re); return x ? x[1] : null; };
    const z = raw.match(/zona\s+([\d.,]+)\s*[–-]\s*([\d.,]+)/i);
    o = {
      sym: m(/\b(DJ30|US30|NQ|USTEC|NAS100|NDX)\b/i),
      tf: m(/\b(?:DJ30|US30|NQ|USTEC|NAS100|NDX)\s+(\d+[mhDWM]?)\b/i),
      dir: m(/precio\s+entr[oó]\s+en\s+(\w+)/i) || m(/\((se espera que \w+)\)/i),
      lo: z && z[1], hi: z && z[2],
      prob: m(/probabilidad\s+([\d.,]+)\s*%/i),
      session: m(/sesi[oó]n\s+(\w+)/i),
      price: m(/precio\s+([\d]+(?:[.,]\d+)?)\s*$/i),
    };
  }
  let lo = typeof o.lo === "number" ? o.lo : num(o.lo), hi = typeof o.hi === "number" ? o.hi : num(o.hi);
  if (lo > hi) [lo, hi] = [hi, lo];
  let prob = o.prob == null ? null : num(o.prob); if (prob != null && prob <= 1) prob *= 100;
  const price = o.price == null ? null : num(o.price);
  const sym = tvSym(o.sym);
  const dir = DIR(String(o.dir || ""));
  const out = { sym, tf: o.tf ? String(o.tf) : null, dir, lo, hi, prob, session: o.session ? String(o.session) : null, price, raw: raw.slice(0, 400) };
  if (!sym) return { ok: false, error: "no reconozco el mercado (necesito DJ30 o NQ/USTEC)" };
  if (!dir) return { ok: false, error: "no reconozco la dirección (OFERTA/DEMANDA o baja/sube)" };
  if (!(lo > 0) || !(hi > lo)) return { ok: false, error: "zona inválida (necesito lo < hi)" };
  if (price != null && (price < lo * 0.9 || price > hi * 1.1)) return { ok: false, error: "precio fuera de la zona (" + price + ")" };
  return { ok: true, alert: out };
}

// ---------- Registro ----------
const list = () => kvGet("vgq", []) || [];
const save = (arr) => { while (arr.length > MAX) arr.shift(); kvSet("vgq", arr); };
const vgRef = (sym) => (IDX[sym] ? +IDX[sym].price : null);

export function recordVg(a, now = Date.now()) {
  const arr = list();
  const dup = arr.find((x) => x.sym === a.sym && x.lo === a.lo && x.hi === a.hi && x.dir === a.dir && now - x.t < DEDUPE);
  if (dup) return { ok: true, dup: true, id: dup.id };
  const w = a.hi - a.lo;
  const rec = { id: now.toString(36) + Math.random().toString(36).slice(2, 5), t: now, ...a, width: w, status: "abierta", min: a.price ?? null, max: a.price ?? null, last: a.price ?? null, t_end: null, end_price: null };
  arr.push(rec); save(arr); VG.n++; VG.err = "";
  return { ok: true, id: rec.id, rec };
}

const fmt = (x) => (x == null ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 }));

// Un tick: actualiza cada alerta abierta con el precio actual y la resuelve si toca la regla.
export function vgTick(now = Date.now()) {
  const arr = list(); let changed = false;
  for (const a of arr) {
    if (a.status !== "abierta") continue;
    const p = vgRef(a.sym);
    const fresh = IDX[a.sym] && now - IDX[a.sym].t < STALE;
    if (p != null && fresh) {
      a.last = p; a.min = a.min == null ? p : Math.min(a.min, p); a.max = a.max == null ? p : Math.max(a.max, p); changed = true;
      let res = null;
      if (a.dir === "baja") { if (p > a.hi) res = "falla"; else if (p <= a.lo - a.width) res = "acierta"; }
      else { if (p < a.lo) res = "falla"; else if (p >= a.hi + a.width) res = "acierta"; }
      if (res) { a.status = res; a.t_end = now; a.end_price = p; vgResult(a); continue; }
    }
    if (now - a.t > H24) { a.status = "sin resolver"; a.t_end = now; changed = true; vgResult(a); }
  }
  if (changed) save(arr);
}

const DIRTXT = (d) => (d === "baja" ? "oferta (esperaba bajada)" : "demanda (esperaba subida)");
const MK = (s) => (s === "YM" ? "DJ30" : "NQ");
function vgResult(a) {
  const st = a.status === "acierta" ? "✅ Acertó" : a.status === "falla" ? "❌ Falló (cerró fuera de la zona)" : "⏳ Sin resolver a 24 h";
  resPost("📊 **VG QUANT · " + MK(a.sym) + " " + (a.tf || "") + "** · " + DIRTXT(a.dir) + "\nZona " + fmt(a.lo) + " – " + fmt(a.hi) + " · " + st +
    "\nPrecio final " + fmt(a.end_price) + " · máx " + fmt(a.max) + " · mín " + fmt(a.min) + "\n-# Medición con regla fija (1 ancho de zona, 24 h). No es señal validada.").catch((e) => { VG.err = "resultados: " + e.message; });
}

// v4.17: borrar un registro (p. ej. una prueba que entró como real). Devuelve true si existía.
export function vgDelete(id) {
  const arr = list(), i = arr.findIndex((a) => a.id === id);
  if (i < 0) return false;
  arr.splice(i, 1); save(arr); return true;
}

export function vgSummary() {
  const arr = list();
  const done = arr.filter((a) => a.status === "acierta" || a.status === "falla");
  const ac = done.filter((a) => a.status === "acierta").length;
  const open = arr.filter((a) => a.status === "abierta").length;
  const pct = done.length ? Math.round((ac / done.length) * 100) + "%" : "—";
  const last = arr.slice(-5).reverse().map((a) => "· " + new Date(a.t).toISOString().slice(0, 16).replace("T", " ") + " UTC · " + a.id + " · " + a.sym + " " + (a.dir === "baja" ? "oferta" : "demanda") + " " + fmt(a.lo) + "–" + fmt(a.hi) + " → " + a.status).join("\n");
  return "📊 **VG QUANT · registro**\nRecibidas: " + arr.length + " · abiertas: " + open + " · resueltas: " + done.length + " · acierto: " + pct + " (" + ac + "/" + done.length + ")\n" + (last || "Aún no ha llegado ninguna.");
}

export function startVg() {
  setInterval(() => { try { vgTick(); } catch (e) { log("vgTick", e.message); } }, 60000);
}

// Ruta POST /vgq/<secreto>. El secreto va en la URL; no se valida por IP (TradingView no tiene IP fija para alert()).
export function vgSecret() {
  let s = kvGet("vgSecret", null);
  if (!s) { s = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2); kvSet("vgSecret", s); }
  return s;
}
export function onVg(body) {
  const raw = String(body || "").trim();
  let test = false; try { test = !!JSON.parse(raw).test; } catch {}
  const p = parseVg(raw);
  if (test) return { ok: p.ok, prueba: true, leido: p.ok ? p.alert : null, error: p.error };   // prueba: no registra ni publica
  const fwd = (extra) => idxPost(raw.slice(0, 1800) + extra).catch((e) => { VG.err = "indices-zonas: " + e.message; });
  if (!p.ok) { VG.err = p.error; fwd("\n-# ⚠️ No pude leer este mensaje para el seguimiento (" + p.error + ")."); return { ok: true, reenviado: true, seguimiento: false, error: p.error }; }
  const r = recordVg(p.alert);
  if (r.dup) return { ok: true, id: r.id, dup: true };
  const a = p.alert, w = a.hi - a.lo;
  const meta = a.dir === "baja" ? "acierta si baja a " + fmt(a.lo - w) + " · falla si cierra sobre " + fmt(a.hi) : "acierta si sube a " + fmt(a.hi + w) + " · falla si cierra bajo " + fmt(a.lo);
  fwd("\n-# 📊 Seguimiento activo 24 h: " + meta + ". Resultado en #resultados.");
  return { ok: true, id: r.id };
}
