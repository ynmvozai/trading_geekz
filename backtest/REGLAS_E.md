# Estrategia E — reglas CONGELADAS (12 nov 2026, 5:15 PM PR)

Basadas en las respuestas de Yasser del 4 nov 2026 (zona = 1 vela diaria, la del día anterior;
3 toques en techo o piso + BOS = rechazo; ruptura con FVG u OB con vela 3–4× mayor = continuación;
entradas en 5/15/30 min) y propuestas ese mismo día. El 12 nov pidió continuar el proyecto.
Los dos detalles que quedaron por defecto (meta de la ruptura = 2R; un toque cuenta aunque la mecha
pase el borde si la vela cierra adentro) se congelan como se propusieron.
**Congeladas antes de ver datos.** Cualquier cambio = estrategia nueva (F) con prueba nueva.

## Mercados, datos y periodo (igual que D)
- Dow (USA30IDXUSD) y Nasdaq (USATECHIDXUSD), velas de 1 min de Dukascopy (BID, volumen de ticks).
- 1 feb 2026 → 29 oct 2026. Parte 1: 1 feb – 11 jun. Parte 2: 12 jun – 29 oct.
- Vela diaria = de 5:00 PM a 5:00 PM hora de NY.

## Zona
- La vela diaria **anterior**: techo = su máximo, piso = su mínimo. Cada día de futuros hay una zona nueva.

## E-1 · Rechazo (3 toques + BOS)
1. **Toque de techo:** una vela de 15 min con máximo ≥ techo que **cierra dentro** de la zona (cierre < techo y ≥ piso).
   Para contar como toque nuevo tiene que haber al menos 2 velas sin tocar desde el toque anterior.
   Se cuentan desde el inicio del día de futuros (5:00 PM NY). Si una vela de 15 min cierra por encima del techo,
   la cuenta vuelve a cero.
2. Con **3 toques o más**, se espera el BOS en contra: una vela de 15 min cierra por debajo del último mínimo
   de 15 min confirmado (fractal 2/2). El BOS tiene que ocurrir en la vela del 3.er toque o después.
3. **Entrada:** al cierre de la primera vela (desde la del BOS) que tenga el mayor volumen de las últimas 20 velas
   de 15 min, cierre bajista y cierre dentro de la zona.
4. **Stop:** máximo del OB = última vela alcista antes de la vela del BOS.
5. **Meta:** el piso de la zona. Si queda a menos de 2R, no se toma.
6. Tras una entrada, la cuenta de toques vuelve a cero.
- **Piso:** espejo exacto (3 pisos, BOS hacia arriba, compra, stop en el mínimo del OB bajista, meta en el techo).

## E-2 · Ruptura (continuación)
1. Una vela de 15 min **cierra fuera** de la zona (por encima del techo o por debajo del piso) y la anterior cerró dentro.
2. OB = última vela contraria antes de la vela de ruptura (máx. 10 velas atrás). La ruptura vale si:
   (a) la vela que sigue al OB mide (máximo − mínimo) **3 veces o más** que el OB, o
   (b) el impulso deja un **FVG** que incluye la vela de ruptura: `low[k] > high[k-2]`, o con la vela siguiente
       `low[k+1] > high[k-1]` (en ese caso la vela siguiente también tiene que cerrar fuera). Venta: espejo.
3. **Entrada:** al cierre de la vela donde se cumple la condición (la de ruptura o la siguiente).
4. **Stop:** borde lejano del OB (compra: su mínimo; venta: su máximo).
5. **Meta:** 2R fijo.

## Común
- Horario: la vela de entrada cierra entre 9:30 AM y 2:00 PM NY. Máximo 2 trades por día por mercado (E-1 y E-2 juntas),
  uno abierto a la vez. Stop del lado equivocado → no se toma.
- Salida: stop o meta con velas de 1 min; si una vela toca ambos, cuenta stop. Cierre a las 3:55 PM NY del mismo día.
- Costo ida y vuelta: 3 puntos Dow, 1 punto Nasdaq. También se reporta sin costo.

## Vara
- E-1 y E-2 se juzgan **por separado**. Cada una aprueba si tiene 50+ trades (Dow + Nasdaq) y R promedio > 0
  después de costo en la parte 1 **y** en la parte 2.

## Solo se reportan (no deciden)
- Las mismas reglas con velas de 5 min y de 30 min.
- E-2 con meta de 3R.
- Chequeo contra los 9 trades de Yasser (16–29 oct).
