// Discord: webhooks (cola por canal + respeto del límite 429) y bot por gateway (solo lectura de #agent).
import WebSocket from "ws";
import { ENV } from "./config.js";
import { log, sleep, splitLong } from "./util.js";

// ---------- Webhooks ----------
const queues = new Map(); // url -> {items:[], busy}
export const hookStats = { sent: 0, failed: 0, lastError: "", lastSent: 0 };

export function post(url, body) {
  if (!url) return Promise.reject(new Error("falta el webhook"));
  if (typeof body === "string") body = { content: body };
  if (body.content && body.content.length > 2000) body.content = body.content.slice(0, 1990) + "…";
  body.allowed_mentions = { parse: [] };
  return new Promise((resolve, reject) => {
    let q = queues.get(url);
    if (!q) queues.set(url, (q = { items: [], busy: false }));
    q.items.push({ body, resolve, reject });
    pump(url, q);
  });
}

async function pump(url, q) {
  if (q.busy) return;
  q.busy = true;
  while (q.items.length) {
    const it = q.items.shift();
    try {
      await send(url, it.body);
      hookStats.sent++; hookStats.lastSent = Date.now();
      it.resolve();
    } catch (e) {
      hookStats.failed++; hookStats.lastError = e.message;
      log("Discord webhook falló:", e.message);
      it.reject(e);
    }
    await sleep(350);
  }
  q.busy = false;
}

async function send(url, body, attempt = 1) {
  let r;
  try {
    r = await fetch(url + (url.includes("?") ? "&" : "?") + "wait=true", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if (attempt < 4) { await sleep(2000 * attempt); return send(url, body, attempt + 1); }
    throw new Error("red: " + e.message);
  }
  if (r.ok) return;
  if (r.status === 429 && attempt < 6) {
    const j = await r.json().catch(() => ({}));
    const wait = Math.ceil(((j.retry_after ?? +r.headers.get("retry-after")) || 2) * 1000) + 100;
    await sleep(wait);
    return send(url, body, attempt + 1);
  }
  if (r.status >= 500 && attempt < 4) { await sleep(2000 * attempt); return send(url, body, attempt + 1); }
  const t = await r.text().catch(() => "");
  throw new Error("HTTP " + r.status + (t ? " " + t.slice(0, 120) : ""));
}

export async function postLong(url, txt) {
  for (const part of splitLong(txt)) await post(url, { content: part });
}

export const agent = (txt) => (ENV.hooks.agent ? postLong(ENV.hooks.agent, txt).catch(() => {}) : Promise.resolve());

// ---------- Bot por gateway ----------
// Solo una conexión por proceso. Lee mensajes de #agent y llama onMessage(msg).
export const bot = { ws: null, connected: false, ready: false, seq: null, sessionId: null, resumeUrl: null, ownerId: null, lastError: "", stop: false };

export function botStart(onMessage) {
  if (!ENV.botToken) { bot.lastError = "falta DISCORD_BOT_TOKEN"; return; }
  connect(onMessage, false);
}

function connect(onMessage, resume) {
  const url = (resume && bot.resumeUrl ? bot.resumeUrl : "wss://gateway.discord.gg") + "/?v=10&encoding=json";
  const ws = new WebSocket(url);
  bot.ws = ws;
  let hb = null, acked = true;
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.s != null) bot.seq = m.s;
    if (m.op === 10) {
      const iv = m.d.heartbeat_interval;
      hb = setInterval(() => {
        if (!acked) { log("Gateway: sin respuesta al latido, reconectando"); ws.terminate(); return; }
        acked = false;
        try { ws.send(JSON.stringify({ op: 1, d: bot.seq })); } catch {}
      }, iv);
      if (resume && bot.sessionId) ws.send(JSON.stringify({ op: 6, d: { token: ENV.botToken, session_id: bot.sessionId, seq: bot.seq } }));
      else ws.send(JSON.stringify({ op: 2, d: { token: ENV.botToken, intents: 1 | 512 | 32768, properties: { os: "linux", browser: "hotzone-server", device: "hotzone-server" } } }));
    } else if (m.op === 11) acked = true;
    else if (m.op === 1) { try { ws.send(JSON.stringify({ op: 1, d: bot.seq })); } catch {} }
    else if (m.op === 7) ws.close(4000);
    else if (m.op === 9) { if (!m.d) { bot.sessionId = null; bot.seq = null; } ws.close(4000); }
    else if (m.op === 0) {
      if (m.t === "READY") { bot.sessionId = m.d.session_id; bot.resumeUrl = m.d.resume_gateway_url; bot.ready = true; bot.lastError = ""; log("Bot de Discord conectado como", m.d.user && m.d.user.username); }
      if (m.t === "RESUMED") { bot.ready = true; log("Bot de Discord: sesión reanudada"); }
      if (m.t === "GUILD_CREATE" && m.d && m.d.id === ENV.guildId) bot.ownerId = m.d.owner_id;
      if (m.t === "MESSAGE_CREATE" && m.d && m.d.channel_id === ENV.agentChannelId && !m.d.webhook_id && !(m.d.author && m.d.author.bot)) {
        Promise.resolve().then(() => onMessage(m.d)).catch((e) => log("Error en comando:", e.message));
      }
    }
  });
  ws.on("open", () => { bot.connected = true; });
  ws.on("error", (e) => { bot.lastError = e.message; });
  ws.on("close", (code) => {
    clearInterval(hb);
    bot.connected = false; bot.ready = false;
    if (bot.ws !== ws) return;
    bot.ws = null;
    if (code === 4004) { bot.lastError = "Discord rechazó el token del bot (4004)"; log(bot.lastError); agent("⚠️ " + bot.lastError + ". Revisa DISCORD_BOT_TOKEN en Railway."); return; }
    if (code === 4014) { bot.lastError = "Falta activar Message Content Intent en el bot (4014)"; log(bot.lastError); agent("⚠️ " + bot.lastError + "."); return; }
    if (bot.stop) return;
    const canResume = ![4007, 4009].includes(code) && bot.sessionId;
    if (!canResume) { bot.sessionId = null; bot.seq = null; }
    log("Gateway cerrado (" + code + "). Reintentando en 5 s");
    setTimeout(() => connect(onMessage, !!canResume), 5000);
  });
}

export function isAdmin(msg) {
  const id = msg.author && msg.author.id;
  if (ENV.ownerIds.length) return ENV.ownerIds.includes(id);
  return !!bot.ownerId && id === bot.ownerId;
}
