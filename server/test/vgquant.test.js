// v4.14 · VG QUANT: lectura del mensaje (texto de Discord y JSON) y regla de seguimiento fija.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore, kvGet } from "../src/store.js";
openStore(":memory:");
const { parseVg, recordVg, vgTick } = await import("../src/vgquant.js");
const { IDX } = await import("../src/macro.js");

const SAMPLE = "🚨 **VG QUANT** · DJ30 240 · precio entró en OFERTA (se espera que BAJE) · zona 51998.35 – 52300.90 · probabilidad 78% · sesión Asia · precio 51999.25";

test("lee el mensaje de Discord tal como llega", () => {
  const r = parseVg(SAMPLE);
  assert.equal(r.ok, true);
  assert.equal(r.alert.sym, "YM");
  assert.equal(r.alert.tf, "240");
  assert.equal(r.alert.dir, "baja");
  assert.equal(r.alert.lo, 51998.35);
  assert.equal(r.alert.hi, 52300.9);
  assert.equal(r.alert.prob, 78);
  assert.equal(r.alert.session, "Asia");
  assert.equal(r.alert.price, 51999.25);
});

test("lee JSON y acepta DEMANDA/sube", () => {
  const r = parseVg(JSON.stringify({ sym: "USTEC", tf: "60", dir: "DEMANDA", lo: "20100.5", hi: "20150", prob: 0.64, price: 20120 }));
  assert.equal(r.ok, true);
  assert.equal(r.alert.sym, "NQ");
  assert.equal(r.alert.dir, "sube");
  assert.equal(r.alert.prob, 64);
});

test("rechaza símbolo, dirección o zona inválidos", () => {
  assert.equal(parseVg(SAMPLE.replace("DJ30", "BTC")).ok, false);
  assert.equal(parseVg(SAMPLE.replace("OFERTA", "algo")).ok, false);
  assert.equal(parseVg(SAMPLE.replace("51998.35 – 52300.90", "52300.90 – 52300.90")).ok, false);
});

test("oferta: acierta si baja un ancho de zona bajo su borde inferior; falla si cierra arriba", () => {
  const t0 = Date.UTC(2026, 9, 13, 12);
  IDX.YM = { price: 51999.25, t: t0 };
  const a = recordVg(parseVg(SAMPLE).alert, t0).rec;
  const b = recordVg({ ...parseVg(SAMPLE).alert, lo: 52000, hi: 52100 }, t0 + 1000).rec;
  IDX.YM = { price: 51999, t: t0 + 60000 };         // ni a ni b
  vgTick(t0 + 60000);
  IDX.YM = { price: 52101, t: t0 + 120000 };         // b: por encima de 52100 → falla; a sigue abierta
  vgTick(t0 + 120000);
  IDX.YM = { price: 51690, t: t0 + 180000 };         // a: ≤ 51998.35 − 302.55 = 51695.80 → acierta
  vgTick(t0 + 180000);
  const state = kvGet("vgq", []);
  assert.equal(state.find((x) => x.id === a.id).status, "acierta");
  assert.equal(state.find((x) => x.id === b.id).status, "falla");
});

test("duplicado dentro de 60 min no se registra dos veces", () => {
  const t0 = Date.UTC(2026, 9, 13, 14);
  const r1 = recordVg(parseVg(SAMPLE).alert, t0);
  const r2 = recordVg(parseVg(SAMPLE).alert, t0 + 5 * 60000);
  assert.equal(r2.dup, true);
  assert.equal(r2.id, r1.id);
});

test("v4.16: modo prueba lee sin registrar; mensaje ilegible se reenvía igual", async () => {
  const { onVg } = await import("../src/vgquant.js");
  const antes = (kvGet("vgq", []) || []).length;
  const t = onVg(JSON.stringify({ test: true, sym: "DJ30", tf: "240", dir: "OFERTA", lo: 1, hi: 2 }));
  assert.equal(t.prueba, true); assert.equal(t.ok, true); assert.equal(t.leido.sym, "YM");
  assert.equal((kvGet("vgq", []) || []).length, antes);
  const r = onVg("🚨 VG QUANT · Zona 1 · mensaje con otro formato");
  assert.equal(r.ok, true); assert.equal(r.reenviado, true); assert.equal(r.seguimiento, false);
  assert.equal((kvGet("vgq", []) || []).length, antes);
});
