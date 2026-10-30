# Estrategia D — reglas CONGELADAS (29 oct 2026, 10:40 PM PR)

Aprobadas por Yasser ("ok", 29 oct 2026 10:38 PM PR) **antes de ver datos**.
No se cambian después de ver resultados. Cualquier cambio = estrategia nueva (E) con prueba nueva.

Origen: 9 capturas de trades reales de Yasser (Dow 15m y Nasdaq 15m/30m, 16–29 oct 2026):
zona diaria (OB, máximo o mínimo) → ruptura de 15 min → entrada en la vela de mayor volumen → stop en el OB.

## Mercados, datos y periodo
- Dow (USA30IDXUSD) y Nasdaq (USATECHIDXUSD), velas de 1 min de Dukascopy (BID, con volumen de ticks).
- 1 feb 2026 → 29 oct 2026. Parte 1: 1 feb – 11 jun. Parte 2: 12 jun – 29 oct.
- Vela diaria = de 5:00 PM a 5:00 PM hora de NY (día de futuros).

## Zona diaria
- **Máximo/mínimo diario:** vela con máximo (o mínimo) más alto (o bajo) que las 2 velas de cada lado.
  Zona = rango completo de esa vela [mínimo, máximo]. Existe desde el cierre de la 2.ª vela posterior (confirmación).
- **OB diario:** una vela diaria cierra por encima del último máximo diario confirmado (o por debajo del último mínimo).
  OB = la última vela contraria antes de esa vela (bajista para ruptura alcista; alcista para ruptura bajista).
  Zona = rango completo de esa vela. Existe desde el cierre de la vela de ruptura.
- La zona muere cuando una vela diaria cierra fuera de ella (por arriba o por abajo).
- Zona que aplica: la más reciente que siga viva y que contenga el precio de entrada.

## Entrada (15 min)
1. **Ruptura (dirección):** una vela de 15 min cierra por encima del último máximo de 15 min confirmado
   (2 velas a cada lado) → dirección compra; por debajo del último mínimo → venta. La dirección dura hasta
   la ruptura contraria.
2. **OB de 15 min:** la última vela contraria antes de la vela de ruptura (para compra, la última vela bajista).
3. **Vela de mayor volumen:** desde la vela de ruptura en adelante, la primera vela de 15 min que
   (a) tiene el mayor volumen de las últimas 20 velas de 15 min (contándose ella),
   (b) cierra en la dirección del trade (compra: cierre > apertura; venta: cierre < apertura), y
   (c) cierra dentro de una zona diaria viva.
   **Entrada al cierre de esa vela.**
4. **Stop:** borde lejano del OB de 15 min (compra: su mínimo; venta: su máximo). Si el stop no queda del lado
   correcto de la entrada, no se toma.
5. **Meta:** el otro extremo de la zona diaria en la dirección del trade (compra: máximo de la zona;
   venta: mínimo). Si la meta queda a menos de 2R, no se toma.
6. **Horario:** la vela de entrada cierra entre 9:30 AM y 2:00 PM hora de NY. Máximo 2 trades por día por mercado,
   uno abierto a la vez.
7. **Salida:** stop o meta, revisados con velas de 1 min. Si una vela toca ambos, cuenta stop.
   Lo que siga abierto se cierra a las 3:55 PM NY del mismo día.

## Costos y vara
- Costo ida y vuelta: 3 puntos en Dow (YM) y 1 punto en Nasdaq (NQ). También se reporta sin costo.
- **Aprueba si:** 50+ trades en total (Dow + Nasdaq) y R promedio > 0 después de costo en la parte 1 **y** en la parte 2.

## Variantes que solo se reportan (no deciden)
- Caja y ruptura en 30 min en lugar de 15 min.
- Dejar el trade abierto hasta las 3:55 PM NY de la sesión siguiente (máximo 2 días).

## Chequeo contra los 9 trades de Yasser
Antes de mirar el resultado agregado se lista qué hizo el detector en cada uno de esos 9 días y mercados.
