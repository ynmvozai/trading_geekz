// v4.39 · Historial de zonas y filtro de meta a menos de 1R.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore, zoneLogSince, zoneLogCount } from "../src/store.js";
openStore(":memory:");
const { metaCorta, measuredStop } = await import("../src/risk.js");
const { Z, setZones, checkBroken } = await import("../src/zones.js");
const { recordAlert } = await import("../src/results.js");
const { setIdxZones } = await import("../src/sesionny.js");

test("metaCorta: usa el stop medido en cripto y el de la zona en índices", () => {
  // BTC venta, zona 100–101: stop medido 101 × 1.005 = 101.505; entrada en el borde 100 → riesgo 1.505
  const z = { sym: "BTC", side: "sell", lo: 100, hi: 101, sl: 101.2, tp1: 99, tp2: 0 };
  assert.ok(Math.abs(measuredStop("BTC", "sell", 100, 101) - 101.505) < 1e-9);
  assert.equal(metaCorta("BTC", z), true);                       // gana 1.0 < 1.505
  assert.equal(metaCorta("BTC", { ...z, tp1: 98.4 }), false);    // gana 1.6 ≥ 1.505
  assert.equal(metaCorta("BTC", { ...z, tp1: 98.4 }, 100.5), false); // entrada 100.5: gana 2.1, riesgo 1.005
  assert.equal(metaCorta("BTC", { ...z, tp1: 0 }), false);       // sin meta no se juzga
  // Compra en índice (sin stop medido): usa el stop de la zona
  const i = { sym: "US30", side: "buy", lo: 50000, hi: 50100, sl: 49900, tp1: 50250 };
  assert.equal(metaCorta("US30", i), true);                      // entrada 50100: gana 150 < riesgo 200
  assert.equal(metaCorta("US30", { ...i, tp1: 50300 }), false);  // gana 200 = riesgo 200 → 1R exacto pasa
  assert.equal(metaCorta("US30", { ...i, sl: 0 }), false);       // sin stop no se juzga
});

test("recordAlert no sigue una señal con la meta a menos de 1R", () => {
  const z = { sym: "XAU", name: "OB 1H", grade: "A", side: "buy", lo: 3990, hi: 4000, sl: 3940, tp1: 4020, tp2: 0 };
  const a = recordAlert({ t: 1, sym: "XAU", kind: "precio_en_zona", z, entry: 4000, prox: 100 });
  assert.equal(a.track, 0); assert.equal(a.status, "meta corta");
  const b = recordAlert({ t: 2, sym: "XAU", kind: "precio_en_zona", z: { ...z, lo: 3991, tp1: 4100 }, entry: 4000, prox: 100 });
  assert.equal(b.track, 1); assert.equal(b.status, "abierta");
});

test("historial: cada zona marcada y cada zona rota quedan guardadas con precio", () => {
  const n0 = zoneLogCount();
  Z.priceOf = (s) => (s === "BTC" ? 70000 : null);
  setZones([{ sym: "BTC", name: "FVG 4H", grade: "A", side: "sell", lo: 71000, hi: 71500, sl: 72000, tp1: 69000, tp2: 68000 },
            { sym: "SOL", name: "OB 1H", grade: "B", side: "buy", lo: 78, hi: 79, sl: 77, tp1: 82, tp2: 0 }], "Ai");
  assert.equal(zoneLogCount(), n0 + 2);
  setZones(Z.list.slice(0, 1), "zona borrada");                  // borrar no añade al historial
  assert.equal(zoneLogCount(), n0 + 2);
  const rows = zoneLogSince(0), btc = rows.find((r) => r.sym === "BTC" && r.ev === "marcada");
  assert.equal(btc.source, "Ai"); assert.equal(btc.price, 70000); assert.equal(btc.lo, 71000); assert.equal(btc.tp1, 69000);
  assert.equal(rows.find((r) => r.sym === "SOL").price, null);
  assert.equal(checkBroken("BTC", 72001, 123456).length, 1);
  const rota = zoneLogSince(0).find((r) => r.ev === "rota");
  assert.equal(rota.sym, "BTC"); assert.equal(rota.price, 72001); assert.equal(rota.t, 123456);
  assert.equal(zoneLogCount(), n0 + 2);                          // las rotas no cuentan como marcadas
});

test("historial: las zonas de índices también se guardan", () => {
  const n0 = zoneLogCount();
  assert.equal(setIdxZones([{ sym: "US30", name: "OB diario", side: "sell", lo: 52000, hi: 52800, sl: 53000, tp1: 51500 }]), 1);
  assert.equal(zoneLogCount(), n0 + 1);
  assert.equal(zoneLogSince(0).at(-1).source, "índices");
});
