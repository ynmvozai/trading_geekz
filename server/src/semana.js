// v4.36 (Yasser, 25 oct 2026): "que active los screenshots de los trades de esta semana, los ganadores y los perdedores".
// Junta las operaciones cerradas de la semana (tu diario, las señales medidas del servidor, VG QUANT y Ai Crypto)
// y manda a #resultados un resumen + una gráfica por operación con la entrada, el stop, la meta y dónde salió.
import { kvGet, kvSet, alertsSince } from "./store.js";
import { renderChart } from "./chart.js";
import { zonesFor } from "./zonasgraf.js";
import { resPost, resFile } from "./discord.js";
import { sim } from "./alerts.js";
import { prParts, log, sleep } from "./util.js";

const NM = { BTC: "BTC", SOL: "SOL", XAU: "Oro", YM: "Dow", NQ: "Nasdaq", ETH: "ETH" };
const MKT = { YM: "US30", NQ: "NAS100", XAU: "ORO" };
const f = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2 }));
const cuando = (t) => new Date(t).toLocaleString("es-PR", { timeZone: "America/Puerto_Rico", weekday: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Lunes 00:00 hora PR de la semana de t (PR = UTC−4 fijo).
export function weekStart(t = Date.now()) {
  const pr = new Date(t - 4 * 3600000), dow = (pr.getUTCDay() + 6) % 7;
  return Date.UTC(pr.getUTCFullYear(), pr.getUTCMonth(), pr.getUTCDate() - dow) + 4 * 3600000;
}

export function collectWeek(since, now = Date.now()) {
  const out = [];
  // 1) Tu diario (#diario-de-trades)
  const d = kvGet("diario", null);
  for (const tr of (d && d.closed) || []) {
    if (!(tr.t_end >= since) || tr.r == null) continue;
    const b = tr.basis || 0;
    out.push({ fuente: "Tu diario #" + tr.id, sym: tr.sym, side: tr.side, entry: tr.entry + b, sl: tr.sl0 + b, tp: tr.tp != null ? tr.tp + b : null, exit: tr.exit + b, t: tr.t, t_end: tr.t_end, r: tr.r, nota: tr.nota || "", how: tr.how });
  }
  // 2) Señales medidas por el servidor (zonas + órdenes grandes)
  for (const a of alertsSince(since)) {
    if (a.r == null || !["TP1", "TP2", "SL"].includes(a.status)) continue;
    const tp = a.status === "TP2" ? a.tp2 : a.tp1;
    out.push({ fuente: "Señal del servidor (" + a.zone_name + " " + (a.grade || "") + ")", sym: a.sym, side: a.side, entry: a.entry, sl: a.sl, tp, exit: a.status === "SL" ? a.sl : tp, t: a.t, t_end: a.end_t || a.t, r: a.r, how: a.status });
  }
  // 3) VG QUANT (regla fija: 1 ancho de zona, 24 h). Se dibuja en precio del futuro (zona + base).
  for (const a of kvGet("vgq", []) || []) {
    if (!(a.t_end >= since) || !["acierta", "falla"].includes(a.status)) continue;
    const b = a.basis || 0, w = a.hi - a.lo, sell = a.dir === "baja", e = (a.price ?? (sell ? a.lo : a.hi)) + b;
    const sl = (sell ? a.hi : a.lo) + b, tp = (sell ? a.lo - w : a.hi + w) + b;
    out.push({ fuente: "VG QUANT " + (a.tf || ""), sym: a.sym, side: sell ? "sell" : "buy", entry: e, sl, tp, exit: (a.end_price ?? 0) + b, t: a.t, t_end: a.t_end, r: a.status === "acierta" ? Math.abs(tp - e) / Math.abs(e - sl || 1) : -1, zona: [a.lo + b, a.hi + b], how: a.status });
  }
  // 4) Ai Crypto (práctica)
  for (const t of sim.closed || []) {
    if (!(t.end >= since)) continue;
    out.push({ fuente: "Ai Crypto (" + t.zname + ")", sym: t.sym, side: t.side, entry: t.entry, sl: t.sl, tp: t.tp, exit: t.exit, t: t.t, t_end: t.end, r: t.r, how: t.out });
  }
  return out.filter((x) => x.t_end <= now).sort((a, b) => a.t - b.t);
}

function tfFor(x) { const d = x.t_end - x.t; return d < 8 * 3600000 ? "15m" : d < 3 * 86400000 ? "1h" : "4h"; }
const TFMS = { "15m": 900000, "1h": 3600000, "4h": 14400000 };

export async function sendWeek(opts = {}) {
  const now = Date.now(), since = opts.since || weekStart(now);
  const L = collectWeek(since, now);
  if (!L.length) { await resPost("📸 **Trades de la semana**\nNo hay operaciones cerradas desde el lunes."); return { n: 0 }; }
  const win = L.filter((x) => x.r > 0), loss = L.filter((x) => x.r <= 0), tot = L.reduce((a, x) => a + x.r, 0);
  const line = (x) => (x.r > 0 ? "✅ " : "❌ ") + NM[x.sym] + " " + (x.side === "buy" ? "compra" : "venta") + " · " + (x.r > 0 ? "+" : "") + x.r.toFixed(2) + "R · " + cuando(x.t) + " · " + x.fuente;
  await resPost("📸 **Trades de la semana** (desde el lunes " + prParts(since).date.slice(5) + ")\n" + win.length + " ganadoras · " + loss.length + " perdedoras · total " + (tot >= 0 ? "+" : "") + tot.toFixed(2) + "R · R promedio " + (tot / L.length >= 0 ? "+" : "") + (tot / L.length).toFixed(2) +
    "\n\n**Ganadoras**\n" + (win.map(line).join("\n") || "—") + "\n\n**Perdedoras**\n" + (loss.map(line).join("\n") || "—") + "\n-# Abajo, una gráfica por operación (ganadoras primero). R sin comisión salvo tu diario y Ai Crypto.");
  let sent = 0;
  for (const x of [...win, ...loss].slice(0, opts.max || 25)) {
    const tf = tfFor(x), ms = TFMS[tf];
    try {
      const g = await renderChart({ mercado: MKT[x.sym] || x.sym, tf, lado: x.side === "sell" ? "venta" : "compra", entrada: x.entry, stop: x.sl, meta: x.tp, zona: x.zona },
        { zonas: [], desde: x.t - 60 * ms, hasta: Math.min(now, x.t_end + 20 * ms), tEntrada: x.t, tSalida: x.t_end, gano: x.r > 0, salidaLabel: (x.r > 0 ? "GANO " : "PERDIO ") + (x.r > 0 ? "+" : "") + x.r.toFixed(2) + "R" });
      await resFile(g.png, "trade.png", (x.r > 0 ? "✅ **GANADORA** · " : "❌ **PERDEDORA** · ") + NM[x.sym] + " " + (x.side === "buy" ? "compra" : "venta") + " · " + (x.r > 0 ? "+" : "") + x.r.toFixed(2) + "R\n" +
        "Entrada " + f(x.entry) + " → salida " + f(x.exit) + " · stop " + f(x.sl) + (x.tp ? " · meta " + f(x.tp) : "") + "\n" + cuando(x.t) + " → " + cuando(x.t_end) + " · " + x.fuente + (x.nota ? " · " + x.nota : ""));
      sent++;
    } catch (e) { log("Semana: gráfica", x.sym, e.message); await resPost("⚠️ No pude dibujar " + NM[x.sym] + " " + cuando(x.t) + ": " + e.message).catch(() => {}); }
    await sleep(1200);
  }
  return { n: L.length, sent };
}

// Automático: viernes 5:15 PM hora PR, una vez por semana.
export function weekTick(t = Date.now()) {
  const p = prParts(t);
  if (p.weekday !== "Fri" || p.hour !== 17 || p.minute < 15 || p.minute >= 30 || kvGet("weekShots") === p.date || kvGet("weekShotsOff", false)) return false;
  kvSet("weekShots", p.date); sendWeek().catch((e) => log("Semana:", e.message)); return true;
}
