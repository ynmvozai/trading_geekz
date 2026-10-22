// v4.30 · Gráfica de velas en PNG (sin dependencias) para que TITO muestre lo que está viendo, con la entrada que propone.
// Pedido de Yasser (22 oct 2026): "que me envíe un screenshot de la gráfica que está viendo con la entrada que propone".
// Se dibuja con las MISMAS velas que recibe TITO: Binance (BTC, SOL, oro) y futuros YM/NQ (Yahoo; si falla, CNBC del servidor).
import zlib from "node:zlib";
import { SYMS } from "./config.js";
import { klinesRaw } from "./binance.js";
import { IDX } from "./macro.js";
import { log } from "./util.js";

// ---------- Letra de 5x7 ----------
const G = {
  A: "01110,10001,10001,11111,10001,10001,10001", B: "11110,10001,10001,11110,10001,10001,11110", C: "01110,10001,10000,10000,10000,10001,01110",
  D: "11110,10001,10001,10001,10001,10001,11110", E: "11111,10000,10000,11110,10000,10000,11111", F: "11111,10000,10000,11110,10000,10000,10000",
  G: "01110,10001,10000,10111,10001,10001,01111", H: "10001,10001,10001,11111,10001,10001,10001", I: "01110,00100,00100,00100,00100,00100,01110",
  J: "00111,00010,00010,00010,00010,10010,01100", K: "10001,10010,10100,11000,10100,10010,10001", L: "10000,10000,10000,10000,10000,10000,11111",
  M: "10001,11011,10101,10101,10001,10001,10001", N: "10001,10001,11001,10101,10011,10001,10001", O: "01110,10001,10001,10001,10001,10001,01110",
  P: "11110,10001,10001,11110,10000,10000,10000", Q: "01110,10001,10001,10001,10101,10010,01101", R: "11110,10001,10001,11110,10100,10010,10001",
  S: "01111,10000,10000,01110,00001,00001,11110", T: "11111,00100,00100,00100,00100,00100,00100", U: "10001,10001,10001,10001,10001,10001,01110",
  V: "10001,10001,10001,10001,10001,01010,00100", W: "10001,10001,10001,10101,10101,10101,01010", X: "10001,10001,01010,00100,01010,10001,10001",
  Y: "10001,10001,01010,00100,00100,00100,00100", Z: "11111,00001,00010,00100,01000,10000,11111",
  0: "01110,10001,10011,10101,11001,10001,01110", 1: "00100,01100,00100,00100,00100,00100,01110", 2: "01110,10001,00001,00010,00100,01000,11111",
  3: "11111,00010,00100,00010,00001,10001,01110", 4: "00010,00110,01010,10010,11111,00010,00010", 5: "11111,10000,11110,00001,00001,10001,01110",
  6: "00110,01000,10000,11110,10001,10001,01110", 7: "11111,00001,00010,00100,01000,01000,01000", 8: "01110,10001,10001,01110,10001,10001,01110",
  9: "01110,10001,10001,01111,00001,00010,01100",
  ".": "00000,00000,00000,00000,00000,01100,01100", ",": "00000,00000,00000,00000,01100,00100,01000", ":": "00000,01100,01100,00000,01100,01100,00000",
  "-": "00000,00000,00000,11111,00000,00000,00000", "+": "00000,00100,00100,11111,00100,00100,00000", "/": "00001,00010,00010,00100,01000,01000,10000",
  "%": "11001,11010,00010,00100,01000,01011,10011", "(": "00010,00100,01000,01000,01000,00100,00010", ")": "01000,00100,00010,00010,00010,00100,01000",
  "·": "00000,00000,00000,01100,01100,00000,00000", "=": "00000,00000,11111,00000,11111,00000,00000", " ": "00000,00000,00000,00000,00000,00000,00000",
};
const norm = (s) => String(s).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------- Lienzo RGBA ----------
function canvas(w, h, bg) {
  const d = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = bg[0]; d[i * 4 + 1] = bg[1]; d[i * 4 + 2] = bg[2]; d[i * 4 + 3] = 255; }
  const px = (x, y, c, a = 1) => {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    d[i] = d[i] * (1 - a) + c[0] * a; d[i + 1] = d[i + 1] * (1 - a) + c[1] * a; d[i + 2] = d[i + 2] * (1 - a) + c[2] * a;
  };
  const rect = (x0, y0, x1, y1, c, a = 1) => { const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1); for (let y = Math.round(ay); y <= Math.round(by); y++) for (let x = Math.round(ax); x <= Math.round(bx); x++) px(x, y, c, a); };
  const hline = (x0, x1, y, c, dash = 0, a = 1, th = 1) => { for (let x = x0; x <= x1; x++) if (!dash || Math.floor((x - x0) / dash) % 2 === 0) for (let t = 0; t < th; t++) px(x, y + t, c, a); };
  const text = (x, y, s, c, sc = 2) => { let cx = x; for (const ch of norm(s)) { const g = G[ch] || G[" "]; g.split(",").forEach((row, ry) => { for (let rx = 0; rx < 5; rx++) if (row[rx] === "1") rect(cx + rx * sc, y + ry * sc, cx + rx * sc + sc - 1, y + ry * sc + sc - 1, c); }); cx += 6 * sc; } return cx; };
  const textW = (s, sc = 2) => norm(s).length * 6 * sc;
  return { w, h, d, px, rect, hline, text, textW };
}

// ---------- PNG ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(cv) {
  const { w, h, d } = cv, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = d[i]; raw[o + 1] = d[i + 1]; raw[o + 2] = d[i + 2]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- Velas ----------
const MK = { BTC: "BTC", BITCOIN: "BTC", SOL: "SOL", SOLANA: "SOL", ORO: "XAU", XAU: "XAU", GOLD: "XAU", US30: "YM", DOW: "YM", DJ30: "YM", YM: "YM", NAS100: "NQ", NASDAQ: "NQ", NQ: "NQ", USTEC: "NQ" };
export const mkOf = (s) => MK[norm(s).replace(/[^A-Z0-9]/g, "")] || null;
const NAME = { BTC: "BITCOIN", SOL: "SOLANA", XAU: "ORO", YM: "DOW (FUTUROS YM)", NQ: "NASDAQ (FUTUROS NQ)" };
const TFS = ["5m", "15m", "1h", "4h"];
const YH = { YM: "YM=F", NQ: "NQ=F" }, YRANGE = { "5m": "2d", "15m": "5d", "1h": "1mo", "4h": "3mo" };
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", accept: "application/json" };

// Velas reales de Yahoo para los futuros (para 4h se agrupan las de 1h). Devuelve [[t(ms), o, h, l, c], …].
export async function idxBars(k, tf) {
  const iv = tf === "4h" ? "1h" : tf;
  const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(YH[k]) + "?interval=" + iv + "&range=" + YRANGE[tf], { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Yahoo HTTP " + r.status);
  const j = await r.json(), x = j && j.chart && j.chart.result && j.chart.result[0];
  if (!x || !Array.isArray(x.timestamp)) throw new Error("Yahoo sin velas");
  const q = x.indicators.quote[0];
  let out = x.timestamp.map((t, i) => [t * 1000, q.open[i], q.high[i], q.low[i], q.close[i]]).filter((b) => b.slice(1).every((v) => v != null && isFinite(v)));
  if (tf === "4h") { const m = new Map(); for (const b of out) { const key = Math.floor(b[0] / 14400000); const a = m.get(key); if (!a) m.set(key, [...b]); else { a[2] = Math.max(a[2], b[2]); a[3] = Math.min(a[3], b[3]); a[4] = b[4]; } } out = [...m.values()]; }
  return out;
}
export async function barsOf(mk, tf, n = 90) {
  if (mk === "YM" || mk === "NQ") {
    try { const b = await idxBars(mk, tf); if (b.length >= 10) return { bars: b.slice(-n), fuente: "Yahoo " + YH[mk] }; } catch (e) { log("Velas", mk, tf, "Yahoo:", e.message); }
    const h1 = (IDX[mk] && IDX[mk].h1) || [];
    if (h1.length >= 5) return { bars: h1.slice(-n).map((b) => [Date.parse(b[0].replace(" ", "T") + "Z") || 0, b[1], b[2], b[3], b[4]]), fuente: (IDX[mk].fuente || "CNBC") + " (1h aproximada)" };
    throw new Error("sin velas del " + (mk === "YM" ? "Dow" : "Nasdaq") + " ahora");
  }
  const a = await klinesRaw(SYMS[mk].label, tf, n);
  return { bars: a.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4]]), fuente: "Binance futuros " + SYMS[mk].label };
}

const fmtP = (v) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v >= 10 ? v.toFixed(2) : v.toFixed(4));

// spec: { mercado, tf, lado, entrada, stop, meta, zona:[lo,hi] } → { png, caption }
export async function renderChart(spec) {
  const mk = mkOf(spec.mercado); if (!mk) throw new Error("mercado no reconocido: " + spec.mercado);
  const tf = TFS.includes(String(spec.tf || "").toLowerCase()) ? String(spec.tf).toLowerCase() : "1h";
  const { bars, fuente } = await barsOf(mk, tf, 90);
  if (bars.length < 5) throw new Error("pocas velas para dibujar");
  const lv = { entrada: +spec.entrada || null, stop: +spec.stop || null, meta: +spec.meta || null };
  const zona = Array.isArray(spec.zona) && spec.zona.length === 2 && spec.zona.every((v) => +v > 0) ? [Math.min(+spec.zona[0], +spec.zona[1]), Math.max(+spec.zona[0], +spec.zona[1])] : null;
  let lo = Math.min(...bars.map((b) => b[3])), hi = Math.max(...bars.map((b) => b[2]));
  for (const v of [lv.entrada, lv.stop, lv.meta, ...(zona || [])]) if (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * 0.06 || hi * 0.002; lo -= pad; hi += pad;
  const W = 1100, H = 620, L = 20, R = 150, T = 60, Bm = 50;
  const cv = canvas(W, H, [19, 23, 34]);
  const y = (p) => T + (hi - p) / (hi - lo) * (H - T - Bm);
  const grid = [42, 46, 58], muted = [120, 128, 150], white = [220, 224, 235], green = [38, 166, 154], red = [239, 83, 80], blue = [66, 135, 245], gold = [240, 185, 11];
  const lvY = [lv.entrada, lv.stop, lv.meta].filter(Boolean).map((v) => y(v));
  for (let i = 0; i <= 6; i++) { const p = lo + (hi - lo) * i / 6, yy = Math.round(y(p)); cv.hline(L, W - R, yy, grid); if (!lvY.some((v) => Math.abs(v - yy) < 22)) cv.text(W - R + 10, yy - 7, fmtP(p), muted, 2); }
  const zc = (spec.lado || "").toLowerCase().startsWith("v") ? red : green;
  if (zona) cv.rect(L, y(zona[1]), W - R, y(zona[0]), zc, 0.16);
  const n = bars.length, step = (W - R - L) / n, bw = Math.max(2, Math.floor(step * 0.65));
  bars.forEach((b, i) => {
    const cx = L + step * i + step / 2, up = b[4] >= b[1], c = up ? green : red;
    cv.rect(cx, y(b[2]), cx, y(b[3]), c);
    const top = y(Math.max(b[1], b[4])), bot = y(Math.min(b[1], b[4]));
    cv.rect(cx - bw / 2, top, cx + bw / 2, Math.max(bot, top + 1), c);
  });
  if (zona) { const lbl = "ZONA " + fmtP(zona[0]) + " - " + fmtP(zona[1]); cv.rect(L + 4, y(zona[1]) + 3, L + 14 + cv.textW(lbl, 2), y(zona[1]) + 21, [19, 23, 34], 0.85); cv.text(L + 9, y(zona[1]) + 6, lbl, zc, 2); }
  const lines = [["ENTRADA", lv.entrada, blue], ["STOP", lv.stop, red], ["META", lv.meta, green]];
  for (const [nm, v, c] of lines) if (v) { const yy = Math.round(y(v)); cv.hline(L, W - R, yy, c, 10, 1, 2); cv.rect(W - R + 4, yy - 10, W - 4, yy + 10, c, 0.9); cv.text(W - R + 8, yy - 7, fmtP(v), [255, 255, 255], 2); cv.text(W - R - cv.textW(nm, 2) - 8, yy - 20, nm, c, 2); }
  const last = bars[n - 1][4];
  cv.text(L, 16, NAME[mk] + " · " + tf + (spec.lado ? " · " + (String(spec.lado).toLowerCase().startsWith("v") ? "VENTA" : "COMPRA") + " PROPUESTA" : ""), white, 3);
  const r = lv.entrada && lv.stop ? Math.abs(lv.entrada - lv.stop) : null, k = r && lv.meta ? Math.abs(lv.meta - lv.entrada) / r : null;
  cv.text(L, H - 34, "TITO · " + fuente + " · ULTIMO " + fmtP(last) + (k ? " · META = " + k.toFixed(1) + "R" : ""), muted, 2);
  cv.text(L, H - 16, "ESCENARIO, NO ASESORIA. LA DECISION FINAL ES TUYA.", gold, 2);
  return { png: encodePng(cv), caption: "📈 " + NAME[mk].toLowerCase().replace(/^./, (c) => c.toUpperCase()) + " · " + tf + " · " + fuente + (k ? " · meta " + k.toFixed(1) + "R" : "") };
}

// Saca los bloques [[GRAFICO]]{…}[[/GRAFICO]] del texto de TITO.
export function extractCharts(txt) {
  const specs = [];
  const clean = String(txt || "").replace(/\[\[GRAFICO\]\]([\s\S]*?)\[\[\/GRAFICO\]\]/g, (_, j) => { try { specs.push(JSON.parse(j.trim())); } catch {} return ""; }).trim();
  return { txt: clean, specs: specs.slice(0, 2) };
}
