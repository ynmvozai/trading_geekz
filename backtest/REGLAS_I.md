# Estrategia I — reglas CONGELADAS (15 nov 2026, 7:55 AM PR)

Pedido de Yasser (15 nov, 7:43 AM): "Haz esta corrida con la última estrategia pero baja el time frame a 1H 30min analizar zonas
(máximo mínimo diario o semanal (si se juntan mejor)) y 1-5 min entrada".
Es H-15 un escalón más abajo: la zona se analiza en 1H (y 30 min) sobre el máximo/mínimo del día o de la semana anterior,
y la entrada se busca en 5 min. **Congeladas antes de bajar los datos de 5 min.**
Aviso: estos años (2017–oct 2026) ya se usaron para G-1, H y H-15, que no pasaron. Una regla que pase aquí
todavía necesita seguirse en papel antes de darla por buena.

## Datos
- Dow, Nasdaq, oro y BTC · Dukascopy 1 min BID agregadas a 5 min · 2017–2021 y 2022–oct 2026.
- Día y semana alineados a las 5:00 PM de Nueva York. Velas de 1 h y 30 min armadas con las de 5 min.

## Niveles
- **Diario:** máximo (PDH) y mínimo (PDL) del día anterior. **Semanal:** máximo (PWH) y mínimo (PWL) de la semana anterior.
- **Juntos:** el nivel diario y el semanal del mismo lado están a 0,15 % o menos uno del otro (o son el mismo).

## Dirección (velas de 1 h; compra — la venta es el espejo exacto)
- Vela de señal igual que en G: barra pin (mecha inferior ≥ 2/3 del rango) o envolvente alcista, rango ≥ ½ ATR14 de 1 h.
- Su mínimo toca el nivel (PDL o PWL) o queda a 0,15 % o menos, **cierra por encima del nivel** y su mínimo es el más bajo
  de las últimas 5 velas de 1 h.
- Meta fijada: señal en PDL → PDH; señal en PWL → PWH; si están juntos → PDH (la más cercana).
- Invalidación: mínimo de la señal. La dirección se apaga cuando el precio llega a la meta, una vela de 5 min **cierra**
  por debajo de la invalidación, aparece una señal contraria, o vence: señal diaria al cierre del día siguiente;
  señal semanal o junta al cierre de la semana siguiente. Al apagarse por invalidación, señal contraria o tiempo, lo abierto se cierra.
- Una señal nueva del mismo lado renueva meta e invalidación.

## Entrada (velas de 5 min, solo sesión de Nueva York)
- Velas de 5 min que cierran entre 9:35 AM y 12:30 PM hora de NY. Máximo una entrada por sesión y mercado en cada dirección.
- Gatillo: una vela de 5 min cierra por encima del último máximo de 5 min confirmado (fractal 2/2) sin romper.
- Entrada al cierre. Stop: mínimo más bajo desde ese máximo hasta la vela de entrada. Meta: la fijada, solo si queda a 1R o más.
- Reentrar solo si todo lo abierto de esa dirección va en ganancia.
- Salida: stop o meta con velas de 5 min; si una vela toca ambos, cuenta stop.
- Costo ida y vuelta: Dow 3 puntos · Nasdaq 1 punto · oro 0,6 USD · BTC 0,1 %.

## Vara
- Aprueba si: 50+ trades y R promedio > 0 después de costo en 2017–2021 **y** en 2022–2026 (todo junto: diario, semanal y juntos).

## Solo se reportan (no deciden)
- Por tipo de nivel (diario / semanal / juntos), por mitades, por mercado, compras/ventas, primera entrada/reentradas.
- La misma regla con la señal de dirección en velas de **30 min** en vez de 1 h.
- La entrada en 1 min no se corre en esta tanda: con stops de 1 min el costo fijo pesa varias veces más. Se baja solo si 5 min promete.
