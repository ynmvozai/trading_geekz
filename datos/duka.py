# Descarga velas de 1 min de Dukascopy (BID) para US30 y NAS100 y las guarda como CSV.gz (UTC).
import lzma, struct, sys, gzip, datetime as dt, urllib.request, concurrent.futures as cf, time, statistics
SYMS = {"USA30IDXUSD": (5000, 100000), "USATECHIDXUSD": (5000, 60000)}
start = dt.date.fromisoformat(sys.argv[1]); end = dt.date.fromisoformat(sys.argv[2])
def get(sym, d):
    url = f"https://datafeed.dukascopy.com/datafeed/{sym}/{d.year}/{d.month-1:02d}/{d.day:02d}/BID_candles_min_1.bi5"
    for i in range(4):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read()
            if not r: return d, []
            raw = lzma.decompress(r)
            out = []
            for k in range(0, len(raw), 24):
                t, o, c, l, h, v = struct.unpack(">5if", raw[k:k+24])
                out.append((t, o, h, l, c, v))
            return d, out
        except urllib.error.HTTPError as e:
            if e.code == 404: return d, []
            time.sleep(2 + i * 3)
        except Exception:
            time.sleep(2 + i * 3)
    print("FALLO", sym, d, flush=True); return d, None
for sym, (lo, hi) in SYMS.items():
    days = [start + dt.timedelta(n) for n in range((end - start).days + 1)]
    days = [d for d in days if d.weekday() != 5]
    res = {}
    with cf.ThreadPoolExecutor(12) as ex:
        for d, rows in ex.map(lambda d: get(sym, d), days): res[d] = rows
    allc = [r for d in sorted(res) if res[d] for r in res[d]]
    med = statistics.median([r[4] for r in allc[:5000]])
    div = next(x for x in (1, 10, 100, 1000, 10000, 100000) if lo <= med / x <= hi)
    n = 0
    with gzip.open(f"{sym}.csv.gz", "wt") as f:
        f.write("t,o,h,l,c,v\n")
        for d in sorted(res):
            if not res[d]: continue
            base = int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())
            for t, o, h, l, c, v in res[d]:
                if v == 0 and o == c == h == l: continue
                f.write(f"{base+t},{o/div:.2f},{h/div:.2f},{l/div:.2f},{c/div:.2f},{v:.3f}\n"); n += 1
    print(sym, "días", sum(1 for d in res if res[d]), "fallos", sum(1 for d in res if res[d] is None), "velas", n, "divisor", div, flush=True)
