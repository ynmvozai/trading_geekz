# Hot Zone 24/7 · servidor (Trading_GeeKz · Visionary_GeeKz)

Servicio Node.js que corre en la nube sin depender de la Mac: lee las órdenes reales de Binance futuros,
las compara con las zonas y manda alertas a Discord. **Solo analiza y alerta. Nunca opera dinero.**

## Qué hace
- **Binance** `aggTrade` de BTCUSDT, SOLUSDT, XAUUSDT por WebSocket, con reconexión (espera creciente) y aviso en #agent si pasan 2 min sin datos.
- **Órdenes**: suma de fills del mismo lado en 250 ms. Mínimos BTC $3M, SOL $1M, XAU $3M (máximo $6M). Guarda las de $250K+ de 24 h.
- **Alertas** a #cryptoman (BTC, SOL) y #oro-índice (XAU): orden en zona (`HOT ZONE`) o cerca (`CERCA DE ZONA (xx.xx%)`, radio BTC 1.5% · SOL 3% · XAU 1%).
- **Vigilancia**: resumen 🎯 cada hora de 6:00 a 22:00 (hora de PR) y al arrancar; avisos 🔥 80% y 🎯 100% (30 min de espera por zona).
- **Ai Crypto**: señales con precio real a #ai-crypto (sin ejecutar).
- **TITO** (Claude) en #agent, mapa diario 7:48 AM (hora de PR), comandos de control.
- **Historial de señales**: cada alerta se guarda y se sigue hasta TP1, TP2 o SL (48 h máximo). Comando `resultados` y resumen cada domingo 6:00 PM.
- **HTTP**: `/health` (503 si no hay datos de Binance en 3 min, para UptimeRobot), `/alive` (para Railway), `/state` (para el panel), `/` (panel v3.0 de solo lectura).

## Comandos en #agent
`estado` · `zonas` · `precio` · `ordenes` · `flujo` · `link` · `vigilancia` · `resultados [días]` · `check <dirección>`
Solo dueño: `pausar alertas` · `reanudar alertas` · `cargar zonas <json o enlace #z=>` · `borrar zona <n>` (pide "sí") · `reiniciar` · `mapa diario apagar|encender`
Cualquier otra pregunta → TITO. `actualiza zonas` → TITO recalcula y el servidor guarda las zonas.

## Variables de entorno
Ver `.env.example`. Nunca en el código ni en Git.

## Correr en la Mac
```
cd server && cp .env.example .env   # pega tus valores
npm install && npm start
npm test                              # pruebas de la lógica
node test/e2e.mjs                     # prueba de punta a punta con Binance/Discord falsos locales
```
(Node 22.13 o más nuevo. `npm start` lee las variables del entorno; para usar `.env`: `node --env-file=.env src/index.js`.)

## Despliegue (Railway)
- Repo `ynmvozai/trading_geekz`, **Root Directory** `/server`, **Config file** `/server/railway.json` (región Ámsterdam, healthcheck `/alive`, reinicio siempre, watch `server/**`).
- **Volumen** montado en `/data` (la base de datos sobrevive reinicios y despliegues).
- Región **fuera de EE. UU.** (Binance bloquea EE. UU.).

## Archivos
`src/binance.js` WebSocket y velas · `src/market.js` órdenes 250 ms, flujo, feed · `src/zones.js` zonas y proximidad ·
`src/alerts.js` alertas, vigilancia, Ai Crypto · `src/results.js` historial TP/SL · `src/discord.js` webhooks (cola + 429) y bot gateway ·
`src/tito.js` Claude · `src/commands.js` comandos · `src/health.js` HTTP y estado · `src/store.js` SQLite · `src/prompts.js` prompts copiados del panel (`npm run prompts`).
