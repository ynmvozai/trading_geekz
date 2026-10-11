// Configuración fija (portada del panel v2.4) y variables de entorno.
import path from "node:path";

export const VERSION = "v3.6-server · 10 oct 2026";

export const SYMS = {
  BTC: { stream: "btcusdt", label: "BTCUSDT", dec: 1, min: 3000000, max: 6000000, ch: "crypto" },
  SOL: { stream: "solusdt", label: "SOLUSDT", dec: 2, min: 1000000, max: 6000000, ch: "crypto" },
  XAU: { stream: "xauusdt", label: "XAUUSDT", dec: 2, min: 3000000, max: 6000000, ch: "oro" },
};
export const NAMES = { BTC: "Bitcoin", SOL: "Solana", XAU: "Oro" };
export const ORDER = ["BTC", "SOL", "XAU"];
export const BUCKETS = [250000, 500000, 1000000, 3000000, 6000000];
export const NEAR = { BTC: 1.5, SOL: 3, XAU: 1 };   // % radio "cerca de zona" para alertas de órdenes
export const WATCH = { BTC: 5, SOL: 8, XAU: 3 };    // % máximo para la vigilancia (proximidad 0-100%)
export const BURST_MS = 250;                         // una "orden" = fills del mismo lado dentro de 250 ms
export const STREAK_MIN = 15;                        // racha: minutos
export const FEED_MIN_USD = 250000;                  // se guardan órdenes de $250K o más (24 h)
export const TZ = "America/Puerto_Rico";
export const PUBLIC_URL = "https://ynmvozai.github.io/trading_geekz/";

const env = process.env;
export const ENV = {
  port: +env.PORT || 8080,
  dataDir: env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || path.resolve("data"),
  hooks: {
    crypto: env.WEBHOOK_CRYPTO || "",
    oro: env.WEBHOOK_ORO || "",
    agent: env.WEBHOOK_AGENT || "",
    aicrypto: env.WEBHOOK_AICRYPTO || "",
    resultados: env.WEBHOOK_RESULTADOS || "",
    indices: env.WEBHOOK_INDICES || "",
    sesion: env.WEBHOOK_SESION || "",
  },
  botToken: env.DISCORD_BOT_TOKEN || "",
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  indicesChannelId: env.INDICES_CHANNEL_ID || "1557713241722069072",
  sesionChannelId: env.SESION_CHANNEL_ID || "1558528510354788392",
  agentChannelId: env.AGENT_CHANNEL_ID || "1557585826810962102",
  guildId: env.GUILD_ID || "1557574932064509982",
  ownerIds: (env.OWNER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
  binanceWs: env.BINANCE_WS || "wss://fstream.binance.com/market/stream",
  binanceRest: env.BINANCE_REST || "https://fapi.binance.com",
  aiModel: env.AI_MODEL || "claude-sonnet-5-5",
  serverUrl: env.SERVER_URL || (env.RAILWAY_PUBLIC_DOMAIN ? "https://" + env.RAILWAY_PUBLIC_DOMAIN : ""),
};

// Para logs: nunca imprimir un secreto completo.
export function mask(s) {
  if (!s) return "(vacío)";
  return s.length <= 10 ? "***" : s.slice(0, 6) + "…" + s.slice(-3);
}
