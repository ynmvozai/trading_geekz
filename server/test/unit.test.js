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
  assert.match(msg.content, /^ℹ️ INFO · 🐋 Bitcoin: ballena COMPRÓ \$3\.51M (en \d+ órdenes )?· 100,200\nDentro de zona de VENTA\n⚠️ Ojo: empuja en contra/);
  assert.match(msg.content, /Información, no señal de entrada/);   // v4.22
  assert.doesNotMatch(msg.content.split("\n")[0], /\*|_/);
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
  assert.match(txt, /\*\*Total\*\* · 2 resueltas · TP1 50% · TP2 50% · SL 50%/); // v4.3: la compra dentro de zona de venta ya no cuenta
  assert.match(txt, /1 sin resolver/);
});

test("vigilancia y comandos rápidos", () => {
  setZones([{ ...ZB }], "t");
  M.S.BTC.price = 100200;
  assert.match(watchText(["BTC", "SOL"], "T"), /🎯 Bitcoin → venta .* · dentro/);
  M.S.BTC.price = 50000; assert.equal(watchText(["BTC", "SOL"], "T"), ""); M.S.BTC.price = 100200;
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

test("v3.2: calendario, índices y plan de sesión", async () => {
  const MA = await import("../src/macro.js");
  const ev = MA.parseCal([{ title: "CPI m/m", country: "USD", date: "2026-10-14T08:30:00-04:00", impact: "High", forecast: "0.3%", previous: "0.4%" },
    { title: "Algo EUR", country: "EUR", date: "2026-10-14T05:00:00-04:00", impact: "High" }, { title: "Low USD", country: "USD", date: "2026-10-14T09:00:00-04:00", impact: "Low" }]);
  assert.equal(ev.length, 1); assert.equal(ev[0].title, "CPI m/m");
  const y = MA.parseYahoo({ chart: { result: [{ meta: { regularMarketPrice: 51700 }, timestamp: [1791590400, 1791676800], indicators: { quote: [{ open: [51200, null], high: [51800, 1], low: [51100, 1], close: [51650, 1] }] } }] } });
  assert.equal(y.bars.length, 1); assert.equal(y.price, 51700);
  const st = MA.parseStooq("Date,Open,High,Low,Close,Volume\n2026-10-09,27300,27400,27200,27366,100\n");
  assert.deepEqual(st[0], ["2026-10-09", 27300, 27400, 27200, 27366]);
  const SE = await import("../src/sesion.js");
  const s = SE.splitSections("[[RESUMEN]] r1\n[[CRYPTO]] c1\n[[ORO]] o1\n[[INDICES]] i1");
  assert.equal(s.RESUMEN, "r1"); assert.equal(s.CRYPTO, "c1"); assert.equal(s.ORO, "o1"); assert.equal(s.INDICES, "i1");
  assert.equal(SE.etParts(Date.parse("2026-10-12T12:20:00Z")).hour, 8);   // 8:20 AM ET en octubre (EDT)
  assert.equal(SE.etParts(Date.parse("2026-11-16T13:20:00Z")).hour, 8);   // 8:20 AM ET en noviembre (EST)
  assert.match(SE.SESSION_Q, /\[\[INDICES\]\]/);
});

test("v3.3: canal #sesion-ny (ventana, índices y radar)", async () => {
  const SN = await import("../src/sesionny.js");
  assert.equal(SN.inWindow(Date.parse("2026-10-12T13:05:00Z")), true);   // lunes 9:05 AM PR
  assert.equal(SN.inWindow(Date.parse("2026-10-12T21:35:00Z")), false);  // lunes 5:35 PM PR
  assert.equal(SN.inWindow(Date.parse("2026-10-10T15:00:00Z")), false);  // sábado
  assert.equal(SN.setIdxZones([{ sym: "US30", name: "x", side: "sell", lo: 51875, hi: 51765 }, { sym: "BTC", lo: 1, hi: 2 }]), 1);
  assert.equal(SN.idxZones()[0].lo, 51765);
  assert.match(SN.boardText("t", Date.now() - 3600000, null), /Dow/);
  assert.match(SN.radarText("t", Date.now() - 3600000, null), /^t\n/);
});

test("v3.4: índices por webhook de TradingView", async () => {
  const MA = await import("../src/macro.js");
  assert.equal(MA.tvSym("DJ30"), "YM"); assert.equal(MA.tvSym("USTEC"), "NQ"); assert.equal(MA.tvSym("OANDA:US30USD"), "YM"); assert.equal(MA.tvSym("BTCUSD"), null);
  const r = MA.onTv('{"s":"DJ30","o":51600,"h":51700,"l":51550,"c":51650,"t":"2026-10-12T13:35:00Z"}');
  assert.equal(r.ok, true); assert.equal(MA.IDX.YM.price, 51650); assert.match(MA.IDX.YM.fuente, /^TradingView/);
  MA.onTv({ s: "DJ30", o: 51650, h: 51800, l: 51640, c: 51790, t: "2026-10-12T13:40:00Z" });
  assert.deepEqual(MA.IDX.YM.daily[MA.IDX.YM.daily.length - 1], ["2026-10-12", 51600, 51800, 51550, 51790]);
  assert.equal(MA.IDX.YM.h1.length, 1);
  assert.equal(MA.onTv("{}").ok, false);
  assert.equal(MA.tvSecret().length, 24);
});

test("v3.6: webhook de TradingView sin secreto (solo IPs de TradingView)", async () => {
  const MA = await import("../src/macro.js");
  assert.equal(MA.tvIpOk("1.2.3.4, 52.89.214.238", "").ok, true);
  assert.equal(MA.tvIpOk("52.89.214.238, 9.9.9.9", "").ok, false);
  assert.equal(MA.tvIpOk("", "::ffff:34.212.75.30").ok, true);
  const p = MA.IDX.YM.price;
  assert.equal(MA.onTv({ s: "DJ30", c: p * 1.5 }).ok, false);
});

test("v3.7: índices desde CNBC", async () => {
  const MA = await import("../src/macro.js");
  const q = MA.parseCnbc({ FormattedQuoteResult: { FormattedQuote: [{ symbol: "@DJ.1", code: 0, last: "51,800", open: "51,600", high: "51,900", low: "51,500", last_time: "2026-10-12T10:02:00.000-0400" }, { symbol: "@NQ.1", last: "25,010.25" }] } });
  assert.equal(q["@DJ.1"].last, "51,800"); assert.ok(q["@NQ.1"]);
  MA.storeIdxBar("NQ", "2026-10-12T14:00", 25000, 25020, 24990, 25010, { d: "2026-10-12", ohlc: [24900, 25050, 24850, 25010] }, "CNBC @NQ.1");
  assert.equal(MA.IDX.NQ.price, 25010); assert.match(MA.IDX.NQ.fuente, /^CNBC/);
  assert.deepEqual(MA.IDX.NQ.daily[MA.IDX.NQ.daily.length - 1], ["2026-10-12", 24900, 25050, 24850, 25010]);
});

test("v4.0: mega ballenas por rangos, liquidaciones y wallets", async () => {
  const MG = await import("../src/mega.js");
  assert.equal(MG.megaLevel("BTC", 10e6), 0); assert.equal(MG.megaLevel("BTC", 20e6), 1); assert.equal(MG.megaLevel("BTC", 50e6), 2); assert.equal(MG.megaLevel("BTC", 150e6), 3);
  assert.match(MG.rangoTxt("BTC", 2), /Rango: \$40\.00M–\$100\.00M \(nivel 2 de 3\)/);
  assert.match(MG.rangoTxt("SOL", 3), /más de \$40\.00M/);
  const t0 = Date.now();
  const one = MG.onBurst({ sym: "BTC", side: "sell", usd: 18e6, first: t0 }, 100200, t0);
  assert.match(one, /^🐳 MEGA BALLENA · Bitcoin\n🔴 Vendieron \$18\.00M en una sola orden · 100,200\nRango: \$15\.00M–\$40\.00M/);
  assert.equal(MG.onBurst({ sym: "BTC", side: "sell", usd: 2e6, first: t0 + 1000 }, 100100, t0 + 1000), null);       // mismo nivel en 5 min: no repite
  assert.equal(MG.onBurst({ sym: "BTC", side: "buy", usd: 200e3, first: t0 }, 100100, t0), null);                     // orden chica no cuenta
  for (let i = 0; i < 3; i++) MG.onBurst({ sym: "SOL", side: "buy", usd: 1.4e6, first: t0 + i * 5000 }, 200, t0 + i * 5000);
  const acc = MG.onBurst({ sym: "SOL", side: "buy", usd: 1.4e6, first: t0 + 15000 }, 201, t0 + 15000);
  assert.match(acc || "", /🐳 MEGA BALLENA · Solana\n🟢 Compraron \$5\.60M en 4 órdenes en 15 segundos/);
  assert.equal(MG.onLiq("BTC", "long", 3e6, 99000, t0, t0), null);
  assert.match(MG.onLiq("BTC", "long", 2.5e6, 98900, t0 + 60000, t0 + 60000), /^💥 LIQUIDACIONES GRANDES · Bitcoin\nCerraron a la fuerza \$5\.50M en compras \(largos\)/);
  const WL = await import("../src/wallets.js");
  const w1 = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const tx = { signature: "s", timestamp: 1760000000, nativeTransfers: [{ fromUserAccount: w1, toUserAccount: "pool", amount: 2e9 }],
    tokenTransfers: [{ fromUserAccount: "pool", toUserAccount: w1, mint: "MEMEmint1111111111111111111111111111111111", tokenAmount: 1000000 }] };
  const sw = WL.parseSwaps(tx, [w1], 150);
  assert.equal(sw.length, 1); assert.equal(sw[0].side, "buy"); assert.equal(sw[0].usd, 300);
  assert.match(WL.addWallet(w1, "Ballena1"), /Agregada: Ballena1/);
  assert.match(WL.addWallet("hola", "x"), /no parece/);
  assert.match(WL.walletsText(), /Wallets en seguimiento: 1/);
  const rtx = { blockTime: 1760000000, meta: { err: null, preBalances: [5e9], postBalances: [3e9],
    preTokenBalances: [], postTokenBalances: [{ owner: w1, mint: "MEMEmint1111111111111111111111111111111111", uiTokenAmount: { uiAmount: 5000 } }] },
    transaction: { message: { accountKeys: [{ pubkey: w1 }] } } };
  const rs = WL.parseRpcTx(rtx, w1, 150);
  assert.equal(rs.length, 1); assert.equal(rs[0].side, "buy"); assert.equal(rs[0].usd, 300); assert.equal(rs[0].qty, 5000);
});

test("v4.3: zonas rotas, lado correcto, stop mínimo y termómetro de sesgo", async () => {
  const ZN = await import("../src/zones.js"), R = await import("../src/results.js"), BI = await import("../src/bias.js");
  setZones([{ ...ZB, lo: 100000, hi: 100500, sl: 101000 }, { sym: "BTC", name: "OB compra", grade: "A", side: "buy", lo: 95000, hi: 95500, sl: 94500, tp1: 97000, tp2: 98000 }], "t");
  // Lado correcto: con el precio ARRIBA de una zona de venta, no cuenta como "cerca".
  assert.notEqual(ZN.nearZone("BTC", 100700).i, 0);              // la de venta queda fuera; solo aparece la de compra (lejos)
  assert.equal(ZN.nearZone("BTC", 99800).i, 0);
  // Zona rota: el precio pasa el stop (101,000) → muere y deja de estar "en zona".
  assert.equal(ZN.checkBroken("BTC", 100900).length, 0);
  assert.equal(ZN.checkBroken("BTC", 101050).length, 1);
  assert.equal(ZN.checkBroken("BTC", 101100).length, 0);           // no avisa dos veces
  assert.equal(ZN.isBroken(ZN.Z.list[0]), true);
  assert.equal(ZN.zoneAt("BTC", 100200), -1);
  // Stop mínimo: sin ATR usa respaldo 0.15 % en BTC → stop a $50 de la entrada no cuenta.
  const tight = R.recordAlert({ t: Date.now(), sym: "BTC", kind: "orden_en_zona", z: { ...ZB, lo: 100020, sl: 100250 }, entry: 100200 });
  assert.equal(tight.status, "stop muy cerca");
  // Termómetro: subida sostenida → compradores.
  const up = Array.from({ length: 60 }, (_, i) => ["t", 100 + i, 101 + i, 99 + i, 100.5 + i]);
  up[59][4] = 200;
  const r = BI.scoreOf("SOL", up, up);
  assert.ok(r.score >= 2, "score " + r.score); assert.equal(r.label, "COMPRADORES");
  assert.ok(BI.atr14(up) > 0);
});

test("v4.4: estudio · zonas algorítmicas y simulación con velas de 1 minuto", async () => {
  const E = await import("../src/estudio.js");
  const H = 3600000, K = [];
  let p = 100;
  for (let i = 0; i < 40; i++) { K.push([i * H, p, p + 1, p - 1, p + (i % 2 ? 0.3 : -0.3)]); }
  K.push([40 * H, 100, 100.5, 98.5, 99]);                                  // vela bajista (order block de compra)
  K.push([41 * H, 99, 104, 99, 103.8], [42 * H, 103.8, 108, 103.5, 107.5], [43 * H, 107.5, 110, 107, 109.5]); // impulso que rompe
  for (let i = 44; i < 60; i++) K.push([i * H, 109, 110, 108, 109]);
  const Z = E.detectZones(K, "1H");
  const ob = Z.find((z) => z.tipo === "OB" && z.side === "buy");
  assert.ok(ob, "debe detectar el order block de compra");
  assert.equal(ob.lo, 98.5); assert.equal(ob.hi, 100.5);
  // Minutos: el precio baja a la zona (100.5), rebota y sube a la meta.
  const n = 600, M = { t: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), n };
  for (let i = 0; i < n; i++) { const v = i < 200 ? 109 - i * 0.045 : 100 + (i - 200) * 0.05; M.t[i] = ob.t0 + i * 60000; M.h[i] = v + 0.05; M.l[i] = v - 0.05; M.c[i] = v; }
  const r = E.simZone(M, { ...ob }, { k: 0.25, R: 1, confirm: "toque" });
  assert.ok(r && r.win === true, "debe ganar: " + JSON.stringify(r));
});

test("v4.5: macro fundamental · lectura de FRED, régimen y datos nuevos", async () => {
  const F = await import("../src/fundamental.js");
  assert.deepEqual(F.parseFred("observation_date,UNRATE\n2026-08-01,4.3\n2026-09-01,.\n2026-10-01,4.2\n"), [["2026-08-01", 4.3], ["2026-10-01", 4.2]]);
  // Serie mensual: índice que sube 0.25% por mes (≈3% anual) y luego se frena (≈1.2% anualizado los últimos 3 meses).
  const mon = (n, f) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2023, 9 + i, 1)).toISOString().slice(0, 10); return [d, f(i)]; });
  let v = 100; const core = mon(36, (i) => (v *= i >= 33 ? 1.001 : 1.0025));
  const S = {
    CPILFESL: core, CPIAUCSL: core, PCEPILFE: core, UNRATE: mon(36, () => 4.2), SAHMREALTIME: mon(36, () => 0),
    PAYEMS: mon(36, (i) => 150000 + i * 150), M2SL: mon(36, (i) => 20000 * 1.004 ** i),
  };
  const R = F.analyze(S, {});
  assert.equal(R.inflacion.tendencia, "bajando");
  assert.equal(R.empleo.riesgo_recesion, "BAJO");
  assert.equal(R.regimen, "GOLDILOCKS");
  const R2 = F.analyze({ ...S, SAHMREALTIME: mon(36, () => 0.6) }, {});
  assert.equal(R2.empleo.riesgo_recesion, "ALTO");
  assert.equal(R2.regimen, "DESACELERACIÓN");
  // Mercado en consolidación: sube y luego rango muy estrecho.
  const cl = []; for (let i = 0; i < 300; i++) cl.push(i < 250 ? 100 + i * 0.2 + (i % 2 ? 3 : -3) : 150 + (i % 2 ? 0.3 : -0.3));
  assert.equal(F.marketRegime(cl).estado, "consolidación");
  assert.equal(F.marketRegime(cl.slice(0, 100)).estado, "sin dato");
  // Datos nuevos: la primera vez solo memoriza; luego avisa una sola vez.
  const seen = {};
  assert.deepEqual(F.newDataTexts(S, seen), []);
  const S2 = { ...S, UNRATE: [...S.UNRATE, ["2026-10-01", 4.4]] };
  const t = F.newDataTexts(S2, seen);
  assert.equal(t.length, 1); assert.match(t[0], /Desempleo de oct 2026: 4\.4% \(antes 4\.2%\)/);
  assert.deepEqual(F.newDataTexts(S2, seen), []);
  const txt = F.panoramaText(R);
  assert.match(txt, /^🌎 Panorama macro/); assert.match(txt, /Goldilocks/); assert.match(txt, /S&P 500: sin dato/);
});

test("v4.5: el sesgo solo cambia si se confirma en 2 lecturas seguidas", async () => {
  const { confirmLabel } = await import("../src/bias.js");
  const P = {};
  assert.equal(confirmLabel(P, "SOL", "NEUTRAL", "VENDEDORES"), "NEUTRAL");   // 1ª lectura: pendiente
  assert.equal(confirmLabel(P, "SOL", "NEUTRAL", "NEUTRAL"), "NEUTRAL");      // volvió: se cancela
  assert.equal(confirmLabel(P, "SOL", "NEUTRAL", "VENDEDORES"), "NEUTRAL");
  assert.equal(confirmLabel(P, "SOL", "NEUTRAL", "VENDEDORES"), "VENDEDORES"); // 2ª seguida: confirmado
  assert.equal(confirmLabel(P, "BTC", undefined, "COMPRADORES"), "COMPRADORES"); // primera vez: directo
});

test("v4.7: una zona FVG existe recién cuando cierra la vela que la confirma", async () => {
  const E = await import("../src/estudio.js");
  const H = 3600000, K = [];
  for (let i = 0; i < 30; i++) K.push([i * H, 100, 101, 99, 100]);
  K.push([30 * H, 100, 101, 99.5, 100.8], [31 * H, 100.8, 106, 100.8, 105.5], [32 * H, 105.5, 107, 104, 106.5], [33 * H, 106.5, 107, 105.5, 106]);
  for (let i = 34; i < 40; i++) K.push([i * H, 106, 107, 105.5, 106]);
  const f = E.detectZones(K, "1H").find((z) => z.tipo === "FVG" && z.side === "buy" && z.lo === 101);
  assert.ok(f, "debe detectar el FVG de compra 101–104");
  assert.equal(f.hi, 104);
  assert.equal(f.t0, 33 * H, "se activa al cierre de la vela de las 32 h (o sea a las 33 h), nunca antes");
});

test("v4.23: #mega-ballenas ignora el oro", async () => {
  const { onBurst, onLiq } = await import("../src/mega.js");
  assert.equal(onBurst({ sym: "XAU", side: "buy", usd: 9e9, first: Date.now() }, 4200), null);
  assert.equal(onLiq("XAU", "long", 9e9, 4200), null);
});
