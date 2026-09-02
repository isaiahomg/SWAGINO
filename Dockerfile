# SWAGINO shared server — runs proxy.py with a baked-in Tradier token.
# The container listens only on the internal compose network; a Cloudflare Tunnel sidecar
# (see docker-compose.yml) is what reaches it, so no host port is ever published.
FROM python:3.12-slim

WORKDIR /app

# The app is a single self-contained HTML file plus the proxy, favicon, and local fonts.
COPY proxy.py swagino.html c799f001526d973d5e323d94542fe589.ico ./
COPY fonts/ ./fonts/

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
