# CONTINUAR · estado del proyecto Hot Zone 24/7

_Última actualización: 10 oct 2026._ Lee esto primero si eres una sesión nueva de Claude Code.

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
- Monitor de caída activo: secreto `WEBHOOK_AGENT` en GitHub y primera corrida manual en verde (6 s).

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


## v3.1 · Sentimiento Fear & Greed (10 oct 2026)
- Nuevo `src/sentiment.js`: crypto (BTC/SOL) de `api.alternative.me/fng` y referencia de acciones EE. UU. (para oro) de CNN `production.dataviz.cnn.io/index/fearandgreed/graphdata`. Se refresca cada 30 min; si falla, "sin dato" (nunca se rellena).
- Aparece en: alertas (campo "Sentimiento · Fear & Greed" con lectura contraria por zona), resumen de vigilancia (línea 🧭 y etiqueta ✅/⚠️/⚪ por zona), `estado`, `/state`, comando `sentimiento` en #agent y contexto de TITO (nota añadida en `tito.js`, sin tocar `prompts.js`).
- Historial: columnas nuevas `fg` y `fg_read` en `alerts` (migración automática). `resultados` separa "Sentimiento a favor / neutral / en contra" para medir si mejora los aciertos en 2–4 semanas. Por ahora solo etiqueta, no filtra.
- Pendiente idea de Yasser: sesgo de temporalidad mayor (4H/diario/semanal) con order flow (CVD, open interest, funding). No implementado aún.

## v3.2 · Plan de sesión NY, calendario e índices (10 oct 2026)
- `src/sesion.js`: plan de la sesión de Nueva York automático L-V 8:15 AM hora de NY (`etParts`, cambia solo con el horario de invierno). TITO usa velas diarias + 4H/1H, índices, calendario y Fear & Greed; responde en secciones `[[RESUMEN]] [[CRYPTO]] [[ORO]] [[INDICES]]` + bloque JSON de zonas (se cargan con `applyAiZones`). Envío: crypto → WEBHOOK_CRYPTO, oro → WEBHOOK_ORO, índices → **WEBHOOK_INDICES** (nueva variable; sin ella va a #agent), resumen → #agent.
- `src/macro.js`: calendario USD (Forex Factory `ff_calendar_thisweek/nextweek.json`, impacto medio/alto) cada 3 h, aviso automático 30 min antes de cada noticia de alto impacto a #cryptoman, #oro-índice, #indices-zonas y #agent; índices YM=F y NQ=F de Yahoo (fallback Stooq diario) cada 15 min. Todo con "sin dato" si falla.
- Comandos: `plan ny` (a pedido), `plan ny apagar/encender` (dueño), `calendario` / `noticias`. `estado` muestra calendario, índices y plan.
- TITO recibe `calendario_usd_7_dias` en el payload y una nota que reemplaza "no tienes calendario".
- Ojo costo: el plan NY (8:15) y el mapa diario (7:48) llaman a Claude cada uno. Si Yasser quiere uno solo: `mapa diario apagar`.
- Fuentes Yahoo/Stooq no se pudieron probar desde el entorno de desarrollo (bloqueadas); verificar con `estado` en Railway.

## v3.3 · Canal #sesion-ny (10 oct 2026)
- Canal creado en Discord: `#sesion-ny` (categoría ALERTAS, id `1558528510354788392`, variable `SESION_CHANNEL_ID`).
- `src/sesionny.js`: activo L-V de 9:00 AM a 5:30 PM hora de PR (ventana fija en PR); open (9:30 AM ET) y cierre (4:00 PM ET) en hora de NY (`etParts` en util.js), así el cambio de horario se ajusta solo.
  Publica: pre-apertura (9:00 PR), OPEN de NY, radar compacto cada hora (10:30–3:30 ET), CIERRE de NY con zonas tocadas, alertas 80%/100% de los 5 mercados y copia de las alertas de órdenes grandes en zona.
  BTC/SOL/Oro: zonas + órdenes grandes reales (dónde quedaron respecto al precio y a la zona). US30/NAS100: solo zonas (sin órdenes en vivo), zonas guardadas en kv `idxZones` desde el plan NY.
- Envío: `WEBHOOK_SESION` si existe; si no, el bot por REST (`DISCORD_BOT_TOKEN` + id del canal). Si el bot no tiene permiso, `estado` lo dice (HTTP 403).
- Comandos: `radar` (en #agent) y `probar sesion` (manda una prueba a #sesion-ny).

## v3.4 · Índices desde TradingView (10 oct 2026)
- En Railway, Yahoo (429) y Stooq (403) bloquean. Solución: alertas de TradingView de Yasser (DJ30 y USTEC, 5 min, "Once per bar close") hacen POST a `/tv/<secreto>` con `{"s":"{{ticker}}","o":{{open}},"h":{{high}},"l":{{low}},"c":{{close}},"t":"{{time}}"}`.
- El secreto se genera solo (kv `tvSecret`); el dueño lo ve con `tv url` en #agent. El servidor guarda velas de 5 min (2 días), arma 1H y diarias (60 días) y llena `IDX.YM` / `IDX.NQ` (fuente "TradingView"). Yahoo/Stooq quedan de respaldo.
- La historia diaria de índices se llena con los días: al principio TITO tendrá poca historia.

## v3.5 · #indices-zonas sin webhook (10 oct 2026)
- `idxPost` (discord.js): usa `WEBHOOK_INDICES` si existe; si no, el bot publica por REST en el canal `INDICES_CHANNEL_ID` (default `1557713241722069072`). Lo mismo que #sesion-ny. Así Yasser no tiene que copiar webhooks.
- `probar sesion` prueba #sesion-ny y #indices-zonas y dice si falta permiso (403).

## v3.6 · TradingView sin secreto (10 oct 2026)
- `POST /tv` acepta solo las IPs oficiales de TradingView (52.89.214.238, 34.212.75.30, 54.218.53.128, 52.32.178.7; se lee la última IP de X-Forwarded-For) y descarta precios que se alejen más de 8% del último. `/tv/<secreto>` sigue funcionando.
- Así las alertas de TradingView se configuran con `https://tradinggeekz-production.up.railway.app/tv` sin manejar secretos. `estado` muestra recibidos/rechazados y la última IP rechazada (por si Railway cambia el encabezado).
