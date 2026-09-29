"""Independent reference implementations (written from the published definitions, not from
swagino.html) checked against what the SWAGINO chart series actually hold.
Usage: python3 verify.py dumpdir [SYM...]"""
import json, sys, math, glob, os, bisect, datetime as dt
from collections import defaultdict, OrderedDict

DUMP = sys.argv[1]
SYMS = sys.argv[2:] or None
REAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'real')

# ---------------- primitives ----------------
def sma_seeded_ema(x, n):
    out = [None]*len(x)
    if len(x) < n: return out
    s = sum(x[:n]); out[n-1] = s/n; k = 2/(n+1)
    for i in range(n, len(x)): out[i] = x[i]*k + out[i-1]*(1-k)
    return out

def rma(x, n):
    """Wilder's moving average: seed = SMA of the first n valid values, then (prev*(n-1)+v)/n; null in -> null out."""
    out = [None]*len(x); s = 0; c = 0; r = None
    for i, v in enumerate(x):
        if v is None: continue
        if r is None:
            s += v; c += 1
            if c == n: r = s/n; out[i] = r
        else:
            r = (v + (n-1)*r)/n; out[i] = r
    return out

def ma(x, n, kind, vol=None):
    out = [None]*len(x)
    if kind == 'rma': return rma(x, n)
    if kind == 'ema':   # TradingView-style EMA used by maCalc: seeded with the first valid value, shown from the n-th
        e = None; seen = 0; k = 2/(n+1)
        for i, v in enumerate(x):
            if v is None: continue
            seen += 1; e = v if e is None else v*k + e*(1-k)
            out[i] = e if seen >= n else None
        return out
    for i in range(len(x)):
        if i < n-1: continue
        w = x[i-n+1:i+1]
        if any(v is None for v in w): continue
        if kind == 'sma': out[i] = sum(w)/n
        elif kind == 'wma':
            wts = list(range(1, n+1)); out[i] = sum(a*b for a, b in zip(w, wts))/sum(wts)
        elif kind == 'vwma':
            vw = vol[i-n+1:i+1]
            if any(v is None for v in vw) or sum(vw) <= 0: continue
            out[i] = sum(a*b for a, b in zip(w, vw))/sum(vw)
    return out

def pstdev(x, n):
    out = [None]*len(x)
    for i in range(n-1, len(x)):
        w = x[i-n+1:i+1]
        if any(v is None for v in w): continue
        m = sum(w)/n; out[i] = math.sqrt(sum((v-m)**2 for v in w)/n)
    return out

def wilder_rsi(src, n):
    up = [None]*len(src); dn = [None]*len(src)
    for i in range(1, len(src)):
        if src[i] is None or src[i-1] is None: continue
        ch = src[i]-src[i-1]; up[i] = max(ch, 0.0); dn[i] = -min(ch, 0.0)
    ru, rd = rma(up, n), rma(dn, n)
    out = [None]*len(src)
    for i in range(len(src)):
        if ru[i] is None or rd[i] is None: continue
        out[i] = 100.0 if rd[i] == 0 else 0.0 if ru[i] == 0 else 100 - 100/(1+ru[i]/rd[i])
    return out

def wilder_adx(h, l, c, n):
    """Wilder 1978: TR/+DM/-DM (tie -> neither), sum-seeded smoothing S=S-S/n+x, DI, DX, ADX=mean of first n DX then Wilder."""
    N = len(h); plus = [None]*N; minus = [None]*N; adx = [None]*N
    sTR = sP = sM = 0.0; k = 0; dxs = []; ax = None
    for i in range(1, N):
        up = h[i]-h[i-1]; down = l[i-1]-l[i]
        eps = 1e-9*max(1, abs(h[i]), abs(h[i-1]))
        pdm = up if (up-down > eps and up > 0) else 0.0
        mdm = down if (down-up > eps and down > 0) else 0.0
        tr = max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1]))
        k += 1
        if k <= n: sTR += tr; sP += pdm; sM += mdm
        else: sTR = sTR - sTR/n + tr; sP = sP - sP/n + pdm; sM = sM - sM/n + mdm
        if k < n: continue
        p = 100*sP/sTR if sTR > 0 else 0; m = 100*sM/sTR if sTR > 0 else 0
        plus[i] = p; minus[i] = m
        dx = 100*abs(p-m)/(p+m) if p+m > 0 else 0
        if k < 2*n-1: dxs.append(dx)
        elif k == 2*n-1: dxs.append(dx); ax = sum(dxs)/n; adx[i] = ax
        else: ax = (ax*(n-1)+dx)/n; adx[i] = ax
    return plus, minus, adx

def pxdp(v):
    a = abs(v)
    if not (a > 0) or not math.isfinite(a): return 2
    return min(10, max(2, 4-math.floor(math.log10(a))))
def jsround(v, d):
    """+v.toFixed(d): rounds the EXACT binary value (ties away from zero), e.g. 745.915 -> 745.91."""
    from decimal import Decimal, ROUND_HALF_UP
    q = Decimal(1).scaleb(-d); x = Decimal(abs(v)).quantize(q, rounding=ROUND_HALF_UP)
    return float(x) if v >= 0 else -float(x)
def close_to(a, b, d):
    """Compare a chart value `a` (rounded by the app to d decimals) with reference `b`: must match
    within one unit in the last displayed place (rounding of a value that differs only by FP noise)."""
    if a is None or b is None: return a is None and b is None
    return abs(a-b) <= 0.5*10**(-d) + 1e-9*max(1, abs(b))

HOLIDAYS = {'2026-11-26', '2026-12-25', '2026-09-07', '2026-07-03'}
NOW_TS = [None]
def et_epoch_real(ymd, minute):
    from zoneinfo import ZoneInfo
    d = dt.datetime.fromisoformat(ymd).replace(tzinfo=ZoneInfo('America/New_York')) + dt.timedelta(minutes=minute)
    return int(d.timestamp())
def monday(ymd):
    d = dt.date.fromisoformat(ymd); return (d - dt.timedelta(days=d.weekday())).isoformat()
def et_epoch(ymd, minute):
    # chart time for intraday bars = ET wall clock encoded as UTC seconds
    d = dt.datetime.fromisoformat(ymd) + dt.timedelta(minutes=minute)
    return int(d.replace(tzinfo=dt.timezone.utc).timestamp())

WARP_MIN = {'1m': 1, '2m': 2, '3m': 3, '4m': 4, '5m': 5, '10m': 10, '15m': 15, '20m': 20, '30m': 30, '1h': 60, '2h': 120, '4h': 240}
def forming_bar(tf, data, D, C):
    today = D['nowYmd']; nowm = D['nowHM']
    if tf == 'D': return data[-1][6] == today and nowm < 960
    if tf == 'W':
        wk = monday(today); last_day = None
        for k_ in range(4, -1, -1):
            d_ = (dt.date.fromisoformat(wk) + dt.timedelta(days=k_)).isoformat()
            if d_ not in HOLIDAYS: last_day = d_; break
        return data[-1][6] == wk and (today < last_day or (today == last_day and nowm < 960))
    end = min(data[-1][9] + int(tf)*60, et_epoch_real(data[-1][6], 960 if C['sess'] == 'rth' else 1200))
    return NOW_TS[0] < end

# ---------------- checks ----------------
class R:
    def __init__(self): self.c = defaultdict(lambda: [0, 0, []])
    def ok(self, key, good, ex=None):
        e = self.c[key]; e[0] += 1
        if not good:
            e[1] += 1
            if len(e[2]) < 3 and ex is not None: e[2].append(ex)
RES = R()

def cmp_series(key, got, ref, d, idx=None):
    for i, (a, b) in enumerate(zip(got, ref)):
        RES.ok(key, close_to(a, b, d(i) if callable(d) else d), (i, a, b))

def series_from_raw(raw, tf, sess):
    b5 = raw['bars5']; b15 = raw['bars15']
    def keep(b):
        dow = dt.date.fromisoformat(b[6]).weekday()
        if dow >= 5: return False
        return (570 <= b[7] < 960) if sess == 'rth' else True   # dump window has no early-close day
    anchor = 570 if sess == 'rth' else 240
    if tf == '5': src, g = b5, 5
    elif tf == '10': src, g = b5, 10
    else:
        g = int(tf); src = b5 if (b5 and (not b15 or b5[0][0] < b15[0][0])) else b15
    out = OrderedDict()
    for b in src:
        if not keep(b): continue
        off = ((b[7]-anchor) % 1440)
        k = (b[6], off//g)
        start = b[7] - (off % g)
        if k not in out: out[k] = [et_epoch(b[6], start), b[1], b[2], b[3], b[4], b[5], b[6], start]
        else:
            o = out[k]; o[2] = max(o[2], b[2]); o[3] = min(o[3], b[3]); o[4] = b[4]; o[5] += b[5]
    return list(out.values())

def check_symbol(path):
    D = json.load(open(path)); sym = D['sym']; cn = D['cn']; C = D['cfg']
    NOW_TS[0] = et_epoch_real(D['nowYmd'], D['nowHM'])
    realD = {r['date']: r for r in json.load(open(os.path.join(REAL, sym+'_daily.json')))}
    for tf, T in D['tf'].items():
        tag = lambda k: f"{k}"
        data = T['data']; n = len(data)
        o = [x[1] for x in data]; h = [x[2] for x in data]; l = [x[3] for x in data]; c = [x[4] for x in data]; v = [x[5] for x in data]
        # ---- series building ----
        if tf == 'D':
            for x in data:
                r = realD.get(x[0]); RES.ok('bars:D == real Tradier daily', r is not None and (r['open'], r['high'], r['low'], r['close'], r['volume']) == (x[1], x[2], x[3], x[4], x[5]), x[0])
        elif tf == 'W':
            agg = OrderedDict()
            for r in D['raw']['daily']:
                k = monday(r[0])
                if k not in agg: agg[k] = [k, r[1], r[2], r[3], r[4], r[5]]
                else: a = agg[k]; a[2] = max(a[2], r[2]); a[3] = min(a[3], r[3]); a[4] = r[4]; a[5] += r[5]
            ref = list(agg.values())
            RES.ok('bars:W == Monday roll-up of daily', len(ref) == n and all(tuple(a[:6]) == tuple(b[:6]) for a, b in zip(ref, data)), (len(ref), n))
        else:
            ref = series_from_raw(D['raw'], tf, C['sess'])
            good = len(ref) == n and all(a[0] == b[0] and a[1:6] == b[1:6] for a, b in zip(ref, data))
            RES.ok(f'bars:{tf} aggregation+bucket-start stamps ('+os.environ.get('INTRADAY_SRC','synthetic')+' intraday)', good, (len(ref), n))
        # ---- candles + volume ----
        cs = C['candle']; prev = None; badc = 0
        for i in range(n):
            up = (c[i] >= (prev if (cs.get('prevClose') and prev is not None) else o[i])); prev = c[i]
            want = (cs['bodyUp'] if up else cs['bodyDn']) if cs.get('body', True) else 'rgba(0,0,0,0)'
            if T['lastBarsColor'][i] is not None and not (C['satyRibbon'].get('showCandleBias')):
                RES.ok('candles: body colour rule', T['candles']['color'][i] == want, (i, T['candles']['color'][i], want))
            RES.ok('candles: OHLC plotted == bars', (T['candles']['open'][i], T['candles']['high'][i], T['candles']['low'][i], T['candles']['close'][i]) == (o[i], h[i], l[i], c[i]), i)
            RES.ok('volume: plotted == bar volume', T['vol']['value'][i] == v[i], i)
        # ---- RSI ----
        P = T['params']; rc = C['rsi']
        srcname = rc.get('src', 'close'); assert srcname == 'close'
        rsi = wilder_rsi(c, max(1, P['rsiLen']))
        cmp_series('RSI: Wilder value', T['rsi'], rsi, 2)
        isbb = rc.get('smType') == 'bb' or P['rsiSmType'] == 'bb'
        smtype = 'bb' if isbb else (P['rsiSmType'] or 'none')
        if smtype != 'none':
            kind = 'sma' if isbb else smtype
            m = ma(rsi, max(1, P['rsiSmLen']), kind, v)
            cmp_series(f'RSI MA ({kind})', T['rsiMa'], m, 2)
            if isbb:
                sd = pstdev(rsi, max(1, P['rsiSmLen'])); k = float(rc.get('bbMult') or 2)
                cmp_series('RSI Bollinger upper', T['bbU'], [None if a is None or b is None else a+b*k for a, b in zip(m, sd)], 2)
                cmp_series('RSI Bollinger lower', T['bbL'], [None if a is None or b is None else a-b*k for a, b in zip(m, sd)], 2)
        grad = rc.get('grad', True) is not False and C['ind']['rsi']['on']
        if grad:
            first = next((i for i, x in enumerate(rsi) if x is not None), -1)
            for key, edge in (('ob', float(rc['up'])), ('os', float(rc['lo']))):
                ref = list(rsi)
                if first >= 0:
                    for k in range(3):
                        if first+k < n and ref[first+k] is not None: ref[first+k] = edge + (ref[first+k]-edge)*((k+1)/3)
                cmp_series('RSI OB/OS gradient fill', T[key], ref, 2)
        # ---- MACD ----
        M = C['macd']; fl, sl, gl = int(M['fastLen']), int(M['slowLen']), int(M['sigLen'])
        f = ma(c, fl, M['oscType']); s = ma(c, sl, M['oscType'])
        mac = [None if a is None or b is None else a-b for a, b in zip(f, s)]
        sg = ma(mac, gl, M['sigType']); hs = [None if a is None or b is None else a-b for a, b in zip(mac, sg)]
        dp = lambda i: pxdp(c[i])+2
        if M.get('macdOn'): cmp_series(f"MACD line ({M['oscType']})", T['macd'], mac, dp)
        if M.get('sigOn'): cmp_series(f"MACD signal ({M['sigType']})", T['sig'], sg, dp)
        if M.get('histOn'):
            cmp_series('MACD histogram', T['hist']['value'], hs, dp)
            for i in range(n):
                if hs[i] is None: continue
                rising = i > 0 and hs[i-1] is not None and hs[i] > hs[i-1]
                want = M['histC'][0 if (hs[i] >= 0 and rising) else 1 if hs[i] >= 0 else 2 if rising else 3]
                RES.ok('MACD histogram colour rule', T['hist']['color'][i] == want, (i, T['hist']['color'][i], want))
        # ---- ADX ----
        pl, mi, ax = wilder_adx(h, l, c, T['adxLen'])
        A = C['adx']
        if A.get('adxOn'): cmp_series('ADX', T['adx'], ax, 2)
        if A.get('plusOn'): cmp_series('+DI', T['plus'], pl, 2)
        if A.get('minusOn'): cmp_series('-DI', T['minus'], mi, 2)
        # ---- Saty Pivot Ribbon ----
        Rb = C['satyRibbon']
        lens = dict(f=int(Rb.get('fastEma') or 8), p=int(Rb.get('pivotEma') or 21), s=int(Rb.get('slowEma') or 34),
                    fc=int(Rb.get('fastConvLen') or 13), sc=int(Rb.get('slowConvLen') or 48), b=int(Rb.get('biasEma') or 21))
        warp = Rb.get('timeWarp', 'off')
        if warp in ('off', None):
            E = {k: sma_seeded_ema(c, L) for k, L in lens.items()}
            # Saty's ribbon EMAs are ema[realtime ? 1 : 0]: a bar still forming shows the previous bar's EMA.
            forming = forming_bar(tf, data, D, C)
            RES.ok(f'Ribbon: forming-bar rule evaluated ({tf})', True)
            if forming and n >= 2:
                for k in ('f', 'p', 's', 'fc', 'sc'): E[k][n-1] = E[k][n-2]
        elif warp in ('D', 'W', 'M', 'Y') or warp in WARP_MIN:
            # TradingView Pine docs (Other timeframes and data -> lookahead): a lookahead_off request "has a
            # new historical value at the end of each HTF period" -> the period's own value sits on the LAST
            # chart bar inside the period; earlier bars show the previous period. The chart's final bar takes
            # its own period only once that period has ended (clock past the period's last session end).
            sess = C['sess']; daily_chart = tf in ('D', 'W')
            now_min_ts = NOW_TS[0]
            def sess_end(ymd):
                return et_epoch_real(ymd, 960 if (daily_chart or sess == 'rth') else 1200)
            if warp in ('D', 'W', 'M', 'Y'):
                def keyof(ymd): return ymd if warp == 'D' else monday(ymd) if warp == 'W' else ymd[:7] if warp == 'M' else ymd[:4]
                per = OrderedDict()
                for r in D['raw']['daily']:
                    if dt.date.fromisoformat(r[0]).weekday() >= 5: continue
                    per[keyof(r[0])] = r[4]
                pkeys = list(per.keys()); pcl = list(per.values())
                if tf == 'W' and warp == 'D':
                    # warp finer than the chart: a lookahead_off request returns the LAST intrabar's value,
                    # i.e. the week's final daily row; the chart bar ends with the week itself
                    wk_last = {}
                    for k in pkeys: wk_last[monday(k)] = k
                    bkeys = [wk_last.get(x[6], x[6]) for x in data]
                    last_ended = not forming_bar(tf, data, D, C)
                else:
                    bkeys = [keyof(x[6]) for x in data]
                    # last trading day of the final bar's period
                    d0 = dt.date.fromisoformat(data[-1][6]); lastday = None
                    for k_ in range(0, 370):
                        dd = (d0 + dt.timedelta(days=k_)).isoformat()
                        if keyof(dd) != bkeys[-1]: break
                        if dt.date.fromisoformat(dd).weekday() < 5 and dd not in HOLIDAYS: lastday = dd
                    last_ended = (not forming_bar(tf, data, D, C)) and lastday is not None and now_min_ts >= sess_end(lastday)
                E = {}
                for k2, L in lens.items():
                    e = sma_seeded_ema(pcl, L); pos = {k: i for i, k in enumerate(pkeys)}; out = []
                    for i, x in enumerate(data):
                        kb = bkeys[i]
                        ends = (bkeys[i+1] != kb) if i < n-1 else last_ended
                        if ends and kb in pos: out.append(e[pos[kb]]); continue
                        j = bisect.bisect_left(pkeys, kb) - 1
                        out.append(e[j] if j >= 0 else None)
                    E[k2] = out
            else:
                g = WARP_MIN[warp]; anchor = 570 if sess == 'rth' else 240
                bkeys = [(x[0],) if daily_chart else (x[6], ((x[7]-anchor) % 1440)//g) for x in data]
                closes_b = []; bidx = []
                for i, x in enumerate(data):
                    if i == 0 or bkeys[i] != bkeys[i-1]: closes_b.append(x[4])
                    else: closes_b[-1] = x[4]
                    bidx.append(len(closes_b)-1)
                if daily_chart: last_ended = not forming_bar(tf, data, D, C)
                else:
                    st_ = data[-1][7] - ((data[-1][7]-anchor) % 1440) % g
                    endm = min(max(0, st_)+g, 960 if sess == 'rth' else 1200)
                    last_ended = (not forming_bar(tf, data, D, C)) and now_min_ts >= et_epoch_real(data[-1][6], endm)
                E = {}
                for k2, L in lens.items():
                    e = sma_seeded_ema(closes_b, L); out = []
                    for i in range(n):
                        ends = (bkeys[i+1] != bkeys[i]) if i < n-1 else last_ended
                        j = bidx[i] if ends else bidx[i]-1
                        out.append(e[j] if j >= 0 else None)
                    E[k2] = out
            RES.ok(f'Ribbon warp {warp} on {tf}: final bar period ended = {last_ended}', True)
        if E:
            rpx = lambda i, arr: pxdp(arr[i]) if arr[i] is not None else 2
            show = lambda k: Rb.get(k, True)
            if show('showFastHi'): cmp_series(f'Ribbon fast EMA (warp {warp})', T['rbFast']['value'], E['f'], lambda i: rpx(i, E['f']))
            if show('showPivotHi'): cmp_series(f'Ribbon pivot EMA (warp {warp})', T['rbPivot']['value'], E['p'], lambda i: rpx(i, E['p']))
            if show('showSlowHi'): cmp_series(f'Ribbon slow EMA (warp {warp})', T['rbSlow']['value'], E['s'], lambda i: rpx(i, E['s']))
            if Rb.get('showFastConv'): cmp_series('Ribbon fast conviction EMA', T['rbFc'], E['fc'], lambda i: rpx(i, E['fc']))
            if Rb.get('showSlowConv'): cmp_series('Ribbon slow conviction EMA', T['rbSc'], E['sc'], lambda i: rpx(i, E['sc']))
            both = lambda a_, b_: [None if (a_[i] is None or b_[i] is None) else a_[i] for i in range(n)]
            cmp_series('Ribbon fast cloud edges', T['cloudF']['a'], both(E['f'], E['p']), lambda i: rpx(i, E['f']))
            cmp_series('Ribbon fast cloud edges', T['cloudF']['b'], both(E['p'], E['f']), lambda i: rpx(i, E['p']))
            cmp_series('Ribbon slow cloud edges', T['cloudS']['a'], both(E['p'], E['s']), lambda i: rpx(i, E['p']))
            cmp_series('Ribbon slow cloud edges', T['cloudS']['b'], both(E['s'], E['p']), lambda i: rpx(i, E['s']))
            # cloud colour = bull when a>=b
            for key, a_, b_ in (('cloudF', E['f'], E['p']), ('cloudS', E['p'], E['s'])):
                cols = [T[key]['color'][i] for i in range(n) if a_[i] is not None and b_[i] is not None]
                pairs = set((T[key]['color'][i], a_[i] >= b_[i]) for i in range(n) if a_[i] is not None and b_[i] is not None and T[key]['color'][i] is not None)
                RES.ok('Ribbon cloud colour = bull iff a>=b', len(set(p for p, _ in pairs)) == len(pairs), sorted(pairs)[:4])
            if Rb.get('showArrows'):
                ref_arrows = [(data[i][0], E['fc'][i] >= E['sc'][i]) for i in range(1, n)
                              if None not in (E['fc'][i], E['sc'][i], E['fc'][i-1], E['sc'][i-1]) and (E['fc'][i] >= E['sc'][i]) != (E['fc'][i-1] >= E['sc'][i-1])]
                RES.ok('Ribbon conviction arrows (fast conv crosses slow conv)', [tuple(a[:2]) for a in T['arrows']] == ref_arrows, (len(T['arrows']), len(ref_arrows)))
            if Rb.get('showCandleBias'):
                cols = {'bullF': Rb['bullFastCloud'], 'bearF': Rb['bearFastCloud'], 'bullS': Rb['bullSlowCloud'], 'bearS': Rb['bearSlowCloud']}
                for i in range(n):
                    b = E['b'][i]
                    if b is None: continue
                    if o[i] == c[i]: want = '#808080'
                    elif o[i] < c[i]: want = cols['bullF'] if c[i] >= b else cols['bearS']
                    else: want = cols['bullS'] if c[i] >= b else cols['bearF']
                    RES.ok('Ribbon candle bias colour', T['lastBarsColor'][i] == want, (i, T['lastBarsColor'][i], want))
        # ---- VWAP ----
        V = C['vwap']
        if not (V.get('hideOnDWM') and tf in ('D', 'W')):
            for k, L in enumerate(V['lines']):
                if not L['on']: continue
                def akey(ymd):
                    return ymd if L['anchor'] == 'session' else monday(ymd) if L['anchor'] == 'week' else ymd[:7]
                ref = []; cpv = cv = 0; pk = None
                for x in data:
                    kk = akey(x[6])
                    if kk != pk: cpv = cv = 0; pk = kk
                    cpv += (x[2]+x[3]+x[4])/3*(x[5] or 0); cv += (x[5] or 0)
                    ref.append(cpv/cv if cv > 0 else None)
                cmp_series(f"VWAP ({L['anchor']})", T['vw'][k], ref, lambda i, ref=ref: pxdp(ref[i]) if ref[i] is not None else 2)
        # ---- Market structure: properties from its written specification ----
        sw = T['sw']; st = max(2, P['swing'])
        for j, x in enumerate(sw):
            RES.ok('Structure: swing price == bar high/low', x['price'] == (h[x['i']] if x['type'] == 'H' else l[x['i']]), x)
            if j: RES.ok('Structure: swings alternate H/L', x['type'] != sw[j-1]['type'], (sw[j-1], x))
        lastH = lastL = None
        for x in sw:
            if x['type'] == 'H':
                want = 'H' if lastH is None else ('HH' if x['price'] > lastH else 'LH'); lastH = x['price']
            else:
                want = 'L' if lastL is None else ('HL' if x['price'] > lastL else 'LL'); lastL = x['price']
            RES.ok('Structure: HH/LH/HL/LL labels', x['label'] == want, (x, want))
        for b in T['brks']:
            RES.ok('Structure: BOS/CHoCH bar closes through the level', (c[b['i']] > b['price']) if b['dir'] == 'up' else (c[b['i']] < b['price']), b)
            RES.ok('Structure: broken swing was confirmed before the break', b['ref'] + st <= b['i'], b)
            # first close through: no earlier bar between confirmation and i closed through it
            first = all(not ((c[j] > b['price']) if b['dir'] == 'up' else (c[j] < b['price'])) for j in range(b['ref']+st, b['i']))
            RES.ok('Structure: break is the FIRST close through', first, b)
        for x in sw:
            RES.ok('Structure: no swing inside the last `strength` bars (causal)', x['i'] <= n-1-st, (x, n, st))
        # ---- RSI divergence completeness: brute force from the written rules, compare the drawn set ----
        if C['rsi'].get('div') and C['ind']['rsi']['on']:
            rthf = [x[8] is not False for x in data]
            useAll = sum(rthf) < 20
            trr = [None]*n; pcl = None
            for i in range(n):
                if useAll or rthf[i]:
                    if pcl is not None: trr[i] = max(h[i]-l[i], abs(h[i]-pcl), abs(l[i]-pcl))
                    pcl = c[i]
            atr = [None]*n; ssum = 0; cnt = 0; rr = None
            for i, x in enumerate(trr):       # rmaSeries: carries the last value through gaps
                if x is None: atr[i] = rr; continue
                if rr is None:
                    ssum += x; cnt += 1
                    if cnt == 14: rr = ssum/14; atr[i] = rr
                else: rr = (rr*13 + x)/14; atr[i] = rr
            refd = []
            for isLow, typ in ((True, 'L'), (False, 'H')):
                seq = [x for x in sw if x['type'] == typ]
                for bi in range(1, len(seq)):
                    b = seq[bi]; rb = rsi[b['i']]
                    if rb is None or not (atr[b['i']] and atr[b['i']] > 0): continue
                    for ai in range(bi-1, max(0, bi-5)-1, -1):
                        a = seq[ai]; ra = rsi[a['i']]
                        if ra is None: continue
                        gap = b['i']-a['i']
                        if gap < P['divMin'] or gap > P['divMax']: continue
                        if abs(b['price']-a['price']) < 0.5*atr[b['i']]: continue
                        if abs(rb-ra) < 3: continue
                        lim = min(a['price'], b['price']) if isLow else max(a['price'], b['price'])
                        if any((seq[k]['price'] < lim) if isLow else (seq[k]['price'] > lim) for k in range(ai+1, bi)): continue
                        kind = None
                        if isLow:
                            if b['price'] < a['price'] and rb > ra and min(ra, rb) <= 35: kind = ('bull', 'regular')
                            elif b['price'] > a['price'] and rb < ra: kind = ('bull', 'hidden')
                        else:
                            if b['price'] > a['price'] and rb < ra and max(ra, rb) >= 65: kind = ('bear', 'regular')
                            elif b['price'] < a['price'] and rb > ra: kind = ('bear', 'hidden')
                        if not kind: continue
                        refd.append((b['i']+st, kind[0], kind[1], b['i'], a['i'])); break
            refd.sort(key=lambda t: t[0])   # stable, like Array.sort on confirm
            want = [(k0, k1, bi_, ai_) for _, k0, k1, bi_, ai_ in refd[-20:]]
            got = [(d['side'], d['kind'], d['pivot'], d['from']) for d in T['divs']]
            RES.ok('Divergence: drawn set == brute-force set (last 20)', got == want, (len(got), len(want), [g for g in got if g not in want][:2], [w_ for w_ in want if w_ not in got][:2]))
        # ---- RSI divergence: every emitted pair satisfies the written rules ----
        dc = {'minPriceATR': 0.5, 'minRsiDelta': 3, 'zoneLo': 35, 'zoneHi': 65}
        for d in T['divs']:
            a_, b_ = d['from'], d['pivot']
            RES.ok('Divergence: endpoints are swings', any(x['i'] == a_ for x in sw) and any(x['i'] == b_ for x in sw), d)
            RES.ok('Divergence: RSI values read at the swings', close_to(round(d['val'], 9), rsi[b_], 6) and close_to(round(d['fromVal'], 9), rsi[a_], 6), d)
            RES.ok('Divergence: RSI leg >= minRsiDelta', abs(d['val']-d['fromVal']) >= dc['minRsiDelta'] - 1e-9, d)
            gap = b_ - a_
            RES.ok('Divergence: gap within [divMin,divMax]', P['divMin'] <= gap <= P['divMax'], (d, P['divMin'], P['divMax']))
            isLow = d['side'] == 'bull'
            pa = l[a_] if isLow else h[a_]; pb = l[b_] if isLow else h[b_]
            if d['kind'] == 'regular':
                okk = (pb < pa and d['val'] > d['fromVal'] and min(d['val'], d['fromVal']) <= dc['zoneLo']) if isLow else (pb > pa and d['val'] < d['fromVal'] and max(d['val'], d['fromVal']) >= dc['zoneHi'])
            else:
                okk = (pb > pa and d['val'] < d['fromVal']) if isLow else (pb < pa and d['val'] > d['fromVal'])
            RES.ok('Divergence: price/RSI relation matches its kind', okk, d)
        # ---- Saty ATR Levels (daily-based; identical on every tf) ----
        if T['saty'] and tf == 'D':
            S = C['satyCfg']; assert S['mode'] == 'day'
            rows = [r for r in D['raw']['daily'] if dt.date.fromisoformat(r[0]).weekday() < 5]
            today = D['nowYmd']
            fit = [r for r in rows if r[0] < today]
            def tr_of(rs):
                return [None] + [max(rs[i][2]-rs[i][3], abs(rs[i][2]-rs[i-1][4]), abs(rs[i][3]-rs[i-1][4])) for i in range(1, len(rs))]
            if S.get('autoLen', True) is not False:
                if len(fit) < 120: L = 5
                else:
                    tr = tr_of(fit); nn = len(fit); lo = max(1, nn-250); best = None
                    for Ln in [5, 6, 7, 8, 9, 10, 12, 14]:
                        a = rma(tr, Ln); errs = [abs(a[i]-tr[i+1]) for i in range(lo, nn-1) if a[i] is not None and tr[i+1] is not None]
                        if len(errs) < 40: continue
                        m_ = sum(errs)/len(errs)
                        if best is None or m_ < best[0]: best = (m_, Ln)
                    L = best[1] if best else 5
            else: L = max(2, int(S.get('atrLen') or 5))
            RES.ok('Saty: auto ATR length (fit on completed days)', D['satyLen'] == L, (D['satyLen'], L))
            ci = max(i for i, r in enumerate(rows) if r[0] < today)
            tr = tr_of(rows)[1:]
            seed = sum(tr[:L])/L; atr = [None]*len(tr); atr[L-1] = seed
            for i in range(L, len(tr)): atr[i] = (atr[i-1]*(L-1)+tr[i])/L
            A_ = atr[ci-1]; pc = rows[ci][4]
            RES.ok('Saty: ATR (Wilder RMA of TR) at last completed day', abs(T['saty']['atr']-A_) < 1e-9*A_, (T['saty']['atr'], A_))
            RES.ok('Saty: previous close', T['saty']['prevClose'] == pc, (T['saty']['prevClose'], pc))
            trig = float(S.get('trigger') or 0.236)
            RES.ok('Saty: triggers = prevClose ± 0.236·ATR', abs(T['saty']['trigUp']-(pc+trig*A_)) < 1e-9*pc and abs(T['saty']['trigDn']-(pc-trig*A_)) < 1e-9*pc)
            cur = rows[-1]; RES.ok('Saty: range % of ATR (developing day)', abs(T['saty']['pct']-(cur[2]-cur[3])/A_*100) < 1e-7)
            mults = {0.382: 'mid', 0.5: 'mid', 0.618: 'key', 0.786: 'mid', 1.0: 'atr', 1.236: 'key', 1.382: 'mid', 1.5: 'mid', 1.618: 'key', 1.786: 'mid', 2.0: 'atr', 2.236: 'key', 2.618: 'key', 3.0: 'atr'}
            ext = {1.236, 1.382, 1.5, 1.618, 1.786, 2.0, 2.236, 2.618, 3.0}
            want = {}
            for mm, kind in mults.items():
                if mm in ext and not S.get('extensions'): continue
                if kind == 'mid' and not S.get('allFib', True): continue
                for sgn, pre in ((1, 'p'), (-1, 'm')):
                    k = pre+(str(int(mm)) if mm == int(mm) else repr(mm))
                    if (S.get('sty') or {}).get(k, {}).get('on') is False: continue
                    want[k] = jsround(pc+sgn*mm*A_, 2)
            want['trigUp'] = jsround(pc+trig*A_, 2); want['trigDn'] = jsround(pc-trig*A_, 2)
            if not ((S.get('sty') or {}).get('pc', {}).get('on') is False): want['pc'] = jsround(pc, 2)
            got = {k: p for k, p in T['satyLabels']}
            RES.ok('Saty: ladder rungs present and priced', got == want, ({k: (got.get(k), want.get(k)) for k in set(got) | set(want) if got.get(k) != want.get(k)}))
    # ---- Levels (Prev H/L/C from real daily; session levels from synthetic 5m) ----
    today = D['nowYmd']
    past = [r for r in D['raw']['daily'] if r[0] < today and dt.date.fromisoformat(r[0]).weekday() < 5]
    lv = {k: p for k, _, p, _ in D['levels']}
    pdr = past[-1]
    RES.ok('Levels: Prev H / Prev L / prev close (real daily)', lv.get('PrevH') == jsround(pdr[2], 2) and lv.get('PrevL') == jsround(pdr[3], 2) and D['prevClosePx'] == pdr[4], (lv.get('PrevH'), pdr))
    tb = [b for b in D['raw']['bars5'] if b[6] == today]
    pre = [b for b in tb if 240 <= b[7] < 570]; rth = [b for b in tb if 570 <= b[7] < 960]
    if pre: RES.ok('Levels: PM high/low (04:00-09:30)', lv.get('PMH') == jsround(max(b[2] for b in pre), 2) and lv.get('PML') == jsround(min(b[3] for b in pre), 2))
    if rth: RES.ok('Levels: HOD/LOD (regular session)', lv.get('HOD') == jsround(max(b[2] for b in rth), 2) and lv.get('LOD') == jsround(min(b[3] for b in rth), 2))
    # Ceiling / Floor: 25-day volume-by-price profile, 100 bins over the lookback's range; a day's volume spread
    # across its RTH 5m bars' [low,high] by each bar's share of the day's 5m volume (whole-day range if <40 bars)
    rows = [r for r in D['raw']['daily'] if r[0] < today][-25:]
    spot = D['lastPx']
    if len(rows) >= 5 and spot is not None:
        lo = min(r[3] for r in rows); hi = max(r[2] for r in rows); bs = (hi-lo)/100; bins = {}
        def add(rl, rh, vol):
            rng = max(0.01, rh-rl); i0 = math.floor((rl-lo)/bs); i1 = math.floor((rh-lo)/bs)
            for bi in range(i0, i1+1):
                b = lo+bi*bs; ov = max(0, min(rh, b+bs)-max(rl, b))
                if ov > 0: bins[bi] = bins.get(bi, 0) + vol*(ov/rng)
        for r in rows:
            db = [b for b in D['raw']['bars5'] if b[6] == r[0] and 570 <= b[7] < 960]
            dv = sum(b[5] or 0 for b in db)
            if len(db) >= 40 and dv > 0:
                for b in db: add(b[3], b[2], r[5]*((b[5] or 0)/dv))
            else: add(r[3], r[2], r[5])
        def peak(above):
            side = [(bi, v) for bi, v in bins.items() if ((lo+bi*bs) >= spot if above else (lo+(bi+1)*bs) <= spot)]
            if not side: return None
            mx = max(v for _, v in side); tied = sorted(bi for bi, v in side if v == mx)
            i = 0
            while i+1 < len(tied) and tied[i+1]-tied[i] == 1: i += 1
            run = tied[:i+1]; return lo+((run[0]+run[-1])/2)*bs+bs/2
        ce, fl = peak(True), peak(False)
        RES.ok('Levels: institutional Ceiling (volume profile)', lv.get('InstCeil') == (jsround(ce, 2) if ce is not None else None), (lv.get('InstCeil'), ce))
        RES.ok('Levels: institutional Floor (volume profile)', lv.get('InstFloor') == (jsround(fl, 2) if fl is not None else None), (lv.get('InstFloor'), fl))
    RES.ok('App: no runtime errors during renders', not D['errors'], D['errors'][:2])

files = sorted(glob.glob(os.path.join(DUMP, '*_*.json')))
files = [f for f in files if not os.path.basename(f).startswith('_') and (not SYMS or os.path.basename(f).split('_')[0] in SYMS)]
for f in files: check_symbol(f)
w = max(len(k) for k in RES.c)
tot = bad = 0
for k in sorted(RES.c):
    n, b, ex = RES.c[k]; tot += n; bad += b
    print(f"{'FAIL' if b else 'pass'}  {k:<{w}}  {n-b}/{n}" + (f"   e.g. {ex[:2]}" if b else ''))
print(f"\nTOTAL checks {tot}, failures {bad}, files {len(files)}")
