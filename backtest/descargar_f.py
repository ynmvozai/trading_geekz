# Velas de 1 HORA con volumen (Dukascopy BID, archivo mensual) → datos_f/<SYM>.csv.gz (t,o,h,l,c,v; t = s UTC).
# Uso: python3 descargar_f.py 2022-01 2026-10
import gzip, lzma, os, struct, sys, time, statistics
import concurrent.futures as cf, datetime as dt, urllib.request, urllib.error

y0, m0 = map(int, sys.argv[1].split("-")); y1, m1 = map(int, sys.argv[2].split("-"))
OUT = "datos_f"; os.makedirs(OUT, exist_ok=True)
# nombre: (símbolo Dukascopy, precio mínimo y máximo razonables para adivinar el divisor)
SYMS = {"US30": ("USA30IDXUSD", 15000, 100000), "NAS": ("USATECHIDXUSD", 5000, 45000), "XAU": ("XAUUSD", 1000, 8000), "BTC": ("BTCUSD", 10000, 99000)}

def months():
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        yield y, m
        m += 1
        if m > 12: y, m = y + 1, 1

def get(sym, ym):
    y, m = ym
    url = f"https://datafeed.dukascopy.com/datafeed/{sym}/{y}/{m-1:02d}/BID_candles_hour_1.bi5"
    raw = None
    for i in range(8):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=40).read(); break
        except urllib.error.HTTPError as e:
            if e.code == 404: print("404", sym, ym, flush=True); return []
            time.sleep(2 + 3 * i)
        except Exception:
            time.sleep(2 + 3 * i)
    if raw is None: print("FALLO", sym, ym, flush=True); return []
    if not raw: return []
    raw = lzma.decompress(raw); base = int(dt.datetime(y, m, 1, tzinfo=dt.timezone.utc).timestamp())
    out = []
    for k in range(0, len(raw) - 23, 24):
        t, o, c, l, h, v = struct.unpack(">5if", raw[k:k + 24])
        if v == 0 and o == c == h == l: continue
        out.append((base + t, o, h, l, c, v))
    return out

t0 = time.time()
for name, (sym, lo, hi) in SYMS.items():
    p = f"{OUT}/{name}.csv.gz"
    if os.path.exists(p): print(name, "ya estaba"); continue
    ms = list(months())
    with cf.ThreadPoolExecutor(3) as ex:
        res = list(ex.map(lambda ym: get(sym, ym), ms))
    rows = sorted(r for rr in res for r in rr)
    if not rows: print(name, "SIN DATOS"); continue
    med = statistics.median([r[4] for r in rows[:3000]])
    div = next((x for x in (1, 10, 100, 1000, 10000, 100000) if lo <= med / x <= hi), None)
    if div is None: print(name, "no pude adivinar el divisor; mediana cruda", med); continue
    gaps = sum(1 for a, b in zip(rows, rows[1:]) if (b[0] - a[0]) % 3600)
    with gzip.open(p, "wt") as f:
        f.write("t,o,h,l,c,v\n")
        for t, o, h, l, c, v in rows:
            f.write(f"{t},{o/div:.2f},{h/div:.2f},{l/div:.2f},{c/div:.2f},{v:.4f}\n")
    print(name, "velas 1h", len(rows), "meses con datos", sum(1 for rr in res if rr), "de", len(ms), "divisor", div, "desfases", gaps,
          "desde", dt.datetime.fromtimestamp(rows[0][0], dt.timezone.utc), "hasta", dt.datetime.fromtimestamp(rows[-1][0], dt.timezone.utc),
          "primer cierre", round(rows[0][4] / div, 2), "último cierre", round(rows[-1][4] / div, 2), flush=True)
print("listo en", round(time.time() - t0), "s")
