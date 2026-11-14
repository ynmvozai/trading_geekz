// v4.42 · auditoría 14 nov: resumen de ballenas, hora de #sentimiento, R con comisión.
import { test } from "node:test";
import assert from "node:assert/strict";
const MG = await import("../src/mega.js");
const { netR } = await import("../src/results.js");
const { listText } = await import("../src/sentcanal.js");

test("resumen de ballenas agrupa por mercado y lado sin sumar dos veces", () => {
  const txt = MG.digestText([
    { sym: "BTC", kind: "order", side: "buy", usd: 30e6, price: 100000 },
    { sym: "BTC", kind: "order", side: "buy", usd: 45e6, price: 100100 },
    { sym: "BTC", kind: "liq", side: "long", usd: 6e6, price: 99900 },
    { sym: "SOL", kind: "order", side: "sell", usd: 9e6, price: 200 },
  ]);
  assert.match(txt, /^🐳 \*\*Resumen de ballenas · últimos 15 min\*\*/);
  assert.match(txt, /\*\*Bitcoin\*\* · 🟢 compras: 2 avisos, la mayor \$45\.00M · 💥 liquidaron largos \$6\.00M/);
  assert.match(txt, /\*\*Solana\*\* · 🔴 ventas: 1 aviso/);
  assert.equal(MG.digestText([]), null);
});

test("nivel 2 va al resumen; flushDigest vacía la cola", async () => {
  const before = MG.MG.queued, t0 = 1.9e12;
  const txt = MG.onBurst({ sym: "BTC", side: "buy", usd: 45e6, first: t0 }, 100000, t0);
  assert.ok(txt);
  assert.equal(MG.MG.queued, before + 1);
});

test("R con comisión descuenta 0,1 % del precio sobre la distancia al stop", () => {
  assert.equal(netR({ r: 2, entry: 100, sl: 99 }), 2 - 0.1);
  assert.equal(netR({ r: -1, entry: 100000, sl: 99500 }), -1.2);
});

test("#sentimiento aclara que la hora es la del último dato", () => {
  const t = listText({ BTC: {}, SOL: {}, XAU: {} }, { crypto: null, stocks: null }, Date.UTC(2026, 10, 14, 12, 25));
  assert.match(t, /datos de las 08:25 \(hora PR\)/);
  assert.match(t, /se edita solo cada 15 min/);
});
