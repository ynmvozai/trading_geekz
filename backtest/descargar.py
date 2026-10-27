# Baja velas de 1 min y las guarda como datos/<SYM>.csv.gz con columnas t,o,h,l,c (t = segundos UTC).
# BTC/SOL: Binance spot (data.binance.vision, zips mensuales/diarios). Oro, Dow, Nasdaq: Dukascopy BID.
# Uso: python3 descargar.py 2026-02-01 2026-10-23
import csv, gzip, io, lzma, os, struct, sys, time, zipfile, statistics
import concurrent.futures as cf, datetime as dt, urllib.request, urllib.error

START = dt.date.fromisoformat(sys.argv[1]); END = dt.date.fromisoformat(sys.argv[2])
OUT = "datos"; os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0"}

def http(url, tries=8):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(2 + 3 * i)
        except Exception:
            time.sleep(2 + 3 * i)
    print("FALLO", url, flush=True); return None

def days():
    d = START
    while d <= END:
        yield d; d += dt.timedelta(1)

# ---------- Binance ----------
def binance_day(sym, d):
    url = f"https://data.binance.vision/data/spot/daily/klines/{sym}/1m/{sym}-1m-{d:%Y-%m-%d}.zip"
    raw = http(url)
    if raw is None: return d, []
    z = zipfile.ZipFile(io.BytesIO(raw)); rows = []
    for r in csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]))):
        t = int(r[0]); t = t // 1000000 if t > 1e14 else t // 1000   # 2025+ usa microsegundos
        rows.append((t, float(r[1]), float(r[2]), float(r[3]), float(r[4])))
    return d, rows

# ---------- Dukascopy ----------
DUKA = {"XAU": ("XAUUSD", 1000, 8000), "US30": ("USA30IDXUSD", 5000, 100000), "NAS": ("USATECHIDXUSD", 5000, 60000)}
def duka_day(sym, d):
    url = f"https://datafeed.dukascopy.com/datafeed/{sym}/{d.year}/{d.month-1:02d}/{d.day:02d}/BID_candles_min_1.bi5"
    raw = http(url)
    if not raw: return d, []
    raw = lzma.decompress(raw); base = int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())
    rows = []
    for k in range(0, len(raw), 24):
        t, o, c, l, h, v = struct.unpack(">5if", raw[k:k + 24])
        if v == 0 and o == c == h == l: continue
        rows.append((base + t, o, h, l, c))
    return d, rows

def save(name, rows, div=1.0):
    rows.sort()
    with gzip.open(f"{OUT}/{name}.csv.gz", "wt") as f:
        f.write("t,o,h,l,c\n")
        for t, o, h, l, c in rows:
            f.write(f"{t},{o/div:.6g},{h/div:.6g},{l/div:.6g},{c/div:.6g}\n")
    print(name, "velas", len(rows), "desde", dt.datetime.fromtimestamp(rows[0][0], dt.timezone.utc) if rows else None,
          "hasta", dt.datetime.fromtimestamp(rows[-1][0], dt.timezone.utc) if rows else None, flush=True)

t0 = time.time()
for name, sym in (("BTC", "BTCUSDT"), ("SOL", "SOLUSDT")):
    if os.path.exists(f"{OUT}/{name}.csv.gz"): print(name, "ya estaba"); continue
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda d: binance_day(sym, d), days()))
    save(name, [r for _, rows in res for r in rows])
for name, (sym, lo, hi) in DUKA.items():
    if os.path.exists(f"{OUT}/{name}.csv.gz"): print(name, "ya estaba"); continue
    ds = [d for d in days() if d.weekday() != 5]
    with cf.ThreadPoolExecutor(3) as ex:
        res = list(ex.map(lambda d: duka_day(sym, d), ds))
    rows = [r for _, rr in res for r in rr]
    med = statistics.median([r[4] for r in rows[:5000]])
    div = next(x for x in (1, 10, 100, 1000, 10000, 100000) if lo <= med / x <= hi)
    save(name, rows, div)
print("listo en", round(time.time() - t0), "s")
