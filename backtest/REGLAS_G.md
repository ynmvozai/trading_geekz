# Estrategia G — reglas CONGELADAS (12 nov 2026, 7:50 PM PR)

Pedido de Yasser (12 nov, 7:30 PM): usar el libro "The Candlestick Trading Bible" para afinar la estrategia F
"o cualquiera que le funcione". F no pasó la vara (−0,02R / −0,44R). G toma del libro lo que cambia respecto a F:
- **La señal es una vela de rechazo en el nivel** (barra pin o envolvente en 4H), no un BOS con FVG.
- **Entrada al cierre de la vela de señal, stop detrás de su mecha** (cap. "tácticas de negociación").
- **Análisis de arriba hacia abajo:** semanal → diario → 4H (cap. "Marcos de tiempo").
- **Con tendencia: retroceso a la media de 21** con las medias de 8 y 21 marcando la dirección (cap. pin bar y envolvente).
- Riesgo/recompensa mínimo y no arriesgar más de 2 % por operación (cap. "manejo de dinero").
Estas reglas salen del libro y de lo que Yasser ya definió para F; **no** se eligieron mirando los resultados de F.
**Congeladas antes de ver datos.** Cualquier cambio = estrategia nueva (H).

## Datos (los mismos de F)
- Dow, Nasdaq, oro y BTC · velas de 1 hora de Dukascopy · 1 ene 2022 → 31 oct 2026.
  Parte 1: ene 2022 – may 2024. Parte 2: jun 2024 – oct 2026. Semana, día y 4H alineados a las 5:00 PM NY.

## Velas de señal (4H; compra — la venta es el espejo exacto)
- **Barra pin alcista:** la mecha inferior mide 2/3 o más del rango de la vela (el cuerpo queda en el tercio superior).
- **Envolvente alcista:** la vela anterior es bajista, la actual es alcista, su cuerpo cubre el cuerpo anterior
  (cierre > apertura anterior y apertura ≤ cierre anterior) y es más grande.
- En ambos casos el rango de la vela de señal mide al menos la mitad del rango medio (ATR de 14 velas de 4H).
- Mínimo de la señal = mínimo de la barra pin, o el menor de las dos velas de la envolvente.

## G-1 · Rechazo en el extremo semanal (la jugada de Yasser, con la señal del libro)
- Nivel: máximo (PWH) y mínimo (PWL) de la vela semanal anterior.
- **Compra:** vela de señal alcista cuyo mínimo toca PWL o queda a menos de 0,3 % de él, que **cierra por encima de PWL**
  y cuyo mínimo es el más bajo de las últimas 5 velas de 4H.
- Entrada: al cierre de la vela de señal. Stop: mínimo de la señal. Meta: PWH. Se toma solo si la meta queda a 2R o más.

## G-2 · Con tendencia en la media de 21 (el método principal del libro)
- Tendencia alcista: media simple de 8 por encima de la de 21 en **diario** (última vela diaria cerrada) **y** en 4H.
- **Compra:** vela de señal alcista cuyo mínimo toca o cruza la media de 21 de 4H y que cierra por encima de ella.
- Entrada: al cierre de la vela de señal. Stop: mínimo de la señal. Meta: 2R fijo.

## Gestión y medición (igual que F)
- Un trade abierto a la vez por mercado y por jugada. Salida: stop o meta con velas de 1 hora; si una vela toca ambos, cuenta stop.
  Lo que siga abierto se cierra al final de la semana siguiente a la de entrada.
- Costo ida y vuelta: Dow 3 puntos · Nasdaq 1 punto · oro 0,6 USD · BTC 0,1 %.

## Vara
- G-1 y G-2 se juzgan **por separado**: 50+ trades (los 4 mercados) y R promedio > 0 después de costo en la parte 1 **y** en la parte 2.
- Como ya se han probado varias reglas sobre estos mismos años, una que pase aquí se confirma después con datos
  de 2017–2021 (que nadie ha tocado) antes de darla por buena.

## Solo se reportan (no deciden)
- Por mercado; compras y ventas por separado.
- G-1 con meta fija de 2R (sin exigir la distancia al otro extremo).
- G-1 con la vela de señal en **diario** en vez de 4H.
- G-1 y G-2 entrando con orden limitada en el 50 % de la vela de señal (la "entrada conservadora" del libro), válida 24 h.
- G-2 con meta de 3R.
