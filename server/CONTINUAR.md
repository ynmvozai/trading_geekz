# CONTINUAR · estado del proyecto Hot Zone 24/7

_Última actualización: 9 oct 2026._ Lee esto primero si eres una sesión nueva de Claude Code.

## Contexto rápido
- Dueño: Yasser Nieves (Visionary_GeeKz). Habla español, no es programador, maneja todo desde el iPhone.
- Reglas: data real siempre, nunca operar dinero, secretos solo en variables de entorno, "Ai" (nunca AI/IA), "Visionary_GeeKz".
- Fuente de verdad de la lógica: `../index.html` (panel v2.4, publicado en GitHub Pages). **No tocar `index.html` sin aprobación.**
- El servidor vive en `server/`. Prompts de TITO se copian del HTML con `npm run prompts` (no editarlos a mano).

## Hecho (código)
- [x] Fase 0: lectura del panel, estructura `server/`.
- [x] Fase 1: Binance → órdenes 250 ms → zonas (en SQLite) → Discord, reconexión, aviso de 2 min sin datos, `cargar zonas`.
- [x] Fase 2: bot por gateway (#agent), todos los comandos, TITO con reintentos, mapa diario 7:48 AM.
- [x] Fase 3 (código): `/health`, `/alive`, `/state`, `railway.json`, panel v3.0 de solo lectura en `server/panel/index.html`.
- [x] Fase 4: historial de señales TP1/TP2/SL (48 h), `resultados`, resumen de los domingos.
- [x] Pruebas: `npm test` (lógica) y `node test/e2e.mjs` (punta a punta con Binance/Discord falsos locales) pasan.

## Despliegue (estado 9 oct 2026)
- Código en `main` (index.html sin cambios). Yasser aprobó: pasar a main, plan Hobby de Railway ($5/mes), que Claude haga el despliegue.
- **Bloqueo**: la red del entorno de Claude Code no deja salir a `backboard.railway.com`, `discord.com`, `*.up.railway.app` ni `api.uptimerobot.com`.
  Yasser tiene que permitir esos dominios en el entorno (menú del entorno → Edit → Network access). Si no aplica en esta sesión, abrir una nueva en el mismo entorno.
- Script listo: `RAILWAY_TOKEN=... node server/scripts/railway-deploy.mjs crear` (proyecto, servicio desde GitHub, root /server, config, Ámsterdam, volumen /data, dominio; imprime el enlace de Variables).
  Luego `estado`, `desplegar`, `agent` (lee #agent con el token del bot guardado en Railway, sin imprimirlo), `region asia-southeast1-eqsg3a` si hay 451.
  Los ids (no secretos) quedan en `server/scripts/.railway-ids.json` (ignorado por git).
- Aviso de caída: `.github/workflows/hotzone-monitor.yml` (GitHub Actions cada 5 min → #agent). Necesita variable `HOTZONE_URL` y secreto `WEBHOOK_AGENT` en GitHub.
  Ojo: GitHub apaga los cron de repos sin actividad en 60 días.

## En vivo (9 oct 2026, 7:27 PM PR)
- Railway: proyecto/servicio `trading_geekz`, volumen /data, 6 variables + TZ, dominio `tradinggeekz-production.up.railway.app` (Yasser lo configuró con la extensión de Chrome).
- Prueba real: resumen "Zonas en vigilancia" llegó a #cryptoman y #oro-índice; TITO (bot OracleGeekz) contestó en #agent con precios reales de Binance (BTC 82,579 · SOL 109.18 · XAU 4,196.49) y retraso 71/194/187 ms.
- Problema: las velas REST (fapi.binance.com/klines) llegaron "sin datos" → TITO no pudo calcular zonas. Lo más probable: la región del servicio no quedó en Ámsterdam (Binance bloquea REST desde EE. UU. con 451; el WebSocket sí pasa).
  Arreglo: Settings → Deploy → Regions → EU West (Amsterdam). `estado` ahora muestra la línea "Velas de Binance (REST)" con el error y la región.
- Desde el contenedor de Claude Code no se puede abrir el dominio (red bloqueada), así que la verificación se hace por Discord (`estado`).

## Resuelto (9 oct 2026, noche)
- Región cambiada a EU West (Amsterdam, `europe-west4-drams3a`). `estado`: "Velas de Binance: ok".
- `actualiza zonas`: TITO cargó 8 zonas reales (BTC, SOL, XAU) con SL/TP. Las alertas ya las usan.
- Monitor de caída: URL fija en el workflow; falta solo el secreto `WEBHOOK_AGENT` en GitHub.

## Falta (necesita a Yasser o a la nube)
- [ ] Probar con Binance y Discord reales: el contenedor de Claude Code no tiene salida a esos sitios. Se prueba en Railway.
- [ ] Crear el servicio en Railway (región Ámsterdam, volumen `/data`, variables) y verificar: mensaje "Servidor Hot Zone encendido" en #agent, alerta real en #cryptoman/#oro.
- [ ] Cargar zonas (`actualiza zonas` o `cargar zonas`).
- [ ] UptimeRobot vigilando `https://<servidor>/health`.
- [ ] Cerrar la pestaña del panel viejo en la Mac cuando el servidor envíe (evita alertas dobles).
- [ ] Con aprobación de Yasser: reemplazar `index.html` por el panel v3.0 de solo lectura (apuntando a `?api=https://<servidor>`).
- [ ] Decidir con Yasser si se apaga la tarea programada de las 7:48 AM (el servidor ya hace el mapa diario; se apaga en el servidor con `mapa diario apagar`).
- [ ] Canal `#resultados` + variable `WEBHOOK_RESULTADOS` (opcional; sin ella el resumen va a #agent).

## Decisiones tomadas
- SQLite con `node:sqlite` (sin compilación nativa). Requiere Node ≥ 22.13.
- Comandos de control solo para el dueño del servidor de Discord (o `OWNER_IDS`).
- Historial: una señal seguida por zona a la vez (las repetidas se guardan como "repetida"); si SL y TP caen en la misma vela de 1 min tras un corte, cuenta SL. Señales con SL/TP que no cuadran con el precio: "sin niveles", no cuentan.
- `reiniciar` sale con código 1 y Railway lo levanta (reinicio "ALWAYS").
