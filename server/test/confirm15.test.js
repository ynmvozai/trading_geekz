// v4.15 · Confirmación de 15 min (BTC, SOL, oro): regla fija con velas sintéticas.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const { evalTouch, outcome } = await import("../src/confirm15.js");
const { fiveMin } = await import("../src/estudio.js");
const P = 300000, T0 = Date.UTC(2026, 9, 13, 14, 0);

// Zona de venta 100–102. 14 velas previas (swing mínimo 100.6 en la 8), toque en k=14, luego k+1..k+3.
function velas({ volK3 = 25, bosClose = 100.5, k3High = 100.4 } = {}) {
  const C = [];
  for (let i = 0; i < 14; i++) C.push([101, 101.4, i === 8 ? 100.6 : 100.8, 101.1, 10]);
  C.push([101, 101.5, 100.9, 101.2, 10]);          // k: toque
  C.push([101.2, 101.3, 100.7, 100.9, 12]);        // k+1
  C.push([100.9, 101.0, 100.4, bosClose, 14]);     // k+2: cierre bajo 100.6 = BOS
  C.push([100.4, k3High, 100.0, 100.1, volK3]);    // k+3: máx < mín(k+1)=100.7 = FVG
  const M = { t: C.map((_, i) => T0 + i * P), o: C.map((c) => c[0]), h: C.map((c) => c[1]), l: C.map((c) => c[2]), c: C.map((c) => c[3]), v: C.map((c) => c[4]), n: C.length };
  return fiveMin(M);
}
const tTouch = T0 + 14 * P + 60000;
const venta = [{ t: tTouch + 120000, side: "sell", usd: 2e6, price: 100.8 }];

test("venta: FVG + BOS + volumen + órdenes netas vendedoras → confirmada", () => {
  const e = evalTouch(velas(), tTouch, "sell", 100, 102, venta, 1e6);
  assert.equal(e.ok, true);
  assert.deepEqual([e.fvg, e.bos, e.vol, e.ords, e.confirmada], [true, true, true, true, true]);
});

test("sin órdenes grandes en la zona no confirma (y lo registra)", () => {
  const e = evalTouch(velas(), tTouch, "sell", 100, 102, [], 1e6);
  assert.equal(e.ords, false); assert.equal(e.confirmada, false); assert.equal(e.fvg && e.bos && e.vol, true);
});

test("orden pequeña, fuera de zona o fuera de la ventana no cuenta", () => {
  const malas = [{ t: tTouch + 1, side: "sell", usd: 5e5, price: 100.8 }, { t: tTouch + 1, side: "sell", usd: 2e6, price: 105 }, { t: tTouch - 1, side: "sell", usd: 2e6, price: 100.8 }];
  assert.equal(evalTouch(velas(), tTouch, "sell", 100, 102, malas, 1e6).ords, false);
});

test("volumen bajo, sin BOS o sin FVG fallan su paso", () => {
  assert.equal(evalTouch(velas({ volK3: 9 }), tTouch, "sell", 100, 102, venta, 1e6).vol, false);
  assert.equal(evalTouch(velas({ bosClose: 100.7 }), tTouch, "sell", 100, 102, venta, 1e6).bos, false);
  assert.equal(evalTouch(velas({ k3High: 100.8 }), tTouch, "sell", 100, 102, venta, 1e6).fvg, false);
});

test("faltan velas después del toque → sin datos", () => {
  const F = velas(); F.n = 16;
  assert.equal(evalTouch(F, tTouch, "sell", 100, 102, venta, 1e6).ok, false);
});

test("resultado: un ancho de zona a favor acierta; cruzar el borde lejano falla", () => {
  assert.equal(outcome("sell", 100, 102, 98), "acierta");
  assert.equal(outcome("sell", 100, 102, 102.01), "falla");
  assert.equal(outcome("sell", 100, 102, 99), null);
  assert.equal(outcome("buy", 100, 102, 104), "acierta");
  assert.equal(outcome("buy", 100, 102, 99.9), "falla");
});
