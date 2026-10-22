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

## v3.7 · CNBC para índices y #resultados (11 oct 2026)
- Índices: orden de fuentes = TradingView (si llega por /tv) → **CNBC** (`quote.cnbc.com` @DJ.1 / @ND.1, precio en vivo + apertura/máximo/mínimo del día) → Yahoo → Stooq. CNBC y TradingView guardan velas en la misma memoria (`tv5:`, `tvD:` en kv) con `storeIdxBar`.
- Canal `#resultados` creado (id `1558812052053688400`, `RESULTADOS_CHANNEL_ID`); el resumen del domingo 6 PM lo publica el bot ahí.

## v3.8 · Mensajes cortos y amigables (11 oct 2026)
- Pedido de Yasser: notificaciones "people friendly", sin mensajes largos. Piezas comunes en `src/friendly.js` (`dot`, `lado`, `espera`, `quien`, `rango`, `niveles`, `empuje`, `animo`, `animoTag`).
- Orden grande (`buildMessage`): texto plano de 4-6 líneas, sin embed: título (EN LA ZONA / CERCA DE ZONA %), quién empujó y cuánto, zona y hacia dónde se espera, SL/TP, si la orden va a favor o en contra de la zona, ánimo (Fear & Greed). Racha solo si hay 2+.
- Vigilancia por hora: una línea por zona (máx. 6). Alertas 80%/100%: "Bitcoin se acerca / entró a la zona de VENTA" + 3 líneas.
- #sesion-ny: tablero con 2-3 líneas por mercado (precio, zona más cercana, mayor orden y quién gana); radar 1 línea por mercado; títulos cortos ("Abrió / Cerró Nueva York").
- Ai Crypto: "Señal: VENDER Bitcoin a X" + SL/TP; resultado "llegó al TP / tocó SL".
- Plan NY (TITO): prompt pide lenguaje simple, máx. 700 caracteres por sección y cada zona en una línea.
- Próximo: tracking de wallets "whale" (Cielo vs tracker propio, Yasser decide).

## v3.9 · Formato aprobado por Yasser (11 oct 2026)
- Propuesta aprobada: https://claude.ai/artifact/C1CCojfdeWBYENXXoJsZqM. Regla clave: la 1.ª línea de cada alerta va SIN `**` ni `_` (las notificaciones del celular los muestran crudos). "🛑 Stop / 🎯 Meta" en vez de SL/TP, Bitcoin sin decimales y sin ".00" (`pf` en friendly.js), cercanía en palabras (lejos / a medio camino / muy cerca / dentro).
- Orden grande: "🐋 Bitcoin: ballena VENDIÓ $4.83M · 83,119" + "Dentro/Cerca de zona de VENTA → empuja a favor ✅" (o "⚠️ Ojo: empuja en contra…"). Agrupación: misma moneda + lado + zona en 2 min → un solo mensaje y luego "➕ siguen VENDIENDO · +$X en N órdenes más".
- Zona 80/100%: "🔴 Oro entró a zona de VENTA · precio". Resumen de cada hora solo si alguna zona está a ≥50% (`watchText` devuelve "" si no).
- #sesion-ny: tablero de 1 línea por mercado ordenado por cercanía + línea de ballenas; radar solo con mercados ≥50%; cierre con `closeText` (zonas tocadas, cambio desde el open, qué vigilar mañana). Índices se llaman "Dow" y "Nasdaq".
- Noticias: un solo aviso, en #sesion-ny dentro de su horario o en #agent fuera; nombre en español (`newsEs`).
- Ai Crypto: "🤖 Señal Ai: VENDER Bitcoin · precio" / "✅ Señal Ai ganó…" / "❌ Señal Ai tocó el stop…" + "📊 Récord: X de N ganadas".
- #agent: arranque y latido diario con `bootText` (solo lista lo que falla); `estado` sigue dando el detalle.
- #resultados (domingo 6 PM): `weeklyText(7)` amigable; el comando `resultados` mantiene el detalle.
- Plan NY: el prompt prohíbe siglas (BOS, FVG, OB, R) y fija el formato de una línea por zona.
- Pendiente aprobado en idea: alerta 🐳 mega ballena (sin importar zona) + liquidaciones grandes, y tracker propio de wallets de Solana (regla 3 de 10). Falta que Yasser confirme montos y lista de wallets / API key de Helius.

## v4.0 · #mega-ballenas y #wallet-tracking (11 oct 2026)
- Canal **#mega-ballenas** creado (id `1558942738181787748`, `MEGA_CHANNEL_ID`; o `WEBHOOK_MEGA`). Lo publica el bot y menciona al dueño (`OWNER_IDS[0]` o dueño del servidor) para que suene el celular.
- `src/mega.js`: montos por rangos (`MEGA` en config.js) · BTC 15M/40M/100M · SOL 5M/15M/40M · Oro 15M/40M/100M → 🐳 Mega ballena / 🐳🐳 Ballena gigante / 🚨 Orden histórica. Avisa una sola orden o la suma de órdenes del mismo lado en 60 s (solo cuentan órdenes ≥ 1/3 del mínimo de alerta). Avisa aunque el precio esté lejos de las zonas y dice la zona más cercana. No repite el mismo nivel en 5 min.
- Liquidaciones: stream `@forceOrder` de Binance (mismo WebSocket). Suma por lado en 5 min; aviso desde BTC $5M · SOL $2M · Oro $2M (`LIQ`); 🚨 y mención si es 4× o más.
- `src/wallets.js` → **#wallet-tracking** (id `1558158617411190865`, `WALLET_CHANNEL_ID`): wallets de Solana vía Helius. Con `HELIUS_API_KEY` en Railway el servidor crea/actualiza solo su webhook (tipo SWAP, enhanced) hacia `/helius/<secreto>`. Regla por defecto: 3+ wallets compran la misma moneda en 24 h → aviso con link de DexScreener. USD gastado = SOL que salió × precio real de SOL (Binance) o USDC/USDT. Comandos en #agent: `wallets`, `wallet agregar <dir> <nombre>`, `wallet quitar <nombre>`, `wallet regla <mín> <horas>`, `wallet solos on/off`, `probar mega`.
- Pendiente: Yasser crea la API key gratis en helius.dev y la pega en Railway (`HELIUS_API_KEY`); cargar la lista de wallets.

## v4.1 · Wallets sin Helius (11 oct 2026)
- Si no hay `HELIUS_API_KEY`, `pollWallets()` revisa cada 60 s la red pública de Solana (`SOLANA_RPC` o api.mainnet-beta.solana.com): `getSignaturesForAddress` + `getTransaction` (jsonParsed) y saca compras/ventas por cambio de saldos (`parseRpcTx`). La primera vuelta solo marca desde dónde empezar (no reenvía historia).
- Compras sueltas encendidas por defecto (`walletRule().solos = true`): un mensaje agrupado por vuelta "🟢 Cooker compró $X · $1.2K · 4:32 PM · cap $850K". Nombre, liquidez y cap de DexScreener (público, sin clave).
- Con `HELIUS_API_KEY` el webhook manda al instante y el sondeo se apaga solo.
- Pendiente (Yasser, en la Mac mini): clave de Helius en Railway, elegir regla del auditor (A estricta 1,000–5,000%/año x 3 años · B respaldo ≥300%/año), cargar wallets. Después: construir `wallet auditar <dirección>` (PnL por año desde la blockchain).

## v4.3 · Filtros de acierto + termómetro de sesgo (12 oct 2026)
- Diagnóstico con data real (`/senales`, 37 señales 10–12 oct): 5 ganadas / 30 perdidas. 26 entraron en zonas YA rotas (el precio había pasado su stop), 24 con stop a menos de medio ATR 1H, 16 con orden en contra de la zona, 16 "cerca" desde el lado equivocado. Con las 4 reglas solo pasaban 3 (1 ganada).
- a) Zonas rotas (`zones.js`): si el precio pasa el stop (o ±0.3 % del borde sin stop) la zona muere: no alerta, no cuenta, no sale en #sesion-ny; aviso "❌ … se rompió la zona" al canal del mercado. Guardado en kv `zbroken` / `zbrokenLog` (48 h).
- b) "Cerca" solo por el lado correcto: debajo de una zona de venta, encima de una de compra (`nearZone`).
- c) Solo cuenta como señal si la orden empuja a favor de la zona; si no, el aviso sale con "Solo informativa".
- d) Stop mínimo = 0.5 × ATR 14 de 1H (Binance, en vivo). Respaldo sin dato: BTC 0.15 %, SOL 0.35 %, oro 0.10 %. Estado "stop muy cerca" en `recordAlert`; Ai Crypto tampoco abre.
- e) `src/bias.js` termómetro −4…+4 cada 15 min: estructura 1H (rompe máx./mín. de 24 h), tendencia 4H (media 20 vs 50), neto de ballenas 4 h (> 2× mínimo), zonas rotas 12 h. ≥ +2 COMPRADORES, ≤ −2 VENDEDORES. Al cambiar avisa en el canal del mercado, #sesion-ny y #agent. Señales contra el sesgo no cuentan. Comando `sesgo`. TITO lo recibe en `sesgo_order_flow` y no usa zonas ROTA.
- Oro: mínimo de alerta $3M → $1.5M (la mayor orden vista fue $1.89M) y mega ballena $5M/$15M/$40M.
- Tarea de la nube "Trading zones check — daily AM" (7:48) APAGADA el 12 oct (duplicaba el mapa del servidor).

## v4.4 · Estudio de mercado hacia el pasado (12 oct 2026)
- `src/estudio.js`, corre en Railway (desde aquí no se llega a Binance). Arrancó solo 90 s después del despliegue (kv `estudioV44`); se repite con `estudio`, `estudio 1`, `estudio 2 3`; avance con `estudio estado`. Resultados en kv `estudio1/2/3` y en `GET /estudio` (solo lectura).
- Fase 1 · ballenas: aggTrades diarios de data.binance.vision (zip leído en streaming, ráfagas de 250 ms iguales a las del vivo), 1 día por semana × 12 meses, BTC/SOL/oro. Mide acierto y movimiento promedio a 15 min / 1 h / 4 h por tamaño (⅓–1×, 1–2×, 2–5×, 5×+ del mínimo), por tendencia 4H y por sesión NY; rangos absolutos 15M/40M/100M. Recomienda mínimo = escalón más chico con ≥ 55 % a 1 h y 30+ casos.
- Fase 2 · zonas + reglas: order blocks (última vela contraria + impulso que rompe el extremo de 10 velas) y FVG en 1H/4H con código; simulación con velas de 1 minuto, comisión 0.1 % ida y vuelta. Rejilla: TF 1H/4H × stop 0.25/0.5/1 ATR más allá del borde × meta 1/1.5/2/3R × toque/rechazo (cierre 15 min fuera) × con/sin tendencia 4H. Afina con los primeros 8 meses y valida con los últimos 4; por mercado reporta la mejor regla, la mejor con ≥ 68 % de acierto, desglose por lado, grado, tipo, sesión y Fear & Greed.
- Fase 3 · TITO a ciegas: 10 fechas por mercado (BTC, SOL), cada 9 días, solo velas hasta las 8:15 AM NY; se simulan sus zonas 24 h con su propio SL/TP1 y se marca cuáles cumplen el stop mínimo de la v4.3.
- Límites: sin historial de liquidaciones (Binance no lo publica); el oro tiene poca historia; Dow/Nasdaq quedan fuera (sin fuente horaria accesible desde Railway).

## v4.5 · Canal #macro-fundamental y menos ruido en #agent (12 oct 2026)
- Canal nuevo #macro-fundamental (categoría 🚨 ALERTAS, id 1559305676306518107; se publica con el bot, o `WEBHOOK_MACRO` si existe; `MACRO_CHANNEL_ID` para cambiarlo).
- `src/fundamental.js`: data real de FRED (CSV público, sin clave): inflación general/subyacente/PCE, desempleo, empleos, solicitudes, regla de Sahm, PIB, tasa de la Fed, bonos 2a/10a, curva 10a−2a, dólar, VIX, balance de la Fed, M2, S&P 500 y Nasdaq; velas diarias de Binance para Bitcoin y oro.
- Régimen = crecimiento (riesgo de recesión bajo/medio/alto) × tendencia de la inflación subyacente (ritmo de 3 meses vs anual): Goldilocks, Reflación, Estanflación, Desaceleración. Régimen de cada mercado: tendencia alcista, bajista, consolidación (rango de 20 días < 70 % de lo normal y cerca de su media de 50) o mixto.
- Publica: panorama los lunes 8:30 AM PR y "🆕 Dato nuevo" cuando FRED trae un CPI, desempleo, PCE o PIB nuevo (revisa 9, 11 y 15 h L-V). Comandos: `macro`, `probar macro`, `macro apagar/encender`. TITO recibe `macro_fundamental` en su panel para contestar sobre inflación, recesión, Fed o consolidación.
- Menos ruido: el cambio de sesgo necesita 2 lecturas seguidas (30 min) y ya no se publica en #agent (solo en el canal del mercado y en #sesion-ny en horario NY). `sesgo` muestra el cambio pendiente.

## v4.6 · Fase 1 corregida (12 oct 2026)
- La Fase 1 tomaba 1 día cada 7 desde un sábado: los 53 días fueron sábados (sin sesión NY y solo fin de semana). Ahora toma 1 día cada 6 (rota por todos los días de la semana, ~61 días) y guarda `dias_por_semana`. Se repite sola una vez tras el despliegue (kv `estudioV46`).
- Resultados v4.4 que siguen válidos: Fase 2 (velas de 1 minuto de todo el año) y Fase 3 (fechas cada 9 días).

## v4.7 · Estudio sin mirar al futuro + oro a $3M (12 oct 2026)
- Error corregido en `detectZones`: las zonas se activaban al ABRIR la vela que las confirma (FVG: vela i+1; OB: vela i+3). En la simulación eso permitía entrar en el extremo de esa misma vela. Ahora `t0` = cierre de esa vela. Los resultados de la Fase 2 de la v4.4 (FVG 79–85 %) quedan inválidos; la Fase 2 se repite sola una vez (kv `estudioV47`). Prueba unitaria nueva.
- Aprobado por Yasser (rec. 8, con data de la Fase 1 corregida): mínimo del oro $1.5M → $3M; #mega-ballenas agrega "Tamaño, no dirección" en cada aviso de orden.
- Pendiente de la Fase 2 corregida: motor de zonas en vivo para #ai-crypto, solo zonas que cumplan la regla, meta 1R, stop por ATR, filtro de tendencia, oro fuera de NY, ajuste del prompt de TITO.

## v4.8 · Fase 3 sin mirar al futuro (12 oct 2026)
- Fase 2 corregida (v4.7): sin la entrada imposible, NINGUNA combinación llega a 68 % en entrenamiento y todas pierden en validación (mejores: BTC −0.42R, SOL −0.16R, oro −0.19R por operación). Las metas de 3R aciertan 5–16 %: el precio tiende a atravesar las zonas mecánicas. El motor de zonas (rec. 1–6) NO se despliega; su código queda guardado fuera del repo para cuando haya una regla con ventaja real.
- Fase 3: a TITO se le pasaban la vela de 1H, la de 4H y la diaria todavía abiertas (con hasta ~12 h de futuro). Ahora solo velas cerradas antes de las 8:15 AM NY, y se descuenta la comisión. Se repite sola una vez (kv `estudioV48`).

## v4.9 · Fase 4 (ruptura de zona), Ai Crypto en pausa y nombres (12 oct 2026)
- Fase 4: prueba la RUPTURA de las zonas (cierre de vela más allá del borde lejano, stop del otro lado de la zona, meta 1–3R, 3 días máx., comisión), afinado 8 meses / validación 4. Aprueba solo si el R promedio es positivo en ambos periodos (50+ y 30+ operaciones). Corre sola una vez (kv `estudioV49`); también `estudio 4`.
- Ai Crypto (#ai-crypto) no abre señales nuevas: el estudio corregido no encontró ventaja (llevaba 0 % y −5R). Las abiertas se siguen cerrando.
- Nombres: solo #agent publica como "TITO 👾🤖" (`BOT_NAME`); los demás webhooks conservan su nombre propio. Apodo del bot en el servidor de vuelta a "TITO".

## v4.10 · TITO a ciegas ampliado y nueva vara (12 oct 2026)
- Aprobado por Yasser: la Fase 3 pasa a 60 mañanas por mercado (Bitcoin y Solana), una cada 6 días (~12 meses, ~120 consultas a Anthropic). Corre sola una vez tras el despliegue (kv `estudioV410`).
- Vara para aprobar cualquier regla o agente (aprobada por Yasser): R promedio POSITIVO en los 4 meses de validación con 50+ operaciones, comisión incluida. El % de acierto se reporta, pero ya no es el criterio.

## v4.11 · Fase 5: sesiones NY con órdenes grandes (12 oct 2026)
- Regla definida con Yasser ANTES de ver resultados (ver comentario en `src/estudio.js`, Fase 5). No se ajusta después de ver la data.
- Ventanas NY: apertura (estudio previo 8:00–9:30, disparo 9:30–10:30) y cierre (14:00–15:00, 15:00–16:00), hora de NY, L–V.
- Disparo: toque de zona 1H/4H → FVG de 5 min con BOS (swing más reciente) 5–15 min después → confirmación que supera la vela anterior con más volumen. Stop en el borde lejano o el extremo barrido; meta 2R (también 1R y 3R); máx. 4 h; comisión incluida.
- Regla completa = + órdenes grandes (ráfagas de 250 ms ≥ percentil 99 de 30 días) netas a favor dentro de la zona en la acumulación. También se mide delta y A++ (precio dentro o a ≤ 0.5 % de zona 1D/4H al inicio del estudio previo).
- Solo Bitcoin en esta corrida (datos de Binance). Índices y oro esperan fuente de datos. Position trading: pendientes días máximos, meta y mínimo de operaciones.
- Corre sola una vez tras el despliegue (kv `estudioV411`); comando `estudio 5` para repetir.

## v4.12–v4.13 · Diagnóstico y validación independiente (12 oct 2026)
- v4.12: comando `diagnostico estudio` (solo lectura). En 12 meses de BTC: toque 378 de 520 ventanas, FVG+BOS ~2 por semana, el volumen quita ~25 % de las confirmaciones; la caída a 28 señales viene de exigir todo en el mismo candidato.
- v4.13: Fase 6, regla candidata CONGELADA con Yasser antes de correr: toque de zona 1H/4H → FVG 5m que empieza después del toque → BOS; entrada al cierre del FVG; stop en el extremo de la vela del toque; 2R (1R/3R reportados); máx. 4 h; costes 0.14 %; una operación por ventana; zona consumida tras su operación. Confirmación con volumen solo como filtro aparte.
- Datos no usados antes para esta regla: SOL últimos 12 meses y BTC de hace 13 a 24 meses. Vara: combinado 50+ operaciones con R promedio > 0, cada mercado mostrado aparte. Corre sola una vez (kv `estudioV413`).

## v4.14 · Seguimiento de VG QUANT (DJ30 y NQ) (13 oct 2026)
- Ruta nueva `POST /vgq/<secreto>` (el secreto sale con `vg url` en #agent). Acepta el texto del mensaje de Discord de VG QUANT o un JSON {sym, tf, dir, lo, hi, prob, session, price}.
- Registro silencioso en kv `vgq` (máx. 300): nada se publica solo en ningún canal. Se consulta con `vg registro` en #agent.
- Regla de resultado FIJA (escrita antes de ver datos): oferta acierta si el precio baja 1 ancho de zona bajo el borde inferior, falla si cierra sobre el borde superior; demanda es el espejo; sin resolver a las 24 h. Precio: feed de TradingView de DJ30/NQ, revisado cada minuto.
- Solo mide: no opera ni cambia alertas existentes. Es medición, no señal validada.
- Regla de #agent (Yasser): es para consultar, no para avisos continuos.

## v4.15 · Confirmación de 15 min tras el toque · BTC, SOL y oro (13 oct 2026)
- `src/confirm15.js`. Regla FIJA aprobada por Yasser antes de ver datos (comentario al inicio del archivo): toque de zona viva → velas 5m k+1..k+3: FVG a favor, BOS al cierre de k+2 (swing de `fiveMin`), volumen de k+3 > promedio de las 12 velas previas, órdenes grandes (≥ ⅓ del mínimo de alerta) netas a favor dentro de la zona (±0,1 %). Confirmada = las 4.
- Velas de 5m con volumen en USD desde Binance (klines); órdenes del feed de ráfagas en vivo.
- Resultado para TODOS los toques (confirmados o no, para comparar): 1 ancho de zona a favor = acierta; cruzar el borde lejano = falla; 24 h = sin resolver.
- Registro silencioso en kv `c15` (máx. 500). Un toque por zona cada 60 min. Nada se publica; se consulta con `confirmacion registro` en #agent.
- DJ30/NQ: solo VG QUANT (v4.14), sin volumen ni órdenes (decisión de Yasser).

## v4.16 · Un canal por señal (13 oct 2026)
- Decisión de Yasser: cada señal en su canal; #agent solo responde cuando él pregunta y recopila todo para decidir. Las alertas de órdenes de BTC/SOL/oro en #cryptoman y #oro-índice NO se tocan.
- VG QUANT: TradingView permite un solo webhook por alerta; ahora la alerta va al servidor (`/vgq/<secreto>`), que la reenvía TAL CUAL a #indices-zonas (+ línea de seguimiento) y publica el resultado en #resultados. Si no entiende el mensaje, igual lo reenvía. JSON con `"test":true` = prueba sin registrar ni publicar.
- Confirmación 15 min: las CONFIRMADAS se publican en #cryptoman (BTC/SOL) u #oro-índice (oro) y su resultado en #resultados. Las no confirmadas solo se registran. Respeta "pausar alertas".
- Pendiente (Yasser): canal de sentimiento no existe todavía; faltan otras cosas que él recordará.

## v4.17 · Borrar un registro de VG QUANT (13 oct 2026)
- Una prueba enviada antes de que v4.16 terminara de desplegar entró como alerta real (id `mv6og178vyo`). Comando nuevo (solo dueño) `vg borrar <id>` en #agent; `vg registro` ahora muestra el id. Lección: probar la ruta solo después de confirmar la versión en /alive.

## v4.18 · Canal #sentimiento: lista por par (13 oct 2026)
- Pedido de Yasser: un solo canal con el sentimiento de cada par en una lista. Canal creado en ALERTAS (id 1559553092368998470, `SENTIMIENTO_CHANNEL_ID`).
- `src/sentcanal.js`: un mensaje vivo por día que el bot edita cada 15 min (día nuevo = mensaje nuevo). BTC/SOL/oro: % cuentas en largo y traders grandes L/C (Binance 1h) + funding + Fear & Greed que aplica. Dow/Nasdaq: solo F&G de CNN (no hay dato gratis por par; se dice).
- Lectura contraria de la multitud: ≥65 % largos (o ≥60 % con funding ≥0,03 %) = cargada en largos; ≤35 % (o ≤40 % con funding ≤−0,01 %) = cargada en cortos. Contexto, no entrada.

## v4.19 · Tamaño de posición en las alertas (13 oct 2026)
- Decisión de Yasser: riesgo fijo $100 por operación, cuenta $3,000. Comandos `riesgo` / `riesgo 100` / `cuenta 3000` en #agent (cambiar = solo dueño). Guardado en kv `riskCfg`.
- `src/risk.js`: entrada = borde de la zona (venta: inferior; compra: superior), o el cierre confirmado en la confirmación de 15 min. Cantidad = riesgo ÷ distancia al stop; tamaño, apalancamiento, comisión 0,1 % ida y vuelta y pérdida real si toca el stop.
- Candado: stop < 0,3 % o > 10x → "No operable con $100". Se muestra en alertas de ballena a favor de la zona, avisos de zona (#cryptoman, #oro-índice, #sesion-ny) y confirmaciones de 15 min. Índices: sin tamaño (depende del bróker).

## v4.20 · Fase 7: cuánto entra el precio en la zona antes de reaccionar (13 oct 2026)
- Pedido de Yasser: olvidar el stop de cada zona y medir el margen necesario. Regla de medición fija en `src/estudio.js` (Fase 7): zonas 1H/4H, primer toque por zona, entrada en el borde, reacción = se aleja a favor max(1 ancho, 0,5 ATR 1H) en 48 h; penetración antes de reaccionar en %, $, anchos, ATR y más allá del borde lejano; prueba de stops borde lejano + 0/0,1/0,2/0,3/0,5/1 %.
- BTC, SOL y oro, 12 meses de velas de 1 min de Binance. Corre sola una vez (kv `estudioV420`); repetir con `estudio 7`. Índices: sin historial de 1 min (CNBC), fuera de esta fase.
- Es medición: el stop nuevo se define con Yasser después de ver los números.

## v4.21 · Stop medido en las alertas y Fase 8 (metas) (13 oct 2026)
- Fase 7 (12 meses, 1.5–1.8 mil toques por mercado): ~50 % de los toques que reaccionan pasan antes el borde lejano. Margen para no salir en ~80 % de las reacciones: BTC +0,5 %, SOL +1,0 %, oro +0,3 % más allá del borde lejano.
- Aprobado por Yasser: el tamaño de posición y la línea de stop de las alertas (cripto y oro) usan ese stop medido en lugar del stop de la zona (`src/risk.js`, `nivelesMedidos`). Muestra R:R a la meta 1 con comisión. El seguimiento de señales (results.js) todavía usa el stop de la zona.
- Fase 8 (`estudio 8`, se lanza a mano): entrada en el borde, stop medido, metas 1/1,5/2/3R, 48 h, comisión 0,1 %; mejor meta en los primeros 8 meses, juzgada en los últimos 4. Vara: R > 0 con 50+ operaciones en validación.

## v4.22 · Zonas como información y base de VG QUANT (13 oct 2026)
- Fase 8 (12 meses; oro 10): entrada en el borde + stop medido + metas 1/1,5/2/3R → todas negativas en afinado y validación (BTC −0,10 a −0,13R, SOL −0,06 a −0,14R, oro −0,18 a −0,22R). Ninguna zona tiene ventaja por sí sola.
- Decisión de Yasser (recomendaciones): (1) las alertas de zona y de ballena salen como "ℹ️ INFO" con pie "Información, no señal de entrada"; (2) medir VG QUANT cuando haya 50+ resueltas; (3) medir sus propias operaciones (#diario-de-trades está vacío: falta la fuente).
- VG QUANT: se guarda la base = futuro (CNBC) − precio de la alerta al llegar; el seguimiento compara con futuro − base. Sin precio en la alerta o sin feed fresco → "sin base".

## v4.23 · Reparto de canales según Yasser (13 oct 2026)
- #cryptoman: vacío (reservado para sus ganancias/pérdidas personales). Ya no recibe nada del servidor.
- #oro-índice: solo órdenes en vivo de oro (alertas de ballena/zona de XAU) con las reglas.
- #indices-zonas: zonas de VG QUANT (DJ30, NQ/USTEC, BTC, SOL y oro) reenviadas desde TradingView (/vgq/<secreto>). Para BTC/SOL/oro hay que crear la alerta de VG QUANT en esos gráficos con el mismo webhook.
- #sesion-ny: todas sus reglas (alertas de BTC/SOL/oro, confirmaciones de 15 min, cambios de sesgo, plan diario 8:15 ET, avisos de zona de los 5 mercados), solo lunes–viernes 9:00–17:30 hora PR (`inWindow`). Fuera de horario BTC/SOL no se publican (se registran igual).
- #resultados: resultados medidos (VG QUANT, confirmaciones 15 min); a futuro: contexto para un agente automático.
- #mega-ballenas: solo BTC y SOL (`MEGA_SYMS`). #macro-fundamental y #sentimiento sin cambios.

## v4.24 · Diario automático y #agent en silencio (13 oct 2026)
- `src/diario.js`: #diario-de-trades (canal 1557713305542590565). Yasser escribe una línea (`compra btc 83200 sl 82500 tp 84500 plan si nota ...`); el servidor sigue el precio (Binance; Dow/Nasdaq con futuros CNBC ajustados por base) y cierra solo en stop o meta. Mide R con el stop inicial, comisión 0,1 % en cripto/oro, $ con riesgo de `riskCfg`, % de la cuenta. Guarda contexto (zona a favor, sesión NY), plan seguido sí/no y nota.
- Comandos en #diario-de-trades: `cerrar 3 83900`, `stop 3 83000`, `plan 3 si`, `abiertas`, `diario`, `borrar 3`, `ayuda`. En #agent: `diario`. Solo el dueño anota.
- Regla suya (diario GFF 100K, oct 2024: "DEBO VOLVER A 2 SOLO TRADES"): aviso al pasar de 2 operaciones en el día. En ese diario: días con plan seguido +7,7 % (11 de 12 en positivo); días sin plan −2,8 %.
- Las señales de Ai Crypto (en pausa) salen al final de `diario` para comparar. Cuando una regla pase la vara, Ai Crypto anotará sus operaciones con el mismo formato.
- #agent: ya no publica "Sistema encendido" ni "Buenos días" (van al log). Mapa del día 7:48 AM → #sesion-ny. Aviso de noticias fuera de sesión → #macro-fundamental. En #agent solo quedan respuestas y avisos de fallo.

## v4.25 · Alertas de precio en el webhook de VG QUANT (13 oct 2026)
- La alerta de precio "DJ30 Crossing 51,998.29" de Yasser también apunta a /vgq. Él la quiere (ahí ve ventas), así que no se toca: el servidor ignora en silencio los mensajes "Crossing / Greater Than / Less Than" en vez de reenviarlos a #indices-zonas como ilegibles.

## v4.26 · VG QUANT: leer el formato {"content": …} (19 oct 2026)
- Revisión de canales: desde el 14 oct las alertas de VG QUANT llegan como JSON de webhook de Discord (`{"content":"🚨 VG QUANT · BTCUSDT.P 240 · …"}`). `parseVg` no lo leía → ninguna zona se registró ni se midió (12 alertas perdidas del 14 al 19 oct) y #indices-zonas mostraba el JSON crudo.
- Ahora se lee el texto de `content` y se reenvía el texto limpio.

## v4.27 · Menos ruido + Ai Crypto encendido (19 oct 2026)
Revisión de canales (lunes 19 oct): #sesion-ny 126 mensajes en 8 h (54 ballenas, 27 "siguen…", 22 "cerca de zona"); #mega-ballenas 42 en 15 h. Aprobado por Yasser ("tremendas sugerencias, comienza"):
- #sesion-ny: solo (1) precio ENTRA a una zona, una vez por zona por día; (2) confirmación 15 min; (3) resumen de cada hora (:30 ET, 10:30–3:30) con zonas calientes, ballenas de la hora por mercado (si ≥ $10M) y cambios de sesgo; no sale si no hay nada. Más apertura, cierre, plan NY (ahora UN mensaje) y zona rota. Sin tablero de pre-apertura.
- Ballenas de BTC/SOL ya no salen una por una (siguen registrándose y midiéndose). Oro sigue en #oro-índice.
- #mega-ballenas: solo nivel 2+ (BTC ≥ $40M, SOL ≥ $15M) y liquidaciones grandes.
- #macro-fundamental: noticias de la misma hora en un solo mensaje.
- Resumen semanal: "R promedio por señal" (antes salía la suma y parecía por señal).
- VG QUANT: misma zona una vez cada 24 h; el resultado sale como RESPUESTA al aviso en #indices-zonas (bot, message_reference), con récord y cuántas faltan para 50. Respaldo: #resultados.
- Ai Crypto encendido otra vez (Yasser): orden en zona A++ a favor y no contra el sesgo → señal de práctica en #ai-crypto, con stop medido (Fase 7) y comisión en el resultado.
- #agent: un solo mensaje automático por día: al abrir NY (9:30 ET) tablero + resumen del plan.

## v4.28 · Mensajes de TITO en #agent (19 oct 2026)
- Pedido de Yasser: #agent publica solo 3 mensajes automáticos por día (L-V): (1) 8:30 AM PR "Buenos días" (`src/buenosdias.js`: línea positiva + alpha del día con datos reales + consejo de valor; comando `buenos dias` para probar; `morningOff` en kv lo apaga); (2) 9:30 ET apertura de NY (tablero + resumen del plan); (3) 3:50 PM ET "NY cierra en 10 min · así va el día".
- Vuelve el tablero de pre-apertura de las 9:00 AM en #sesion-ny (a Yasser le gusta).
- Canales sin uso (#wallet-tracking, #crypto, #general) se quedan: Yasser piensa abrir el grupo a otras personas en el futuro.

## v4.29 · Mapa del día en silencio (20 oct 2026)
- Yasser: "sigue enviando muchos mensajes en NY". La mañana tenía 2 mensajes largos con las mismas zonas: Mapa del día (7:48 AM) y Plan NY (8:15 ET). El mapa sigue actualizando las zonas pero ya no se publica; si falla, avisa en #agent.
- El correo de Railway "Deploy Crashed" no corresponde al despliegue activo: v4.28 llevaba 10 h encendido sin reinicios y el historial no muestra despliegues fallidos.

## v4.30 · TITO ve el Dow/Nasdaq en vivo y manda la gráfica (22 oct 2026)
- Problema: TITO contestaba "no tengo precio en vivo del Dow" porque en el chat solo recibía el mapa de índices del 7 oct. Ahora cada pregunta trae [INDICES]: futuros YM/NQ en vivo (CNBC, refresco al preguntar) + velas reales 15m y 1h (Yahoo YM=F / NQ=F) + zonas de hoy del Plan NY. El mapa del 7 oct queda como "viejo".
- `src/chart.js`: gráfica de velas en PNG sin dependencias (letra 5x7 propia). TITO añade `[[GRAFICO]]{mercado, tf, lado, entrada, stop, meta, zona}[[/GRAFICO]]` al final cuando propone una entrada; el servidor lo quita del texto, dibuja con las mismas velas y la manda como imagen a #agent (`agentFile`, multipart por webhook). Máx. 2 por respuesta.
- Comando directo en #agent: `grafica btc 1h` (btc, sol, oro, dow/us30, nasdaq/nas100; 5m/15m/1h/4h).
- Prueba sin Discord: GET /grafico/<secreto de VG QUANT>?m=US30&tf=15m&lado=compra&entrada=…&stop=…&meta=…&zona=lo,hi → PNG.
- La instrucción de la gráfica va en el contexto de cada pregunta, no en el prompt de Yasser (no se tocó).

## v4.31 · Gráfica con estilo TradingView (22 oct 2026)
- Yasser quiere que la imagen "se vea como TradingView". Una alerta/webhook de TradingView no puede mandar imágenes ni capturas, y una captura de su pantalla exigiría su computadora encendida; por eso se imita el estilo: tema oscuro de TV, encabezado OHLC, marca de agua (US30, 15M), eje de precio con etiquetas de color, eje de tiempo en hora PR y la herramienta de posición larga/corta (caja verde de meta, roja de stop, R:R).
- Railway: incidente de seguridad del 21 oct; los despliegues de cuentas Hobby estaban pausados → v4.30/v4.31 quedan en cola hasta que se reactiven.

## v4.32 · Zonas en la gráfica + pares de Yasser (22 oct 2026)
- Yasser confirmó que las velas de YM=F (Yahoo) coinciden con su gráfica. Pidió que se vean las zonas: la gráfica dibuja las zonas que el servidor vigila para ese mercado (`src/zonasgraf.js`): mapa/Plan NY (cripto, oro, Dow, Nasdaq) y VG QUANT de las últimas 48 h, corridas por la base del futuro.
- Lista activa de TradingView "Pares de Yasser": TVC:DXY, GBEBROKERS:DJ30, GBEBROKERS:USTEC, COINBASE:SOLUSD, COINBASE:BTCUSD, COINBASE:ETHUSD, GBEBROKERS:XAUUSD, VANTAGE:DJ30. TITO ahora recibe también ETH (Binance ETHUSDT, en lugar de QQQUSDT) y el DXY (Yahoo DX-Y.NYB, 1h); la gráfica acepta ETH y DXY.
