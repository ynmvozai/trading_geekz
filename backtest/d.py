# Backtest de la estrategia D (reglas en REGLAS_D.md). Sin dependencias.
# Uso: python3 d.py datos_d/ resultados_d/
import bisect, gzip, json, os, sys, datetime as dt
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
SPLIT = int(os.environ.get("SPLIT_TS", dt.datetime(2026, 6, 12, tzinfo=dt.timezone.utc).timestamp()))
COST_PTS = {"US30": 3.0, "NAS": 1.0}
W_START, W_END, EXIT_MIN = 9 * 60 + 30, 14 * 60, 15 * 60 + 55
VOL_N, MIN_RR, MAX_DAY = 20, 2.0, 2
HERE = os.path.dirname(os.path.abspath(__file__))

# ---------- datos ----------
def load(path):
    A = {k: [] for k in "tohlcv"}
    with gzip.open(path, "rt") as f:
        next(f)
        for line in f:
            a = line.split(",")
            A["t"].append(int(a[0]))
            for k, x in zip("ohlcv", a[1:6]): A[k].append(float(x))
    return A

def ny(ts):
    return dt.datetime.fromtimestamp(ts, NY)

def resample(A, sec):
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

def daily(A):
    """Velas diarias de futuros: de 5:00 PM a 5:00 PM NY. 'end' = hora real de cierre (último minuto + 60 s)."""
    D = {k: [] for k in ("key", "o", "h", "l", "c", "end")}; cur = None
    for i in range(len(A["t"])):
        key = (ny(A["t"][i]) + dt.timedelta(hours=7)).date()
        if key != cur:
            cur = key
            D["key"].append(key); D["o"].append(A["o"][i]); D["h"].append(A["h"][i]); D["l"].append(A["l"][i])
            D["c"].append(A["c"][i]); D["end"].append(A["t"][i] + 60)
        else:
            D["h"][-1] = max(D["h"][-1], A["h"][i]); D["l"][-1] = min(D["l"][-1], A["l"][i])
            D["c"][-1] = A["c"][i]; D["end"][-1] = A["t"][i] + 60
    return D

def pivots(h, l, k=2):
    """Lista de (idx_confirmación, idx_pivote, tipo, nivel). Confirmado al cierre de idx+k."""
    out = []
    for i in range(k, len(h) - k):
        if all(h[i] > h[i + j] for j in range(-k, k + 1) if j): out.append((i + k, i, "H", h[i]))
        if all(l[i] < l[i + j] for j in range(-k, k + 1) if j): out.append((i + k, i, "L", l[i]))
    return sorted(out)

# ---------- zonas diarias ----------
def daily_zones(D):
    Z, n = [], len(D["c"])
    P = pivots(D["h"], D["l"])
    for ci, pi, typ, lvl in P:
        Z.append({"tipo": "máximo" if typ == "H" else "mínimo", "lo": D["l"][pi], "hi": D["h"][pi], "born": D["end"][ci], "src": pi})
    # OB diario por ruptura de máximo/mínimo confirmado
    p, lastH, lastL = 0, None, None
    for j in range(n):
        while p < len(P) and P[p][0] <= j - 1:  # confirmado al cierre de una vela anterior a j
            _, pi, typ, lvl = P[p]
            if typ == "H": lastH = [lvl, False]
            else: lastL = [lvl, False]
            p += 1
        if lastH and not lastH[1] and D["c"][j] > lastH[0]:
            lastH[1] = True
            k = next((k for k in range(j - 1, -1, -1) if D["c"][k] < D["o"][k]), None)
            if k is not None: Z.append({"tipo": "OB alcista", "lo": D["l"][k], "hi": D["h"][k], "born": D["end"][j], "src": k})
        if lastL and not lastL[1] and D["c"][j] < lastL[0]:
            lastL[1] = True
            k = next((k for k in range(j - 1, -1, -1) if D["c"][k] > D["o"][k]), None)
            if k is not None: Z.append({"tipo": "OB bajista", "lo": D["l"][k], "hi": D["h"][k], "born": D["end"][j], "src": k})
    # muerte: primera vela diaria posterior al nacimiento que cierra fuera
    for z in Z:
        z["dead"] = 10 ** 12
        for m in range(n):
            if D["end"][m] <= z["born"]: continue
            if D["c"][m] > z["hi"] or D["c"][m] < z["lo"]:
                z["dead"] = D["end"][m]; break
    Z.sort(key=lambda z: z["born"])
    return Z

def zone_for(Z, T, price):
    best = None
    for z in Z:
        if z["born"] > T: break
        if z["dead"] > T and z["lo"] <= price <= z["hi"]: best = z  # la más reciente gana
    return best

# ---------- señales de 15/30 min ----------
def candidates(B, sec, Z):
    t, o, h, l, c, v = (B[k] for k in "tohlcv")
    P = pivots(h, l); p = 0
    lastH = lastL = None
    state = None  # dict(dir, stop, k_bos)
    out = []
    for k in range(len(t)):
        while p < len(P) and P[p][0] <= k - 1:
            _, pi, typ, lvl = P[p]
            if typ == "H": lastH = [lvl, False]
            else: lastL = [lvl, False]
            p += 1
        if lastH and not lastH[1] and c[k] > lastH[0]:
            lastH[1] = True
            j = next((j for j in range(k - 1, max(-1, k - 200), -1) if c[j] < o[j]), None)
            state = {"dir": 1, "stop": l[j] if j is not None else None, "ob_t": t[j] if j is not None else None, "bos_t": t[k]}
        elif lastL and not lastL[1] and c[k] < lastL[0]:
            lastL[1] = True
            j = next((j for j in range(k - 1, max(-1, k - 200), -1) if c[j] > o[j]), None)
            state = {"dir": -1, "stop": h[j] if j is not None else None, "ob_t": t[j] if j is not None else None, "bos_t": t[k]}
        if not state or k < VOL_N - 1: continue
        d = state["dir"]
        if v[k] < max(v[k - VOL_N + 1:k + 1]): continue
        if not ((d == 1 and c[k] > o[k]) or (d == -1 and c[k] < o[k])): continue
        T = t[k] + sec
        z = zone_for(Z, T, c[k])
        if z is None: continue
        # primera vela que cumple (a)(b)(c): define el trade; luego la ruptura queda usada
        s = dict(state); state = None
        n = ny(T); mins = n.hour * 60 + n.minute
        s.update({"t_entry": T, "entry": c[k], "day": n.date().isoformat(), "zona": z, "vol_t": t[k]})
        if not (W_START <= mins <= W_END): s["motivo"] = "fuera de horario"
        elif s["stop"] is None or (d == 1 and s["stop"] >= c[k]) or (d == -1 and s["stop"] <= c[k]): s["motivo"] = "stop del lado equivocado"
        else:
            tp = z["hi"] if d == 1 else z["lo"]
            risk = abs(c[k] - s["stop"]); s["tp"] = tp
            if d * (tp - c[k]) < MIN_RR * risk: s["motivo"] = "meta a menos de 2R"
            else: s["motivo"] = None
        out.append(s)
    return out

# ---------- salida con velas de 1 min ----------
def simulate(A, s, hold_days):
    t, o, h, l, c = (A[k] for k in "tohlc")
    d, e, st, tp = s["dir"], s["entry"], s["stop"], s["tp"]
    i = bisect.bisect_left(t, s["t_entry"])
    dates, last_ok = [], None
    while i < len(t):
        n = ny(t[i]); dd = n.date()
        if not dates or dates[-1] != dd:
            if n.weekday() < 5: dates.append(dd)
        if len(dates) > hold_days: break
        if dd == dates[-1] and n.hour * 60 + n.minute >= EXIT_MIN and len(dates) == hold_days:
            break
        if d == 1:
            if l[i] <= st: return min(o[i], st), t[i] + 60, "stop"
            if h[i] >= tp: return tp, t[i] + 60, "meta"
        else:
            if h[i] >= st: return max(o[i], st), t[i] + 60, "stop"
            if l[i] <= tp: return tp, t[i] + 60, "meta"
        last_ok = i; i += 1
    if last_ok is None: return e, s["t_entry"], "sin datos"
    return c[last_ok], t[last_ok] + 60, "3:55 PM"

def run(name, A, Z, sec, hold_days):
    B = resample(A, sec)
    cand = candidates(B, sec, Z)
    busy, per_day, trades = 0, {}, []
    for s in cand:
        if s["motivo"]: s["estado"] = "descartada: " + s["motivo"]; continue
        if s["t_entry"] < busy: s["estado"] = "descartada: ya había un trade abierto"; continue
        if per_day.get(s["day"], 0) >= MAX_DAY: s["estado"] = "descartada: ya hubo 2 trades ese día"; continue
        px, t_end, why = simulate(A, s, hold_days)
        busy = t_end; per_day[s["day"]] = per_day.get(s["day"], 0) + 1
        risk = abs(s["entry"] - s["stop"])
        s.update({"exit": px, "t_exit": t_end, "salida": why, "estado": "tomada",
                  "R": s["dir"] * (px - s["entry"]) / risk, "part": 1 if s["t_entry"] < SPLIT else 2, "sym": name})
        s["R_neto"] = s["R"] - COST_PTS[name] / risk
        s["riesgo_pts"] = risk
        trades.append(s)
    return trades, cand

def stats(tr):
    n = len(tr)
    if not n: return {"n": 0}
    return {"n": n, "aciertos_pct": round(100 * sum(x["R"] > 0 for x in tr) / n, 1),
            "R_bruto": round(sum(x["R"] for x in tr) / n, 3), "R_neto": round(sum(x["R_neto"] for x in tr) / n, 3),
            "R_total_neto": round(sum(x["R_neto"] for x in tr), 2),
            "stop_pts_mediana": round(sorted(x["riesgo_pts"] for x in tr)[n // 2], 1)}

def fmt_t(ts): return ny(ts).strftime("%a %d %b %H:%M")

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    data, zones = {}, {}
    for name in ("US30", "NAS"):
        p = os.path.join(src, name + ".csv.gz")
        if not os.path.exists(p): print("sin datos", name); continue
        data[name] = load(p); zones[name] = daily_zones(daily(data[name]))
        print(name, "velas 1m", len(data[name]["t"]), "zonas diarias", len(zones[name]), flush=True)
    variants = {"D (15 min, mismo día)": (900, 1), "D 30 min": (1800, 1), "D 15 min hasta 2 días": (900, 2)}
    res, all_trades, all_cand = {}, {}, {}
    for vname, (sec, hold) in variants.items():
        tr_all = []
        for name in data:
            tr, cand = run(name, data[name], zones[name], sec, hold)
            tr_all += tr; all_cand[(vname, name)] = cand
        all_trades[vname] = tr_all
        r = {}
        for name in list(data) + ["TODOS"]:
            for part in (1, 2):
                r[f"{name} parte {part}"] = stats([x for x in tr_all if (name == "TODOS" or x["sym"] == name) and x["part"] == part])
        res[vname] = r
        print(vname, json.dumps(r, ensure_ascii=False), flush=True)
    main = "D (15 min, mismo día)"
    a, b = res[main]["TODOS parte 1"], res[main]["TODOS parte 2"]
    res["veredicto"] = {"aprueba": bool(a.get("n", 0) + b.get("n", 0) >= 50 and a.get("R_neto", -1) > 0 and b.get("R_neto", -1) > 0)}
    print("VEREDICTO", res["veredicto"])
    json.dump(res, open(os.path.join(dst, "resumen.json"), "w"), indent=1, ensure_ascii=False)
    keys = ["sym", "part", "dir", "day", "t_entry", "entry", "stop", "tp", "exit", "salida", "R", "R_neto", "riesgo_pts"]
    for vname, tr in all_trades.items():
        fn = "trades_" + ("15m" if vname == main else "30m" if "30" in vname else "2dias") + ".csv"
        with open(os.path.join(dst, fn), "w") as f:
            f.write(",".join(keys + ["zona_lo", "zona_hi", "zona_tipo"]) + "\n")
            for x in tr:
                f.write(",".join(str(round(x[k], 3) if isinstance(x[k], float) else x[k]) for k in keys)
                        + f",{x['zona']['lo']},{x['zona']['hi']},{x['zona']['tipo']}\n")
    # chequeo contra los 9 trades de Yasser
    yp = os.path.join(HERE, "yasser9.json")
    if os.path.exists(yp):
        L = []
        for y in json.load(open(yp)):
            sym = y["sym"]
            if sym not in data: continue
            T = int(dt.datetime.fromisoformat(y["hora_ny"]).replace(tzinfo=NY).timestamp())
            A = data[sym]; i = min(bisect.bisect_left(A["t"], T), len(A["t"]) - 1)
            zy = zone_for(zones[sym], T, A["c"][i])
            L.append(f"\n## #{y['n']} {sym} {y['hora_ny']} {y['dir']} · Yasser: entrada {y['entrada']} stop {y['stop']} meta {y['meta']}")
            L.append(f"  Precio Dukascopy a esa hora: {A['c'][i]:.1f} (diferencia con tu entrada: {A['c'][i] - y['entrada']:+.1f})")
            L.append(f"  Zona diaria viva que contiene el precio: " + (f"{zy['tipo']} {zy['lo']:.1f}–{zy['hi']:.1f}" if zy else "ninguna"))
            for vname in variants:
                if "2 días" in vname: continue
                day = y["hora_ny"][:10]
                cs = [s for s in all_cand[(vname, sym)] if s["day"] == day]
                L.append(f"  [{vname}] señales ese día: {len(cs)}")
                for s in cs:
                    extra = f" → {s['salida']} {s['R']:+.2f}R" if s.get("estado") == "tomada" else ""
                    L.append(f"    {fmt_t(s['t_entry'])} {'compra' if s['dir'] == 1 else 'venta'} entrada {s['entry']:.1f} stop {s['stop'] if s['stop'] is None else round(s['stop'], 1)}"
                             f" meta {round(s['tp'], 1) if 'tp' in s else '-'} · zona {s['zona']['tipo']} {s['zona']['lo']:.1f}–{s['zona']['hi']:.1f} · {s['estado']}{extra}")
        open(os.path.join(dst, "chequeo_9.txt"), "w").write("\n".join(L))
        print("\n".join(L))
