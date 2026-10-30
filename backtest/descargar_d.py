# Velas de 1 min CON volumen para Dow y Nasdaq (Dukascopy BID) → datos_d/<SYM>.csv.gz (t,o,h,l,c,v; t = s UTC).
# Uso: python3 descargar_d.py 2026-02-01 2026-10-29
import gzip, lzma, os, struct, sys, time, statistics
import concurrent.futures as cf, datetime as dt, urllib.request, urllib.error

START = dt.date.fromisoformat(sys.argv[1]); END = dt.date.fromisoformat(sys.argv[2])
OUT = "datos_d"; os.makedirs(OUT, exist_ok=True)
SYMS = {"US30": ("USA30IDXUSD", 5000, 100000), "NAS": ("USATECHIDXUSD", 5000, 60000)}

def get(sym, d):
    url = f"https://datafeed.dukascopy.com/datafeed/{sym}/{d.year}/{d.month-1:02d}/{d.day:02d}/BID_candles_min_1.bi5"
    for i in range(8):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 404: return d, []
            time.sleep(2 + 3 * i)
        except Exception:
            time.sleep(2 + 3 * i)
    else:
        print("FALLO", sym, d, flush=True); return d, []
    if not raw: return d, []
    raw = lzma.decompress(raw); base = int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())
    out = []
    for k in range(0, len(raw), 24):
        t, o, c, l, h, v = struct.unpack(">5if", raw[k:k + 24])
        if v == 0 and o == c == h == l: continue
        out.append((base + t, o, h, l, c, v))
    return d, out

t0 = time.time()
for name, (sym, lo, hi) in SYMS.items():
    p = f"{OUT}/{name}.csv.gz"
    if os.path.exists(p): print(name, "ya estaba"); continue
    ds = []; d = START
    while d <= END:
        if d.weekday() != 5: ds.append(d)
        d += dt.timedelta(1)
    with cf.ThreadPoolExecutor(3) as ex:
        res = list(ex.map(lambda d: get(sym, d), ds))
    rows = sorted(r for _, rr in res for r in rr)
    med = statistics.median([r[4] for r in rows[:5000]])
    div = next(x for x in (1, 10, 100, 1000, 10000, 100000) if lo <= med / x <= hi)
    with gzip.open(p, "wt") as f:
        f.write("t,o,h,l,c,v\n")
        for t, o, h, l, c, v in rows:
            f.write(f"{t},{o/div:.2f},{h/div:.2f},{l/div:.2f},{c/div:.2f},{v:.4f}\n")
    print(name, "velas", len(rows), "dias", sum(1 for _, rr in res if rr), "de", len(ds), "divisor", div,
          "desde", dt.datetime.fromtimestamp(rows[0][0], dt.timezone.utc), "hasta", dt.datetime.fromtimestamp(rows[-1][0], dt.timezone.utc), flush=True)
print("listo en", round(time.time() - t0), "s")
