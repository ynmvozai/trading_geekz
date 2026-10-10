// Comandos del canal #agent (control remoto desde el celular). Todo lo demás va a TITO.
import { ENV, ORDER, NAMES, VERSION, PUBLIC_URL } from "./config.js";
import { agent, isAdmin } from "./discord.js";
import { S, flow, feed, prices } from "./market.js";
import { Z, zonesText, sanitizeZones, parseZoneInput, setZones, applyAiZones, shareLink } from "./zones.js";
import { setPaused, watchText } from "./alerts.js";
import { aiAsk } from "./tito.js";
import { tokenCheck } from "./tokencheck.js";
import { resultsText } from "./results.js";
import { estadoText } from "./health.js";
import { DAILY_Q, ZONES_Q } from "./prompts.js";
import { kvGet, kvSet } from "./store.js";
import { usd, px, hhmmss, sideEs, prParts, log } from "./util.js";
import { sentimentText, refreshSentiment } from "./sentiment.js";

const pending = new Map(); // id de usuario -> {what, run, until}

export function symOf(w) {
  w = (w || "").toLowerCase();
  if (/btc|bitcoin/.test(w)) return "BTC";
  if (/\bsol/.test(w)) return "SOL";
  if (/oro|xau|gold/.test(w)) return "XAU";
  return "";
}

export function quickAnswer(text) {
  const t = (text || "").trim().toLowerCase().replace(/^[/!]/, ""), sy = symOf(t), now = Date.now(), L = [];
  if (/^zona/.test(t)) return zonesText(prices(), sy);
  if (/^precio/.test(t)) {
    ORDER.forEach((k) => { if (!sy || k === sy) L.push((NAMES[k] || k) + ": " + px(S[k].price, k)); });
    return "Precios ahora (Binance futuros)\n" + L.join("\n");
  }
  if (/^flujo/.test(t)) {
    ORDER.forEach((k) => { if (sy && k !== sy) return; const f = flow(k, 300000, now); L.push((NAMES[k] || k) + ": compras " + usd(f.buy) + " · ventas " + usd(f.sell) + " · neto " + usd(f.net)); });
    return "Flujo de los últimos 5 min\n" + L.join("\n");
  }
  if (/^[oó]rden/.test(t)) {
    let b = 0, s2 = 0;
    for (const o of feed) {
      if (now - o.t > 3600000) break;
      if ((sy && o.sym !== sy) || o.usd < 1000000) continue;
      if (o.side === "buy") b += o.usd; else s2 += o.usd;
      if (L.length < 12) L.push(hhmmss(o.t) + " · " + o.sym + " · " + sideEs(o.side) + " · " + usd(o.usd) + " · " + px(o.price, o.sym) + (o.zn ? " · en zona " + o.zn : ""));
    }
    return L.length ? "Órdenes de $1M o más, última hora" + (sy ? " · " + (NAMES[sy] || sy) : "") + "\nCompras " + usd(b) + " · Ventas " + usd(s2) + " · Neto " + usd(b - s2) + "\n\n" + L.join("\n")
      : "Ninguna orden de $1M o más en la última hora" + (sy ? " en " + (NAMES[sy] || sy) : "") + ".";
  }
  if (/^(link|enlace|url|panel|hot ?zone)/.test(t)) {
    return "Panel Hot Zone con las zonas actuales (para mirar desde cualquier equipo):\n<" + shareLink(PUBLIC_URL) + ">" +
      (ENV.serverUrl ? "\nPanel en vivo del servidor (solo lectura): <" + ENV.serverUrl + "/>" : "") + "\nLas alertas salen del servidor en la nube, 24/7.";
  }
  return ayuda();
}

function ayuda() {
  return "Hot Zone " + VERSION + " · Comandos:\n" +
    "**estado** · **zonas** · **precio** · **ordenes** · **flujo** · **link** · **vigilancia** · **resultados** · **sentimiento**\n" +
    "**pausar alertas** · **reanudar alertas** · **cargar zonas** [JSON o enlace del panel] · **borrar zona** [n] · **actualiza zonas** · **reiniciar**\n" +
    "**check** [dirección del token] · **mapa diario apagar/encender**\n" +
    "Mercados: btc, sol, oro. Cualquier otra pregunta la contesta TITO con Ai.";
}

const ADMIN_RE = /^(pausar|reanudar|cargar zonas|borrar zona|reiniciar|mapa diario)/;

export async function onAgentMessage(msg) {
  const q = (msg.content || "").trim();
  if (!q) return;
  const ql = q.toLowerCase().replace(/^[/!]/, "");
  const uid = msg.author && msg.author.id;

  // Confirmación con "sí"
  if (/^(s[ií]|confirmo|confirmar)\.?$/.test(ql) && pending.has(uid)) {
    const p = pending.get(uid); pending.delete(uid);
    if (Date.now() > p.until) return agent("Esa confirmación venció. Repite el comando.");
    return p.run();
  }
  if (/^(no|cancelar)\.?$/.test(ql) && pending.has(uid)) { pending.delete(uid); return agent("Cancelado."); }

  if (ADMIN_RE.test(ql) && !isAdmin(msg)) return agent("Ese comando solo lo puede usar el dueño del servidor.");

  if (/^webhook\b/.test(ql)) return agent("En el servidor los webhooks se guardan en Railway → tu servicio → **Variables** (WEBHOOK_CRYPTO, WEBHOOK_ORO, WEBHOOK_AGENT, WEBHOOK_AICRYPTO). Por seguridad, borra tu mensaje si tenía una URL.");
  if (/^(estado|status)$/.test(ql)) return agent(estadoText());
  if (/^pausar( alertas)?$/.test(ql)) { setPaused(true); return agent("⏸️ Alertas pausadas. No se envía nada a #cryptoman, #oro-índice ni #ai-crypto (el sistema sigue midiendo y guardando). Escribe **reanudar alertas** para volver."); }
  if (/^reanudar( alertas)?$/.test(ql)) { setPaused(false); return agent("▶️ Alertas activas otra vez."); }
  if (/^(sentimiento|miedo|codicia|fear|fear ?(&|and|y) ?greed|fng)\b/.test(ql)) { await refreshSentiment(); return agent(sentimentText()); }
  if (/^vigilancia$/.test(ql)) return agent(watchText(["BTC", "SOL"], "🎯 Zonas en vigilancia · Crypto") + "\n\n" + watchText(["XAU"], "🎯 Zonas en vigilancia · Oro"));
  if (/^resultados/.test(ql)) { const d = +(/(\d+)/.exec(ql) || [])[1] || 30; return agent(resultsText(Math.min(d, 365))); }
  if (/^reiniciar$/.test(ql)) {
    await agent("🔄 Reiniciando el servidor… Railway lo levanta solo en unos segundos. Escribe **estado** en 1 minuto.");
    log("Reinicio pedido desde Discord");
    setTimeout(() => process.exit(1), 1500);
    return;
  }
  if (/^mapa diario (apagar|apagado|off)$/.test(ql)) { kvSet("dailyOff", true); return agent("Mapa diario del servidor apagado."); }
  if (/^mapa diario (encender|prender|on)$/.test(ql)) { kvSet("dailyOff", false); return agent("Mapa diario del servidor encendido: 7:48 AM hora de Puerto Rico."); }

  const cz = /^cargar zonas\s*([\s\S]*)$/i.exec(q);
  if (cz) {
    if (!cz[1].trim()) return agent("Pega el JSON de las zonas después de **cargar zonas** (o un enlace del panel con #z=…). Formato: `[{\"sym\":\"BTC\",\"name\":\"Order block 1H\",\"grade\":\"A++\",\"side\":\"sell\",\"lo\":0,\"hi\":0,\"sl\":0,\"tp1\":0,\"tp2\":0,\"nota\":\"\"}]`");
    let arr;
    try { arr = parseZoneInput(cz[1]); } catch (e) { return agent("❌ No pude leer ese JSON: " + e.message + ". No cambié nada."); }
    const out = sanitizeZones(arr, prices(), 10, true);
    if (!out.length) return agent("❌ Ninguna zona válida (revisa sym BTC/SOL/XAU, lo, hi y que estén a menos de 30% del precio). No cambié nada.");
    setZones(out, "cargadas a mano");
    return agent("✅ " + out.length + " zonas cargadas y guardadas. Las alertas ya usan estas.\n\n" + zonesText(prices()));
  }

  const bz = /^borrar zona\s+(\d+)$/.exec(ql);
  if (bz) {
    const n = +bz[1], z = Z.list[n - 1];
    if (!z) return agent("No existe la zona " + n + ". Escribe **zonas** para ver la lista numerada.");
    pending.set(uid, {
      until: Date.now() + 120000,
      run: () => {
        const i = Z.list.indexOf(z);
        if (i < 0) return agent("Esa zona ya no está.");
        setZones(Z.list.filter((_, k) => k !== i), "zona borrada");
        return agent("🗑️ Zona borrada: " + z.sym + " · " + z.name + " " + px(z.lo, z.sym) + " – " + px(z.hi, z.sym) + ". Quedan " + Z.list.length + ".");
      },
    });
    return agent("¿Borro la zona " + n + ": **" + (NAMES[z.sym] || z.sym) + " · " + z.name + "** " + px(z.lo, z.sym) + " – " + px(z.hi, z.sym) + "? Responde **sí** para confirmar (2 minutos).");
  }

  const cm = /^(check|revisar|verificar|scam)\s+(?:token\s+)?([A-Za-z0-9]{30,64})$/i.exec(q);
  if (cm) {
    await agent("🔎 Revisando el token…");
    try { return agent(await tokenCheck(cm[2])); } catch (e) { return agent("No pude revisar el token: " + e.message); }
  }

  const quick = /^(zonas|precio|flujo|[oó]rdenes|ordenes|link|enlace|url|panel|ayuda|help|comandos)\b/.test(ql) && ql.split(/\s+/).length <= 2;
  if (quick || !ENV.anthropicKey) return agent(quickAnswer(q));

  const upd = /actualiz|zonas nuevas|nuevas zonas|mapa/i.test(q);
  try {
    let t = await aiAsk(upd ? q + "\n" + ZONES_Q : q);
    if (upd) { const r = applyAiZones(t, prices()); t = r.txt + (r.n ? "\n\n✅ Zonas actualizadas en el servidor (" + r.n + "): las alertas ya usan estas." : r.err ? "\n\n⚠️ No pude leer las zonas (" + r.err + ")." : ""); }
    return agent(t);
  } catch (e) {
    return agent("No pude analizar ahora: " + e.message);
  }
}

export async function runDaily() {
  const key = prParts().date;
  kvSet("lastDaily", key);
  if (!ENV.anthropicKey) return agent("⚠️ El mapa del día no salió: falta ANTHROPIC_API_KEY en Railway.");
  try {
    const t = await aiAsk(DAILY_Q);
    const r = applyAiZones(t, prices());
    await agent("🗺️ **Mapa del día**\n" + r.txt + "\n\n" + (r.n ? "✅ Servidor actualizado con " + r.n + " zonas nuevas: las alertas ya usan estas." : "⚠️ No pude actualizar las zonas" + (r.err ? " (" + r.err + ")" : "") + "."));
  } catch (e) {
    await agent("⚠️ El mapa del día falló: " + e.message);
  }
}

export function dailyTick() {
  const pp = prParts();
  if (kvGet("dailyOff", false)) return;
  if (pp.hour === 7 && pp.minute >= 48 && kvGet("lastDaily") !== pp.date) runDaily();
}
