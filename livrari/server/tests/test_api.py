import base64
import io

import openpyxl
import pytest

from app import invoice_extract
from tests.test_parser import CITYVET_TEXT


@pytest.fixture()
def fake_pdf(monkeypatch):
    """Make text extraction return a known invoice text (keyed by file content)."""
    texts = {}

    def fake_extract(data, filename=None):
        return texts.get(data, ""), "text"

    monkeypatch.setattr(invoice_extract, "extract_text", fake_extract)

    def make(text):
        data = b"%PDF-1.4 " + str(len(texts)).encode()
        texts[data] = text
        return base64.b64encode(data).decode()

    return make


def post(client, path, body=None, expect_ok=True):
    res = client.post(path, json=body or {})
    data = res.json()
    assert data["ok"] is expect_ok, data
    return data["data"] if expect_ok else data["error"]


def _catalog_xlsx():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["06.10.2026"])
    ws.append(["CATEGORIE", "Cod INTERN", "COD EAN", "Denumire", "Pret", "TVA", "Pret cu TVA", "COD VAMAL"])
    ws.append(["GOSBI PETFOOD SA", "GOS4", "8436566800372", "GOSBI ORIGINAL DOG ADULT 12kg", 174, "11%", 193.14, "23091090"])
    ws.append(["GOSBI PETFOOD SA", "GOS6", 8436566800358, "GOSBI ORIGINAL DOG BABY 12Kg ", 184, "11%", 204.24, "23091090"])
    ws.append(["KORMOTECH ", "KOR108", "4820215360000", "KITTIX ADULT CATS with beef - Bax 24X 85G", 30, "11%", 33.3, "23091090"])
    buf = io.BytesIO()
    wb.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


def test_full_delivery_flow(client, fake_pdf):
    imp = post(client, "/api/catalog/import", {"file_base64": _catalog_xlsx()})
    assert (imp["created"], imp["updated"]) == (3, 0)
    assert post(client, "/api/catalog/import", {"file_base64": _catalog_xlsx()})["updated"] == 3
    cat = post(client, "/api/catalog/list", {"query": "gos"})
    assert cat["total"] == 2 and cat["products"][0]["producer"] == "GOSBI PETFOOD SA"

    run = post(client, "/api/runs/save", {"run": {"date": "2026-11-05", "driver": "Ion"}})
    assert run["name"] == "Cursa 2026-11-05"

    inv = post(client, "/api/runs/upload", {"run_id": run["id"], "file_base64": fake_pdf(CITYVET_TEXT), "file_name": "6039.pdf"})
    assert inv["name"] == "CTVETF 6039" and inv["customer_name"] == "CERI IMPEX SRL"
    assert [ln["catalog_code"] for ln in inv["lines"]] == ["GOS4", "GOS6"]
    assert inv["amount_untaxed"] == 805.5

    # Same invoice again -> rejected
    err = post(client, "/api/runs/upload", {"run_id": run["id"], "file_base64": fake_pdf(CITYVET_TEXT)}, expect_ok=False)
    assert err["code"] == "DUPLICATE_INVOICE"

    second = CITYVET_TEXT.replace("CTVETF 6039", "CTVETF 6040").replace("CERI IMPEX SRL", "ALT CLIENT SRL")
    inv2 = post(client, "/api/runs/upload", {"run_id": run["id"], "file_base64": fake_pdf(second), "file_name": "6040.pdf"})

    # Loading list: totals per catalog product across both invoices
    s = post(client, "/api/delivery/summary", {"run_id": run["id"]})
    qty = {p["product_code"]: p["quantity"] for p in s["products"]}
    assert qty == {"GOS4": 6.0, "GOS6": 6.0}
    assert s["by_producer"][0] == {"producer": "GOSBI PETFOOD SA", "products": 2, "quantity": 12.0, "delivered_qty": 12.0, "returned_qty": 0.0}
    assert s["counts"]["pending"] == 2

    # Delivery: first delivered, second partial with a damaged bag
    post(client, "/api/delivery/update", {"invoice_id": inv["id"], "status": "delivered", "note": "ok"})
    line = inv2["lines"][1]
    d = post(client, "/api/delivery/update", {
        "invoice_id": inv2["id"], "status": "partial", "note": "un sac rupt",
        "lines": [{"id": line["id"], "return_qty": 1, "return_reason": "damaged", "delivery_note": "sac rupt"}],
    })
    assert d["delivery_state"] == "partial" and d["delivered_at"]
    err = post(client, "/api/delivery/update", {
        "invoice_id": inv2["id"], "status": "partial", "lines": [{"id": line["id"], "return_qty": 9}],
    }, expect_ok=False)
    assert err["code"] == "VALIDATION_ERROR"

    s = post(client, "/api/delivery/summary", {"run_id": run["id"]})
    gos6 = next(p for p in s["products"] if p["product_code"] == "GOS6")
    assert (gos6["quantity"], gos6["delivered_qty"], gos6["returned_qty"]) == (6.0, 5.0, 1.0)
    assert s["counts"] == {"pending": 0, "delivered": 1, "partial": 1, "not_delivered": 0}
    assert s["run"]["delivered_count"] == 1

    # Lines are locked once delivery is recorded; run with deliveries cannot be deleted
    err = post(client, "/api/invoices/save", {"invoice": {"id": inv["id"], "lines": []}}, expect_ok=False)
    assert err["code"] == "VALIDATION_ERROR"
    assert post(client, "/api/runs/delete", {"run_id": run["id"]}, expect_ok=False)["code"] == "VALIDATION_ERROR"

    # Period report
    rep = post(client, "/api/delivery/summary", {"date_from": "2026-11-01", "date_to": "2026-11-30", "customer": "alt"})
    assert rep["totals"]["invoices"] == 1 and rep["totals"]["returned_qty"] == 1.0
    assert post(client, "/api/delivery/summary", {"date_from": "2026-12-01"})["totals"]["invoices"] == 0

    # Not delivered then reset
    nd = post(client, "/api/delivery/update", {"invoice_id": inv["id"], "status": "not_delivered", "note": "client absent"})
    assert nd["delivery_state"] == "not_delivered" and all(ln["delivered_qty"] == 0 for ln in nd["lines"])
    assert post(client, "/api/delivery/update", {"invoice_id": inv["id"], "status": "pending"})["delivery_state"] == "pending"

    # The stored PDF is downloadable
    res = client.get(f"/api/invoices/{inv['id']}/file")
    assert res.status_code == 200 and res.content.startswith(b"%PDF")


def test_edit_invoice_and_remove(client, fake_pdf):
    run = post(client, "/api/runs/save", {"run": {"date": "2026-11-06"}})
    inv = post(client, "/api/runs/upload", {"run_id": run["id"], "file_base64": fake_pdf(CITYVET_TEXT)})
    saved = post(client, "/api/invoices/save", {"invoice": {
        "id": inv["id"], "customer_name": "CERI IMPEX SRL (depozit)",
        "lines": [{"product_name": "Produs nou", "quantity": "2", "price_unit": "10,5", "discount_amount": "1"}],
    }})
    assert saved["customer_name"] == "CERI IMPEX SRL (depozit)"
    assert saved["lines"][0]["amount"] == 20.0 and saved["lines"][0]["catalog_id"] is None
    post(client, "/api/invoices/remove", {"invoice_id": inv["id"]})
    assert post(client, "/api/runs/get", {"run_id": run["id"]})["invoices"] == []
    post(client, "/api/runs/delete", {"run_id": run["id"]})
    assert post(client, "/api/runs/list")["runs"] == []


def test_not_found_and_validation(client):
    assert client.post("/api/runs/get", json={"run_id": 999}).status_code == 404
    assert post(client, "/api/runs/save", {"run": {"date": "nu-e-data"}}, expect_ok=False)["code"] == "VALIDATION_ERROR"
    assert post(client, "/api/catalog/import", {"file_base64": base64.b64encode(b"nope").decode()}, expect_ok=False)["code"] == "INVALID_FILE"


def test_optional_basic_auth(client, monkeypatch):
    from app import main

    assert client.post("/api/runs/list", json={}).status_code == 200  # no login by default
    monkeypatch.setattr(main, "APP_USER", "depozit")
    monkeypatch.setattr(main, "APP_PASSWORD", "secret")
    assert client.post("/api/runs/list", json={}).status_code == 401
    assert client.get("/api/health").status_code == 200
    assert client.post("/api/runs/list", json={}, auth=("depozit", "gresit")).status_code == 401
    assert client.post("/api/runs/list", json={}, auth=("depozit", "secret")).status_code == 200
