// v4.19/v4.21 · Tamaño de posición con riesgo fijo ($100, cuenta $3,000) y stop MEDIDO (borde lejano + margen de la Fase 7).
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const { sizeOf, sizeLine, measuredStop, rrTo, nivelesMedidos } = await import("../src/risk.js");
const cfg = { risk: 100, account: 3000 };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test("stop medido: borde lejano + 0,5 % BTC, 1 % SOL, 0,3 % oro", () => {
  assert.ok(near(measuredStop("BTC", "sell", 84150, 84340.2), 84340.2 * 1.005));
  assert.ok(near(measuredStop("SOL", "buy", 101.56, 105.32), 101.56 * 0.99));
  assert.ok(near(measuredStop("XAU", "buy", 4156.16, 4163.25), 4156.16 * 0.997));
  assert.equal(measuredStop("US30", "buy", 1, 2), null);
});

test("BTC venta 84,150–84,340: ya es operable con el stop medido (≈0,73 %, 4,6x)", () => {
  const s = sizeOf("BTC", "sell", 84150, 84340.2, cfg);
  assert.equal(s.ok, true);
  assert.equal(s.entry, 84150);
  assert.ok(s.stopPct > 0.0072 && s.stopPct < 0.0074);
  assert.ok(s.lev > 4.5 && s.lev < 4.7);
  assert.ok(near(s.loss, 100 + s.notional * 0.001));
});

test("oro compra 4,156–4,163: stop 0,47 %, 7,1x → operable", () => {
  const s = sizeOf("XAU", "buy", 4156.16, 4163.25, cfg);
  assert.equal(s.ok, true);
  assert.ok(s.lev > 7 && s.lev < 7.2);
});

test("candado: zona muy fina deja el stop medido bajo 0,3 % o pide más de 10x", () => {
  const s = sizeOf("XAU", "buy", 4160, 4160.5, cfg);  // 0,3 % + 0,01 % ≈ 0,31 % → 10,6x
  assert.equal(s.ok, false);
});

test("entrada confirmada que ya pasó el stop → no operable", () => {
  const s = sizeOf("SOL", "sell", 108, 108.8, cfg, 110.5);
  assert.equal(s.ok, false);
});

test("R:R a la meta 1 con comisión y aviso si queda corta", () => {
  const s = sizeOf("BTC", "sell", 84150, 84340.2, cfg);
  const rr = rrTo(s, "sell", 83500);
  assert.ok(near(rr, 650 / s.dist - 0.001 * 84150 / s.dist));
  const t = sizeLine("BTC", { side: "sell", lo: 84150, hi: 84340.2, tp1: 83500 }, (x) => String(Math.round(x)));
  assert.ok(t.includes("R:R a la meta 1"), t);
  assert.ok(t.includes("la meta queda corta"), t);
});

test("la línea de niveles muestra el stop medido", () => {
  const t = nivelesMedidos("SOL", { side: "sell", lo: 108.04, hi: 108.84, tp1: 106.3 }, (x) => x.toFixed(2));
  assert.ok(t.startsWith("🛑 Stop 109.93 (borde + 1 %)"), t);
});
