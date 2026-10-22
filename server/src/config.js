// Configuración fija (portada del panel v2.4) y variables de entorno.
import path from "node:path";

export const VERSION = "v4.30-server · 22 oct 2026";

export const SYMS = {
  BTC: { stream: "btcusdt", label: "BTCUSDT", dec: 1, min: 3000000, max: 6000000, ch: "crypto" },
  SOL: { stream: "solusdt", label: "SOLUSDT", dec: 2, min: 1000000, max: 6000000, ch: "crypto" },
  XAU: { stream: "xauusdt", label: "XAUUSDT", dec: 2, min: 3000000, max: 6000000, ch: "oro" }, // v4.7: estudio Fase 1 (50 días, toda la semana): desde ~$3M el oro acertó 56 % a 1 h; debajo, ~51 %
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
    mega: env.WEBHOOK_MEGA || "",
    wallets: env.WEBHOOK_WALLETS || "",
    macro: env.WEBHOOK_MACRO || "",
  },
  botToken: env.DISCORD_BOT_TOKEN || "",
  botName: env.BOT_NAME || "TITO 👾🤖",
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  resultadosChannelId: env.RESULTADOS_CHANNEL_ID || "1558812052053688400",
  indicesChannelId: env.INDICES_CHANNEL_ID || "1557713241722069072",
  sesionChannelId: env.SESION_CHANNEL_ID || "1558528510354788392",
  sentimientoChannelId: env.SENTIMIENTO_CHANNEL_ID || "1559553092368998470", // v4.18: #sentimiento (lista por par, la publica el bot)
  megaChannelId: env.MEGA_CHANNEL_ID || "1558942738181787748",
  walletChannelId: env.WALLET_CHANNEL_ID || "1558158617411190865",
  macroChannelId: env.MACRO_CHANNEL_ID || "1559305676306518107",
  diarioChannelId: env.DIARIO_CHANNEL_ID || "1557713305542590565",   // v4.24: #diario-de-trades
  heliusKey: env.HELIUS_API_KEY || "",
  solanaRpc: env.SOLANA_RPC || "",
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

// v4.0: montos importantes por rangos (USD). Nivel 1 🐳 Mega ballena · 2 🐳🐳 Ballena gigante · 3 🚨 Orden histórica.
export const MEGA = { BTC: [15e6, 40e6, 100e6], SOL: [5e6, 15e6, 40e6], XAU: [5e6, 15e6, 40e6] };
export const MEGA_WIN_MS = 60000;            // suma de órdenes del mismo lado en 60 s
export const LIQ = { BTC: 5e6, SOL: 2e6, XAU: 2e6 }; // liquidaciones sumadas en 5 min
export const LIQ_WIN_MS = 300000;
