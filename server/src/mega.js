// v4.0 · #mega-ballenas: montos muy grandes por rangos y liquidaciones grandes. Data real de Binance futuros.
// Avisa SIEMPRE, esté o no el precio cerca de una zona. Menciona al dueño para que el celular suene.
import { ENV, NAMES, SYMS, MEGA, MEGA_WIN_MS, LIQ, LIQ_WIN_MS } from "./config.js";
import { postLong, bot, hookStats } from "./discord.js";
import { on, S } from "./market.js";
import { Z, zDist, isBroken } from "./zones.js";
import { usd, splitLong, log } from "./util.js";
import { pf, ladoMin, lado, empuje } from "./friendly.js";

export const MEGA_SYMS = ["BTC", "SOL"];
export const MG = { sent: 0, failed: 0, lastErr: "", last: null, liqSent: 0 };
const LEVELS = ["", "🐳 MEGA BALLENA", "🐳🐳 BALLENA GIGANTE", "🚨 ORDEN HISTÓRICA"];

// Nivel 0-3 según el rango del mercado.
export function megaLevel(sym, v) { const t = MEGA[sym] || []; let n = 0; t.forEach((x, i) => { if (v >= x) n = i + 1; }); return n; }
export function rangoTxt(sym, lvl) {
  const t = MEGA[sym]; if (!t || !lvl) return "";
  return "Rango: " + (t[lvl] ? usd(t[lvl - 1]) + "–" + usd(t[lvl]) : "más de " + usd(t[lvl - 1])) + " (nivel " + lvl + " de 3)";
}

// Dónde quedó el precio respecto a las zonas, en una línea.
function zonaTxt(sym, price, side) {
  let best = null;
  for (const z of Z.list) { if (z.sym !== sym || isBroken(z)) continue; const d = zDist(z, price); if (!best || d < best.d) best = { z, d }; }
  if (!best) return "Sin zonas cargadas para comparar";
  const z = best.z, f = (v) => pf(v, sym), rg = f(Math.min(z.lo, z.hi)) + "–" + f(Math.max(z.lo, z.hi));
  if (best.d === 0) return "Dentro de zona de " + lado(z.side) + " " + rg + " → " + (side === z.side ? empuje(side, z.side) : "⚠️ empuja en contra");
  return (best.d * 100 < 1 ? "Cerca de" : "Lejos de zonas · la más cercana:") + " " + ladoMin(z.side) + " " + rg + ", a " + (best.d * 100).toFixed(1) + "%";
}

async function send(txt, ping) {
  const owner = ping ? (ENV.ownerIds[0] || bot.ownerId) : null;
  const content = txt + (owner ? "\n<@" + owner + ">" : "");
  try {
    if (ENV.hooks.mega) await postLong(ENV.hooks.mega, content);
    else {
      if (!ENV.botToken) throw new Error("falta DISCORD_BOT_TOKEN");
      for (const part of splitLong(content)) {
        const r = await fetch("https://discord.com/api/v10/channels/" + ENV.megaChannelId + "/messages", {
          method: "POST", headers: { "content-type": "application/json", authorization: "Bot " + ENV.botToken },
          body: JSON.stringify({ content: part, allowed_mentions: owner ? { users: [owner] } : { parse: [] } }), signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 403 ? " (el bot no tiene permiso de escribir en #mega-ballenas)" : ""));
        hookStats.sent++;
      }
    }
    MG.sent++; MG.lastErr = ""; MG.last = { t: Date.now(), txt: txt.split("\n")[0] };
  } catch (e) { MG.failed++; MG.lastErr = e.message; log("#mega-ballenas falló:", e.message); }
}
export const megaSend = send;

// ---------- Órdenes: una sola orden grande o varias del mismo lado en 60 s ----------
const win = {};      // sym|side → [{t, usd, price}]
const fired = {};    // sym|side → { lvl, t } para no repetir el mismo nivel en 5 min
export function onBurst(b, price, now = Date.now()) {
  const sym = b.sym, k = sym + "|" + b.side, T = b.first;
  if (!MEGA_SYMS.includes(sym)) return null;   // v4.23: #mega-ballenas solo BTC y SOL
  // Solo cuentan órdenes de verdad grandes (≥ 1/3 del mínimo de alerta): el volumen normal no suma.
  if (!MEGA[sym] || b.usd < (SYMS[sym].min || 0) / 3) return null;
  const arr = (win[k] = (win[k] || []).filter((x) => T - x.t <= MEGA_WIN_MS));
  arr.push({ t: T, usd: b.usd, price });
  const single = megaLevel(sym, b.usd), sum = arr.reduce((s, x) => s + x.usd, 0), acc = megaLevel(sym, sum);
  const lvl = Math.max(single, acc); if (!lvl) return null;
  const f = fired[k];
  if (f && now - f.t < 300000 && f.lvl >= lvl) return null;
  fired[k] = { lvl, t: now };
  const name = NAMES[sym] || sym, verbo = b.side === "buy" ? "🟢 Compraron " : "🔴 Vendieron ";
  const amount = single >= acc ? b.usd : sum;
  const how = single >= acc ? "en una sola orden" : "en " + arr.length + " órdenes en " + Math.max(1, Math.round((T - arr[0].t) / 1000)) + " segundos";
  const txt = [LEVELS[lvl] + " · " + name, verbo + usd(amount) + " " + how + " · " + pf(price, sym), rangoTxt(sym, lvl), zonaTxt(sym, price, b.side), "-# Tamaño, no dirección: en el estudio de 12 meses las órdenes gigantes acertaron la dirección ~50 %. Úsala para saber dónde hay dinero grande."].join("\n");
  send(txt, true);
  return txt;
}

// ---------- Liquidaciones: suma en 5 min por lado ----------
const liqWin = {}, liqFired = {};
export function onLiq(sym, kind, amount, price, T = Date.now(), now = Date.now()) {
  if (!MEGA_SYMS.includes(sym)) return null;   // v4.23: solo BTC y SOL
  const k = sym + "|" + kind;
  const arr = (liqWin[k] = (liqWin[k] || []).filter((x) => T - x.t <= LIQ_WIN_MS));
  arr.push({ t: T, usd: amount });
  const sum = arr.reduce((s, x) => s + x.usd, 0), min = LIQ[sym] || Infinity;
  if (sum < min) return null;
  const mult = Math.floor(sum / min), f = liqFired[k];
  if (f && now - f.t < 600000 && f.mult >= mult) return null;   // repite solo si crece (x2, x3…) o pasan 10 min
  liqFired[k] = { mult, t: now };
  const name = NAMES[sym] || sym, big = sum >= min * 4;
  const txt = [(big ? "🚨 LIQUIDACIONES MASIVAS · " : "💥 LIQUIDACIONES GRANDES · ") + name,
    (kind === "long" ? "Cerraron a la fuerza " + usd(sum) + " en compras (largos)" : "Cerraron a la fuerza " + usd(sum) + " en ventas (cortos)") + " en " + Math.max(1, Math.round((T - arr[0].t) / 60000)) + " min · " + pf(price, sym),
    kind === "long" ? "El precio cayó y sacó a los que compraban. Puede seguir bajando o rebotar fuerte." : "El precio subió y sacó a los que vendían. Puede seguir subiendo o girar fuerte.",
    zonaTxt(sym, price, kind === "long" ? "sell" : "buy")].join("\n");
  MG.liqSent++;
  send(txt, big);
  return txt;
}

export function startMega() { on("burst", (b, price) => onBurst(b, price)); }
export function megaEstado() {
  const dest = ENV.hooks.mega ? "webhook" : ENV.botToken ? "bot" : "sin destino";
  return (MG.lastErr ? "❌" : "✅") + " #mega-ballenas: " + dest + " · rangos BTC " + MEGA.BTC.map((v) => usd(v)).join("/") + " · SOL " + MEGA.SOL.map((v) => usd(v)).join("/") + " · Oro " + MEGA.XAU.map((v) => usd(v)).join("/") +
    " · enviados " + MG.sent + " (liquidaciones " + MG.liqSent + ")" + (MG.lastErr ? " · último error: " + MG.lastErr : "");
}
