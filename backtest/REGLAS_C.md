# Estrategia C — reglas CONGELADAS (26 oct 2026, 9:00 PM PR)

Aprobadas por Yasser ("ok", 26 oct 2026 8:58 PM PR) **antes de ver datos**.
No se cambian después de ver resultados. Cualquier cambio = estrategia nueva (D) con prueba nueva.

Origen: su diario de la cuenta GFF 100K (586394), sep–nov 2024: zona HTF → neutralización →
cierre de vela → entrada en el retroceso a BreakerOB / IFVG de 1–5 min.

## Mercados y periodo
- BTC y SOL (Binance spot 1m), oro XAUUSD, Dow (USA30) y Nasdaq (USATECH) (Dukascopy 1m, BID).
- 1 feb 2026 → 23 oct 2026. Parte 1 (afinado): 1 feb – 11 jun. Parte 2 (validación): 12 jun – 23 oct.

## Zonas del agente (sustituto reproducible)
Las zonas reales de TITO las elige la IA y no se pueden reconstruir hacia atrás. Sustituto fijo:
- FVG de 1H y 4H. Alcista: `low[i] > high[i-2]` → zona de compra `[high[i-2], low[i]]`.
  Bajista: `high[i] < low[i-2]` → zona de venta `[high[i], low[i-2]]`.
- La zona existe desde el cierre de la vela i. Muere si una vela de 5 min cierra más allá de su borde lejano
  o a los 10 días.

## Entrada (igual para C-A y C-B)
1. Ventana: la vela de 5 min de la neutralización cierra entre 9:30 y 12:30 hora de NY. Llenados solo hasta 12:30.
2. Neutralización (5 min): swing = fractal 2/2 ya confirmado. Para compra: mecha por debajo del último mínimo
   swing y la vela **cierra** por encima de él. Venta: espejo.
3. Ruptura (1 min): en los 60 min siguientes, una vela de 1 min **cierra** por encima del último máximo swing
   de 1 min (fractal 2/2 confirmado al cierre de la neutralización). Si antes el precio pasa la mecha
   de la neutralización, se descarta.
4. Nivel de entrada: el FVG de 1 min más reciente del impulso (desde la vela de la mecha hasta la vela de ruptura +1);
   orden limitada en su borde cercano. Si no hay FVG: el máximo de la última vela bajista antes del impulso (OB/Breaker).
   Venta: espejo.
5. La orden vive 30 min desde la ruptura. Si no se llena, se cancela.
6. Stop: mecha de la neutralización ± 0,01 %.
7. Meta: borde cercano de la zona del agente más cercana en la dirección del trade (cualquier lado).
   Sin zona o meta a menos de 1R → no se toma.
8. Salida: stop o meta. Si una vela toca ambos, cuenta stop. Lo que siga abierto se cierra a las 15:55 NY.
9. Máximo 2 trades por día por mercado, uno abierto a la vez.

## C-A vs C-B
- **C-B (desde la zona):** la mecha de la neutralización queda dentro de una zona viva del mismo lado
  (compra dentro de zona de compra; venta dentro de zona de venta).
- **C-A (hacia la zona):** la mecha no queda dentro de ninguna zona viva.

## Costos y vara
- Costo ida y vuelta: 0,1 % del precio (vara principal). También se reporta 0,04 % (órdenes limitadas).
- Aprueba si: 50+ trades en total y R promedio > 0 **después de costo** en la parte 1 **y** en la parte 2.
