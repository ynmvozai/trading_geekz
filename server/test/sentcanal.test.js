// v4.18 · #sentimiento: lectura de la multitud y texto de la lista por par.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
openStore(":memory:");
const { crowdRead, listText } = await import("../src/sentcanal.js");

test("lectura de la multitud por % de cuentas en largo y funding", () => {
  assert.equal(crowdRead({ longPct: 70, funding: 0.01 }).tag, "multitud larga");
  assert.equal(crowdRead({ longPct: 61, funding: 0.05 }).tag, "multitud larga");
  assert.equal(crowdRead({ longPct: 30 }).tag, "multitud corta");
  assert.equal(crowdRead({ longPct: 38, funding: -0.02 }).tag, "multitud corta");
  assert.equal(crowdRead({ longPct: 57, funding: 0.01 }).tag, "inclinada a largos");
  assert.equal(crowdRead({ longPct: 43 }).tag, "inclinada a cortos");
  assert.equal(crowdRead({ longPct: 50 }).tag, "equilibrada");
  assert.equal(crowdRead({}).tag, "sin dato");
});

test("la lista trae los 5 pares y dice sin dato cuando falta", () => {
  const t = listText({ BTC: { longPct: 66, topRatio: 1.8, funding: 0.012 }, SOL: {}, XAU: { longPct: 48, funding: 0.005 } },
    { crypto: { v: 30, label: "Miedo", prev: 28 }, stocks: null }, Date.UTC(2026, 9, 13, 13, 5));
  for (const n of ["Bitcoin", "Solana", "Oro", "Dow", "Nasdaq"]) assert.ok(t.includes("**" + n + "**"), n);
  assert.ok(t.includes("Cuentas en largo 66%"));
  assert.ok(t.includes("sin dato de posicionamiento"));
  assert.ok(t.includes("F&G acciones EE. UU. sin dato"));
  assert.ok(t.length < 2000);
});
