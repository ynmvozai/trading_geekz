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
const MK = { ETH: "ETH", ETHEREUM: "ETH", DXY: "DXY", DOLAR: "DXY", DOLLAR: "DXY", BTC: "BTC", BITCOIN: "BTC", SOL: "SOL", SOLANA: "SOL", ORO: "XAU", XAU: "XAU", GOLD: "XAU", US30: "YM", DOW: "YM", DJ30: "YM", YM: "YM", NAS100: "NQ", NASDAQ: "NQ", NQ: "NQ", USTEC: "NQ" };
export const mkOf = (s) => MK[norm(s).replace(/[^A-Z0-9]/g, "")] || null;
const NAME = { ETH: "ETHEREUM", DXY: "INDICE DEL DOLAR (DXY)", BTC: "BITCOIN", SOL: "SOLANA", XAU: "ORO", YM: "DOW (FUTUROS YM)", NQ: "NASDAQ (FUTUROS NQ)" };
const TFS = ["5m", "15m", "1h", "4h"];
const YH = { YM: "YM=F", NQ: "NQ=F", DXY: "DX-Y.NYB" }, YRANGE = { "5m": "2d", "15m": "5d", "1h": "1mo", "4h": "3mo" };
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
  if (mk === "DXY") { const b = await idxBars("DXY", tf); return { bars: b.slice(-n), fuente: "Yahoo DX-Y.NYB" }; }
  if (mk === "ETH") { const a = await klinesRaw("ETHUSDT", tf, n); return { bars: a.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4]]), fuente: "Binance futuros ETHUSDT" }; }
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
export async function renderChart(spec, opts = {}) {
  // v4.31: estilo TradingView (tema oscuro, eje de precio y de tiempo, marca de agua, herramienta de posición larga/corta).
  const mk = mkOf(spec.mercado); if (!mk) throw new Error("mercado no reconocido: " + spec.mercado);
  const tf = TFS.includes(String(spec.tf || "").toLowerCase()) ? String(spec.tf).toLowerCase() : "1h";
  const { bars, fuente } = await barsOf(mk, tf, 110);
  if (bars.length < 5) throw new Error("pocas velas para dibujar");
  const lv = { entrada: +spec.entrada || null, stop: +spec.stop || null, meta: +spec.meta || null };
  const zona = Array.isArray(spec.zona) && spec.zona.length === 2 && spec.zona.every((v) => +v > 0) ? [Math.min(+spec.zona[0], +spec.zona[1]), Math.max(+spec.zona[0], +spec.zona[1])] : null;
  const venta = String(spec.lado || "").toLowerCase().startsWith("v");
  let lo = Math.min(...bars.map((b) => b[3])), hi = Math.max(...bars.map((b) => b[2]));
  for (const v of [lv.entrada, lv.stop, lv.meta, ...(zona || [])]) if (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * 0.08 || hi * 0.002; lo -= pad; hi += pad;
  const W = 1200, H = 680, L = 10, AX = 110, T = 44, TB = 34, FT = 22;
  const R = W - AX, B = H - TB - FT;
  const bg = [19, 23, 34], grid = [32, 36, 48], axis = [42, 46, 57], txt = [178, 181, 190], white = [209, 212, 220];
  const up = [8, 153, 129], dn = [242, 54, 69], blue = [41, 98, 255], tgt = [8, 153, 129], stp = [242, 54, 69];
  const cv = canvas(W, H, bg);
  const y = (p) => T + (hi - p) / (hi - lo) * (B - T);
  const n = bars.length, extra = lv.entrada ? 34 : 6, step = (R - L) / (n + extra), bw = Math.max(3, Math.floor(step * 0.7));
  const X = (i) => L + step * i + step / 2;
  // cuadrícula
  const ticks = 8;
  for (let i = 0; i <= ticks; i++) { const yy = Math.round(T + (B - T) * i / ticks); cv.hline(L, R, yy, grid); }
  const every = Math.max(1, Math.round(n / 8));
  for (let i = 0; i < n; i += every) { const xx = Math.round(X(i)); for (let yy = T; yy <= B; yy++) cv.px(xx, yy, grid); }
  // marca de agua
  const wm = (mk === "YM" ? "US30" : mk === "NQ" ? "NAS100" : mk === "XAU" ? "XAUUSD" : mk === "DXY" ? "DXY" : mk + "USDT") + ", " + tf.toUpperCase();
  cv.text(Math.round((R - cv.textW(wm, 9)) / 2), Math.round((T + B) / 2 - 32), wm, [36, 41, 56], 9);
  // v4.32: zonas que el servidor vigila para ese mercado (Plan NY / mapa, y VG QUANT ajustada por la base del futuro)
  const zs = (opts.zonas || []).filter((z) => z.hi >= lo && z.lo <= hi).slice(0, 6);
  for (const z of zs) { const c = z.side === "sell" ? dn : up; cv.rect(L, y(Math.min(z.hi, hi)), R, y(Math.max(z.lo, lo)), c, 0.10); cv.hline(L, R, Math.round(y(z.hi)), c, 6, 0.6); cv.hline(L, R, Math.round(y(z.lo)), c, 6, 0.6); }
  // zona propuesta
  if (zona) { const zc = venta ? dn : up; cv.rect(L, y(zona[1]), R, y(zona[0]), zc, 0.12); }
  // velas
  bars.forEach((b, i) => {
    const cx = Math.round(X(i)), c = b[4] >= b[1] ? up : dn;
    cv.rect(cx, y(b[2]), cx, y(b[3]), c);
    const top = y(Math.max(b[1], b[4])), bot = y(Math.min(b[1], b[4]));
    cv.rect(cx - Math.floor(bw / 2), top, cx + Math.floor(bw / 2), Math.max(bot, top + 1), c);
  });
  for (const z of zs) { const c = z.side === "sell" ? dn : up, lbl = z.label, yy = Math.round(y(Math.min(z.hi, hi))) + 3; cv.rect(L + 4, yy, L + 14 + cv.textW(lbl, 2), yy + 18, bg, 0.85); cv.text(L + 9, yy + 3, lbl, c, 2); }
  // herramienta de posición (como la de TradingView)
  let k = null;
  if (lv.entrada && lv.stop) {
    const x0 = Math.round(X(n + 1)), x1 = R - 6, risk = Math.abs(lv.entrada - lv.stop);
    if (lv.meta) { cv.rect(x0, y(lv.entrada), x1, y(lv.meta), tgt, 0.22); k = Math.abs(lv.meta - lv.entrada) / risk; }
    cv.rect(x0, y(lv.entrada), x1, y(lv.stop), stp, 0.22);
    cv.hline(x0, x1, Math.round(y(lv.entrada)), [120, 123, 134], 0, 1, 2);
    const pc = (a) => (Math.abs(a - lv.entrada) / lv.entrada * 100).toFixed(2) + "%";
    const tag = (yy, label, c) => { const w = cv.textW(label, 2) + 16, xx = Math.max(x0 - 40, Math.min(Math.round((x0 + x1) / 2 - w / 2), x1 - w)); cv.rect(xx, yy - 11, xx + w, yy + 11, c, 1); cv.text(xx + 8, yy - 7, label, [255, 255, 255], 2); };
    if (lv.meta) tag(Math.round(y(lv.meta)) + (venta ? 14 : -14), "TARGET " + fmtP(lv.meta) + " (" + pc(lv.meta) + ")", tgt);
    tag(Math.round(y(lv.stop)) + (venta ? -14 : 14), "STOP " + fmtP(lv.stop) + " (" + pc(lv.stop) + ")", stp);
    tag(Math.round(y(lv.entrada)), (venta ? "VENTA " : "COMPRA ") + fmtP(lv.entrada) + (k ? " · R:R " + k.toFixed(2) : ""), [90, 94, 106]);
  }
  // eje de precio
  cv.rect(R, 0, W, H, bg); for (let yy = 0; yy < H; yy++) cv.px(R, yy, axis);
  const last = bars[n - 1][4], lc = last >= bars[n - 1][1] ? up : dn;
  const tagY = [last, lv.entrada, lv.stop, lv.meta].filter(Boolean).map((v) => y(v));
  for (let i = 0; i <= ticks; i++) { const yy = Math.round(T + (B - T) * i / ticks), p = hi - (hi - lo) * i / ticks; if (!tagY.some((v) => Math.abs(v - yy) < 24) && yy < B - 8) cv.text(R + 10, yy - 7, fmtP(p), txt, 2); }
  const ptag = (v, c) => { const yy = Math.round(y(v)); cv.rect(R + 1, yy - 11, W - 2, yy + 11, c, 1); cv.text(R + 8, yy - 7, fmtP(v), [255, 255, 255], 2); };
  cv.hline(L, R, Math.round(y(last)), lc, 4, 0.8);
  if (lv.meta) ptag(lv.meta, tgt); if (lv.stop) ptag(lv.stop, stp); if (lv.entrada) ptag(lv.entrada, blue);
  ptag(last, lc);
  // eje de tiempo (hora de Puerto Rico)
  cv.rect(0, B + 1, W, B + TB, bg); cv.hline(0, W, B, axis);
  const hm = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/Puerto_Rico", hour12: false, ...(tf === "4h" || tf === "1h" ? { day: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" }) }).replace(",", "");
  for (let i = Math.ceil(every / 2); i < n; i += every) { const s = hm(bars[i][0]); cv.text(Math.round(X(i) - cv.textW(s, 2) / 2), B + 10, s, txt, 2); }
  // encabezado OHLC
  const b = bars[n - 1], name = { ETH: "ETHEREUM / TETHERUS PERP", DXY: "INDICE DEL DOLAR (DXY)", BTC: "BITCOIN / TETHERUS PERP", SOL: "SOLANA / TETHERUS PERP", XAU: "GOLD / TETHERUS PERP", YM: "DOW JONES FUTUROS (YM)", NQ: "NASDAQ 100 FUTUROS (NQ)" }[mk];
  let hx = cv.text(L + 6, 12, name + " · " + tf.toUpperCase() + " ·  ", white, 2);
  for (const [l, v] of [["O", b[1]], ["H", b[2]], ["L", b[3]], ["C", b[4]]]) { hx = cv.text(hx, 12, l, txt, 2); hx = cv.text(hx + 4, 12, fmtP(v) + "  ", lc, 2); }
  cv.text(L + 6, H - FT + 4, "TITO · " + fuente + " · HORA PR · ESCENARIO, NO ASESORIA", [93, 96, 107], 2);
  return { png: encodePng(cv), caption: "📈 " + name.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) + " · " + tf + " · " + fuente + (k ? " · R:R " + k.toFixed(2) : "") };
}

// Saca los bloques [[GRAFICO]]{…}[[/GRAFICO]] del texto de TITO.
export function extractCharts(txt) {
  const specs = [];
  const clean = String(txt || "").replace(/\[\[GRAFICO\]\]([\s\S]*?)\[\[\/GRAFICO\]\]/g, (_, j) => { try { specs.push(JSON.parse(j.trim())); } catch {} return ""; }).trim();
  return { txt: clean, specs: specs.slice(0, 2) };
}
