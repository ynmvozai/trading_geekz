# Backtest de la estrategia E (reglas en REGLAS_E.md). Reutiliza piezas de d.py. Sin dependencias.
# Uso: python3 e.py datos_d/ resultados_e/
import bisect, json, os, sys, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d as D

TOUCH_GAP, TOUCH_N, OB_BACK, BIG_X = 2, 3, 10, 3.0

def prev_day_zone(Dd):
    """clave del día de futuros -> (piso, techo) de la vela diaria ANTERIOR."""
    return {Dd["key"][i]: (Dd["l"][i - 1], Dd["h"][i - 1]) for i in range(1, len(Dd["key"]))}

def mirror(B):
    return {"t": B["t"], "v": B["v"], "o": [-x for x in B["o"]], "c": [-x for x in B["c"]], "h": [-x for x in B["l"]], "l": [-x for x in B["h"]]}

def scan_side(B, sec, zone_of, flip):
    """Busca VENTAS por rechazo en el techo (E-1) y COMPRAS por ruptura del techo (E-2).
    Con flip=True los datos vienen espejados: equivale a compras en el piso y ventas por ruptura del piso."""
    t, o, h, l, c, v = (B[k] for k in "tohlcv")
    P = D.pivots(h, l); p = 0
    lastL = None
    key_prev = None; n_top = 0; last_touch = None; third_k = None; rej = None; pend_brk = None
    out = []
    for k in range(len(t)):
        while p < len(P) and P[p][0] <= k - 1:
            _, pi, typ, lvl = P[p]
            if typ == "L": lastL = [lvl, False]
            p += 1
        key = (D.ny(t[k]) + dt.timedelta(hours=7)).date()
        if key != key_prev:
            key_prev = key; n_top = 0; last_touch = None; third_k = None; rej = None; pend_brk = None
        z = zone_of.get(key)
        if z is None: continue
        lo, hi = (-z[1], -z[0]) if flip else z      # espejado: el piso real pasa a ser el techo
        T = t[k] + sec
        nyT = D.ny(T); mins = nyT.hour * 60 + nyT.minute; day = nyT.date().isoformat()
        in_win = D.W_START <= mins <= D.W_END
        bos_down = bool(lastL and not lastL[1] and c[k] < lastL[0])
        if bos_down: lastL[1] = True

        # ----- E-2: ruptura del techo -----
        def emit_brk(kk, j):
            s = {"sub": "E-2", "dir": 1, "entry": c[kk], "stop": l[j], "t_entry": t[kk] + sec, "day": day, "zona": (lo, hi)}
            s["motivo"] = None if in_win else "fuera de horario"
            if s["motivo"] is None and not (s["stop"] < s["entry"]): s["motivo"] = "stop del lado equivocado"
            if s["motivo"] is None: s["tp"] = s["entry"] + 2 * (s["entry"] - s["stop"])
            out.append(s)
        if pend_brk is not None:
            kb, j = pend_brk; pend_brk = None
            if k == kb + 1 and c[k] > hi and l[k] > h[kb - 1]: emit_brk(k, j)
        if k >= 2 and c[k] > hi and c[k - 1] <= hi:
            j = next((j for j in range(k - 1, max(-1, k - 1 - OB_BACK), -1) if c[j] < o[j]), None)
            if j is not None:
                big = (h[j + 1] - l[j + 1]) >= BIG_X * (h[j] - l[j]) and (h[j] - l[j]) > 0
                fvg = l[k] > h[k - 2]
                if big or fvg: emit_brk(k, j)
                else: pend_brk = (k, j)

        # ----- E-1: rechazo en el techo -----
        if c[k] > hi:
            n_top = 0; last_touch = None; third_k = None; rej = None
        elif h[k] >= hi and c[k] >= lo:                 # toque: mecha al techo y cierre dentro
            if last_touch is None or k - last_touch > TOUCH_GAP: n_top += 1
            last_touch = k
            if n_top >= TOUCH_N and third_k is None: third_k = k
        if third_k is not None and bos_down and k >= third_k and rej is None:
            j = next((j for j in range(k - 1, max(-1, k - 200), -1) if c[j] > o[j]), None)
            rej = {"stop": h[j] if j is not None else None}
        if rej is not None and k >= D.VOL_N - 1 and v[k] >= max(v[k - D.VOL_N + 1:k + 1]) and c[k] < o[k] and lo <= c[k] <= hi:
            s = {"sub": "E-1", "dir": -1, "entry": c[k], "stop": rej["stop"], "t_entry": T, "day": day, "zona": (lo, hi), "toques": n_top}
            if not in_win: s["motivo"] = "fuera de horario"
            elif s["stop"] is None or s["stop"] <= c[k]: s["motivo"] = "stop del lado equivocado"
            else:
                s["tp"] = lo
                s["motivo"] = None if (c[k] - lo) >= D.MIN_RR * (s["stop"] - c[k]) else "meta a menos de 2R"
            out.append(s)
            rej = None; n_top = 0; last_touch = None; third_k = None
    if flip:
        for s in out:
            s["dir"] = -s["dir"]
            for kx in ("entry", "stop", "tp"):
                if s.get(kx) is not None: s[kx] = -s[kx]
            s["zona"] = (-s["zona"][1], -s["zona"][0])
    return out

def run(name, A, zone_of, sec, tp_mult=2.0):
    B = D.resample(A, sec)
    cand = scan_side(B, sec, zone_of, False) + scan_side(mirror(B), sec, zone_of, True)
    cand.sort(key=lambda s: s["t_entry"])
    busy, per_day, trades = 0, {}, []
    for s in cand:
        if s["motivo"]: s["estado"] = "descartada: " + s["motivo"]; continue
        if s["sub"] == "E-2" and tp_mult != 2.0: s["tp"] = s["entry"] + s["dir"] * tp_mult * abs(s["entry"] - s["stop"])
        if s["t_entry"] < busy: s["estado"] = "descartada: ya había un trade abierto"; continue
        if per_day.get(s["day"], 0) >= D.MAX_DAY: s["estado"] = "descartada: ya hubo 2 trades ese día"; continue
        px, t_end, why = D.simulate(A, s, 1)
        busy = t_end; per_day[s["day"]] = per_day.get(s["day"], 0) + 1
        risk = abs(s["entry"] - s["stop"])
        s.update({"exit": px, "t_exit": t_end, "salida": why, "estado": "tomada", "sym": name, "riesgo_pts": risk,
                  "R": s["dir"] * (px - s["entry"]) / risk, "part": 1 if s["t_entry"] < D.SPLIT else 2})
        s["R_neto"] = s["R"] - D.COST_PTS[name] / risk
        trades.append(s)
    return trades, cand

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
    data, zones = {}, {}
    for name in ("US30", "NAS"):
        p = os.path.join(src, name + ".csv.gz")
        if not os.path.exists(p): print("sin datos", name); continue
        data[name] = D.load(p); zones[name] = prev_day_zone(D.daily(data[name]))
        print(name, "velas 1m", len(data[name]["t"]), "días con zona", len(zones[name]), flush=True)
    variants = {"E 15 min": (900, 2.0), "E 5 min": (300, 2.0), "E 30 min": (1800, 2.0), "E 15 min · ruptura a 3R": (900, 3.0)}
    res, all_tr, all_cand = {}, {}, {}
    for vname, (sec, tpm) in variants.items():
        tr_all = []
        for name in data:
            tr, cand = run(name, data[name], zones[name], sec, tpm)
            tr_all += tr; all_cand[(vname, name)] = cand
        all_tr[vname] = tr_all; r = {}
        for sub in ("E-1", "E-2"):
            for name in list(data) + ["TODOS"]:
                for part in (1, 2):
                    r[f"{sub} {name} parte {part}"] = D.stats([x for x in tr_all if x["sub"] == sub and (name == "TODOS" or x["sym"] == name) and x["part"] == part])
        res[vname] = r
        print(vname, json.dumps({k: v for k, v in r.items() if "TODOS" in k}, ensure_ascii=False), flush=True)
    ver = {}
    for sub in ("E-1", "E-2"):
        a, b = res["E 15 min"][f"{sub} TODOS parte 1"], res["E 15 min"][f"{sub} TODOS parte 2"]
        ver[sub] = bool(a.get("n", 0) + b.get("n", 0) >= 50 and a.get("R_neto", -1) > 0 and b.get("R_neto", -1) > 0)
    res["veredicto"] = ver; print("VEREDICTO", ver)
    json.dump(res, open(os.path.join(dst, "resumen.json"), "w"), indent=1, ensure_ascii=False)
    keys = ["sub", "sym", "part", "dir", "day", "t_entry", "entry", "stop", "tp", "exit", "salida", "R", "R_neto", "riesgo_pts"]
    for vname, tr in all_tr.items():
        fn = "trades_" + vname.replace("E ", "").replace(" · ruptura a 3R", "_3R").replace(" ", "") + ".csv"
        with open(os.path.join(dst, fn), "w") as f:
            f.write(",".join(keys + ["zona_lo", "zona_hi"]) + "\n")
            for x in tr:
                f.write(",".join(str(round(x[k], 3) if isinstance(x[k], float) else x[k]) for k in keys) + f",{x['zona'][0]},{x['zona'][1]}\n")
    yp = os.path.join(D.HERE, "yasser9.json")
    if os.path.exists(yp):
        L = []
        for y in json.load(open(yp)):
            sym = y["sym"]
            if sym not in data: continue
            T = int(dt.datetime.fromisoformat(y["hora_ny"]).replace(tzinfo=D.NY).timestamp())
            key = (D.ny(T) + dt.timedelta(hours=7)).date(); z = zones[sym].get(key)
            L.append(f"\n## #{y['n']} {sym} {y['hora_ny']} {y['dir']} · Yasser: entrada {y['entrada']} stop {y['stop']} meta {y['meta']}")
            L.append("  Vela diaria anterior: " + (f"piso {z[0]:.1f} · techo {z[1]:.1f}" if z else "sin dato"))
            for vname in ("E 15 min", "E 5 min", "E 30 min"):
                cs = [s for s in all_cand[(vname, sym)] if s["day"] == y["hora_ny"][:10]]
                L.append(f"  [{vname}] señales ese día: {len(cs)}")
                for s in cs:
                    extra = f" → {s['salida']} {s['R']:+.2f}R" if s.get("estado") == "tomada" else ""
                    st = "-" if s.get("stop") is None else f"{s['stop']:.1f}"; tp = f"{s['tp']:.1f}" if s.get("tp") is not None else "-"
                    L.append(f"    {D.fmt_t(s['t_entry'])} {s['sub']} {'compra' if s['dir'] == 1 else 'venta'} entrada {s['entry']:.1f} stop {st} meta {tp} · {s['estado']}{extra}")
        open(os.path.join(dst, "chequeo_9.txt"), "w").write("\n".join(L)); print("\n".join(L))
