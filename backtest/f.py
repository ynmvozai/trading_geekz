# Backtest de la estrategia F (reglas en REGLAS_F.md). Velas de 1 hora. Sin dependencias.
# Uso: python3 f.py datos_f/ resultados_f/
import bisect, gzip, json, os, sys, datetime as dt
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
SPLIT = int(os.environ.get("SPLIT_TS", dt.datetime(2024, 6, 1, tzinfo=dt.timezone.utc).timestamp()))
NEAR, MIN_RR, OB_BACK, FILL_HOURS = 0.003, 2.0, 30, 24
COST = {"US30": ("pts", 3.0), "NAS": ("pts", 1.0), "XAU": ("pts", 0.6), "BTC": ("pct", 0.001)}

def load(path):
    A = {k: [] for k in "tohlcv"}
    with gzip.open(path, "rt") as f:
        next(f)
        for line in f:
            a = line.split(",")
            A["t"].append(int(a[0]))
            for k, x in zip("ohlcv", a[1:6]): A[k].append(float(x))
    return A

def shifted(ts):   # hora de NY + 7 h: las 5:00 PM NY pasan a ser medianoche → día y semana de futuros
    return dt.datetime.fromtimestamp(ts, NY).replace(tzinfo=None) + dt.timedelta(hours=7)

def build(A):
    """Agrupa las velas de 1 h en 4H, días y semanas (con la hora de cierre real de cada grupo)."""
    n = len(A["t"]); sd = [shifted(x) for x in A["t"]]
    def group(keyf):
        G = {k: [] for k in ("key", "o", "h", "l", "c", "v", "end", "i0", "i1")}; cur = object()
        for i in range(n):
            k = keyf(sd[i])
            if k != cur:
                cur = k
                G["key"].append(k); G["o"].append(A["o"][i]); G["h"].append(A["h"][i]); G["l"].append(A["l"][i]); G["c"].append(A["c"][i])
                G["v"].append(A["v"][i]); G["end"].append(A["t"][i] + 3600); G["i0"].append(i); G["i1"].append(i)
            else:
                G["h"][-1] = max(G["h"][-1], A["h"][i]); G["l"][-1] = min(G["l"][-1], A["l"][i]); G["c"][-1] = A["c"][i]
                G["v"][-1] += A["v"][i]; G["end"][-1] = A["t"][i] + 3600; G["i1"][-1] = i
        return G
    wk = lambda d: d.isocalendar()[:2]
    H4 = group(lambda d: (d.date(), d.hour // 4)); Dd = group(lambda d: d.date()); W = group(wk)
    H4["wk"] = [wk(sd[i]) for i in H4["i0"]]; Dd["wk"] = [wk(sd[i]) for i in Dd["i0"]]
    return H4, Dd, W

def mirror(A):
    return {"t": A["t"], "v": A["v"], "o": [-x for x in A["o"]], "c": [-x for x in A["c"]], "h": [-x for x in A["l"]], "l": [-x for x in A["h"]]}

def pivot_highs(h, k=2):
    return [(i + k, h[i]) for i in range(k, len(h) - k) if all(h[i] > h[i + j] for j in range(-k, k + 1) if j)]

def long_signals(A, use_vd=True, trend="no", plays=("rebote",)):
    """Señales de COMPRA (con datos espejados sirve para ventas)."""
    H4, Dd, W = build(A)
    t_end, o, h, l, c = H4["end"], H4["o"], H4["h"], H4["l"], H4["c"]
    widx = {k: i for i, k in enumerate(W["key"])}
    P = pivot_highs(h); p = 0; lastH = None
    out = []; cur_wk = None; wk_hi = wk_lo = None
    d_ptr = 0   # días cerrados hasta T
    for k in range(len(c)):
        while p < len(P) and P[p][0] <= k - 1:
            lastH = [P[p][1], False]; p += 1
        if H4["wk"][k] != cur_wk: cur_wk = H4["wk"][k]; wk_hi, wk_lo = h[k], l[k]
        else: wk_hi, wk_lo = max(wk_hi, h[k]), min(wk_lo, l[k])
        if not (lastH and not lastH[1] and c[k] > lastH[0]): continue
        lastH[1] = True                                    # BOS
        T = t_end[k]; wi = widx[cur_wk]
        if wi == 0 or k < 2: continue
        PWH, PWL, w_open = W["h"][wi - 1], W["l"][wi - 1], W["o"][wi]
        while d_ptr < len(Dd["end"]) and Dd["end"][d_ptr] <= T: d_ptr += 1
        done = [i for i in range(max(0, d_ptr - 8), d_ptr) if Dd["wk"][i] == cur_wk]     # días ya cerrados de esta semana
        if not done: continue
        vd = max(done, key=lambda i: Dd["v"][i]); vd_lo, vd_hi = Dd["l"][vd], Dd["h"][vd]
        last_d = d_ptr - 1
        if trend in ("dia", "semana+dia") and not (Dd["c"][last_d] > Dd["o"][last_d]): continue
        if trend == "semana+dia" and not (c[k] > w_open): continue
        j = next((j for j in range(k - 1, max(-1, k - 1 - OB_BACK), -1) if c[j] < o[j]), None)
        if j is None: continue
        fi = next((i for i in range(k, max(j, 1), -1) if l[i] > h[i - 2]), None)
        if fi is None: continue
        f_lo, f_hi = h[fi - 2], l[fi]
        entry, stop = f_hi, l[j]
        # VD: la entrada (borde del FVG) queda dentro de la vela diaria de mayor volumen y el OB la toca
        if use_vd and not (vd_lo <= entry <= vd_hi and l[j] <= vd_hi and h[j] >= vd_lo): continue
        if not (stop < entry): continue
        risk = entry - stop
        if c[k] > PWH: play, tp = "ruptura", entry + MIN_RR * risk
        elif wk_lo <= PWL + NEAR * abs(PWL):
            play, tp = "rebote", PWH
            if tp - entry < MIN_RR * risk: continue
        else: continue
        if play not in plays: continue
        out.append({"dir": 1, "play": play, "t_sig": T, "entry": entry, "stop": stop, "tp": tp, "wi": wi,
                    "pwh": PWH, "pwl": PWL, "vd": (vd_lo, vd_hi), "fvg": (f_lo, f_hi)})
    return out, W

def simulate(A, W, s):
    """Llenado con orden limitada (24 h de mercado) y salida con velas de 1 h. Datos en el sentido de la señal (compra)."""
    t, o, h, l, c = (A[k] for k in "tohlc")
    i = bisect.bisect_left(t, s["t_sig"]); fill = None
    for n in range(i, min(i + FILL_HOURS, len(t))):
        if l[n] <= s["entry"]: fill = n; break
    if fill is None: return None
    px = min(o[fill], s["entry"])
    if l[fill] <= s["stop"]: return px, min(px, s["stop"]), t[fill], t[fill] + 3600, "stop"
    wk_fill = shifted(t[fill]).isocalendar()[:2]
    wi = W["key"].index(wk_fill); last = W["i1"][min(wi + 1, len(W["key"]) - 1)]
    for n in range(fill + 1, last + 1):
        if l[n] <= s["stop"]: return px, min(o[n], s["stop"]), t[fill], t[n] + 3600, "stop"
        if h[n] >= s["tp"]: return px, s["tp"], t[fill], t[n] + 3600, "meta"
    return px, c[last], t[fill], t[last] + 3600, "fin de la semana siguiente"

def run(name, A, use_vd=True, trend="no", plays=("rebote",)):
    M = mirror(A)
    sl, WL = long_signals(A, use_vd, trend, plays); ss, WS = long_signals(M, use_vd, trend, plays)
    cand = [(s, A, WL, 1) for s in sl] + [(s, M, WS, -1) for s in ss]
    cand.sort(key=lambda x: x[0]["t_sig"])
    busy, trades = 0, []
    for s, data, W, sgn in cand:
        if s["t_sig"] < busy: continue
        r = simulate(data, W, s)
        if r is None: continue
        px, ex, t_fill, t_exit, why = r
        busy = t_exit; risk = s["entry"] - s["stop"]
        R = (ex - px) / risk
        kind, cv = COST[name]; cost = cv if kind == "pts" else cv * abs(px)
        x = {"sym": name, "play": s["play"], "dir": sgn, "t_sig": s["t_sig"], "t_fill": t_fill, "t_exit": t_exit, "salida": why,
             "entry": sgn * s["entry"], "stop": sgn * s["stop"], "tp": sgn * s["tp"], "fill": sgn * px, "exit": sgn * ex,
             "R": R, "R_neto": R - cost / risk, "riesgo": risk, "riesgo_pct": 100 * risk / abs(s["entry"]),
             "part": 1 if s["t_sig"] < SPLIT else 2}
        if sgn == 1: x.update({"pwh": s["pwh"], "pwl": s["pwl"], "vd_lo": s["vd"][0], "vd_hi": s["vd"][1], "fvg_lo": s["fvg"][0], "fvg_hi": s["fvg"][1]})
        else: x.update({"pwh": -s["pwl"], "pwl": -s["pwh"], "vd_lo": -s["vd"][1], "vd_hi": -s["vd"][0], "fvg_lo": -s["fvg"][1], "fvg_hi": -s["fvg"][0]})
        trades.append(x)
    return trades

def stats(tr):
    n = len(tr)
    if not n: return {"n": 0}
    return {"n": n, "aciertos_pct": round(100 * sum(x["R"] > 0 for x in tr) / n, 1), "R_bruto": round(sum(x["R"] for x in tr) / n, 3),
            "R_neto": round(sum(x["R_neto"] for x in tr) / n, 3), "R_total_neto": round(sum(x["R_neto"] for x in tr), 2),
            "stop_pct_mediana": round(sorted(x["riesgo_pct"] for x in tr)[n // 2], 2)}

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    data = {}
    for name in COST:
        p = os.path.join(src, name + ".csv.gz")
        if not os.path.exists(p): print("sin datos", name); continue
        data[name] = load(p); print(name, "velas 1h", len(data[name]["t"]), flush=True)
    variants = {"F": (True, "no", ("rebote",)), "F + día a favor": (True, "dia", ("rebote",)), "F + semana y día a favor": (True, "semana+dia", ("rebote",)),
                "F sin vela de volumen": (False, "no", ("rebote",)), "Ruptura (continuación)": (True, "semana+dia", ("ruptura",))}
    res, all_tr = {}, {}
    for vname, (uv, ut, pl) in variants.items():
        tr = [x for name in data for x in run(name, data[name], uv, ut, pl)]
        all_tr[vname] = tr; r = {}
        for grp, flt in [("TODOS", lambda x: True)] + [(n, (lambda n: lambda x: x["sym"] == n)(n)) for n in data] + \
                        [("compras", lambda x: x["dir"] == 1), ("ventas", lambda x: x["dir"] == -1)]:
            for part in (1, 2): r[f"{grp} parte {part}"] = stats([x for x in tr if flt(x) and x["part"] == part])
        res[vname] = r
        print(vname, json.dumps({k: v for k, v in r.items() if k.startswith(("TODOS", "compras", "ventas"))}, ensure_ascii=False), flush=True)
    a, b = res["F"]["TODOS parte 1"], res["F"]["TODOS parte 2"]
    res["veredicto"] = {"aprueba": bool(a.get("n", 0) + b.get("n", 0) >= 50 and a.get("R_neto", -1) > 0 and b.get("R_neto", -1) > 0)}
    print("VEREDICTO", res["veredicto"])
    json.dump(res, open(os.path.join(dst, "resumen.json"), "w"), indent=1, ensure_ascii=False)
    keys = ["sym", "play", "part", "dir", "t_sig", "t_fill", "t_exit", "salida", "entry", "stop", "tp", "fill", "exit", "R", "R_neto", "riesgo_pct",
            "pwh", "pwl", "vd_lo", "vd_hi", "fvg_lo", "fvg_hi"]
    for vname, tr in all_tr.items():
        fn = {"F": "trades.csv", "F + día a favor": "trades_dia.csv", "F + semana y día a favor": "trades_semana_dia.csv",
              "F sin vela de volumen": "trades_sin_vd.csv", "Ruptura (continuación)": "trades_ruptura.csv"}[vname]
        with open(os.path.join(dst, fn), "w") as f:
            f.write(",".join(keys) + "\n")
            for x in tr: f.write(",".join(str(round(x[k], 4) if isinstance(x[k], float) else x[k]) for k in keys) + "\n")
