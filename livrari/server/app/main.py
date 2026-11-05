"""Vetora Livrări – standalone server (FastAPI + SQLite).

All API endpoints are POST /api/... with a JSON body and answer {"ok": true, "data": ...}
or {"ok": false, "error": {"code", "message", "details"}}. The built web UI is served from WEB_DIR.
"""

import base64
import binascii
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import db, services
from .services import AppError

WEB_DIR = Path(os.environ.get("WEB_DIR", Path(__file__).resolve().parents[2] / "web" / "out"))
# Optional protection: if both are set, every request needs HTTP Basic auth.
APP_USER = os.environ.get("APP_USER") or None
APP_PASSWORD = os.environ.get("APP_PASSWORD") or None

@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    yield


app = FastAPI(title="Vetora Livrări", docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=lifespan)


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if APP_USER and APP_PASSWORD and request.url.path != "/api/health":
        header = request.headers.get("authorization", "")
        ok = False
        if header.lower().startswith("basic "):
            try:
                user, _, pwd = base64.b64decode(header[6:]).decode().partition(":")
                ok = secrets.compare_digest(user, APP_USER) and secrets.compare_digest(pwd, APP_PASSWORD)
            except (binascii.Error, UnicodeDecodeError):
                ok = False
        if not ok:
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Vetora Livrari"'})
    return await call_next(request)


@app.exception_handler(AppError)
async def _app_error(_request, exc: AppError):
    return JSONResponse(
        {"ok": False, "error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        status_code=exc.status,
    )


def ok(data):
    return {"ok": True, "data": data}


def _decode_file(payload):
    raw = payload.get("file_base64") or ""
    if not raw:
        raise AppError("MISSING_FIELDS", "Lipsește fișierul.")
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        return base64.b64decode(raw)
    except (binascii.Error, ValueError) as e:
        raise AppError("INVALID_FILE", "Conținutul fișierului nu este valid.") from e


@app.get("/api/health")
def health():
    return {"ok": True}


# --- Runs ---

@app.post("/api/runs/list")
def runs_list(p: dict = Body(default={})):
    with db.transaction() as conn:
        return ok({"runs": services.list_runs(conn, p.get("date_from"), p.get("date_to"), p.get("limit") or 100)})


@app.post("/api/runs/save")
def runs_save(p: dict = Body(default={})):
    with db.transaction() as conn:
        return ok(services.save_run(conn, p.get("run") or {}))


@app.post("/api/runs/get")
def runs_get(p: dict = Body(default={})):
    with db.transaction() as conn:
        return ok(services.get_run(conn, p.get("run_id")))


@app.post("/api/runs/delete")
def runs_delete(p: dict = Body(default={})):
    with db.transaction() as conn:
        services.delete_run(conn, p.get("run_id"))
        return ok({"deleted": True})


@app.post("/api/runs/upload")
def runs_upload(p: dict = Body(default={})):
    file_bytes = _decode_file(p)
    with db.transaction() as conn:
        return ok(services.create_invoice_from_file(conn, p.get("run_id"), file_bytes, p.get("file_name") or "factura.pdf"))


# --- Invoices ---

@app.post("/api/invoices/get")
def invoices_get(p: dict = Body(default={})):
    with db.transaction() as conn:
        inv = services.get_invoice_row(conn, p.get("invoice_id"))
        return ok(services.serialize_invoice(conn, inv, with_lines=True, include_text=True))


@app.post("/api/invoices/save")
def invoices_save(p: dict = Body(default={})):
    with db.transaction() as conn:
        return ok(services.save_invoice(conn, p.get("invoice") or {}))


@app.post("/api/invoices/remove")
def invoices_remove(p: dict = Body(default={})):
    with db.transaction() as conn:
        services.remove_invoice(conn, p.get("invoice_id"))
        return ok({"removed": True})


@app.get("/api/invoices/{invoice_id}/file")
def invoices_file(invoice_id: int):
    with db.transaction() as conn:
        path, name = services.invoice_file(conn, invoice_id)
    media = "application/pdf" if path.suffix == ".pdf" else None
    return FileResponse(path, media_type=media, filename=name, content_disposition_type="inline")


# --- Delivery ---

@app.post("/api/delivery/update")
def delivery_update(p: dict = Body(default={})):
    with db.transaction() as conn:
        return ok(services.set_delivery(
            conn, p.get("invoice_id"), p.get("status") or "delivered",
            note=p.get("note"), lines=p.get("lines") or None, note_given="note" in p,
        ))


@app.post("/api/delivery/summary")
def delivery_summary(p: dict = Body(default={})):
    with db.transaction() as conn:
        return ok(services.summary(
            conn, run_id=p.get("run_id"), date_from=p.get("date_from"), date_to=p.get("date_to"),
            customer=(p.get("customer") or "").strip() or None,
        ))


# --- Catalog ---

@app.post("/api/catalog/import")
def catalog_import(p: dict = Body(default={})):
    file_bytes = _decode_file(p)
    with db.transaction() as conn:
        return ok(services.import_catalog(conn, file_bytes))


@app.post("/api/catalog/list")
def catalog_list(p: dict = Body(default={})):
    with db.transaction() as conn:
        return ok(services.list_catalog(conn, (p.get("query") or "").strip() or None, p.get("limit") or 300))


# --- Web UI (static export of the Next.js app) ---

if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
