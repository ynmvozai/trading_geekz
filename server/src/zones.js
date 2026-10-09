// Zonas: guardadas en la base de datos, proximidad, cerca/en zona, aplicar zonas de TITO.
import { SYMS, NEAR, WATCH, NAMES, ORDER } from "./config.js";
import { kvGet, kvSet } from "./store.js";
import { px, usd, shortPR } from "./util.js";

export const Z = { list: [], date: null, state: [] }; // state[i] = {inside, buy, sell, since}

export function loadZones() {
  Z.list = kvGet("zones", []) || [];
  Z.date = kvGet("zdate", null);
  Z.state = [];
}

export function setZones(list, source) {
  Z.list = list;
  Z.state = [];
  Z.date = shortPR(Date.now()) + (source ? " · " + source : "");
  kvSet("zones", Z.list);
  kvSet("zdate", Z.date);
}

export const zkey = (z) => z.sym + "|" + z.lo + "|" + z.hi;
export const nearR = (sym) => NEAR[sym] || 1;
export function zDist(z, p) {
  const lo = Math.min(z.lo, z.hi), hi = Math.max(z.lo, z.hi);
  return p < lo ? (lo - p) / p : p > hi ? (p - hi) / p : 0;
}
// Proximidad para alertas de órdenes (radio NEAR): 0 = lejos, 100 = dentro.
export const proxNear = (sym, d) => Math.max(0, (1 - d / (nearR(sym) / 100)) * 100);
// Proximidad para vigilancia (radio WATCH).
export const prox = (z, p) => Math.max(0, Math.min(100, (1 - zDist(z, p) / (WATCH[z.sym] / 100)) * 100));

export function zoneAt(sym, p) {
  for (let i = 0; i < Z.list.length; i++) {
    const z = Z.list[i];
    if (z.sym === sym && z.hi > 0 && p >= Math.min(z.lo, z.hi) && p <= Math.max(z.lo, z.hi)) return i;
  }
  return -1;
}
export function nearZone(sym, p) {
  let best = null;
  for (let i = 0; i < Z.list.length; i++) {
    const z = Z.list[i];
    if (z.sym !== sym || !(z.hi > 0)) continue;
    const d = zDist(z, p);
    if (!best || d < best.d) best = { i, d };
  }
  return best;
}

export function zoneStatus(z, i, price) {
  const p = price, st = Z.state[i];
  if (p == null) return ["Esperando precio…", false];
  const lo = Math.min(z.lo, z.hi), hi = Math.max(z.lo, z.hi);
  if (p >= lo && p <= hi) return ["PRECIO DENTRO · " + px(p, z.sym) + " · compras " + usd(st ? st.buy : 0) + " · ventas " + usd(st ? st.sell : 0), true];
  const edge = p < lo ? lo : hi, d = Math.abs(edge - p) / p * 100;
  return ["Precio " + px(p, z.sym) + " · a " + d.toFixed(d < 1 ? 2 : 1) + "% de la zona (" + (p < lo ? "tiene que subir" : "tiene que bajar") + ")", false];
}

// Limpia una lista de zonas (de TITO, de un JSON pegado o de un enlace del panel).
// prices: {BTC: precio...}; descarta zonas a más de 30% del precio. maxPer: máximo por mercado.
export function sanitizeZones(arr, prices, maxPer = 3, keepEstado = false) {
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach((z) => {
    if (!z || typeof z !== "object") return;
    const sym = String(z.sym || "").toUpperCase();
    if (!SYMS[sym]) return;
    let lo = +z.lo, hi = +z.hi;
    if (!(lo > 0 && hi > 0)) return;
    if (lo > hi) [lo, hi] = [hi, lo];
    const p = prices && prices[sym];
    if (p && (hi < p * 0.7 || lo > p * 1.3)) return;
    if (out.filter((x) => x.sym === sym).length >= maxPer) return;
    out.push({
      sym, name: String(z.name || "Zona").slice(0, 40), grade: String(z.grade || "").slice(0, 4),
      estado: keepEstado ? String(z.estado || "").slice(0, 12) : "NUEVA",
      side: z.side === "buy" ? "buy" : "sell", lo, hi, sl: +z.sl || 0, tp1: +z.tp1 || 0, tp2: +z.tp2 || 0,
      nota: String(z.nota || "").slice(0, 200),
    });
  });
  return out;
}

// Igual que applyAiZones del panel: busca el bloque ```json``` y repara JSON truncado.
export function parseAiZones(txt) {
  const m = /```json\s*([\s\S]*?)(```|$)/i.exec(txt || "");
  if (!m) return { txt, arr: null };
  const raw = m[1].trim();
  let arr;
  try { arr = JSON.parse(raw); } catch {
    const k = raw.lastIndexOf("}");
    try { arr = JSON.parse(raw.slice(0, k + 1).replace(/,\s*$/, "") + "]"); } catch {
      return { txt: txt.replace(m[0], "").trim(), arr: null, err: "JSON inválido" };
    }
  }
  return { txt: txt.replace(m[0], "").trim(), arr };
}

export function applyAiZones(txt, prices) {
  const r = parseAiZones(txt);
  if (!r.arr) return { txt: r.txt, n: 0, err: r.err };
  const out = sanitizeZones(r.arr, prices, 3);
  if (out.length) setZones(out, "Ai");
  return { txt: r.txt, n: out.length };
}

// Acepta un JSON pegado o un enlace del panel (#z=base64).
export function parseZoneInput(input) {
  const s = String(input || "").trim().replace(/^```(?:json)?\s*|```$/g, "").trim();
  const m = /[#&]z=([A-Za-z0-9_\-+/=]+)/.exec(s);
  if (m) {
    const b = m[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b, "base64").toString("utf8"));
  }
  const j = JSON.parse(s);
  return Array.isArray(j) ? j : Array.isArray(j.zones) ? j.zones : [j];
}

export function shareLink(base) {
  const b64 = Buffer.from(JSON.stringify(Z.list), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return base + "#z=" + b64;
}

export function zonesText(prices, sy) {
  const L = [];
  Z.list.forEach((z, i) => {
    if (sy && z.sym !== sy) return;
    const y = z.sym, r = zoneStatus(z, i, prices[y]);
    L.push("**" + (i + 1) + ". " + (NAMES[y] || y) + " · " + (z.side === "buy" ? "COMPRA" : "VENTA") + "** · " + z.name + (z.grade ? " · " + z.grade : "") + (z.estado ? " · " + z.estado : "") +
      "\n" + px(z.lo, y) + " – " + px(z.hi, y) + " · se espera que " + (z.side === "buy" ? "SUBA" : "BAJE") + " hacia " + px(z.tp1, y) +
      "\nSL " + px(z.sl, y) + " · TP1 " + px(z.tp1, y) + " · TP2 " + px(z.tp2, y) + "\n" + r[0]);
  });
  return L.length
    ? "Zonas a vigilar (" + (Z.date || "sin fecha") + ")\n\n" + L.join("\n\n") + "\n\nSon una expectativa, no una certeza. La decisión final siempre es tuya."
    : "No hay zonas" + (sy ? " para " + (NAMES[sy] || sy) : "") + " ahora mismo. Escribe **actualiza zonas** (TITO las calcula) o **cargar zonas** seguido del JSON.";
}

export const zoneSyms = () => ORDER.filter((k) => Z.list.some((z) => z.sym === k));
