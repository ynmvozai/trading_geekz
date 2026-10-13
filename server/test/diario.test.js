// v4.24 · Diario automático: lectura de la línea, R con comisión, cierre automático en stop/meta.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore, kvGet } from "../src/store.js";
openStore(":memory:");
const D = await import("../src/diario.js");
const { S } = await import("../src/market.js");
const { IDX } = await import("../src/macro.js");

test("lee compra/venta con precio, stop, meta, plan y nota", () => {
  const p = D.parseLine("compra BTC 83,200 sl 82500 tp 84500 plan si nota OB 1H, entrada IFVG 1min");
  assert.equal(p.cmd, "new"); assert.equal(p.side, "buy"); assert.equal(p.sym, "BTC");
  assert.equal(p.entry, 83200); assert.equal(p.sl, 82500); assert.equal(p.tp, 84500);
  assert.equal(p.plan, true); assert.equal(p.nota, "OB 1H, entrada IFVG 1min");
  const v = D.parseLine("venta oro 4170,5 sl 4185");
  assert.equal(v.side, "sell"); assert.equal(v.sym, "XAU"); assert.equal(v.entry, 4170.5); assert.equal(v.tp, null);
  assert.equal(D.parseLine("compra sol sl 105").entry, null);
  assert.equal(D.parseLine("compra dow 51600 sl 51500 salida 51750").exit, 51750);
  assert.equal(D.parseLine("cerrar 3 83900").cmd, "close");
  assert.equal(D.parseLine("plan 3 no").plan, false);
  assert.equal(D.parseLine("hola"), null);
});

test("R con comisión: cripto paga 0,1 %, índices no", () => {
  const t = { sym: "BTC", side: "buy", entry: 100, sl0: 99 };
  assert.ok(Math.abs(D.rOf(t, 102) - (2 - 0.1)) < 1e-9);
  assert.ok(Math.abs(D.rOf({ ...t, sym: "YM" }, 102) - 2) < 1e-9);
  assert.ok(Math.abs(D.rOf({ sym: "YM", side: "sell", entry: 100, sl0: 101 }, 101) + 1) < 1e-9);
});

test("rechaza sin stop o con stop del lado equivocado", () => {
  S.BTC.price = 83000; S.BTC.lastRecv = Date.now();
  assert.equal(D.openTrade(D.parseLine("compra btc 83000 tp 84000")).ok, false);
  assert.equal(D.openTrade(D.parseLine("compra btc 83000 sl 83500")).ok, false);
});

test("abre, sigue el precio y cierra solo en la meta", () => {
  const t0 = Date.now();
  S.SOL.price = 107; S.SOL.lastRecv = t0;
  const r = D.openTrade(D.parseLine("compra sol 107 sl 105 tp 111"), t0);
  assert.equal(r.ok, true);
  S.SOL.price = 109; S.SOL.lastRecv = t0 + 5000; D.diarioTick(t0 + 5000);
  assert.equal(kvGet("diario").open.length, 1);
  S.SOL.price = 111.2; S.SOL.lastRecv = t0 + 10000; D.diarioTick(t0 + 10000);
  const d = kvGet("diario"), c = d.closed[0];
  assert.equal(d.open.length, 0); assert.equal(c.how, "meta"); assert.equal(c.exit, 111);
  assert.ok(Math.abs(c.r - (2 - 0.001 * 107 / 2)) < 1e-9);
  assert.ok(Math.abs(c.usd - c.r * 100) < 1e-9);
});

test("índices: sigue con futuros ajustados a tu precio y cierra en el stop", () => {
  const t0 = Date.now();
  IDX.YM = { price: 51650, t: t0 };
  const r = D.openTrade(D.parseLine("venta dow 51600 sl 51700 tp 51400"), t0);
  assert.equal(r.ok, true);
  IDX.YM = { price: 51760, t: t0 + 5000 }; D.diarioTick(t0 + 5000);   // ajustado 51.710 ≥ 51.700 → stop
  const c = kvGet("diario").closed[0];
  assert.equal(c.how, "stop"); assert.equal(c.r, -1);
});

test("anota una ya cerrada y avisa al pasar de 2 operaciones en el día", () => {
  const r = D.openTrade(D.parseLine("compra btc 83000 sl 82000 salida 84000 plan no"));
  assert.equal(r.ok, true); assert.match(r.txt, /Operación #3 de hoy/);
  assert.match(D.diarioText(), /Plan NO seguido: 1/);
});
