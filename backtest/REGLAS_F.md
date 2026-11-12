# Estrategia F — reglas CONGELADAS (12 nov 2026, 5:50 PM PR)

Idea de Yasser (12 nov 2026, 5:37 PM PR): (1) máximo y mínimo de la vela semanal: el precio debe tocarlo o llegar muy cerca;
(2) vela diaria de mayor volumen, marcada; (3) en 4H: BOS + FVG, stop bajo el OB; (4) seguir la tendencia de la semana y del día
(y el fundamental). Corrección suya (5:41 PM): la vela diaria de mayor volumen es **dentro de la semana que está corriendo**.
Sus respuestas de las 5:43 PM (leídas antes de correr nada con datos reales) ajustan tres puntos: la meta es el otro extremo semanal
con 2R o más ("normalmente sí"); el FVG, el BOS y el stop en el OB ocurren **dentro** de la vela diaria de mayor volumen; y al tocar
el máximo semanal busca **ventas**, al tocar el mínimo busca **compras** ("normalmente busco la inversa").
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
3. **Gatillo en 4H (compra):** una vela de 4H cierra por encima del último máximo de 4H confirmado (fractal 2/2) = BOS.
   OB = última vela bajista antes de la vela del BOS (máx. 30 velas atrás). FVG = el más reciente entre el OB y la vela
   del BOS (`low[i] > high[i-2]`). Sin FVG no hay señal.
4. **Dentro de la VD:** el precio de entrada (borde del FVG) queda dentro del rango de la VD y el OB toca ese rango.

## La jugada (regla principal): la inversa en el extremo semanal
- **Compra:** PWL tocado esta semana + gatillo de compra en 4H que cierra por debajo o en PWH. Meta = PWH.
- **Venta:** espejo exacto (PWH tocado + gatillo de venta; meta = PWL).
- Se toma solo si la meta queda a 2R o más.
- Entrada: orden limitada en el borde del FVG más cercano al precio (compra: borde superior); vale 24 horas de mercado
  desde el cierre del BOS. Stop: extremo del OB (compra: su mínimo). Stop del lado equivocado → no se toma.
- Sin filtro de tendencia en la regla principal: el BOS de 4H es el cambio de dirección. Los filtros se reportan aparte.

## Gestión y medición
- Un trade abierto a la vez por mercado. Salida: stop o meta con velas de 1 hora; si una vela toca ambos (o se llena y toca
  el stop en la misma hora), cuenta stop. Lo que siga abierto se cierra al final de la semana siguiente a la de entrada.
- Costo ida y vuelta: Dow 3 puntos · Nasdaq 1 punto · oro 0,6 USD · BTC 0,1 % del precio. También se reporta sin costo.

## Vara
- Aprueba si: 50+ trades en total (los 4 mercados) y R promedio > 0 después de costo
  en la parte 1 **y** en la parte 2.

## Solo se reportan (no deciden)
- Por mercado, y compras y ventas por separado.
- La regla principal + última vela diaria cerrada a favor del trade.
- La regla principal + semana a favor (cierre de la señal por encima de la apertura semanal para compras) y día a favor.
- La regla principal sin la condición de la VD.
- **Ruptura (continuación):** el BOS cierra más allá del extremo semanal, a favor de semana y día, dentro de la VD, meta 2R fijo.
