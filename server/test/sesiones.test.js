// v4.11 · Fase 5 (sesiones NY): reloj de NY, velas de 5 min, percentil 99 y detección de la señal con datos sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const { etToUtc, fiveMin, sessionSignal, p99 } = await import("../src/estudio.js");
const DAY = 86400000, P = 300000;

test("hora de NY con y sin horario de verano", () => {
  assert.equal(new Date(etToUtc(Date.UTC(2026, 6, 15), 570)).toISOString(), "2026-07-15T13:30:00.000Z");
  assert.equal(new Date(etToUtc(Date.UTC(2026, 0, 15), 570)).toISOString(), "2026-01-15T14:30:00.000Z");
});

test("velas de 5 min con volumen sumado", () => {
  const n = 10, t0 = Date.UTC(2026, 6, 15, 13, 30);
  const M = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), n };
  for (let i = 0; i < n; i++) { M.t[i] = t0 + i * 60000; M.o[i] = 100 + i; M.h[i] = 101 + i; M.l[i] = 99 + i; M.c[i] = 100.5 + i; M.v[i] = 1; }
  const F = fiveMin(M);
  assert.equal(F.n, 2);
  assert.deepEqual([F.o[0], F.h[0], F.l[0], F.c[0], F.v[0]], [100, 105, 99, 104.5, 5]);
});

test("percentil 99 del histograma", () => {
  const h = new Float64Array(480); h[200] = 990; h[280] = 10;   // 10^5 y 10^7
  assert.equal(Math.round(p99([h])), 1e7);
});

test("señal de sesión: toque, FVG con BOS y confirmación con más volumen", () => {
  const iniT = Date.UTC(2026, 6, 15, 13, 30), n = 16;
  const F = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n).fill(110), l: new Float64Array(n).fill(105), c: new Float64Array(n).fill(107), v: new Float64Array(n).fill(10), n };
  for (let i = 0; i < n; i++) F.t[i] = iniT + (i - 4) * P;
  F.sh = new Float64Array(n).fill(108); F.sl = new Float64Array(n).fill(99);
  const set = (k, h, l, c, v) => { F.h[k] = h; F.l[k] = l; F.c[k] = c; F.v[k] = v; };
  set(5, 106, 101, 104, 10);   // toca la demanda 100–102
  set(6, 113, 104, 112, 30);   // impulso: cierra sobre el swing 108 (BOS)
  set(7, 114, 107, 113, 12);   // FVG: mínimo 107 > máximo 106 de la vela 5
  set(8, 118, 112, 117, 20);   // confirmación: supera 114, cierra arriba, más volumen que 12
  const z = { tf: "1H", tipo: "OB", side: "buy", lo: 100, hi: 102, t0: iniT - DAY, end: iniT + DAY };
  const s = sessionSignal(F, [z], iniT, iniT + 12 * P);
  assert.ok(s);
  assert.equal(s.tE, F.t[8] + P); assert.equal(s.e, 117); assert.equal(s.sl, 100); assert.equal(s.dir, 1);
  F.v[8] = 5;                    // sin más volumen: no hay señal
  assert.equal(sessionSignal(F, [z], iniT, iniT + 12 * P), null);
});

test("v4.13: regla candidata (toque → FVG después del toque → BOS) y stop en la vela del toque", async () => {
  const { setupSignal, confirmOf } = await import("../src/estudio.js");
  const iniT = Date.UTC(2026, 6, 15, 13, 30), n = 16;
  const F = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n).fill(110), l: new Float64Array(n).fill(105), c: new Float64Array(n).fill(107), v: new Float64Array(n).fill(10), n };
  for (let i = 0; i < n; i++) F.t[i] = iniT + (i - 4) * P;
  F.sh = new Float64Array(n).fill(108); F.sl = new Float64Array(n).fill(99);
  const set = (k, h, l, c, v) => { F.h[k] = h; F.l[k] = l; F.c[k] = c; F.v[k] = v; };
  set(5, 106, 101, 104, 10);   // toque (k)
  set(6, 106.5, 103, 106, 10); // k+1
  set(7, 113, 105, 112, 30);   // k+2: BOS sobre 108
  set(8, 114, 107, 113, 12);   // k+3: mínimo 107 > máximo 106.5 de k+1 → FVG
  set(9, 118, 112, 117, 20);   // confirmación con más volumen
  const z = { tf: "1H", tipo: "OB", side: "buy", lo: 100, hi: 102, t0: iniT - DAY, end: iniT + DAY };
  const s = setupSignal(F, [z], iniT, iniT + 12 * P, new Set());
  assert.ok(s); assert.equal(s.k, 5); assert.equal(s.e, 113); assert.equal(s.sl, 101); assert.equal(s.tE, F.t[8] + P);
  const c = confirmOf(F, s, iniT + 12 * P); assert.ok(c); assert.equal(c.e, 117);
  assert.equal(setupSignal(F, [z], iniT, iniT + 12 * P, new Set([z])), null);   // zona consumida
});
