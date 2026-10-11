// v4.0 · #wallet-tracking: wallets "whale" de Solana. Data real vía Helius (webhook de transacciones SWAP).
// Regla de confluencia: cuando N wallets seguidas (por defecto 3) compran la MISMA moneda dentro de la ventana
// (por defecto 24 h), se avisa. Yasser solo pega HELIUS_API_KEY en Railway; el servidor crea su propio webhook.
import crypto from "node:crypto";
import { ENV } from "./config.js";
import { postLong, hookStats } from "./discord.js";
import { S } from "./market.js";
import { kvGet, kvSet } from "./store.js";
import { usd, splitLong, log } from "./util.js";

export const W = { recibidos: 0, compras: 0, ventas: 0, avisos: 0, lastErr: "", hookId: "", lastSync: 0, lastEvent: 0 };
const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLES = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]); // USDC, USDT
const BASE = new Set([SOL_MINT, ...STABLES]);

export const walletList = () => kvGet("wallets", []) || [];
export const walletRule = () => kvGet("walletRule", { min: 3, hours: 24, solos: false }) || { min: 3, hours: 24, solos: false };
export function walletSecret() { let s = kvGet("walletSecret", ""); if (!s) { s = crypto.randomBytes(18).toString("hex"); kvSet("walletSecret", s); } return s; }
const aliasOf = (a) => { const w = walletList().find((x) => x.addr === a); return w ? w.alias : a.slice(0, 4) + "…" + a.slice(-4); };
const isAddr = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export function addWallet(addr, alias) {
  if (!isAddr(addr)) return "Esa no parece una dirección de Solana.";
  const L = walletList();
  if (L.length >= 50) return "Máximo 50 wallets.";
  const al = (alias || "W" + (L.length + 1)).slice(0, 20), i = L.findIndex((x) => x.addr === addr);
  if (i >= 0) L[i].alias = al; else L.push({ addr, alias: al, t: Date.now() });
  kvSet("wallets", L); syncHook().catch(() => {});
  return (i >= 0 ? "✏️ Actualizada: " : "✅ Agregada: ") + al + " (" + addr.slice(0, 4) + "…" + addr.slice(-4) + ") · total " + L.length;
}
export function removeWallet(q) {
  const L = walletList(), i = L.findIndex((x) => x.addr === q || x.alias.toLowerCase() === String(q).toLowerCase());
  if (i < 0) return "No encontré esa wallet.";
  const [w] = L.splice(i, 1); kvSet("wallets", L); syncHook().catch(() => {});
  return "🗑️ Quitada: " + w.alias + " · quedan " + L.length;
}
export function walletsText() {
  const L = walletList(), r = walletRule();
  return ["👛 Wallets en seguimiento: " + L.length, ...L.map((w, i) => (i + 1) + ". " + w.alias + " · " + w.addr.slice(0, 4) + "…" + w.addr.slice(-4)),
    "Regla: avisar cuando " + r.min + "+ wallets compren la misma moneda en " + r.hours + " h" + (r.solos ? " · también cada compra suelta" : ""),
    ENV.heliusKey ? "Helius: " + (W.hookId ? "webhook activo ✅" : "conectando…" + (W.lastErr ? " (" + W.lastErr + ")" : "")) : "⚠️ Falta HELIUS_API_KEY en Railway",
    "-# Comandos: wallet agregar <dirección> <nombre> · wallet quitar <nombre> · wallet regla 3 24 · wallet solos on/off"].join("\n");
}

// ---------- Helius: crear o actualizar el webhook con las wallets actuales ----------
export async function syncHook() {
  if (!ENV.heliusKey) return;
  if (!ENV.serverUrl) { W.lastErr = "falta la URL pública del servidor"; return; }
  const url = ENV.serverUrl + "/helius/" + walletSecret(), addrs = walletList().map((w) => w.addr);
  const api = "https://api.helius.xyz/v0/webhooks", key = "?api-key=" + ENV.heliusKey;
  try {
    const r = await fetch(api + key, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("Helius HTTP " + r.status);
    const mine = (await r.json()).find((h) => String(h.webhookURL || "").startsWith(ENV.serverUrl + "/helius/"));
    if (!addrs.length) { W.hookId = mine ? mine.webhookID : ""; W.lastErr = ""; return; }
    const body = JSON.stringify({ webhookURL: url, transactionTypes: ["SWAP"], accountAddresses: addrs, webhookType: "enhanced" });
    const w = await fetch(mine ? api + "/" + mine.webhookID + key : api + key, { method: mine ? "PUT" : "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(15000) });
    if (!w.ok) throw new Error("Helius HTTP " + w.status + " al " + (mine ? "actualizar" : "crear") + " el webhook");
    const j = await w.json(); W.hookId = j.webhookID || (mine && mine.webhookID) || "ok"; W.lastErr = ""; W.lastSync = Date.now();
  } catch (e) { W.lastErr = e.message; log("Helius:", e.message); }
}

// Nombre corto de la moneda (DAS getAsset). Se guarda en caché.
const symCache = new Map();
async function tokenSym(mint) {
  if (symCache.has(mint)) return symCache.get(mint);
  let s = mint.slice(0, 4) + "…";
  if (ENV.heliusKey) {
    try {
      const r = await fetch("https://mainnet.helius-rpc.com/?api-key=" + ENV.heliusKey, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint } }), signal: AbortSignal.timeout(10000) });
      const j = await r.json(), m = j && j.result && j.result.content && j.result.content.metadata;
      if (m && (m.symbol || m.name)) s = String(m.symbol || m.name).slice(0, 16);
    } catch {}
  }
  symCache.set(mint, s);
  return s;
}

// De una transacción "enhanced" de Helius saca compras/ventas de las wallets seguidas.
// Compra = la wallet recibe una moneda que no es SOL/USDC/USDT. USD gastado = SOL que salió × precio real de SOL (Binance) o USDC/USDT.
export function parseSwaps(tx, tracked, solPrice) {
  const out = [], tt = tx.tokenTransfers || [], nt = tx.nativeTransfers || [];
  for (const w of tracked) {
    const got = tt.filter((x) => x.toUserAccount === w && !BASE.has(x.mint) && +x.tokenAmount > 0);
    const gave = tt.filter((x) => x.fromUserAccount === w && !BASE.has(x.mint) && +x.tokenAmount > 0);
    const solOut = nt.filter((x) => x.fromUserAccount === w).reduce((s, x) => s + (+x.amount || 0), 0) / 1e9
      + tt.filter((x) => x.fromUserAccount === w && x.mint === SOL_MINT).reduce((s, x) => s + (+x.tokenAmount || 0), 0);
    const solIn = nt.filter((x) => x.toUserAccount === w).reduce((s, x) => s + (+x.amount || 0), 0) / 1e9
      + tt.filter((x) => x.toUserAccount === w && x.mint === SOL_MINT).reduce((s, x) => s + (+x.tokenAmount || 0), 0);
    const stOut = tt.filter((x) => x.fromUserAccount === w && STABLES.has(x.mint)).reduce((s, x) => s + (+x.tokenAmount || 0), 0);
    const stIn = tt.filter((x) => x.toUserAccount === w && STABLES.has(x.mint)).reduce((s, x) => s + (+x.tokenAmount || 0), 0);
    for (const g of got) out.push({ wallet: w, side: "buy", mint: g.mint, qty: +g.tokenAmount, usd: Math.max(0, solOut - solIn) * (solPrice || 0) + Math.max(0, stOut - stIn), t: (tx.timestamp || 0) * 1000 || Date.now(), sig: tx.signature });
    for (const g of gave) out.push({ wallet: w, side: "sell", mint: g.mint, qty: +g.tokenAmount, usd: Math.max(0, solIn - solOut) * (solPrice || 0) + Math.max(0, stIn - stOut), t: (tx.timestamp || 0) * 1000 || Date.now(), sig: tx.signature });
  }
  return out;
}

async function send(txt) {
  try {
    if (ENV.hooks.wallets) await postLong(ENV.hooks.wallets, txt);
    else {
      if (!ENV.botToken) throw new Error("falta DISCORD_BOT_TOKEN");
      for (const part of splitLong(txt)) {
        const r = await fetch("https://discord.com/api/v10/channels/" + ENV.walletChannelId + "/messages", {
          method: "POST", headers: { "content-type": "application/json", authorization: "Bot " + ENV.botToken },
          body: JSON.stringify({ content: part, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 403 ? " (el bot no tiene permiso de escribir en #wallet-tracking)" : ""));
        hookStats.sent++;
      }
    }
    W.avisos++;
  } catch (e) { W.lastErr = e.message; log("#wallet-tracking falló:", e.message); }
}
export const walletSend = send;

// Memoria de compras por moneda: mint → [{wallet, usd, qty, t}]
export async function onHelius(body) {
  let arr; try { arr = typeof body === "string" ? JSON.parse(body) : body; } catch { return { ok: false, error: "JSON inválido" }; }
  if (!Array.isArray(arr)) arr = [arr];
  const tracked = walletList().map((w) => w.addr), solPrice = S.SOL && S.SOL.price, r = walletRule();
  const book = kvGet("walletBuys", {}) || {}, cut = Date.now() - r.hours * 3600000;
  let n = 0;
  for (const tx of arr) {
    W.recibidos++; W.lastEvent = Date.now();
    for (const s of parseSwaps(tx, tracked, solPrice)) {
      n++;
      if (s.side === "sell") { W.ventas++; continue; }
      W.compras++;
      const L = (book[s.mint] = (book[s.mint] || []).filter((x) => x.t >= cut));
      L.push({ wallet: s.wallet, usd: s.usd, qty: s.qty, t: s.t });
      const sym = await tokenSym(s.mint), px = s.qty > 0 && s.usd > 0 ? s.usd / s.qty : null;
      if (r.solos) send("👛 " + aliasOf(s.wallet) + " compró $" + sym + (s.usd ? " · " + usd(s.usd) : "") + (px ? " · precio " + fmtTiny(px) : "") + "\n-# <https://dexscreener.com/solana/" + s.mint + ">");
      const who = [...new Set(L.map((x) => x.wallet))], fired = kvGet("walletFired", {}) || {};
      if (who.length >= r.min && (fired[s.mint] || 0) < who.length) {
        fired[s.mint] = who.length; kvSet("walletFired", fired);
        const total = L.reduce((a, x) => a + (x.usd || 0), 0), mins = Math.max(1, Math.round((Math.max(...L.map((x) => x.t)) - Math.min(...L.map((x) => x.t))) / 60000));
        send(["👛 " + who.length + " wallets compraron la misma moneda · $" + sym,
          "Wallets: " + who.map(aliasOf).join(", "),
          (total ? "Total: " + usd(total) + " en " + (mins >= 120 ? Math.round(mins / 60) + " h" : mins + " min") : "En " + mins + " min") + (px ? " · precio " + fmtTiny(px) : ""),
          "-# Moneda nueva = riesgo alto. Revisa liquidez antes de entrar: <https://dexscreener.com/solana/" + s.mint + ">"].join("\n"));
      }
    }
  }
  // Limpia monedas viejas
  for (const m of Object.keys(book)) { book[m] = book[m].filter((x) => x.t >= cut); if (!book[m].length) delete book[m]; }
  kvSet("walletBuys", book);
  return { ok: true, swaps: n };
}
function fmtTiny(v) { return v >= 1 ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "$" + v.toPrecision(3); }

export function startWallets() { if (ENV.heliusKey) { syncHook(); setInterval(() => syncHook(), 6 * 3600000); } }
export function walletEstado() {
  const L = walletList().length;
  if (!ENV.heliusKey) return "❌ #wallet-tracking: falta HELIUS_API_KEY en Railway · wallets " + L;
  return (W.lastErr ? "❌" : "✅") + " #wallet-tracking: Helius " + (W.hookId ? "conectado" : "sin webhook") + " · wallets " + L + " · regla " + walletRule().min + " en " + walletRule().hours + " h · compras vistas " + W.compras + " · avisos " + W.avisos + (W.lastErr ? " · último error: " + W.lastErr : "");
}
export function setRule(min, hours, solos) {
  const r = walletRule();
  if (min) r.min = Math.max(2, Math.min(10, min));
  if (hours) r.hours = Math.max(1, Math.min(168, hours));
  if (solos != null) r.solos = solos;
  kvSet("walletRule", r);
  return "✅ Regla: " + r.min + "+ wallets en " + r.hours + " h" + (r.solos ? " · compras sueltas encendidas" : "");
}
