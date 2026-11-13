# Velas de 15 min con volumen para UN símbolo y UN año (Dukascopy 1 min BID, agregadas) → salida/<SYM>_<AÑO>.csv.gz
# Uso: python3 descargar_15m.py US30 2024 [mes_final]
import gzip, lzma, os, struct, sys, time
import concurrent.futures as cf, datetime as dt, urllib.request, urllib.error

NAME, YEAR = sys.argv[1], int(sys.argv[2]); LAST_M = int(sys.argv[3]) if len(sys.argv) > 3 else 12
SYM = {"US30": "USA30IDXUSD", "NAS": "USATECHIDXUSD", "XAU": "XAUUSD", "BTC": "BTCUSD"}[NAME]
DIV = {"US30": 1000, "NAS": 1000, "XAU": 1000, "BTC": 10}[NAME]
OUT = "salida"; os.makedirs(OUT, exist_ok=True)
AGENT = {"User-Agent": "Mozilla/5.0"}

def get(d, tries=8):
    url = f"https://datafeed.dukascopy.com/datafeed/{SYM}/{d.year}/{d.month-1:02d}/{d.day:02d}/BID_candles_min_1.bi5"
    raw = None
    for i in range(tries):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=40).read(); break
        except urllib.error.HTTPError as e:
            if e.code == 404: return []
            time.sleep(2 + 3 * i)
        except Exception:
            time.sleep(2 + 3 * i)
    if raw is None: return None
    if not raw: return []
    raw = lzma.decompress(raw); base = int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())
    out = []
    for k in range(0, len(raw) - 23, 24):
        t, o, c, l, h, v = struct.unpack(">5if", raw[k:k + 24])
        if v == 0 and o == c == h == l: continue
        out.append((base + t, o, h, l, c, v))
    return out

days = []; d = dt.date(YEAR, 1, 1)
while d.year == YEAR and d.month <= LAST_M:
    if NAME == "BTC" or d.weekday() != 5: days.append(d)
    d += dt.timedelta(1)
t0 = time.time()
with cf.ThreadPoolExecutor(3) as ex: res = list(ex.map(get, days))
bad = 0
for n, d in enumerate(days):
    if res[n] is None:
        time.sleep(15); res[n] = get(d, tries=14)
        if res[n] is None: bad += 1; print("FALLO DEFINITIVO", NAME, d, flush=True); res[n] = []
bars = {}
for rr in res:
    for t, o, h, l, c, v in rr:
        b = t // 900 * 900; x = bars.get(b)
        if x is None: bars[b] = [o, h, l, c, v]
        else:
            if h > x[1]: x[1] = h
            if l < x[2]: x[2] = l
            x[3] = c; x[4] += v
with gzip.open(f"{OUT}/{NAME}_{YEAR}.csv.gz", "wt") as f:
    f.write("t,o,h,l,c,v\n")
    for b in sorted(bars):
        o, h, l, c, v = bars[b]; f.write(f"{b},{o/DIV:.2f},{h/DIV:.2f},{l/DIV:.2f},{c/DIV:.2f},{v:.3f}\n")
ks = sorted(bars)
print(NAME, YEAR, "días con datos", sum(1 for rr in res if rr), "de", len(days), "fallidos", bad, "velas 15m", len(ks),
      "primer cierre", round(bars[ks[0]][3] / DIV, 2) if ks else None, "último cierre", round(bars[ks[-1]][3] / DIV, 2) if ks else None,
      "en", round(time.time() - t0), "s", flush=True)
