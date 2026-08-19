# Multi-stage build: compile Python deps (several — cryptography, pillow,
# grpcio — need a C toolchain) in a full image, then copy just the built
# site-packages into a slim runtime image so the shipped container isn't
# carrying gcc/build headers around.

FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# emergentintegrations is a private package (only resolvable through this
# dev sandbox's own package mirror, not public PyPI) that powers the
# optional "Ask Kanda AI" chat/voice-transcription endpoints
# (routes/assistant.py) via a sandbox-issued EMERGENT_LLM_KEY. Neither the
# package nor that key exist outside this dev environment, so it's excluded
# from the container build — everything else in the app is unaffected,
# since both usages are lazy imports scoped inside their own route handlers,
# not module-level. Those two endpoints simply aren't available in this
# deployment until they're re-pointed at a real LLM provider — a separate,
# deliberate task, not a byproduct of this build fix.
RUN grep -v '^emergentintegrations==' requirements.txt > requirements.docker.txt \
    && pip install --no-cache-dir --prefix=/install -r requirements.docker.txt

FROM python:3.11-slim AS runtime

WORKDIR /app

# Cloud Run (and most container platforms) run as a non-root user by
# convention; the FastAPI app itself needs no elevated privileges.
RUN useradd --create-home --shell /bin/bash kanda
COPY --from=builder /install /usr/local
COPY . .
RUN chown -R kanda:kanda /app

# Debian's OpenSSL ships a default CipherString of DEFAULT@SECLEVEL=2, which
# some MongoDB Atlas shared-tier (M0) clusters' TLS handshakes don't satisfy
# — pymongo fails with "SSL handshake failed: ... TLSV1_ALERT_INTERNAL_ERROR"
# against every shard host, an alert the *server* side sends, not a client
# CA-trust problem (that's a different fix, already applied in db.py).
# Lowering to SECLEVEL=1 is the standard workaround for this exact error.
RUN sed -i 's/^CipherString = DEFAULT@SECLEVEL=2/CipherString = DEFAULT@SECLEVEL=1/' /etc/ssl/openssl.cnf

USER kanda

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-8000}/healthz')" || exit 1

# Cloud Run injects $PORT; default to 8000 for local/docker-compose runs
# where nothing sets it. Shell form so the ${PORT:-8000} expansion happens.
CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}
