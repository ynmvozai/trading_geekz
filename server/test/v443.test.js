// v4.43 · Ai Crypto: grado A o A++, 1 entrada por zona por día.
import { test } from "node:test";
import assert from "node:assert/strict";
const { simGradeOk, simZoneUsedToday } = await import("../src/alerts.js");

test("Ai Crypto acepta A y A++, no B", () => {
  assert.equal(simGradeOk("A++"), true); assert.equal(simGradeOk("A"), true); assert.equal(simGradeOk("B"), false);
});
test("una entrada por zona por día (hora PR)", () => {
  const z = { name: "Order block 1H", lo: 100000 }, t0 = Date.UTC(2026, 10, 16, 15, 0);
  const closedToday = { open: [], closed: [{ sym: "BTC", zname: z.name, lo: z.lo, t: t0 - 3600000 }] };
  assert.equal(simZoneUsedToday(closedToday, "BTC", z, t0), true);
  assert.equal(simZoneUsedToday(closedToday, "BTC", z, t0 + 86400000), false);   // al día siguiente sí
  assert.equal(simZoneUsedToday(closedToday, "SOL", z, t0), false);
  assert.equal(simZoneUsedToday({ open: [{ sym: "BTC", zname: z.name, lo: z.lo, t: t0 - 3 * 86400000 }], closed: [] }, "BTC", z, t0), true);   // sigue abierta
});
