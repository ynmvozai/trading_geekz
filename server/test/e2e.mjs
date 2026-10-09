// Prueba de punta a punta en local: Binance y Discord falsos (solo para probar el cableado).
// Uso: node test/e2e.mjs
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

const got = [];
const rest = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    if (req.url.startsWith("/hook/")) { got.push({ ch: req.url.split("/")[2].split("?")[0], body: JSON.parse(b) }); res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
    if (req.url.startsWith("/fapi/v1/ping")) { res.writeHead(200); return res.end("{}"); }
    res.writeHead(200, { "content-type": "application/json" }); res.end("[]");
  });
}).listen(9102);
const wss = new WebSocketServer({ port: 9101 });
wss.on("connection", (ws) => {
  let T = Date.now();
  const send = (s, p, q, m) => ws.send(JSON.stringify({ stream: s + "@aggTrade", data: { p: String(p), q: String(q), T: (T += 50), m } }));
  const iv = setInterval(() => { send("btcusdt", 100200, 0.01, false); send("xauusdt", 4150, 0.1, true); send("solusdt", 200, 1, false); }, 200);
  setTimeout(() => { for (let i = 0; i < 4; i++) send("btcusdt", 100200, 10, true); }, 3000);   // venta $4M dentro de la zona BTC
  setTimeout(() => { for (let i = 0; i < 4; i++) send("xauusdt", 4140, 200, true); }, 4000);    // venta $3.3M cerca de la zona de oro
  ws.on("close", () => clearInterval(iv));
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hz-"));
const H = "http://127.0.0.1:9102/hook/";
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/index.js"], {
  env: { ...process.env, PORT: "9103", DATA_DIR: dir, BINANCE_WS: "ws://127.0.0.1:9101/market/stream", BINANCE_REST: "http://127.0.0.1:9102",
    WEBHOOK_CRYPTO: H + "crypto", WEBHOOK_ORO: H + "oro", WEBHOOK_AGENT: H + "agent", WEBHOOK_AICRYPTO: H + "aicrypto", DISCORD_BOT_TOKEN: "", ANTHROPIC_API_KEY: "" },
  stdio: ["ignore", "inherit", "inherit"],
});
// Zonas cargadas antes de arrancar (como si Yasser hubiera usado "cargar zonas").
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(path.join(dir, "hotzone.db"));
db.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
db.prepare("INSERT OR REPLACE INTO kv VALUES('zones',?)").run(JSON.stringify([
  { sym: "BTC", name: "Order block 1H", grade: "A++", side: "sell", lo: 100000, hi: 100500, sl: 101000, tp1: 99000, tp2: 98000 },
  { sym: "XAU", name: "Fair value gap 4H", grade: "B", side: "sell", lo: 4155, hi: 4170, sl: 4180, tp1: 4100, tp2: 4080 }]));
db.close();

await new Promise((r) => setTimeout(r, 23000));
const h = await (await fetch("http://127.0.0.1:9103/health")).json();
const st = await (await fetch("http://127.0.0.1:9103/state")).json();
child.kill("SIGTERM"); wss.close(); rest.close();
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) process.exitCode = 1; };
const crypto = got.filter((g) => g.ch === "crypto"), oro = got.filter((g) => g.ch === "oro"), ag = got.filter((g) => g.ch === "agent");
ok(crypto.some((g) => /^HOT ZONE · BTC · VENTA \$4\.01M/.test(g.body.content)), "alerta HOT ZONE BTC a #cryptoman: " + (crypto[0] && crypto[0].body.content));
ok(oro.some((g) => /^CERCA DE ZONA \(\d+\.\d\d%\) · XAU · VENTA/.test(g.body.content)), "alerta CERCA DE ZONA oro a #oro: " + (oro[0] && oro[0].body.content));
ok(got.some((g) => g.ch === "aicrypto" && /SEÑAL REAL · ENTRADA/.test(g.body.content)), "señal Ai Crypto a #ai-crypto");
ok(ag.some((g) => /Servidor Hot Zone encendido/.test(g.body.content)), "mensaje de arranque en #agent");
ok(h.ok && h.mercados.BTC.precio === 100200 && h.binance.conectado, "/health ok con precio y conexión");
ok(st.zonas.length === 2 && st.ordenes.length >= 2, "/state con zonas y órdenes");
console.log(ag.map((g) => g.body.content).join("\n---\n").slice(0, 1500));
