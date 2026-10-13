// v4.19 · Tamaño de posición con riesgo fijo ($100, cuenta $3,000) y candado de stop mínimo / apalancamiento.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const { sizeOf, sizeLine } = await import("../src/risk.js");
const cfg = { risk: 100, account: 3000 };

test("SOL venta 110.64–111.22, stop 112.10: entrada en el borde inferior, operable", () => {
  const s = sizeOf("SOL", "sell", 110.64, 111.22, 112.1, cfg);
  assert.equal(s.ok, true);
  assert.equal(s.entry, 110.64);
  assert.ok(Math.abs(s.qty - 100 / 1.46) < 1e-9);
  assert.ok(Math.abs(s.notional - 7578.08) < 0.1);
  assert.ok(s.lev > 2.5 && s.lev < 2.6);
  assert.ok(Math.abs(s.loss - (100 + s.notional * 0.001)) < 1e-9);
});

test("BTC venta 84,150–84,340, stop 84,400: stop a 0,30 % → no operable", () => {
  const s = sizeOf("BTC", "sell", 84150, 84340.2, 84400, cfg);
  assert.equal(s.ok, false);
  assert.ok(s.stopPct < 0.003);
});

test("Oro compra 4,156–4,163, stop 4,150: apalancamiento 10,5x → no operable", () => {
  const s = sizeOf("XAU", "buy", 4156.16, 4163.25, 4150, cfg);
  assert.equal(s.entry, 4163.25);
  assert.equal(s.ok, false);
  assert.ok(s.lev > 10);
});

test("stop del lado equivocado, índice o sin stop", () => {
  assert.equal(sizeOf("BTC", "buy", 80000, 81000, 82000, cfg).ok, false);
  assert.equal(sizeOf("US30", "buy", 1, 2, 0.5, cfg), null);
  assert.equal(sizeOf("BTC", "buy", 1, 2, 0, cfg), null);
});

test("la línea usa la entrada confirmada cuando se pasa", () => {
  const t = sizeLine("SOL", { side: "sell", lo: 110.64, hi: 111.22, sl: 112.1 }, (x) => x.toFixed(2), 110);
  assert.ok(t.startsWith("💵 Con $100 de riesgo (entrada 110.00)"), t);
});
