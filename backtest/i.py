# Backtest de la estrategia I (reglas en REGLAS_I.md): zona en 1 h sobre máximo/mínimo del día o la semana anterior + entrada en 5 min (NY).
# Uso: python3 i.py carpeta_velas_5m/ resultados_i/
import json, os, sys, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import f as F, g as G, h as H, h15 as H15

NEAR = 0.0015
INF = 10 ** 12

def to_bar(A, sec):
    R = {k: [] for k in "tohlcv"}; cur = None
    for i in range(len(A["t"])):
        b = A["t"][i] // sec * sec
        if b != cur:
            cur = b
            for k in "tohlcv": R[k].append(b if k == "t" else A[k][i])
        else:
            if A["h"][i] > R["h"][-1]: R["h"][-1] = A["h"][i]
            if A["l"][i] < R["l"][-1]: R["l"][-1] = A["l"][i]
            R["c"][-1] = A["c"][i]; R["v"][-1] += A["v"][i]
    return R

def bias_events(B, bar):
    """Señales de dirección de COMPRA en velas B (con datos espejados: de venta)."""
    t, o, h, l, c = (B[k] for k in "tohlc"); n = len(t)
    sd = [F.shifted(x) for x in t]
    dk = [x.date() for x in sd]; wk = [x.isocalendar()[:2] for x in sd]
    def prev_levels(keys):
        ph, pl, idx, starts = [None] * n, [None] * n, [0] * n, []
        cur = None; hi = lo = None; lh = ll = None
        for i in range(n):
            if keys[i] != cur:
                if cur is not None: lh, ll = hi, lo
                cur = keys[i]; hi, lo = h[i], l[i]; starts.append(t[i])
            else: hi, lo = max(hi, h[i]), min(lo, l[i])
            ph[i], pl[i], idx[i] = lh, ll, len(starts) - 1
        return ph, pl, idx, starts
    PDH, PDL, di, dst = prev_levels(dk); PWH, PWL, wi, wst = prev_levels(wk)
    rng = [h[i] - l[i] for i in range(n)]; atr = G.sma(rng, G.ATR_N)
    ev = []
    for k in range(21, n):
        if atr[k] is None or rng[k] <= 0 or rng[k] < 0.5 * atr[k]: continue
        pin = (min(o[k], c[k]) - l[k]) >= (2.0 / 3.0) * rng[k]
        eng = c[k - 1] < o[k - 1] and c[k] > o[k] and c[k] > o[k - 1] and o[k] <= c[k - 1] and (c[k] - o[k]) > (o[k - 1] - c[k - 1])
        if not (pin or eng): continue
        low = l[k] if pin else min(l[k], l[k - 1])
        if low > min(l[k - G.LOOK + 1:k + 1]): continue
        ok = lambda L: L is not None and low <= L + NEAR * abs(L) and c[k] > L
        d_ok, w_ok = ok(PDL[k]), ok(PWL[k])
        if not (d_ok or w_ok): continue
        d_exp = dst[di[k] + 2] if di[k] + 2 < len(dst) else INF
        w_exp = wst[wi[k] + 2] if wi[k] + 2 < len(wst) else INF
        if d_ok and w_ok and abs(PDL[k] - PWL[k]) <= NEAR * abs(PWL[k]): tipo, tp, exp = "juntos", PDH[k], w_exp
        elif w_ok: tipo, tp, exp = "semanal", PWH[k], w_exp
        else: tipo, tp, exp = "diario", PDH[k], d_exp
        if tp is None or not (tp > c[k]): continue
        ev.append({"T": t[k] + bar, "inval": low, "tp": tp, "expire": exp, "tipo": tipo})
    return ev

def ses_ny5(t_close):
    n = dt.datetime.fromtimestamp(t_close, H.NYZ); m = n.hour * 60 + n.minute
    return (n.date().isoformat(), "NY") if 9 * 60 + 35 <= m <= 12 * 60 + 30 else None

def run(name, A5, sig_sec=3600):
    B = to_bar(A5, sig_sec); M5, MB = F.mirror(A5), F.mirror(B)
    evL, evS = bias_events(B, sig_sec), bias_events(MB, sig_sec)
    out = []
    for data, ev, other, sgn in ((A5, evL, evS, 1), (M5, evS, evL, -1)):
        for tr in H.engine(data, ev, [x["T"] for x in other], bar=300, ses_fn=ses_ny5):
            risk = tr["entry"] - tr["stop"]; R = (tr["exit"] - tr["entry"]) / risk
            kind, cv = F.COST[name]; cost = cv if kind == "pts" else cv * abs(tr["entry"])
            ts = tr["t_sig"]
            out.append({"sym": name, "dir": sgn, "tipo": tr["tipo"], "reentrada": int(tr["n_abiertas"] > 0), "t_sig": ts, "t_exit": tr["t_exit"], "salida": tr["salida"],
                        "entry": sgn * tr["entry"], "stop": sgn * tr["stop"], "tp": sgn * tr["tp"], "exit": sgn * tr["exit"],
                        "R": R, "R_neto": R - cost / risk, "riesgo_pct": 100 * risk / abs(tr["entry"]),
                        "periodo": 1 if ts < H15.P2 else 2, "mitad": 1 + sum(ts >= x for x in H15.HALF)})
    return out, len(evL), len(evS)

def resumen(tr):
    res = {}
    groups = [("TODOS", lambda x: True)] + [(n, (lambda n: lambda x: x["sym"] == n)(n)) for n in F.COST] + \
             [(k, (lambda k: lambda x: x["tipo"] == k)(k)) for k in ("diario", "semanal", "juntos")] + \
             [("compras", lambda x: x["dir"] == 1), ("ventas", lambda x: x["dir"] == -1),
              ("primera entrada", lambda x: not x["reentrada"]), ("reentradas", lambda x: x["reentrada"])]
    for grp, flt in groups:
        res[f"{grp} · 2017–2021"] = F.stats([x for x in tr if flt(x) and x["periodo"] == 1])
        res[f"{grp} · 2022–2026"] = F.stats([x for x in tr if flt(x) and x["periodo"] == 2])
    for m, lab in enumerate(("2017–jun 2019", "jul 2019–2021", "2022–may 2024", "jun 2024–oct 2026"), 1):
        res[f"TODOS · mitad {lab}"] = F.stats([x for x in tr if x["mitad"] == m])
    a, b = res["TODOS · 2017–2021"], res["TODOS · 2022–2026"]
    res["veredicto"] = {"aprueba": bool(a.get("n", 0) >= 50 and b.get("n", 0) >= 50 and a.get("R_neto", -1) > 0 and b.get("R_neto", -1) > 0)}
    return res

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    keys = ["sym", "dir", "tipo", "reentrada", "periodo", "mitad", "t_sig", "t_exit", "salida", "entry", "stop", "tp", "exit", "R", "R_neto", "riesgo_pct"]
    data = {name: H15.load15(src, name) for name in F.COST}
    for label, sec, fn in (("Señal en 1 h (decide)", 3600, "1h"), ("Señal en 30 min (solo se reporta)", 1800, "30m")):
        tr = []
        print("=====", label)
        for name, A in data.items():
            if not A["t"]: print("sin datos", name); continue
            x, nl, ns = run(name, A, sec); tr += x
            print(name, "velas 5m", len(A["t"]), "señales: compra", nl, "venta", ns, "trades", len(x), flush=True)
        res = resumen(tr)
        for k, v in res.items(): print("%-34s" % k, json.dumps(v, ensure_ascii=False))
        json.dump(res, open(os.path.join(dst, f"resumen_{fn}.json"), "w"), indent=1, ensure_ascii=False)
        with open(os.path.join(dst, f"trades_{fn}.csv"), "w") as fh:
            fh.write(",".join(keys) + "\n")
            for x in tr: fh.write(",".join(str(round(x[k], 4) if isinstance(x[k], float) else x[k]) for k in keys) + "\n")
