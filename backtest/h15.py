# Backtest de H-15 (reglas en REGLAS_H15.md): dirección de G-1 en 4H + entradas en 15 min, solo sesión de Nueva York.
# Uso: python3 h15.py carpeta_velas_15m/ resultados_h15/
import glob, gzip, json, os, sys, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import f as F, h as H

P2 = int(dt.datetime(2022, 1, 1, tzinfo=dt.timezone.utc).timestamp())
HALF = [int(dt.datetime(y, m, 1, tzinfo=dt.timezone.utc).timestamp()) for y, m in ((2019, 7), (2022, 1), (2024, 6))]

def load15(src, name):
    A = {k: [] for k in "tohlcv"}
    for p in sorted(glob.glob(os.path.join(src, f"{name}_*.csv.gz"))):
        with gzip.open(p, "rt") as fh:
            next(fh)
            for line in fh:
                a = line.split(","); A["t"].append(int(a[0]))
                for k, x in zip("ohlcv", a[1:6]): A[k].append(float(x))
    return A

def to_1h(A):
    R = {k: [] for k in "tohlcv"}; cur = None
    for i in range(len(A["t"])):
        b = A["t"][i] // 3600 * 3600
        if b != cur:
            cur = b
            for k in "tohlcv": R[k].append(b if k == "t" else A[k][i])
        else:
            if A["h"][i] > R["h"][-1]: R["h"][-1] = A["h"][i]
            if A["l"][i] < R["l"][-1]: R["l"][-1] = A["l"][i]
            R["c"][-1] = A["c"][i]; R["v"][-1] += A["v"][i]
    return R

def ses_ny15(t_close):
    n = dt.datetime.fromtimestamp(t_close, H.NYZ); m = n.hour * 60 + n.minute
    return (n.date().isoformat(), "NY") if 9 * 60 + 45 <= m <= 12 * 60 + 30 else None

def run(name, A15):
    A1 = to_1h(A15); M15, M1 = F.mirror(A15), F.mirror(A1)
    evL, evS = H.bias_events(A1), H.bias_events(M1)
    out = []
    for data, ev, other, sgn in ((A15, evL, evS, 1), (M15, evS, evL, -1)):
        for tr in H.engine(data, ev, [x["T"] for x in other], bar=900, ses_fn=ses_ny15):
            risk = tr["entry"] - tr["stop"]; R = (tr["exit"] - tr["entry"]) / risk
            kind, cv = F.COST[name]; cost = cv if kind == "pts" else cv * abs(tr["entry"])
            ts = tr["t_sig"]
            out.append({"sym": name, "dir": sgn, "reentrada": int(tr["n_abiertas"] > 0), "t_sig": ts, "t_exit": tr["t_exit"], "salida": tr["salida"],
                        "entry": sgn * tr["entry"], "stop": sgn * tr["stop"], "tp": sgn * tr["tp"], "exit": sgn * tr["exit"],
                        "R": R, "R_neto": R - cost / risk, "riesgo_pct": 100 * risk / abs(tr["entry"]),
                        "periodo": 1 if ts < P2 else 2, "mitad": 1 + sum(ts >= x for x in HALF)})
    return out, len(evL), len(evS)

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    tr = []
    for name in F.COST:
        A = load15(src, name)
        if not A["t"]: print("sin datos", name); continue
        x, nl, ns = run(name, A); tr += x
        print(name, "velas 15m", len(A["t"]), "señales de dirección: compra", nl, "venta", ns, "trades", len(x), flush=True)
    res = {}
    groups = [("TODOS", lambda x: True)] + [(n, (lambda n: lambda x: x["sym"] == n)(n)) for n in F.COST] + \
             [("compras", lambda x: x["dir"] == 1), ("ventas", lambda x: x["dir"] == -1),
              ("primera entrada", lambda x: not x["reentrada"]), ("reentradas", lambda x: x["reentrada"])]
    for grp, flt in groups:
        res[f"{grp} · 2017–2021"] = F.stats([x for x in tr if flt(x) and x["periodo"] == 1])
        res[f"{grp} · 2022–2026"] = F.stats([x for x in tr if flt(x) and x["periodo"] == 2])
    for m, lab in enumerate(("2017–jun 2019", "jul 2019–2021", "2022–may 2024", "jun 2024–oct 2026"), 1):
        res[f"TODOS · mitad {lab}"] = F.stats([x for x in tr if x["mitad"] == m])
    a, b = res["TODOS · 2017–2021"], res["TODOS · 2022–2026"]
    res["veredicto"] = {"aprueba": bool(a.get("n", 0) >= 50 and b.get("n", 0) >= 50 and a.get("R_neto", -1) > 0 and b.get("R_neto", -1) > 0)}
    for k, v in res.items(): print("%-34s" % k, json.dumps(v, ensure_ascii=False))
    json.dump(res, open(os.path.join(dst, "resumen.json"), "w"), indent=1, ensure_ascii=False)
    keys = ["sym", "dir", "reentrada", "periodo", "mitad", "t_sig", "t_exit", "salida", "entry", "stop", "tp", "exit", "R", "R_neto", "riesgo_pct"]
    with open(os.path.join(dst, "trades.csv"), "w") as fh:
        fh.write(",".join(keys) + "\n")
        for x in tr: fh.write(",".join(str(round(x[k], 4) if isinstance(x[k], float) else x[k]) for k in keys) + "\n")
