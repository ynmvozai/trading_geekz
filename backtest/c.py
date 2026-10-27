# Backtest de la estrategia C (reglas en REGLAS_C.md). Sin dependencias.
# Uso: python3 c.py datos/ resultados/
import gzip, json, os, sys, datetime as dt
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
SPLIT = int(os.environ.get("SPLIT_TS", dt.datetime(2026, 6, 12, tzinfo=dt.timezone.utc).timestamp()))
COSTS = {"c010": 0.001, "c004": 0.0004}
W_START, W_END, EXIT_MIN = 9 * 60 + 30, 12 * 60 + 30, 15 * 60 + 55

def load(path):
    t, o, h, l, c = [], [], [], [], []
    with gzip.open(path, "rt") as f:
        next(f)
        for line in f:
            a = line.split(",")
            t.append(int(a[0])); o.append(float(a[1])); h.append(float(a[2])); l.append(float(a[3])); c.append(float(a[4]))
    return t, o, h, l, c

def ny_info(ts):
    d = dt.datetime.fromtimestamp(ts, NY)
    return d.date().isoformat(), d.hour * 60 + d.minute

def resample(t, o, h, l, c, sec):
    R = {"t": [], "o": [], "h": [], "l": [], "c": []}; cur = None
    for i in range(len(t)):
        b = t[i] // sec * sec
        if b != cur:
            cur = b; R["t"].append(b); R["o"].append(o[i]); R["h"].append(h[i]); R["l"].append(l[i]); R["c"].append(c[i])
        else:
            if h[i] > R["h"][-1]: R["h"][-1] = h[i]
            if l[i] < R["l"][-1]: R["l"][-1] = l[i]
            R["c"][-1] = c[i]
    return R

def mirror(B):  # largo ↔ corto: precios negados, máximos y mínimos intercambiados
    return {"t": B["t"], "o": [-x for x in B["o"]], "c": [-x for x in B["c"]], "h": [-x for x in B["l"]], "l": [-x for x in B["h"]]}

def fvg_zones(B, sec):
    Z = []
    h, l, t = B["h"], B["l"], B["t"]
    for i in range(2, len(t)):
        if t[i] - t[i - 2] != 2 * sec: continue  # velas seguidas
        born = t[i] + sec
        if l[i] > h[i - 2]: Z.append({"side": "buy", "lo": h[i - 2], "hi": l[i], "born": born})
        elif h[i] < l[i - 2]: Z.append({"side": "sell", "lo": h[i], "hi": l[i - 2], "born": born})
    return Z

def zone_deaths(Z, B5):
    t, c = B5["t"], B5["c"]; import bisect
    for z in Z:
        end = z["born"] + 10 * 86400; z["dead"] = end
        k = bisect.bisect_left(t, z["born"])
        while k < len(t) and t[k] + 300 <= end:
            if (z["side"] == "buy" and c[k] < z["lo"]) or (z["side"] == "sell" and c[k] > z["hi"]):
                z["dead"] = t[k] + 300; break
            k += 1
    return Z

def mirror_zones(Z):
    return [{"side": "sell" if z["side"] == "buy" else "buy", "lo": -z["hi"], "hi": -z["lo"], "born": z["born"], "dead": z["dead"]} for z in Z]

def alive(Z, T):
    return [z for z in Z if z["born"] <= T < z["dead"]]

def pivots_high(h, k=2):
    """conf[n] = lista acumulada no; devuelve lista de (idx_confirmación, nivel)."""
    out = []
    for i in range(k, len(h) - k):
        v = h[i]
        if all(v > h[i - j] for j in range(1, k + 1)) and all(v > h[i + j] for j in range(1, k + 1)):
            out.append((i + k, v))
    return out

def run_long(M1, M5, Z, ny1, ny5):
    """Candidatos de compra (en datos espejados sirve para ventas)."""
    import bisect
    t1, o1, h1, l1, c1 = M1["t"], M1["o"], M1["h"], M1["l"], M1["c"]
    t5, h5, l5, c5 = M5["t"], M5["h"], M5["l"], M5["c"]
    piv_low5 = {ci: -v for ci, v in pivots_high([-x for x in l5])}  # idx conf -> nivel del mínimo
    ph1 = pivots_high(h1); ph1_conf = [p[0] for p in ph1]
    out = []
    PL, intact = None, False
    for k in range(len(t5)):
        if k in piv_low5:  # pivote confirmado al cierre de k: vale desde k+1
            pass
        # evaluar la vela k con el último pivote confirmado hasta k-1
        if PL is not None and intact and l5[k] < PL:
            intact = False
            day, m = ny5[k]
            if c5[k] > PL and m >= W_START and m + 5 <= W_END:
                s = setup(k, M1, t5[k], t5[k] + 300, l5[k], c5[k], ph1, ph1_conf, Z, ny1)
                if s: out.append(s)
        if k in piv_low5:
            PL, intact = piv_low5[k], True
    return out

def setup(k, M1, T0, T, low, close5, ph1, ph1_conf, Z, ny1):
    import bisect
    t1, o1, h1, l1, c1 = M1["t"], M1["o"], M1["h"], M1["l"], M1["c"]
    j0 = bisect.bisect_left(t1, T)
    w0 = bisect.bisect_left(t1, T0)
    if j0 >= len(t1) or w0 >= j0: return None
    w = min(range(w0, j0), key=lambda i: l1[i])           # vela de 1m con la mecha
    stop = low - abs(low) * 0.0001
    # último máximo swing de 1m (confirmado antes de T) por encima del cierre de la neutralización
    p = bisect.bisect_left(ph1_conf, j0) - 1; H = None
    while p >= 0 and t1[ph1_conf[p]] >= T - 6 * 3600:
        if ph1[p][1] > close5: H = ph1[p][1]; break
        p -= 1
    if H is None: return None
    j = j0; brk = None
    while j < len(t1) and t1[j] < T + 3600:
        if l1[j] < low: return None
        if c1[j] > H: brk = j; break
        j += 1
    if brk is None: return None
    # nivel de entrada: FVG más reciente del impulso; si no hay, máximo de la última vela bajista
    entry, place, kind = None, brk, None
    for m in range(min(brk + 1, len(t1) - 1), w + 1, -1):
        if l1[m] > h1[m - 2]: entry, place, kind = l1[m], max(brk, m), "FVG"; break
    if entry is None:
        for m in range(brk - 1, w - 1, -1):
            if c1[m] < o1[m]: entry, kind = h1[m], "OB"; break
    if entry is None or not (stop < entry < c1[place]): return None
    risk = entry - stop
    tps = [z["lo"] for z in alive(Z, t1[place] + 60) if z["lo"] > entry]
    if not tps: return None
    tp = min(tps)
    if tp - entry < risk: return None
    inside = any(z["side"] == "buy" and z["lo"] <= low <= z["hi"] for z in alive(Z, T))
    base = {"t_sweep": T, "variant": "B" if inside else "A", "entry": entry, "stop": stop, "tp": tp, "kind": kind,
            "t_place": t1[place] + 60, "day": ny1[j0][0]}
    # llenado
    n = place + 1; cancel = t1[brk] + 60 + 1800; fill = None
    while n < len(t1) and t1[n] < cancel and ny1[n][1] < W_END and ny1[n][0] == base["day"]:
        if l1[n] <= entry: fill = n; break
        n += 1
    if fill is None:
        return dict(base, filled=False, t_end=min(cancel, t1[n] if n < len(t1) else cancel))
    px = min(o1[fill], entry)
    if l1[fill] <= stop:
        return dict(base, filled=True, fill_px=px, exit_px=min(px, stop), t_end=t1[fill] + 60, why="stop")
    n = fill + 1
    while n < len(t1) and ny1[n][0] == base["day"] and ny1[n][1] < EXIT_MIN:
        if l1[n] <= stop: return dict(base, filled=True, fill_px=px, exit_px=min(o1[n], stop), t_end=t1[n] + 60, why="stop")
        if h1[n] >= tp: return dict(base, filled=True, fill_px=px, exit_px=tp, t_end=t1[n] + 60, why="tp")
        n += 1
    last = n - 1
    return dict(base, filled=True, fill_px=px, exit_px=c1[last], t_end=t1[last] + 60, why="15:55")

def run_symbol(path):
    t, o, h, l, c = load(path)
    M1 = {"t": t, "o": o, "h": h, "l": l, "c": c}
    M5 = resample(t, o, h, l, c, 300)
    Z = fvg_zones(resample(t, o, h, l, c, 3600), 3600) + fvg_zones(resample(t, o, h, l, c, 14400), 14400)
    zone_deaths(Z, M5)
    ny1 = [ny_info(x) for x in t]; ny5 = [ny_info(x) for x in M5["t"]]
    cand = []
    for s in run_long(M1, M5, Z, ny1, ny5): cand.append(dict(s, side="long"))
    MM1, MM5 = mirror(M1), mirror(M5)
    for s in run_long(MM1, MM5, mirror_zones(Z), ny1, ny5):
        for key in ("entry", "stop", "tp", "fill_px", "exit_px"):
            if key in s: s[key] = -s[key]
        cand.append(dict(s, side="short"))
    cand.sort(key=lambda s: s["t_sweep"])
    busy, per_day, trades = 0, {}, []
    for s in cand:
        if s["t_sweep"] < busy: continue
        if s["filled"] and per_day.get(s["day"], 0) >= 2: continue
        busy = s["t_end"]
        if not s["filled"]: continue
        per_day[s["day"]] = per_day.get(s["day"], 0) + 1
        sign = 1 if s["side"] == "long" else -1
        risk = abs(s["entry"] - s["stop"])
        s["R"] = sign * (s["exit_px"] - s["fill_px"]) / risk
        for name, pct in COSTS.items(): s["R_" + name] = s["R"] - pct * abs(s["fill_px"]) / risk
        s["part"] = 1 if s["t_sweep"] < SPLIT else 2
        trades.append(s)
    return trades, len(Z)

def stats(tr):
    n = len(tr)
    if not n: return {"n": 0}
    f = lambda k: round(sum(x[k] for x in tr) / n, 3)
    return {"n": n, "gana_pct": round(100 * sum(1 for x in tr if x["R"] > 0) / n, 1), "R": f("R"),
            "R_c010": f("R_c010"), "R_c004": f("R_c004"), "R_total_c010": round(sum(x["R_c010"] for x in tr), 2)}

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    allt, res = [], {}
    for name in ("BTC", "SOL", "XAU", "US30", "NAS"):
        p = os.path.join(src, name + ".csv.gz")
        if not os.path.exists(p): print("sin datos", name); continue
        tr, nz = run_symbol(p)
        for x in tr: x["sym"] = name
        allt += tr
        res[name] = {"zonas": nz}
        for v in ("A", "B"):
            for part in (1, 2):
                res[name][f"C-{v} parte {part}"] = stats([x for x in tr if x["variant"] == v and x["part"] == part])
        print(name, json.dumps(res[name]), flush=True)
    for v in ("A", "B"):
        for part in (1, 2):
            res.setdefault("TODOS", {})[f"C-{v} parte {part}"] = stats([x for x in allt if x["variant"] == v and x["part"] == part])
    json.dump(res, open(os.path.join(dst, "resumen.json"), "w"), indent=1)
    keys = ["sym", "variant", "part", "side", "day", "kind", "entry", "stop", "tp", "fill_px", "exit_px", "why", "R", "R_c010", "R_c004", "t_sweep"]
    with open(os.path.join(dst, "trades.csv"), "w") as f:
        f.write(",".join(keys) + "\n")
        for x in allt: f.write(",".join(str(round(x[k], 6) if isinstance(x[k], float) else x[k]) for k in keys) + "\n")
    print("TODOS", json.dumps(res["TODOS"]))
