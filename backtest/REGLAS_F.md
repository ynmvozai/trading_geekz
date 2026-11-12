# Estrategia F — reglas CONGELADAS (12 nov 2026, 5:50 PM PR)

Idea de Yasser (12 nov 2026, 5:37 PM PR): (1) máximo y mínimo de la vela semanal: el precio debe tocarlo o llegar muy cerca;
(2) vela diaria de mayor volumen, marcada; (3) en 4H: BOS + FVG, stop bajo el OB; (4) seguir la tendencia de la semana y del día
(y el fundamental). Corrección suya (5:41 PM): la vela diaria de mayor volumen es **dentro de la semana que está corriendo**.
Los puntos que no definió se congelan con los valores propuestos ese mismo día (meta, papel de la vela de volumen, rechazo vs ruptura).
**Congeladas antes de ver datos.** Cualquier cambio = estrategia nueva (G) con prueba nueva.

## Mercados, datos y periodo
- Dow (USA30IDXUSD), Nasdaq (USATECHIDXUSD), oro (XAUUSD) y BTC (BTCUSD): velas de 1 hora de Dukascopy (BID, volumen de ticks).
- 1 ene 2022 → 31 oct 2026. Parte 1: ene 2022 – may 2024. Parte 2: jun 2024 – oct 2026.
- Semana = domingo 5:00 PM → domingo 5:00 PM hora de NY. Día = 5:00 PM → 5:00 PM NY. Velas de 4H alineadas a las 5:00 PM NY.

## Piezas
1. **Nivel semanal:** máximo (PWH) y mínimo (PWL) de la vela semanal anterior. "Tocado" = en la semana en curso el precio
   llegó al nivel o a menos de 0,3 % de él (se mira hasta el cierre de la vela de 4H de la señal).
2. **Vela diaria de mayor volumen (VD):** entre los días **ya cerrados de la semana en curso**, el de mayor volumen.
   Su rango [mínimo, máximo] es la zona marcada. Si todavía no hay ningún día cerrado esa semana, no hay señal.
3. **Tendencia:** compra solo si el cierre de la vela de 4H de la señal está por encima de la apertura semanal **y**
   la última vela diaria cerrada fue alcista (cierre > apertura). Venta: espejo. (El fundamental no se puede reconstruir
   hacia atrás; no entra en la prueba.)
4. **Gatillo en 4H (compra):** una vela de 4H cierra por encima del último máximo de 4H confirmado (fractal 2/2) = BOS.
   OB = última vela bajista antes de la vela del BOS (máx. 30 velas atrás). FVG = el más reciente entre el OB y la vela
   del BOS (`low[i] > high[i-2]`). Sin FVG no hay señal. El FVG tiene que solaparse con la VD.

## Dos jugadas (compra; la venta es el espejo exacto)
- **Rebote:** PWL tocado esta semana y el BOS cierra por debajo o en PWH. Meta = PWH. Se toma solo si la meta queda a 2R o más.
- **Ruptura:** el BOS cierra por encima de PWH. Meta = 2R fijo.
- Entrada (ambas): orden limitada en el borde superior del FVG; vale 24 horas de mercado desde el cierre del BOS.
  Stop: mínimo del OB. Si el stop no queda por debajo de la entrada, no se toma.

## Gestión y medición
- Un trade abierto a la vez por mercado. Salida: stop o meta con velas de 1 hora; si una vela toca ambos (o se llena y toca
  el stop en la misma hora), cuenta stop. Lo que siga abierto se cierra al final de la semana siguiente a la de entrada.
- Costo ida y vuelta: Dow 3 puntos · Nasdaq 1 punto · oro 0,6 USD · BTC 0,1 % del precio. También se reporta sin costo.

## Vara
- Aprueba si: 50+ trades en total (los 4 mercados, las dos jugadas) y R promedio > 0 después de costo
  en la parte 1 **y** en la parte 2.

## Solo se reportan (no deciden)
- Por mercado y por jugada (rebote / ruptura).
- La misma regla sin la confluencia de la VD, y sin el filtro de tendencia (para ver qué aporta cada pieza).
