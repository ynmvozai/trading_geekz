// Pruebas de la lógica portada (datos de prueba solo aquí, nunca en producción).
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const { Z, setZones, applyAiZones, parseZoneInput, sanitizeZones, prox, proxNear, zoneAt, shareLink } = await import("../src/zones.js");
const M = await import("../src/market.js");
const { initAlerts, buildMessage, watchText } = await import("../src/alerts.js");
const R = await import("../src/results.js");
const { splitLong, prParts } = await import("../src/util.js");
const { quickAnswer } = await import("../src/commands.js");
const { AI_PROMPT, DAILY_Q, ZONES_Q } = await import("../src/prompts.js");
initAlerts();

const ZB = { sym: "BTC", name: "Order block 1H", grade: "A++", side: "sell", lo: 100000, hi: 100500, sl: 101000, tp1: 99000, tp2: 98000, nota: "" };

test("prompts copiados del panel", () => {
  assert.match(AI_PROMPT, /^# IDENTIDAD Y ROL/);
  assert.ok(AI_PROMPT.includes("La decisión final siempre es tuya."));
  assert.ok(DAILY_Q.startsWith("Haz el mapa del día.") && DAILY_Q.endsWith(ZONES_Q));
});

test("agregación de 250 ms y umbral mínimo", () => {
  setZones([{ ...ZB }], "test");
  const got = [];
  M.on("big", (o) => got.push(o));
  const t0 = Date.now();
  M.onTrade("BTC", 100200, 10, t0, false, t0);       // $1.0M
  M.onTrade("BTC", 100200, 15, t0 + 100, false, t0 + 100); // +$1.5M
  M.onTrade("BTC", 100200, 10, t0 + 200, false, t0 + 200); // +$1.0M = $3.5M dentro de 250 ms
  M.onTrade("BTC", 100200, 1, t0 + 400, false, t0 + 400);  // nueva ráfaga → cierra la anterior
  assert.equal(got.length, 1);
  assert.equal(Math.round(got[0].usd), 3507000);
  assert.equal(got[0].zone, 0);
  assert.equal(got[0].side, "buy");
  const msg = buildMessage(got[0]);
  assert.match(msg.content, /^HOT ZONE · BTC · COMPRA \$3\.51M/);
});

test("cerca de zona: proximidad 0-100%", () => {
  assert.equal(proxNear("BTC", 0), 100);
  assert.equal(proxNear("BTC", 0.015), 0);
  assert.equal(proxNear("BTC", 0.0075).toFixed(2), "50.00");
  assert.equal(prox(ZB, 100200), 100);
  assert.equal(prox(ZB, 100000 / 1.05), 0);
  assert.equal(zoneAt("BTC", 100600), -1);
});

test("TITO: JSON de zonas truncado se repara", () => {
  M.S.BTC.price = 100200;
  const txt = 'Análisis.\n```json\n[{"sym":"BTC","name":"FVG 4H","grade":"B","side":"buy","lo":99000,"hi":99500,"sl":98500,"tp1":100500,"tp2":101000,"nota":"x"},{"sym":"BTC","name":"cor';
  const r = applyAiZones(txt, { BTC: 100200 });
  assert.equal(r.n, 1);
  assert.equal(r.txt, "Análisis.");
  assert.equal(Z.list[0].side, "buy");
  const far = sanitizeZones([{ sym: "BTC", lo: 10, hi: 20 }], { BTC: 100200 });
  assert.equal(far.length, 0);
});

test("cargar zonas: JSON o enlace del panel", () => {
  setZones([{ ...ZB }], "t");
  const link = shareLink("https://x/");
  const arr = parseZoneInput("mira " + link);
  assert.equal(arr[0].lo, 100000);
  assert.equal(parseZoneInput('```json\n[{"sym":"XAU","lo":1,"hi":2}]\n```')[0].sym, "XAU");
});

test("historial: TP1 luego TP2, SL, niveles inválidos, 48 h", () => {
  R.loadResults();
  const t = Date.now();
  R.checkRange("BTC", 97000, 97000, t); // cierra lo que quedó abierto de otras pruebas
  const ZH = { ...ZB, lo: 100010 };
  const a = R.recordAlert({ t, sym: "BTC", kind: "orden_en_zona", z: ZH, entry: 100200, prox: 100 });
  assert.equal(a.status, "abierta");
  const dup = R.recordAlert({ t, sym: "BTC", kind: "precio_en_zona", z: ZH, entry: 100300, prox: 100 });
  assert.equal(dup.status, "repetida");
  R.checkRange("BTC", 98990, 98990, t + 1000); // TP1
  assert.equal(R.openCount(), 1);
  R.checkRange("BTC", 97990, 97990, t + 2000); // TP2
  assert.equal(R.openCount(), 0);
  const ZS = { ...ZB, lo: 100001 };
  R.recordAlert({ t, sym: "BTC", kind: "orden_en_zona", z: ZS, entry: 100200 });
  R.checkRange("BTC", 100900, 101100, t + 1000); // SL
  assert.equal(R.openCount(), 0);
  const bad = R.recordAlert({ t, sym: "BTC", kind: "orden_cerca", z: { ...ZB, lo: 100002 }, entry: 98500 }); // TP1 arriba de la entrada en venta
  assert.equal(bad.status, "sin niveles");
  R.recordAlert({ t: t - 49 * 3600000, sym: "BTC", kind: "orden_en_zona", z: { ...ZB, lo: 100003 }, entry: 100200 });
  R.expire(t);
  const txt = R.resultsText(30);
  assert.match(txt, /\*\*Total\*\* · 3 resueltas · TP1 67% · TP2 67% · SL 33%/);
  assert.match(txt, /1 sin resolver/);
});

test("vigilancia y comandos rápidos", () => {
  setZones([{ ...ZB }], "t");
  M.S.BTC.price = 100200;
  assert.match(watchText(["BTC", "SOL"], "T"), /EN LA ZONA/);
  assert.match(quickAnswer("zonas btc"), /Order block 1H/);
  assert.match(quickAnswer("precio"), /Bitcoin: 100,200\.0/);
});

test("utilidades", () => {
  const parts = splitLong("a\n".repeat(3000));
  assert.ok(parts.every((p) => p.length <= 1900) && parts.join("") === "a\n".repeat(3000));
  const p = prParts(Date.UTC(2026, 9, 9, 11, 48)); // 7:48 AM en Puerto Rico (UTC-4)
  assert.equal(p.hour, 7); assert.equal(p.minute, 48);
});

test("sentimiento Fear & Greed: niveles y lectura por zona", async () => {
  const S = await import("../src/sentiment.js");
  assert.equal(S.labelEs(10), "Miedo extremo");
  assert.equal(S.labelEs(50), "Neutral");
  assert.equal(S.labelEs(90), "Codicia extrema");
  assert.equal(S.sentRead("buy", { v: 15 }).tag, "a favor");
  assert.equal(S.sentRead("sell", { v: 85 }).tag, "a favor");
  assert.equal(S.sentRead("buy", { v: 85 }).tag, "contra");
  assert.equal(S.sentRead("sell", { v: 15 }).tag, "contra");
  assert.equal(S.sentRead("buy", { v: 50 }).tag, "neutral");
  assert.equal(S.sentRead("buy", null).tag, "sin dato");
  S.SENT.crypto = { v: 20, label: "Miedo extremo", prev: 25, week: 40, t: Date.now(), fuente: "test" };
  const zb = { sym: "BTC", name: "Order block 4H", grade: "A", side: "buy", lo: 99000, hi: 99500, sl: 98500, tp1: 101000, tp2: 102000, nota: "" };
  const r = R.recordAlert({ t: Date.now(), sym: "BTC", kind: "orden_cerca", z: zb, order_side: "sell", entry: 99600, prox: 90, usd: 3500000 });
  assert.equal(r.fg, 20); assert.equal(r.fg_read, "a favor");
  assert.match(S.sentimentText(), /20\/100 · Miedo extremo/);
  S.SENT.crypto = null;
});
