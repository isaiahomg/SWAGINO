# SWAGINO shared server — runs proxy.py with a baked-in Tradier token.
# The container listens only on the internal compose network; a Cloudflare Tunnel sidecar
# (see docker-compose.yml) is what reaches it, so no host port is ever published.
FROM python:3.12-slim

WORKDIR /app

# The app is swagino.html plus the proxy, favicon, and local fonts/vendor/assets. vendor/ (the
# charting library) and assets/ (icon images) were split out of swagino.html itself 2026-09-15 to
# shrink it and let the browser cache them separately across app edits — proxy.py's existing
# generic static-file serving needs no changes to serve them, just these extra COPYs.
COPY proxy.py swagino.html favicon.ico ./
COPY fonts/ ./fonts/
COPY vendor/ ./vendor/
COPY assets/ ./assets/

# Run as an unprivileged user, never root. Port 8787 is > 1024 so no privilege is needed to bind.
RUN useradd -r -u 10001 swagino && chown -R swagino /app
USER swagino

# Bind to all interfaces INSIDE the container so the tunnel sidecar can reach it. The port is
# only exposed to the compose network, never to the public host.
ENV BIND=0.0.0.0 \
    PORT=8787
# TRADIER_TOKEN is supplied at run time from .env (never bake a credential into the image).

EXPOSE 8787

# Local /healthz check — never calls Tradier, so it's free and rate-limit-safe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/healthz',timeout=3).status==200 else 1)"

CMD ["python", "-u", "proxy.py"]
