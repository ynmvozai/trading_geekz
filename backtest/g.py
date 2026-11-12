# Backtest de la estrategia G (reglas en REGLAS_G.md). Reutiliza piezas de f.py. Sin dependencias.
# Uso: python3 g.py datos_f/ resultados_g/
import bisect, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import f as F

NEAR, MIN_RR, ATR_N, LOOK = 0.003, 2.0, 14, 5

def sma(x, n):
    out = [None] * len(x); s = 0.0
    for i, v in enumerate(x):
        s += v
        if i >= n: s -= x[i - n]
        if i >= n - 1: out[i] = s / n
    return out

def long_signals(A, play, bars="4h", tp_mode="regla", tp_mult=2.0):
    """Señales de COMPRA de G-1 o G-2 (con datos espejados sirve para ventas). Entrada = cierre de la vela de señal."""
    H4, Dd, W = F.build(A)
    B = H4 if bars == "4h" else Dd
    o, h, l, c, end, wk = B["o"], B["h"], B["l"], B["c"], B["end"], B["wk"]
    widx = {k: i for i, k in enumerate(W["key"])}
    rng = [h[i] - l[i] for i in range(len(c))]; atr = sma(rng, ATR_N)
    s8, s21 = sma(c, 8), sma(c, 21); d8, d21 = sma(Dd["c"], 8), sma(Dd["c"], 21)
    out = []; d_ptr = 0
    for k in range(max(21, LOOK), len(c)):
        if atr[k] is None or rng[k] <= 0 or rng[k] < 0.5 * atr[k]: continue
        pin = (min(o[k], c[k]) - l[k]) >= (2.0 / 3.0) * rng[k]
        eng = c[k - 1] < o[k - 1] and c[k] > o[k] and c[k] > o[k - 1] and o[k] <= c[k - 1] and (c[k] - o[k]) > (o[k - 1] - c[k - 1])
        if not (pin or eng): continue
        low = l[k] if pin else min(l[k], l[k - 1])
        entry, stop = c[k], low
        if not (stop < entry): continue
        risk = entry - stop; T = end[k]; wi = widx[wk[k]]
        if wi == 0: continue
        if play == "G-1":
            PWH, PWL = W["h"][wi - 1], W["l"][wi - 1]
            if not (low <= PWL + NEAR * abs(PWL) and c[k] > PWL and low <= min(l[k - LOOK + 1:k + 1])): continue
            if tp_mode == "regla":
                tp = PWH
                if tp - entry < MIN_RR * risk: continue
            else: tp = entry + tp_mult * risk
        else:
            while d_ptr < len(Dd["end"]) and Dd["end"][d_ptr] <= T: d_ptr += 1
            ld = d_ptr - 1
            if ld < 21 or d8[ld] is None or d21[ld] is None or not (d8[ld] > d21[ld]): continue
            if s8[k] is None or s21[k] is None or not (s8[k] > s21[k]): continue
            if not (low <= s21[k] and c[k] > s21[k]): continue
            tp = entry + tp_mult * risk
        out.append({"t_sig": T, "entry": entry, "stop": stop, "tp": tp, "hi": h[k], "tipo": "pin" if pin else "envolvente"})
    return out, W

def sim_market(A, W, s):
    t, o, h, l, c = (A[k] for k in "tohlc")
    i = bisect.bisect_left(t, s["t_sig"])
    if i >= len(t): return None
    wi = W["key"].index(F.shifted(t[i]).isocalendar()[:2]); last = W["i1"][min(wi + 1, len(W["key"]) - 1)]
    for n in range(i, last + 1):
        if l[n] <= s["stop"]: return s["entry"], min(o[n], s["stop"]), t[i], t[n] + 3600, "stop"
        if h[n] >= s["tp"]: return s["entry"], s["tp"], t[i], t[n] + 3600, "meta"
    return s["entry"], c[last], t[i], t[last] + 3600, "fin de la semana siguiente"

def run(name, A, play, bars="4h", tp_mode="regla", tp_mult=2.0, entry_mode="cierre"):
    M = F.mirror(A)
    sl, WL = long_signals(A, play, bars, tp_mode, tp_mult); ss, WS = long_signals(M, play, bars, tp_mode, tp_mult)
    cand = sorted([(s, A, WL, 1) for s in sl] + [(s, M, WS, -1) for s in ss], key=lambda x: x[0]["t_sig"])
    busy, trades = 0, []
    for s, data, W, sgn in cand:
        if s["t_sig"] < busy: continue
        if entry_mode == "50%":
            s = dict(s); mid = (s["hi"] + s["stop"]) / 2.0
            if not (s["stop"] < mid < s["entry"]): continue
            if tp_mode != "regla" or play == "G-2": s["tp"] = mid + tp_mult * (mid - s["stop"])
            elif s["tp"] - mid < MIN_RR * (mid - s["stop"]): continue
            s["entry"] = mid
            r = F.simulate(data, W, s)
        else:
            r = sim_market(data, W, s)
        if r is None: continue
        px, ex, t_fill, t_exit, why = r
        busy = t_exit; risk = s["entry"] - s["stop"]; R = (ex - px) / risk
        kind, cv = F.COST[name]; cost = cv if kind == "pts" else cv * abs(px)
        trades.append({"sym": name, "play": play, "tipo": s["tipo"], "dir": sgn, "t_sig": s["t_sig"], "t_fill": t_fill, "t_exit": t_exit, "salida": why,
                       "entry": sgn * s["entry"], "stop": sgn * s["stop"], "tp": sgn * s["tp"], "fill": sgn * px, "exit": sgn * ex,
                       "R": R, "R_neto": R - cost / risk, "riesgo_pct": 100 * risk / abs(s["entry"]), "part": 1 if s["t_sig"] < F.SPLIT else 2})
    return trades

VARIANTS = {
    "G-1": ("G-1", "4h", "regla", 2.0, "cierre"),
    "G-2": ("G-2", "4h", "fija", 2.0, "cierre"),
    "G-1 meta 2R fija": ("G-1", "4h", "fija", 2.0, "cierre"),
    "G-1 señal en diario": ("G-1", "d", "regla", 2.0, "cierre"),
    "G-1 entrada al 50 %": ("G-1", "4h", "regla", 2.0, "50%"),
    "G-2 entrada al 50 %": ("G-2", "4h", "fija", 2.0, "50%"),
    "G-2 meta 3R": ("G-2", "4h", "fija", 3.0, "cierre"),
}

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    data = {}
    for name in F.COST:
        p = os.path.join(src, name + ".csv.gz")
        if not os.path.exists(p): print("sin datos", name); continue
        data[name] = F.load(p); print(name, "velas 1h", len(data[name]["t"]), flush=True)
    res, all_tr = {}, {}
    for vname, (play, bars, tpm, mult, em) in VARIANTS.items():
        tr = [x for name in data for x in run(name, data[name], play, bars, tpm, mult, em)]
        all_tr[vname] = tr; r = {}
        for grp, flt in [("TODOS", lambda x: True)] + [(n, (lambda n: lambda x: x["sym"] == n)(n)) for n in data] + \
                        [("compras", lambda x: x["dir"] == 1), ("ventas", lambda x: x["dir"] == -1),
                         ("pin", lambda x: x["tipo"] == "pin"), ("envolvente", lambda x: x["tipo"] == "envolvente")]:
            for part in (1, 2): r[f"{grp} parte {part}"] = F.stats([x for x in tr if flt(x) and x["part"] == part])
        res[vname] = r
        print(vname, json.dumps({k: v for k, v in r.items() if k.startswith("TODOS")}, ensure_ascii=False), flush=True)
    ver = {}
    for v in ("G-1", "G-2"):
        a, b = res[v]["TODOS parte 1"], res[v]["TODOS parte 2"]
        ver[v] = bool(a.get("n", 0) + b.get("n", 0) >= 50 and a.get("R_neto", -1) > 0 and b.get("R_neto", -1) > 0)
    res["veredicto"] = ver; print("VEREDICTO", ver)
    json.dump(res, open(os.path.join(dst, "resumen.json"), "w"), indent=1, ensure_ascii=False)
    keys = ["sym", "play", "tipo", "part", "dir", "t_sig", "t_fill", "t_exit", "salida", "entry", "stop", "tp", "fill", "exit", "R", "R_neto", "riesgo_pct"]
    for i, (vname, tr) in enumerate(all_tr.items()):
        with open(os.path.join(dst, f"trades_{i}_{vname.replace(' ', '_').replace('%', 'pct').replace('ñ', 'n')}.csv"), "w") as fh:
            fh.write(",".join(keys) + "\n")
            for x in tr: fh.write(",".join(str(round(x[k], 4) if isinstance(x[k], float) else x[k]) for k in keys) + "\n")
