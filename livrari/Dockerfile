# --- Build the web UI (static export) ---
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN NEXT_TELEMETRY_DISABLED=1 npm run build

# --- Python server (API + serves the UI) ---
FROM python:3.12-slim
WORKDIR /srv
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/app ./app
COPY --from=web /web/out ./web
ENV DATA_DIR=/data \
    WEB_DIR=/srv/web \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
