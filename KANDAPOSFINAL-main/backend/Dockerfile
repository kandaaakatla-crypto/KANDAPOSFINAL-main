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
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim AS runtime

WORKDIR /app

# Cloud Run (and most container platforms) run as a non-root user by
# convention; the FastAPI app itself needs no elevated privileges.
RUN useradd --create-home --shell /bin/bash kanda
COPY --from=builder /install /usr/local
COPY . .
RUN chown -R kanda:kanda /app
USER kanda

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-8000}/healthz')" || exit 1

# Cloud Run injects $PORT; default to 8000 for local/docker-compose runs
# where nothing sets it. Shell form so the ${PORT:-8000} expansion happens.
CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}
