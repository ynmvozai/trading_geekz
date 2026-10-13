// v4.21 · Fase 8: metas con el stop medido, con velas sintéticas.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const { metasSim, resumenMetas } = await import("../src/estudio.js");
const T0 = Date.UTC(2026, 0, 10);

// Zona de compra 990–1000 (BTC margen 0,5 %): stop = 990 × 0,995 = 985,05; riesgo = 14,95.
function M_(path) {
  const M = { t: [], h: [], l: [], c: [], n: 0 }, push = (h, l, c) => { M.t.push(T0 + M.n * 60000); M.h.push(h); M.l.push(l); M.c.push(c); M.n++; };
  push(1012, 1008, 1010); push(1006, 999, 1000);            // toque
  for (const [h, l, c] of path) push(h, l, c);
  for (const k of ["t", "h", "l", "c"]) M[k] = Float64Array.from(M[k]);
  return M;
}
const Z = [{ tf: "1H", tipo: "OB", side: "buy", lo: 990, hi: 1000, t0: T0 }];
const risk = 1000 - 990 * 0.995, cost = 0.001 * 1000 / risk;

test("gana 1R y 1,5R, toca stop antes de 2R; comisión descontada", () => {
  const path = [[1005, 995, 1004], [1023, 1001, 1022], [1023, 984, 986]];   // sube a +1,54R y luego baja al stop
  for (let i = 0; i < 3000; i++) path.push([990, 985.5, 988]);
  const T = metasSim(M_(path), Z, 0.005);
  assert.equal(T.length, 1);
  assert.ok(Math.abs(T[0].r[1] - (1 - cost)) < 1e-9);
  assert.ok(Math.abs(T[0].r[1.5] - (1.5 - cost)) < 1e-9);
  assert.ok(Math.abs(T[0].r[2] - (-1 - cost)) < 1e-9);
  assert.equal(T[0].stopped, true);
  assert.ok(T[0].mfe > 1.5 && T[0].mfe < 1.6);
});

test("stop y meta en la misma vela cuenta stop", () => {
  const path = [[1040, 980, 1000]];
  for (let i = 0; i < 3000; i++) path.push([1001, 999, 1000]);
  const T = metasSim(M_(path), Z, 0.005);
  for (const R of [1, 1.5, 2, 3]) assert.ok(Math.abs(T[0].r[R] - (-1 - cost)) < 1e-9);
});

test("sin stop ni meta en 48 h sale al cierre", () => {
  const path = []; for (let i = 0; i < 3000; i++) path.push([1003, 997, 1002]);
  const T = metasSim(M_(path), Z, 0.005);
  assert.ok(Math.abs(T[0].r[3] - (2 / risk - cost)) < 1e-9);
});

test("el resumen elige la mejor meta en afinado y la juzga en validación", () => {
  const T = [];
  for (let i = 0; i < 60; i++) T.push({ t: i, mfe: 1, riskPct: 0.01, cost: 0.1, r: { 1: 0.5, 1.5: 0.2, 2: -1, 3: -1 } });
  for (let i = 0; i < 60; i++) T.push({ t: 100 + i, mfe: 1, riskPct: 0.01, cost: 0.1, r: { 1: -0.2, 1.5: 0.3, 2: -1, 3: -1 } });
  const r = resumenMetas(T, 100);
  assert.equal(r.mejor_en_afinado, "1R");
  assert.equal(r.tabla["1R"].validacion.R_prom, -0.2);
  assert.equal(r.pasa, false);
});
