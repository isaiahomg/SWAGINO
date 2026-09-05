#!/usr/bin/env python3
"""Local CORS proxy for SWAGINO -> Tradier.

Run:  python3 proxy.py       (serves the app + proxies Tradier on http://localhost:8787)
Then open  http://localhost:8787/swagino.html  and enter your Tradier token in Settings.

Serves the local folder (the app) for normal paths, and forwards /v1/* requests to
https://api.tradier.com, passing through your Authorization header. Because the page and
its data come from the same origin, no CORS is involved for same-origin calls (the CORS
headers below stay for anyone still loading the page from a different origin).
Your token stays on your machine; nothing is logged or stored.

Speed notes (this is why start-up used to drag):

  1. The old version answered on HTTP/1.0 and sent no Content-Length, so the
     browser could only tell where a response ended by the socket closing.
     Every single call therefore cost a fresh TCP connection to this proxy.
     It now speaks HTTP/1.1 with a real Content-Length, so the browser opens
     one connection and reuses it for the whole session.

  2. The old version called urllib.urlopen() per request, which opens a new
     TLS connection to api.tradier.com every time - a full handshake, ~100-300ms,
     paid on each of the boot requests. Connections are now pooled per worker
     thread and reused, so only the first call on a thread pays for the
     handshake. A pooled socket can go stale between calls, so a failed reuse
     is retried once on a fresh connection before giving up.
"""
import gzip
import hashlib
import http.client
import http.server
import json
import threading
import time
import os
from urllib.parse import unquote, urlsplit, urlencode, parse_qsl

UPSTREAM_HOST = "api.tradier.com"
# Finnhub is the Scanner's News/Catalysts source — a second, unrelated upstream, proxied the
# same way as Tradier (same-origin from the browser, avoids CORS, keeps a real API key out of
# a page anyone could view-source) but with its own host/auth convention (a `token` query param,
# not a Bearer header) and its own allowlist restricted to the one endpoint SWAGINO actually
# calls, so this can never become an open proxy to Finnhub's wider (paid, rate-limited) surface.
FINNHUB_HOST = "finnhub.io"
_ALLOW_FINNHUB_GET_EXACT_PATH = "/finnhub/company-news"
PORT = int(os.environ.get("PORT", "8787"))
# BIND: 127.0.0.1 keeps the proxy on this machine only (the local default). A hosted
# deployment runs it inside a container behind Cloudflare Tunnel and sets BIND=0.0.0.0
# so the tunnel sidecar can reach it — the box itself never publishes the port publicly.
BIND = os.environ.get("BIND", "127.0.0.1")
TIMEOUT = 30
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FILE = "swagino.html"

# SHARED-TOKEN (server) MODE — set TRADIER_TOKEN to run SWAGINO as a shared server:
#   * every /v1/* call is authorized with THIS token, injected here on the server, so the
#     real Tradier token never reaches any visitor's browser (they send a placeholder);
#   * the served HTML gets a one-line bootstrap so visitors skip the "enter your token"
#     setup dialog and connect straight through this proxy.
# Leave it unset for normal local use: the proxy then passes each browser's own
# Authorization header straight through, exactly as before, and injects nothing.
SHARED_TOKEN = os.environ.get("TRADIER_TOKEN", "").strip()
# Same idea, optional, independent of Tradier: set FINNHUB_TOKEN to serve every visitor's Scanner
# news from one shared key. Unset (the default) means local single-user mode for Finnhub too -
# each browser sends its own key (entered in Settings), passed straight through untouched.
SHARED_FINNHUB = os.environ.get("FINNHUB_TOKEN", "").strip()

# Injected just inside <head> in shared mode. Seeds the localStorage key the app gates on
# (lc_key) and forces proxy-on so calls stay same-origin. The value is a placeholder — the
# real token is added server-side in _forward(); this string is never a credential.
_BOOTSTRAP = (
    b"<script>try{localStorage.setItem('lc_key','shared');"
    b"var c={};try{c=JSON.parse(localStorage.getItem('lc_cfg'))||{}}catch(e){}"
    b"c.proxy=true;localStorage.setItem('lc_cfg',JSON.stringify(c));}catch(e){}</script>"
)

# ENDPOINT ALLOWLIST (shared mode only) — the shared Tradier token is full-access, so without
# this a gated visitor could reach /v1/accounts/* or POST an order under YOUR account. Tradier's
# entire read-only market-data surface lives under /v1/markets/ (quotes, history, timesales,
# options chains/expirations, clock, calendar, search, lookup) and NOTHING there can move money
# or place a trade; account/trading endpoints live under /v1/accounts, /v1/user, /v1/watchlists.
# So we allow GET only under /v1/markets/, and POST only the streaming handshake. Everything else
# is refused with 403 before the token is ever attached. Verified against SWAGINO's actual calls:
# quotes, history, timesales, options/chains, options/expirations, events/session.
# Local single-user mode (no TRADIER_TOKEN) stays unrestricted — it's only ever you.
_ALLOW_GET_PREFIX = "/v1/markets/"
_ALLOW_POST_EXACT = frozenset({"/v1/markets/events/session"})
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".map": "application/json",
}

# Text-ish types worth gzipping. Images/fonts are already compressed formats -
# re-gzipping them wastes CPU for zero (sometimes negative) size benefit.
COMPRESSIBLE_TYPES = (
    "text/html", "text/css", "text/javascript", "application/javascript",
    "application/json", "image/svg+xml", "text/plain",
)

# swagino.html is ~900KB of hand-written source (kept uncompressed and heavily commented on
# disk - see CLAUDE.md/memory notes on why: this file has no build step, so the comments ARE
# the only record of past bugs/decisions for whoever - human or Claude - edits it next).
# Gzip cuts it to roughly a third on the wire with zero effect on that source. Recompressing
# the same ~900KB on every single request would be wasteful, especially once more than one
# visitor is loading it at once in shared-server mode, so the gzip bytes are cached here keyed
# by the file's mtime and only recomputed when swagino.html (or any other static file) actually
# changes on disk - i.e. after a real redeploy, not on every request.
_static_cache = {}

# GEX's Black-Scholes gamma solve needs a risk-free rate r. This used to be a number the user
# had to look up and re-type in Settings by hand as the real 13-week T-bill rate moved. It is
# now fetched here, server-side, from the U.S. Treasury's own published auction results —
# https://www.treasurydirect.gov/TA_WS/securities/auctioned — a public, unauthenticated,
# no-API-key endpoint, so this needs nothing from the user and never touches their Tradier
# token. 13-week bills are auctioned every Monday, so the true rate can only ever move about
# once a week; a 6-hour cache is far shorter than that cadence (never serves a materially stale
# number) while keeping this off the hot path and off Treasury's servers on every page load —
# and, in shared-server mode, one fetch here serves every visitor instead of one each.
TREASURY_HOST = "www.treasurydirect.gov"
TREASURY_PATH = "/TA_WS/securities/auctioned?type=Bill&days=30&format=json"
_RFR_CACHE_TTL = 6 * 3600
_rfr_lock = threading.Lock()
_rfr_cache = {"data": None, "ts": 0.0}


def _fetch_risk_free_rate():
    with _rfr_lock:
        now = time.time()
        cached = _rfr_cache["data"]
        if cached is not None and (now - _rfr_cache["ts"]) < _RFR_CACHE_TTL:
            return cached
        conn = http.client.HTTPSConnection(TREASURY_HOST, timeout=TIMEOUT)
        try:
            conn.request("GET", TREASURY_PATH,
                         headers={"Accept": "application/json", "Host": TREASURY_HOST})
            r = conn.getresponse()
            raw = r.read()
            if r.status != 200:
                raise RuntimeError(f"treasurydirect returned HTTP {r.status}")
            rows = json.loads(raw)
            # "days=30" already limits the response to recent auctions across every bill term
            # (4/6/8/13/17/26/52-week); a 13-week bill is auctioned weekly, so 30 days always
            # contains at least one, generally several. highDiscountRate is the stop-out rate
            # every winning bidder (competitive and non-competitive alike) received at that
            # single-price auction - the same figure Treasury and financial media report as
            # "the 13-week bill was auctioned at X%", and the convention this app's own
            # previously-manual default (3.70%) already matched.
            bills = [row for row in rows
                     if row.get("securityTerm") == "13-Week" and row.get("highDiscountRate")]
            if not bills:
                raise RuntimeError("no completed 13-week bill auction in the last 30 days")
            bills.sort(key=lambda row: row.get("auctionDate", ""), reverse=True)
            latest = bills[0]
            result = {
                "rate": float(latest["highDiscountRate"]),
                "auctionDate": latest.get("auctionDate", "")[:10],
                "cusip": latest.get("cusip", ""),
            }
        finally:
            conn.close()
        _rfr_cache["data"] = result
        _rfr_cache["ts"] = now
        return result


# One upstream connection per (worker thread, host), reused across requests. Keyed by host
# (not just one bare slot) since Finnhub (below) added a SECOND upstream alongside Tradier -
# same pooling technique, just no longer hardcoded to a single host.
_local = threading.local()


def _conn(host):
    conns = getattr(_local, "conns", None)
    if conns is None:
        conns = {}
        _local.conns = conns
    c = conns.get(host)
    if c is None:
        c = http.client.HTTPSConnection(host, timeout=TIMEOUT)
        conns[host] = c
    return c


def _drop(host):
    conns = getattr(_local, "conns", None)
    c = conns.get(host) if conns else None
    if c is not None:
        try:
            c.close()
        except Exception:
            pass
        conns[host] = None


class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"      # lets the browser hold one connection open
    disable_nagle_algorithm = True     # small JSON replies should not wait to coalesce

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Accept, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, status, ctype, body, extra=None):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", ctype)
        # Cheap, always-safe hardening headers (defense in depth behind Cloudflare Access).
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if extra:
            for k, v in extra:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))   # required for keep-alive
        self.end_headers()
        self.wfile.write(body)

    def _forward(self, method):
        headers = {"Accept": "application/json", "Host": UPSTREAM_HOST}
        if SHARED_TOKEN:
            # Server mode: authorize with our own token and ignore whatever the browser sent,
            # so the real credential is never exposed to (or overridable by) a visitor.
            headers["Authorization"] = "Bearer " + SHARED_TOKEN
        else:
            auth = self.headers.get("Authorization")
            if auth:
                headers["Authorization"] = auth
        body = b"" if method == "POST" else None
        if body is not None:
            headers["Content-Length"] = "0"
        last = None
        for attempt in (0, 1):
            try:
                c = _conn(UPSTREAM_HOST)
                c.request(method, self.path, body=body, headers=headers)
                r = c.getresponse()
                data = r.read()                      # must drain before the socket is reusable
                return r.status, r.getheader("Content-Type", "application/json"), data
            except Exception as e:
                last = e
                _drop(UPSTREAM_HOST)                  # stale pooled socket: re-dial and retry once
        raise last

    def _forward_finnhub(self):
        # /finnhub/company-news?symbol=X&from=Y&to=Z[&token=...] -> finnhub.io/api/v1/company-news
        # with the same path/query, but the token swapped for the server's own in shared mode
        # (SHARED_FINNHUB set) exactly like Tradier's SHARED_TOKEN above — a visitor's own query
        # param is ignored, never forwarded, in that mode. In local mode there is no server-side
        # key to inject, so whatever token the browser itself supplied (the user's own, entered in
        # Settings and never sent anywhere but here) passes through unchanged, same as Tradier's
        # local-mode Authorization pass-through.
        parts = urlsplit(self.path)
        sub_path = parts.path[len("/finnhub"):]
        q = dict(parse_qsl(parts.query))
        if SHARED_FINNHUB:
            q["token"] = SHARED_FINNHUB
        upstream_path = "/api/v1" + sub_path + ("?" + urlencode(q) if q else "")
        headers = {"Accept": "application/json", "Host": FINNHUB_HOST}
        last = None
        for attempt in (0, 1):
            try:
                c = _conn(FINNHUB_HOST)
                c.request("GET", upstream_path, headers=headers)
                r = c.getresponse()
                data = r.read()
                return r.status, r.getheader("Content-Type", "application/json"), data
            except Exception as e:
                last = e
                _drop(FINNHUB_HOST)
        raise last

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _is_api(self):
        # Tradier's REST surface is entirely under /v1/. Everything else is served
        # from the local folder so the app and its data share one origin.
        return self.path.split("?", 1)[0].startswith("/v1/")

    def _api_allowed(self, method):
        # In shared mode, only the read-only market-data endpoints (and the streaming
        # handshake) may pass; see the allowlist rationale above. Local mode is unrestricted.
        if not SHARED_TOKEN:
            return True
        path = self.path.split("?", 1)[0]
        if method == "GET":
            return path.startswith(_ALLOW_GET_PREFIX)
        if method == "POST":
            return path in _ALLOW_POST_EXACT
        return False

    def do_POST(self):
        # Needed for /v1/markets/events/session (streaming session creation).
        if self._is_api():
            if self._api_allowed("POST"):
                self._proxy("POST")
            else:
                self._send(403, "text/plain", b"forbidden")
        else:
            self._send(404, "text/plain", b"not found")

    def do_GET(self):
        # /healthz is answered locally (no upstream) so Docker's healthcheck never touches
        # Tradier and never counts against the rate limit.
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            self._send(200, "text/plain; charset=utf-8", b"ok")
        elif path == "/rfr":
            # Public U.S. Treasury data, not Tradier - no token involved, so this is served
            # in every mode (local and shared-server alike) with no allowlist gate.
            self._handle_rfr()
        elif path == _ALLOW_FINNHUB_GET_EXACT_PATH:
            # Narrow on purpose: the ONLY Finnhub path this proxy will ever forward, in every
            # mode (local and shared alike) - not gated behind SHARED_TOKEN's allowlist since
            # it's an entirely separate credential/upstream, but still can't become an open
            # proxy to the rest of Finnhub's surface.
            self._proxy_finnhub()
        elif self._is_api():
            if self._api_allowed("GET"):
                self._proxy("GET")
            else:
                self._send(403, "text/plain", b"forbidden")
        else:
            self._serve_static()

    def _handle_rfr(self):
        try:
            result = _fetch_risk_free_rate()
            self._send(200, "application/json", json.dumps(result).encode(),
                       extra=[("Cache-Control", "public, max-age=1800")])
        except Exception as e:
            self._send(502, "application/json", json.dumps({"error": str(e)}).encode())

    def _proxy(self, method):
        try:
            status, ctype, data = self._forward(method)
            self._send(status, ctype, data)
        except Exception as e:
            self._send(502, "text/plain", str(e).encode())

    def _proxy_finnhub(self):
        try:
            status, ctype, data = self._forward_finnhub()
            self._send(status, ctype, data)
        except Exception as e:
            self._send(502, "text/plain", str(e).encode())

    def _serve_static(self):
        # Serve a file from BASE_DIR (root path -> the app). Refuse anything that escapes it.
        rel = unquote(self.path.split("?", 1)[0]).lstrip("/") or DEFAULT_FILE
        full = os.path.normpath(os.path.join(BASE_DIR, rel))
        try:
            inside = os.path.commonpath([full, BASE_DIR]) == BASE_DIR
        except ValueError:
            inside = False                      # different drive on Windows -> outside
        if not inside or not os.path.isfile(full):
            self._send(404, "text/plain", b"not found")
            return
        ctype = STATIC_TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        try:
            mtime = os.path.getmtime(full)
        except OSError as e:
            self._send(500, "text/plain", str(e).encode())
            return
        entry = _static_cache.get(full)
        if entry is None or entry["mtime"] != mtime:
            try:
                with open(full, "rb") as f:
                    body = f.read()
            except OSError as e:
                self._send(500, "text/plain", str(e).encode())
                return
            # In shared-server mode, drop the bootstrap into the served HTML right after <head>
            # so visitors connect through this proxy without ever seeing the token dialog.
            # SHARED_TOKEN is fixed for the life of the process, so this is safe to bake into
            # the cached body rather than redoing it per request.
            if SHARED_TOKEN and ctype.startswith("text/html"):
                i = body.lower().find(b"<head")
                if i != -1:
                    j = body.find(b">", i)
                    if j != -1:
                        body = body[:j + 1] + _BOOTSTRAP + body[j + 1:]
            # ETag over the FINAL bytes (post-injection) lets a returning browser revalidate
            # with a tiny 304 instead of re-downloading the ~900 KB app. HTML is no-cache (must
            # revalidate) so a redeploy shows up on the next refresh; other assets get a short
            # max-age.
            etag = '"' + hashlib.md5(body).hexdigest() + '"'
            gz = None
            if ctype.split(";", 1)[0].strip().lower() in COMPRESSIBLE_TYPES:
                gz = gzip.compress(body, compresslevel=6)
            entry = {"mtime": mtime, "body": body, "etag": etag, "gz": gz}
            _static_cache[full] = entry
        if self.headers.get("If-None-Match") == entry["etag"]:
            self.send_response(304)
            self._cors()
            self.send_header("ETag", entry["etag"])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        cache = "no-cache" if ctype.startswith("text/html") else "public, max-age=3600"
        extra = [("ETag", entry["etag"]), ("Cache-Control", cache)]
        accept_enc = self.headers.get("Accept-Encoding", "")
        if entry["gz"] is not None and "gzip" in accept_enc:
            # Vary tells any cache in front of this (browser or CDN) that the response differs
            # by Accept-Encoding, so a gzip-capable and a non-gzip client never share one entry.
            extra.append(("Content-Encoding", "gzip"))
            extra.append(("Vary", "Accept-Encoding"))
            self._send(200, ctype, entry["gz"], extra=extra)
        else:
            self._send(200, ctype, entry["body"], extra=extra)

    def log_message(self, fmt, *args):
        # print path only, never headers (keeps your token out of the console)
        print("proxy:", self.path.split("?")[0])


if __name__ == "__main__":
    mode = "SHARED-TOKEN server" if SHARED_TOKEN else "local (pass-through)"
    print(f"SWAGINO running on http://{BIND}:{PORT}   [{mode}]")
    print(f"  open   ->  http://{BIND}:{PORT}/{DEFAULT_FILE}")
    print(f"  /v1/*  ->  proxied to https://{UPSTREAM_HOST} (keep-alive, pooled per thread)")
    if SHARED_TOKEN:
        print("  token  ->  injected server-side; visitors never see or send a credential")
    http.server.ThreadingHTTPServer((BIND, PORT), Proxy).serve_forever()
