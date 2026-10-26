// v4.37 · Auto-Trade: reglas congeladas (4H → FVG 1H → entrada 5 min, 1:2).
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const A = await import("../src/autotrade.js");

test("FVG 1H alcista y bajista con tamaño mínimo", () => {
  const H1 = [[0, 100, 101, 99, 100.5], [3600000, 100.5, 104, 100.4, 103.8], [7200000, 103.8, 105, 102, 104.5]];
  const z = A.fvgZones(H1);
  assert.equal(z.length, 1); assert.equal(z[0].side, 1); assert.equal(z[0].lo, 101); assert.equal(z[0].hi, 102); assert.equal(z[0].t, 10800000);
});

test("entra al romper la vela anterior tras tocar la zona, stop bajo el toque, meta 1:2", () => {
  // 4H alcista sostenido (60 velas subiendo) para que el sesgo sea +1.
  const H4 = Array.from({ length: 60 }, (_, i) => [i * 14400000, 50 + i, 51 + i, 49.5 + i, 50.8 + i]);
  const t0 = 60 * 14400000;
  const H1 = [[t0 - 3 * 3600000, 100, 101, 99, 100.5], [t0 - 2 * 3600000, 100.5, 104, 100.4, 103.8], [t0 - 3600000, 103.8, 105, 102, 104.5]];
  const K5 = [[t0 - 300000, 104, 104.2, 103.9, 104], [t0, 104, 104.1, 101.8, 102.2], [t0 + 300000, 102.2, 102.4, 101.6, 101.9], [t0 + 600000, 101.9, 102.6, 101.8, 102.5]];
  const e = A.scanEntries(K5, H1, H4);
  assert.equal(e.length, 1);
  const tr = e[0];
  assert.equal(tr.side, 1); assert.equal(tr.e, 102.5); assert.equal(tr.t, t0 + 900000);
  assert.ok(Math.abs(tr.sl - 101.6 * (1 - 0.0005)) < 1e-9);
  assert.ok(Math.abs(tr.tp - (tr.e + 2 * tr.R)) < 1e-9);
  const o = A.outcome(tr, [[t0 + 900000, 102.5, 102.6, tr.sl - 0.01, 102]]);
  assert.equal(o.how, "stop"); assert.equal(o.rb, -1);
  const o2 = A.outcome(tr, [[t0 + 900000, 102.5, tr.tp + 0.1, 102.4, 104]]);
  assert.equal(o2.how, "meta"); assert.equal(o2.rb, 2);
});

test("sesión NY: 9:30 a 4:00 PM ET, lunes a viernes", () => {
  assert.equal(A.inNY(Date.parse("2026-10-26T13:35:00Z")), true);   // lun 9:35 AM ET
  assert.equal(A.inNY(Date.parse("2026-10-26T20:00:00Z")), false);  // 4:00 PM ET
  assert.equal(A.inNY(Date.parse("2026-10-25T15:00:00Z")), false);  // domingo
});
