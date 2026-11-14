# Backtest de la estrategia H (reglas en REGLAS_H.md). Velas de 1 hora. Reutiliza f.py y g.py. Sin dependencias.
# Uso: python3 h.py datos/ resultados_h/
import bisect, json, os, sys, datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import f as F, g as G

NYZ, PRZ = ZoneInfo("America/New_York"), ZoneInfo("America/Puerto_Rico")
MIN_RR = 1.0

def bias_events(A):
    """Señales de dirección de COMPRA (con datos espejados: de venta). Igual que G-1 pero sin exigir 2R."""
    H4, Dd, W = F.build(A)
    o, h, l, c, end, wk = H4["o"], H4["h"], H4["l"], H4["c"], H4["end"], H4["wk"]
    widx = {k: i for i, k in enumerate(W["key"])}
    rng = [h[i] - l[i] for i in range(len(c))]; atr = G.sma(rng, G.ATR_N)
    ev = []
    for k in range(21, len(c)):
        if atr[k] is None or rng[k] <= 0 or rng[k] < 0.5 * atr[k]: continue
        pin = (min(o[k], c[k]) - l[k]) >= (2.0 / 3.0) * rng[k]
        eng = c[k - 1] < o[k - 1] and c[k] > o[k] and c[k] > o[k - 1] and o[k] <= c[k - 1] and (c[k] - o[k]) > (o[k - 1] - c[k - 1])
        if not (pin or eng): continue
        low = l[k] if pin else min(l[k], l[k - 1]); wi = widx[wk[k]]
        if wi == 0: continue
        PWH, PWL = W["h"][wi - 1], W["l"][wi - 1]
        if not (low <= PWL + G.NEAR * abs(PWL) and c[k] > PWL and low <= min(l[k - G.LOOK + 1:k + 1])): continue
        if not (PWH > c[k]): continue
        expire = W["end"][min(wi + 1, len(W["key"]) - 1)]
        ev.append({"T": end[k], "inval": low, "tp": PWH, "expire": expire})
    return ev

def session_of(t_close):
    n = dt.datetime.fromtimestamp(t_close, NYZ); m = n.hour * 60 + n.minute
    if 10 * 60 <= m <= 13 * 60: return (n.date().isoformat(), "NY")
    p = dt.datetime.fromtimestamp(t_close, PRZ); mp = p.hour * 60 + p.minute
    if mp >= 23 * 60: return (p.date().isoformat(), "Noche")
    if mp <= 60: return ((p.date() - dt.timedelta(days=1)).isoformat(), "Noche")
    return None

def engine(A, events, cancel_times, bar=3600, ses_fn=None):
    """Opera COMPRAS con la dirección activa. cancel_times: horas de señales contrarias (apagan la dirección)."""
    ses_fn = ses_fn or session_of
    t, o, h, l, c = (A[k] for k in "tohlc")
    piv = F.pivot_highs(h); p = 0; lastH = None          # [nivel, roto, idx]
    e = 0; x = 0; bias = None; used = set(); open_tr = []; done = []
    def close_all(i, why):
        for tr in open_tr: done.append(dict(tr, exit=c[i], t_exit=t[i] + bar, salida=why))
        open_tr.clear()
    for i in range(len(t)):
        tc = t[i] + bar
        while p < len(piv) and piv[p][0] <= i - 1:
            lastH = [piv[p][1], False, piv[p][0] - 2]; p += 1
        while e < len(events) and events[e]["T"] <= t[i]:      # una señal vale desde la vela siguiente a su cierre
            bias = events[e]; e += 1                          # una señal nueva del mismo lado renueva meta e invalidación
        while x < len(cancel_times) and cancel_times[x] <= t[i]: x += 1
        if bias is not None and x and cancel_times[x - 1] > bias["T"]:
            close_all(max(i - 1, 0), "señal contraria"); bias = None
        # gestionar lo abierto
        keep = []
        for tr in open_tr:
            if l[i] <= tr["stop"]: done.append(dict(tr, exit=min(o[i], tr["stop"]), t_exit=tc, salida="stop"))
            elif h[i] >= tr["tp"]: done.append(dict(tr, exit=tr["tp"], t_exit=tc, salida="meta"))
            else: keep.append(tr)
        open_tr[:] = keep
        bos = bool(lastH and not lastH[1] and c[i] > lastH[0])
        if bos: lastH[1] = True
        if bias is None: continue
        if h[i] >= bias["tp"]: bias = None; continue
        if c[i] < bias["inval"]: close_all(i, "invalidada"); bias = None; continue
        if tc >= bias["expire"]: close_all(i, "fin de la semana siguiente"); bias = None; continue
        if not bos: continue
        ses = ses_fn(tc)
        if ses is None or ses in used: continue
        entry = c[i]; stop = min(l[lastH[2]:i + 1])
        if not (stop < entry): continue
        risk = entry - stop
        if bias["tp"] - entry < MIN_RR * risk: continue
        if any(tr["entry"] >= entry for tr in open_tr): continue          # reentrar solo si lo abierto va a favor
        used.add(ses)
        open_tr.append({"t_sig": tc, "entry": entry, "stop": stop, "tp": bias["tp"], "sesion": ses[1], "n_abiertas": len(open_tr)})
    if open_tr: close_all(len(t) - 1, "fin de datos")
    return done

def run(name, A):
    M = F.mirror(A)
    evL, evS = bias_events(A), bias_events(M)
    out = []
    for data, ev, other, sgn in ((A, evL, evS, 1), (M, evS, evL, -1)):
        for tr in engine(data, ev, [x["T"] for x in other]):
            risk = tr["entry"] - tr["stop"]; R = (tr["exit"] - tr["entry"]) / risk
            kind, cv = F.COST[name]; cost = cv if kind == "pts" else cv * abs(tr["entry"])
            out.append({"sym": name, "dir": sgn, "sesion": tr["sesion"], "reentrada": int(tr["n_abiertas"] > 0), "t_sig": tr["t_sig"], "t_exit": tr["t_exit"],
                        "salida": tr["salida"], "entry": sgn * tr["entry"], "stop": sgn * tr["stop"], "tp": sgn * tr["tp"], "exit": sgn * tr["exit"],
                        "R": R, "R_neto": R - cost / risk, "riesgo_pct": 100 * risk / abs(tr["entry"]), "part": 1 if tr["t_sig"] < F.SPLIT else 2})
    return out, len(evL), len(evS)

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    tr = []
    for name in F.COST:
        p = os.path.join(src, name + ".csv.gz")
        if not os.path.exists(p): print("sin datos", name); continue
        A = F.load(p); x, nl, ns = run(name, A); tr += x
        print(name, "velas 1h", len(A["t"]), "señales de dirección: compra", nl, "venta", ns, "trades", len(x), flush=True)
    res = {}
    groups = [("TODOS", lambda x: True)] + [(n, (lambda n: lambda x: x["sym"] == n)(n)) for n in F.COST] + \
             [("NY", lambda x: x["sesion"] == "NY"), ("Noche", lambda x: x["sesion"] == "Noche"), ("compras", lambda x: x["dir"] == 1),
              ("ventas", lambda x: x["dir"] == -1), ("primera entrada", lambda x: not x["reentrada"]), ("reentradas", lambda x: x["reentrada"])]
    for grp, flt in groups:
        res[f"{grp} periodo completo"] = F.stats([x for x in tr if flt(x)])
        for part in (1, 2): res[f"{grp} mitad {part}"] = F.stats([x for x in tr if flt(x) and x["part"] == part])
    for k, v in res.items(): print("%-30s" % k, json.dumps(v, ensure_ascii=False))
    json.dump(res, open(os.path.join(dst, "resumen.json"), "w"), indent=1, ensure_ascii=False)
    keys = ["sym", "dir", "sesion", "reentrada", "part", "t_sig", "t_exit", "salida", "entry", "stop", "tp", "exit", "R", "R_neto", "riesgo_pct"]
    with open(os.path.join(dst, "trades.csv"), "w") as fh:
        fh.write(",".join(keys) + "\n")
        for x in tr: fh.write(",".join(str(round(x[k], 4) if isinstance(x[k], float) else x[k]) for k in keys) + "\n")
