// v4.20 · Fase 7: penetración en la zona antes de reaccionar, con velas sintéticas.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const { penetracion, resumenPen } = await import("../src/estudio.js");
const H = 3600000, T0 = Date.UTC(2026, 0, 10);

// 1H planas (ATR 10) y 1m: zona de compra 990–1000 confirmada en T0. Precio arriba, baja, mete mecha a 985 (5 por debajo del borde lejano), sube a 1010.
function data(minLow, sube = true) {
  const K1 = []; for (let i = 0; i < 60; i++) K1.push([T0 - 50 * H + i * H, 1010, 1015, 1005, 1010]);
  const M = { t: [], h: [], l: [], c: [], n: 0 }, push = (h, l, c) => { M.t.push(T0 + M.n * 60000); M.h.push(h); M.l.push(l); M.c.push(c); M.n++; };
  push(1012, 1008, 1010); push(1006, 999, 1000);          // toque (entra 1)
  push(1000, minLow, 990); push(995, 989, 992);           // penetra
  if (sube) push(1011, 994, 1010);                         // reacciona: +11 >= max(W=10, 0,5·ATR=5)
  for (let i = 0; i < 3000; i++) push(1001, 999, 1000);
  for (const k of ["t", "h", "l", "c"]) M[k] = Float64Array.from(M[k]);
  return { M, K1, Z: [{ tf: "1H", tipo: "OB", side: "buy", lo: 990, hi: 1000, t0: T0 }] };
}

test("mide la penetración antes de reaccionar y lo que pasa del borde lejano", () => {
  const { M, K1, Z } = data(985);
  const T = penetracion(M, K1, Z);
  assert.equal(T.length, 1);
  const x = T[0];
  assert.equal(x.react, true);
  assert.equal(x.pen, 15);                       // de 1000 a 985
  assert.equal(x.penW, 1.5);
  assert.ok(Math.abs(x.farPct - 5 / 1000) < 1e-12);
  const r = resumenPen(T);
  assert.equal(r.reaccionan, 1);
  assert.equal(r.stops.find((s) => s.margen_pct_mas_alla_del_borde === 0).te_sacaba_antes_de_reaccionar_pct, 100);
  assert.equal(r.stops.find((s) => s.margen_pct_mas_alla_del_borde === 1).te_sacaba_antes_de_reaccionar_pct, 0);
});

test("si no reacciona en 48 h se cuenta como toque sin reacción", () => {
  const { M, K1, Z } = data(995, false);
  const T = penetracion(M, K1, Z);
  assert.equal(T.length, 1);
  assert.equal(T[0].react, false);
  assert.equal(resumenPen(T).reaccionan_pct, 0);
});

test("zona que nace con el precio dentro no cuenta", () => {
  const { M, K1, Z } = data(985);
  Z[0].t0 = M.t[2];                              // el precio ya está dentro al confirmarse
  assert.equal(penetracion(M, K1, Z).length, 0);
});
