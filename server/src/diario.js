// v4.24 · Diario automático de tus operaciones (#diario-de-trades). Pedido de Yasser (13 oct 2026).
// Tú escribes UNA línea al entrar; el servidor sigue el precio real y cierra solo al tocar el stop o la meta.
// Cada operación se mide en R (riesgo inicial) con comisión, y guarda el contexto (zona, sesión NY) para aprender después.
// Vara (fija): R promedio > 0 con 50+ operaciones.
// Formato:
//   compra BTC 83200 sl 82500 tp 84500      (sin precio = precio actual; tp opcional)
//   venta oro 4170 sl 4185 tp 4140
//   compra dow 51600 sl 51500 salida 51750   (operación ya cerrada, para anotar una pasada)
//   cerrar 3 83900 · cerrar BTC (precio actual) · stop 3 83000 (mover stop; el R sigue midiendo con el stop inicial)
//   diario · abiertas · borrar 3
import { ENV, NAMES } from "./config.js";
import { kvGet, kvSet } from "./store.js";
import { S } from "./market.js";
import { IDX } from "./macro.js";
import { Z, isBroken } from "./zones.js";
import { inWindow } from "./sesionny.js";
import { riskCfg, FEE_RT } from "./risk.js";
import { botPost } from "./discord.js";
import { log, shortPR, prParts } from "./util.js";

export const DI = { err: "" };
const MAXC = 1000;
const MAXDIA = 2;   // su propia regla (diario GFF, oct 2024): "DEBO VOLVER A 2 SOLO TRADES"
const IDXS = ["YM", "NQ"];
const NM = (s) => ({ YM: "Dow", NQ: "Nasdaq" })[s] || NAMES[s] || s;
const fmt = (x) => (x == null || !isFinite(x) ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: x > 1000 ? 1 : x > 10 ? 2 : 4 }));
const money = (x) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString("en-US");
const rr = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "R";

export function dSym(w) {
  w = String(w || "").toLowerCase();
  if (/^(btc|bitcoin)/.test(w)) return "BTC";
  if (/^(sol|solana)/.test(w)) return "SOL";
  if (/^(oro|xau|gold)/.test(w)) return "XAU";
  if (/^(dow|dj30|us30|ym)/.test(w)) return "YM";
  if (/^(nq|nasdaq|ustec|nas100|ndx)/.test(w)) return "NQ";
  return null;
}
// 83,200 → 83200 · 83200.5 → 83200.5 · 4170,5 → 4170.5
export function dNum(s) {
  if (s == null) return null;
  let x = String(s).trim();
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) x = x.replace(/,/g, "");
  else x = x.replace(/,/g, ".");
  const n = +x; return n > 0 ? n : null;
}
const N = "([\\d][\\d.,]*)";

// Lectura de una línea (pura, probada). Devuelve { cmd, ... } o null.
export function parseLine(text) {
  const t = String(text || "").trim().toLowerCase().replace(/^[/!]/, "").replace(/\s+/g, " ");
  if (!t) return null;
  if (/^(diario|estad[ií]sticas|resumen)$/.test(t)) return { cmd: "stats" };
  if (/^(abiertas|estado)$/.test(t)) return { cmd: "open" };
  if (/^(ayuda|help|\?)$/.test(t)) return { cmd: "help" };
  let q = t.match(/^plan (#?\d+) (s[ií]|no)$/); if (q) return { cmd: "plan", id: +q[1].replace("#", ""), plan: q[2] !== "no" };
  let m = t.match(/^borrar #?(\d+)$/); if (m) return { cmd: "del", id: +m[1] };
  m = t.match(new RegExp("^(?:mover )?(?:sl|stop) (#?\\d+|[a-z0-9]+) (?:a |en )?" + N + "$"));
  if (m) return { cmd: "sl", ref: m[1].replace("#", ""), price: dNum(m[2]) };
  m = t.match(new RegExp("^cerr(?:ar|é|e|ada|ado)? (#?\\d+|[a-z0-9]+)(?: (?:a |en |@ ?)?" + N + ")?$"));
  if (m) return { cmd: "close", ref: m[1].replace("#", ""), price: dNum(m[2]) };
  m = t.match(new RegExp("^(compra|compr[eé]|long|buy|venta|vend[ií]|short|sell) ([a-z0-9.]+)(?: (?:a |en |@ ?)?" + N + ")?(.*)$"));
  if (!m) return null;
  const side = /^(compra|compr|long|buy)/.test(m[1]) ? "buy" : "sell", sym = dSym(m[2]);
  const raw = String(text).trim(), nm = raw.match(/\bnota:?\s+(.+)$/i), rest = (m[4] || "").replace(/\bnota:?\s+.+$/, "");
  const g = (re) => { const x = rest.match(re); return x ? dNum(x[1]) : null; };
  const pl = rest.match(/\bplan (s[ií]|no)\b/);
  return { cmd: "new", side, sym, symRaw: m[2], entry: dNum(m[3]), sl: g(new RegExp("\\b(?:sl|stop) ?" + N)), tp: g(new RegExp("\\b(?:tp|meta|target|objetivo) ?" + N)), exit: g(new RegExp("\\b(?:salida|sal[ií]|cerr[eé]|exit) ?(?:a |en )?" + N)),
    plan: pl ? pl[1] !== "no" : null, nota: nm ? nm[1].trim().slice(0, 200) : null };
}

// Precio de seguimiento: Binance para cripto y oro; futuros (CNBC) para índices.
export function livePrice(sym, now = Date.now()) {
  if (IDXS.includes(sym)) { const i = IDX[sym]; return i && i.price && now - i.t < 20 * 60000 ? +i.price : null; }
  const s = S[sym]; return s && s.price && s.lastRecv && now - s.lastRecv < 60000 ? +s.price : null;
}

// Resultado en R con comisión (pura, probada). Índices: sin comisión (depende del bróker).
export function rOf(tr, exit) {
  const dist = Math.abs(tr.entry - tr.sl0); if (!(dist > 0)) return 0;
  const g = tr.side === "buy" ? exit - tr.entry : tr.entry - exit;
  const fee = IDXS.includes(tr.sym) ? 0 : (FEE_RT * tr.entry) / dist;
  return g / dist - fee;
}

const st = () => kvGet("diario", null) || { n: 0, open: [], closed: [] };
const save = (d) => { if (d.closed.length > MAXC) d.closed.length = MAXC; kvSet("diario", d); };
const post = (txt) => (ENV.diarioChannelId ? botPost(ENV.diarioChannelId, txt) : Promise.resolve()).catch((e) => { DI.err = e.message; log("#diario-de-trades:", e.message); });

function ctxOf(sym, p, now) {
  const z = Z.list.find((z) => z.sym === sym && z.hi > 0 && !isBroken(z) && p >= Math.min(z.lo, z.hi) && p <= Math.max(z.lo, z.hi));
  return { zona: z ? (z.name || (z.side === "sell" ? "venta" : "compra")) + " " + fmt(Math.min(z.lo, z.hi)) + "–" + fmt(Math.max(z.lo, z.hi)) : null, zonaLado: z ? z.side : null, sesionNY: inWindow(now) };
}

// Abre (o anota ya cerrada) una operación. Devuelve { ok, txt }.
export function openTrade(p, now = Date.now()) {
  if (!p.sym) return { ok: false, txt: "No reconozco el mercado \"" + p.symRaw + "\". Usa btc, sol, oro, dow o nasdaq." };
  if (!p.sl) return { ok: false, txt: "Falta el **stop** (sl). Sin stop no hay 1R y no se puede medir. Ej.: `compra btc 83200 sl 82500 tp 84500`" };
  const live = livePrice(p.sym, now), entry = p.entry || live;
  if (!entry) return { ok: false, txt: "No tengo precio en vivo de " + NM(p.sym) + " ahora. Escribe el precio de entrada: `compra " + p.symRaw + " 83200 sl 82500`" };
  const buy = p.side === "buy";
  if (buy ? p.sl >= entry : p.sl <= entry) return { ok: false, txt: "El stop está del lado equivocado: en una " + (buy ? "compra va **debajo**" : "venta va **encima**") + " de la entrada (" + fmt(entry) + ")." };
  if (p.tp && (buy ? p.tp <= entry : p.tp >= entry)) return { ok: false, txt: "La meta está del lado equivocado: en una " + (buy ? "compra va **encima**" : "venta va **debajo**") + " de la entrada." };
  const d = st(), cfg = riskCfg();
  // Índices: base = futuro − tu precio, para seguir con el precio de tu bróker (vale si la anotas al entrar).
  const basis = IDXS.includes(p.sym) && live && p.entry && Math.abs(live - p.entry) / p.entry < 0.02 ? live - p.entry : IDXS.includes(p.sym) ? 0 : null;
  const tr = { id: ++d.n, t: now, sym: p.sym, side: p.side, entry, sl0: p.sl, sl: p.sl, tp: p.tp || null, risk: cfg.risk, basis, mfe: entry, mae: entry, ctx: ctxOf(p.sym, entry, now), plan: p.plan ?? null, nota: p.nota || null, dia: prParts(now).date, status: "abierta" };
  const hoy = [...d.open, ...d.closed].filter((x) => x.dia === tr.dia).length + 1;
  const aviso = hoy > MAXDIA ? "\n⚠️ **Operación #" + hoy + " de hoy.** Tu regla: " + MAXDIA + " por día. En tu diario GFF, los días de 7+ trades fueron los de −2,4 % y −3,8 %." : "";
  if (!p.exit && live != null) {
    const pa = live - (basis || 0);
    if (buy ? pa <= tr.sl : pa >= tr.sl) return { ok: false, txt: "El precio ya está más allá de tu stop (" + fmt(pa) + "). Si ya cerró, anótala con la salida: `" + (buy ? "compra" : "venta") + " " + p.symRaw + " " + fmt(entry) + " sl " + fmt(p.sl) + " salida <precio>`" };
  }
  if (p.exit) { closeT(d, tr, p.exit, "anotada", now); save(d); return { ok: true, txt: closedTxt(tr, d) + aviso }; }
  d.open.push(tr); save(d);
  const dist = Math.abs(entry - p.sl), k = tr.tp ? Math.abs(tr.tp - entry) / dist : null;
  return { ok: true, txt: "📝 **#" + tr.id + " · " + (buy ? "COMPRA" : "VENTA") + " " + NM(tr.sym) + "** en " + fmt(entry) + "\n🛑 Stop " + fmt(tr.sl) + " (1R = " + money(cfg.risk) + ")" + (tr.tp ? " · 🎯 Meta " + fmt(tr.tp) + " (" + k.toFixed(1) + "R)" : " · sin meta: la cierras tú con `cerrar " + tr.id + "`") +
    "\n-# Contexto: " + (tr.ctx.zona ? "dentro de zona " + tr.ctx.zona : "fuera de zona") + " · " + (tr.ctx.sesionNY ? "sesión NY" : "fuera de sesión NY") + (IDXS.includes(tr.sym) ? " · seguimiento con futuros ajustados a tu precio" : "") + ". Te aviso aquí cuando toque stop o meta." + (tr.plan == null ? " ¿Seguiste tu plan? `plan " + tr.id + " si` / `plan " + tr.id + " no`" : "") + aviso };
}

function closeT(d, tr, exit, how, now) {
  tr.exit = exit; tr.how = how; tr.t_end = now; tr.status = "cerrada";
  tr.r = rOf(tr, exit); tr.usd = tr.r * tr.risk;
  d.closed.unshift(tr);
}
function closedTxt(tr, d) {
  const how = { stop: "tocó el stop", meta: "llegó a la meta", manual: "cerrada por ti", anotada: "anotada ya cerrada" }[tr.how] || tr.how;
  const ico = tr.r > 0.05 ? "✅" : tr.r < -0.05 ? "❌" : "➖";
  return ico + " **#" + tr.id + " · " + NM(tr.sym) + " " + (tr.side === "buy" ? "compra" : "venta") + "** " + how + ": " + fmt(tr.entry) + " → " + fmt(tr.exit) + " · **" + rr(tr.r) + " (" + money(tr.usd) + ")**" +
    (tr.how !== "anotada" ? "\n-# Lo mejor que llegó a ir: " + rr(rOf(tr, tr.side === "buy" ? tr.mfe : tr.mae) + (IDXS.includes(tr.sym) ? 0 : (FEE_RT * tr.entry) / Math.abs(tr.entry - tr.sl0))) + " antes de cerrar." : "") +
    "\n📊 " + statLine(d.closed);
}

function findOpen(d, ref) {
  if (/^\d+$/.test(ref)) return d.open.find((x) => x.id === +ref);
  const s = dSym(ref), list = d.open.filter((x) => x.sym === s);
  return list.length === 1 ? list[0] : list.length > 1 ? "varias" : null;
}

export function closeTrade(ref, price, now = Date.now()) {
  const d = st(), tr = findOpen(d, ref);
  if (tr === "varias") return { ok: false, txt: "Tienes varias abiertas en ese mercado. Ciérrala por número: `cerrar 3 83900` (mira `abiertas`)." };
  if (!tr) return { ok: false, txt: "No encuentro esa operación abierta. Escribe `abiertas`." };
  const live = livePrice(tr.sym, now), exit = price || (live != null ? live - (tr.basis || 0) : null);
  if (!exit) return { ok: false, txt: "No tengo precio en vivo; escribe el precio de salida: `cerrar " + tr.id + " 83900`" };
  d.open = d.open.filter((x) => x !== tr); closeT(d, tr, exit, "manual", now); save(d);
  return { ok: true, txt: closedTxt(tr, d) };
}

export function moveSl(ref, price) {
  const d = st(), tr = findOpen(d, ref);
  if (!tr || tr === "varias") return { ok: false, txt: "Indica el número: `stop 3 83000` (mira `abiertas`)." };
  if (tr.side === "buy" ? price >= (livePrice(tr.sym) ?? Infinity) : price <= (livePrice(tr.sym) ?? -Infinity)) return { ok: false, txt: "Ese stop ya está pasado por el precio actual. Si quieres salir, usa `cerrar " + tr.id + "`." };
  tr.sl = price; save(d);
  return { ok: true, txt: "🛑 #" + tr.id + " · stop movido a " + fmt(price) + ". El resultado se sigue midiendo contra tu stop inicial (" + fmt(tr.sl0) + ")." };
}

export function setPlan(id, v) {
  const d = st(), tr = [...d.open, ...d.closed].find((x) => x.id === id);
  if (!tr) return false; tr.plan = v; save(d); return true;
}

export function delTrade(id) {
  const d = st(), a = d.open.length + d.closed.length;
  d.open = d.open.filter((x) => x.id !== id); d.closed = d.closed.filter((x) => x.id !== id);
  if (d.open.length + d.closed.length === a) return false;
  save(d); return true;
}

// Seguimiento automático: toca stop o meta → cierra al nivel y avisa en #diario-de-trades.
export function diarioTick(now = Date.now()) {
  const d = st(); if (!d.open.length) return;
  let changed = false;
  for (const tr of [...d.open]) {
    const raw = livePrice(tr.sym, now); if (raw == null) continue;
    const p = raw - (tr.basis || 0), buy = tr.side === "buy";
    if (buy ? p > tr.mfe : p < tr.mfe) { tr.mfe = p; changed = true; }
    if (buy ? p < tr.mae : p > tr.mae) { tr.mae = p; changed = true; }
    let how = null, lvl = null;
    if (buy ? p <= tr.sl : p >= tr.sl) { how = "stop"; lvl = tr.sl; }
    else if (tr.tp && (buy ? p >= tr.tp : p <= tr.tp)) { how = "meta"; lvl = tr.tp; }
    if (!how) continue;
    d.open = d.open.filter((x) => x !== tr); closeT(d, tr, lvl, how, now); changed = true;
    post(closedTxt(tr, d));
  }
  if (changed) save(d);
}

// ---------- Estadísticas ----------
export function statsOf(arr) {
  const n = arr.length, w = arr.filter((t) => t.r > 0).length, sum = arr.reduce((a, t) => a + t.r, 0);
  return { n, w, pct: n ? (w / n) * 100 : 0, avg: n ? sum / n : 0, sum, usd: arr.reduce((a, t) => a + (t.usd || 0), 0) };
}
function statLine(arr) {
  const s = statsOf(arr);
  const acc = riskCfg().account;
  return s.n ? s.n + " cerradas · " + Math.round(s.pct) + "% ganadoras · R promedio " + rr(s.avg) + " · total " + rr(s.sum) + " (" + money(s.usd) + (acc ? " · " + (s.usd / acc * 100).toFixed(2) + " % de la cuenta" : "") + ")" : "Sin operaciones cerradas todavía.";
}
export function diarioText(aiLine = "") {
  const d = st(), c = d.closed, s = statsOf(c), L = ["📒 **Diario de trades**", statLine(c)];
  if (s.n) {
    const falta = Math.max(0, 50 - s.n);
    L.push("Vara (R promedio > 0 con 50+): " + (falta ? "faltan **" + falta + "** operaciones para juzgar" : s.avg > 0 ? "✅ **la pasas**" : "❌ **no la pasas todavía**"));
    const part = (nm, f) => { const a = c.filter(f); if (!a.length) return null; const x = statsOf(a); return nm + ": " + x.n + " · " + Math.round(x.pct) + "% · " + rr(x.avg) + " prom."; };
    const zonaA = (t) => t.ctx && t.ctx.zona && t.ctx.zonaLado === t.side;
    const rows = [part("Plan seguido", (t) => t.plan === true), part("Plan NO seguido", (t) => t.plan === false), part("A favor de una zona", zonaA), part("Sin zona a favor", (t) => !zonaA(t)), part("En sesión NY", (t) => t.ctx && t.ctx.sesionNY), part("Fuera de sesión NY", (t) => !(t.ctx && t.ctx.sesionNY)),
      ...["BTC", "SOL", "XAU", "YM", "NQ"].map((k) => part(NM(k), (t) => t.sym === k))].filter(Boolean);
    if (rows.length) L.push("-# " + rows.join("\n-# "));
  }
  if (d.open.length) L.push("", "**Abiertas**", ...d.open.map(openRow));
  if (aiLine) L.push("", "🤖 Ai Crypto (automático, en pausa): " + aiLine);
  return L.join("\n");
}
function openRow(t) {
  const p = livePrice(t.sym), pa = p == null ? null : p - (t.basis || 0);
  return "#" + t.id + " · " + (t.side === "buy" ? "compra " : "venta ") + NM(t.sym) + " " + fmt(t.entry) + " · 🛑 " + fmt(t.sl) + (t.tp ? " · 🎯 " + fmt(t.tp) : "") + (pa != null ? " · ahora " + fmt(pa) + " (" + rr(rOf(t, pa)) + ")" : "") + " · " + shortPR(t.t);
}
export function openText() {
  const d = st();
  return d.open.length ? "**Abiertas**\n" + d.open.map(openRow).join("\n") : "No tienes operaciones abiertas en el diario.";
}
export const helpText = () => "📒 **Cómo anotar en el diario** (una línea, el servidor sigue el precio y cierra solo):\n" +
  "`compra btc 83200 sl 82500 tp 84500` · `venta oro 4170 sl 4185 tp 4140` · sin precio = precio actual\n" +
  "`compra dow 51600 sl 51500 salida 51750` → anota una ya cerrada\n" +
  "Opcional al final: `plan si` / `plan no` y `nota OB 1H, entrada IFVG 1min` · luego `plan 3 si`\n" +
  "`cerrar 3 83900` o `cerrar btc` · `stop 3 83000` (mover stop) · `abiertas` · `diario` · `borrar 3`\n" +
  "-# Cada operación se mide en R con tu riesgo de " + money(riskCfg().risk) + " y comisión 0,1 % (cripto y oro). Vara: R promedio > 0 con 50+ operaciones.";

// Mensaje en #diario-de-trades.
export async function onDiario(msg, admin, aiLine = "") {
  const p = parseLine(msg.content);
  if (!p) return post("No entendí. " + helpText());
  if (!admin) return post("Solo el dueño del servidor anota en el diario.");
  if (p.cmd === "help") return post(helpText());
  if (p.cmd === "stats") return post(diarioText(aiLine));
  if (p.cmd === "open") return post(openText());
  if (p.cmd === "plan") return post(setPlan(p.id, p.plan) ? "✍️ #" + p.id + ": plan " + (p.plan ? "seguido" : "NO seguido") + "." : "No existe la #" + p.id + ".");
  if (p.cmd === "del") return post(delTrade(p.id) ? "🗑️ #" + p.id + " borrada del diario." : "No existe la #" + p.id + ".");
  if (p.cmd === "sl") return post(p.price ? moveSl(p.ref, p.price).txt : "Falta el precio del stop.");
  if (p.cmd === "close") return post(closeTrade(p.ref, p.price).txt);
  if (p.cmd === "new") return post(openTrade(p).txt);
}

export function startDiario() {
  setInterval(() => { try { diarioTick(); } catch (e) { log("diarioTick", e.message); } }, 5000);
}
