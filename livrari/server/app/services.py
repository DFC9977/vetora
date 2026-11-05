"""Business logic for delivery runs, invoices, delivery tracking, reports and the product catalog."""

import difflib
import io
import uuid
from datetime import date, datetime, timezone

from . import db, invoice_extract

RUN_STATES = ("planned", "loaded", "in_progress", "done")
DELIVERY_STATES = ("pending", "delivered", "partial", "not_delivered")
RETURN_REASONS = ("refused", "damaged", "missing", "wrong", "other")
FUZZY_CUTOFF = 0.88
MAX_FILE_BYTES = 15 * 1024 * 1024

CATALOG_COLUMNS = {
    "categorie": "producer",
    "producator": "producer",
    "furnizor": "producer",
    "cod intern": "internal_code",
    "cod": "internal_code",
    "cod ean": "ean",
    "ean": "ean",
    "denumire": "name",
    "denumire produs": "name",
    "pret": "price",
    "pret fara tva": "price",
    "tva": "vat_rate",
    "cota tva": "vat_rate",
    "cod vamal": "hs_code",
    "cod hs": "hs_code",
}


class AppError(Exception):
    def __init__(self, code, message, details=None, status=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        self.status = status


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _f(value):
    if value in (None, "", False):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    parsed = invoice_extract.parse_number(str(value))
    return parsed if parsed is not None else 0.0


def _s(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def product_key(code, name):
    key = invoice_extract.normalize_key(code) if code else ""
    return ("code:" + key) if key else ("name:" + invoice_extract.normalize_key(name))


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _line_amount(row):
    return round((row["quantity"] or 0.0) * (row["price_unit"] or 0.0) - (row["discount_amount"] or 0.0), 2)


def serialize_lines(conn, invoice_id):
    rows = conn.execute(
        """SELECT l.*, c.internal_code AS c_code, c.producer AS c_producer
           FROM lines l LEFT JOIN catalog c ON c.id = l.catalog_id
           WHERE l.invoice_id = ? ORDER BY l.seq, l.id""",
        (invoice_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "product_code": r["product_code"],
            "product_name": r["product_name"],
            "uom": r["uom"],
            "quantity": r["quantity"],
            "price_unit": r["price_unit"],
            "vat_rate": r["vat_rate"],
            "discount_amount": r["discount_amount"],
            "amount": _line_amount(r),
            "lot_number": r["lot_number"],
            "expiry_date": r["expiry_date"],
            "catalog_id": r["catalog_id"],
            "catalog_code": r["c_code"],
            "producer": r["c_producer"],
            "return_qty": r["return_qty"],
            "delivered_qty": (r["quantity"] or 0.0) - (r["return_qty"] or 0.0),
            "return_reason": r["return_reason"],
            "delivery_note": r["delivery_note"],
        }
        for r in rows
    ]


def serialize_invoice(conn, inv, with_lines=False, include_text=False):
    lines = serialize_lines(conn, inv["id"])
    run = conn.execute("SELECT name FROM runs WHERE id = ?", (inv["run_id"],)).fetchone() if inv["run_id"] else None
    data = {
        "id": inv["id"],
        "name": inv["number"],
        "invoice_date": inv["invoice_date"],
        "supplier_name": inv["supplier_name"],
        "supplier_vat": inv["supplier_vat"],
        "customer_name": inv["customer_name"],
        "customer_vat": inv["customer_vat"],
        "customer_phone": inv["customer_phone"],
        "delivery_address": inv["delivery_address"],
        "run_id": inv["run_id"],
        "run_name": run["name"] if run else None,
        "file_name": inv["file_name"],
        "has_file": bool(inv["file_path"]),
        "extraction_method": inv["extraction_method"] or "manual",
        "notes": inv["notes"],
        "delivery_state": inv["delivery_state"],
        "delivered_at": inv["delivered_at"],
        "delivery_note": inv["delivery_note"],
        "amount_untaxed": round(sum(ln["amount"] for ln in lines), 2),
        "line_count": len(lines),
    }
    if with_lines:
        data["lines"] = lines
    if include_text:
        data["raw_text"] = inv["raw_text"] or ""
    return data


def serialize_run(conn, run):
    stats = conn.execute(
        """SELECT COUNT(*) AS n,
                  SUM(delivery_state = 'pending') AS pending,
                  SUM(delivery_state = 'delivered') AS delivered,
                  SUM(delivery_state = 'partial') AS partial,
                  SUM(delivery_state = 'not_delivered') AS not_delivered
           FROM invoices WHERE run_id = ?""",
        (run["id"],),
    ).fetchone()
    amount = conn.execute(
        """SELECT COALESCE(SUM(l.quantity * l.price_unit - l.discount_amount), 0)
           FROM lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.run_id = ?""",
        (run["id"],),
    ).fetchone()[0]
    return {
        "id": run["id"],
        "name": run["name"],
        "date": run["date"],
        "driver": run["driver"],
        "vehicle": run["vehicle"],
        "notes": run["notes"],
        "state": run["state"],
        "invoice_count": stats["n"] or 0,
        "pending_count": stats["pending"] or 0,
        "delivered_count": stats["delivered"] or 0,
        "partial_count": stats["partial"] or 0,
        "not_delivered_count": stats["not_delivered"] or 0,
        "amount_total": round(amount or 0.0, 2),
    }


def get_run_row(conn, run_id):
    row = conn.execute("SELECT * FROM runs WHERE id = ?", (int(run_id or 0),)).fetchone()
    if not row:
        raise AppError("NOT_FOUND", "Cursa nu a fost găsită.", status=404)
    return row


def get_invoice_row(conn, invoice_id):
    row = conn.execute("SELECT * FROM invoices WHERE id = ?", (int(invoice_id or 0),)).fetchone()
    if not row:
        raise AppError("NOT_FOUND", "Factura nu a fost găsită.", status=404)
    return row


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------

def list_runs(conn, date_from=None, date_to=None, limit=100):
    sql, args = "SELECT * FROM runs WHERE 1=1", []
    if date_from:
        sql += " AND date >= ?"
        args.append(date_from)
    if date_to:
        sql += " AND date <= ?"
        args.append(date_to)
    sql += " ORDER BY date DESC, id DESC LIMIT ?"
    args.append(int(limit or 100))
    return [serialize_run(conn, r) for r in conn.execute(sql, args).fetchall()]


def save_run(conn, vals):
    fields = {}
    for key in ("name", "driver", "vehicle", "notes"):
        if key in vals:
            fields[key] = _s(vals.get(key))
    if vals.get("date"):
        try:
            date.fromisoformat(vals["date"])
        except ValueError as e:
            raise AppError("VALIDATION_ERROR", "Dată invalidă.") from e
        fields["date"] = vals["date"]
    if "state" in vals:
        if vals["state"] not in RUN_STATES:
            raise AppError("VALIDATION_ERROR", "Stare cursă invalidă.")
        fields["state"] = vals["state"]
    if vals.get("id"):
        run = get_run_row(conn, vals["id"])
        if "name" in fields and not fields["name"]:
            fields.pop("name")
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE runs SET {sets} WHERE id = ?", (*fields.values(), run["id"]))
        run_id = run["id"]
    else:
        fields.setdefault("date", date.today().isoformat())
        if not fields.get("name"):
            fields["name"] = f"Cursa {fields['date']}"
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        run_id = conn.execute(f"INSERT INTO runs ({cols}) VALUES ({marks})", tuple(fields.values())).lastrowid
    return serialize_run(conn, get_run_row(conn, run_id))


def get_run(conn, run_id):
    run = get_run_row(conn, run_id)
    data = serialize_run(conn, run)
    invs = conn.execute("SELECT * FROM invoices WHERE run_id = ? ORDER BY id", (run["id"],)).fetchall()
    data["invoices"] = [serialize_invoice(conn, i, with_lines=True) for i in invs]
    return data


def delete_run(conn, run_id):
    run = get_run_row(conn, run_id)
    done = conn.execute(
        "SELECT COUNT(*) FROM invoices WHERE run_id = ? AND delivery_state != 'pending'", (run["id"],)
    ).fetchone()[0]
    if done:
        raise AppError("VALIDATION_ERROR", "Cursa are livrări înregistrate și nu poate fi ștearsă.")
    for inv in conn.execute("SELECT * FROM invoices WHERE run_id = ?", (run["id"],)).fetchall():
        _delete_file(inv["file_path"])
    conn.execute("DELETE FROM runs WHERE id = ?", (run["id"],))


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------

def _delete_file(rel_path):
    if rel_path:
        try:
            (db.FILES_DIR / rel_path).unlink(missing_ok=True)
        except OSError:
            pass


def find_duplicate(conn, number, supplier_name, exclude_id=None):
    if not number:
        return None
    sql = "SELECT i.*, r.name AS run_name FROM invoices i LEFT JOIN runs r ON r.id = i.run_id WHERE lower(i.number) = lower(?)"
    args = [number]
    if supplier_name:
        sql += " AND lower(COALESCE(i.supplier_name, '')) = lower(?)"
        args.append(supplier_name)
    if exclude_id:
        sql += " AND i.id != ?"
        args.append(exclude_id)
    return conn.execute(sql + " LIMIT 1", args).fetchone()


def _insert_lines(conn, invoice_id, lines):
    for i, ln in enumerate(lines):
        name = _s(ln.get("product_name"))
        if not name:
            continue
        code = _s(ln.get("product_code"))
        qty = _f(ln.get("quantity"))
        ret = min(max(_f(ln.get("return_qty")), 0.0), max(qty, 0.0))
        reason = ln.get("return_reason") if ln.get("return_reason") in RETURN_REASONS else None
        conn.execute(
            """INSERT INTO lines (invoice_id, seq, product_code, product_name, product_key, uom, quantity,
                                  price_unit, vat_rate, discount_amount, lot_number, expiry_date, catalog_id,
                                  return_qty, return_reason, delivery_note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                invoice_id, (i + 1) * 10, code, name, product_key(code, name), _s(ln.get("uom")), qty,
                _f(ln.get("price_unit")), _f(ln.get("vat_rate")), _f(ln.get("discount_amount")),
                _s(ln.get("lot_number")), _s(ln.get("expiry_date")), match_catalog(conn, name, code),
                ret, reason, _s(ln.get("delivery_note")),
            ),
        )


def create_invoice_from_file(conn, run_id, file_bytes, file_name):
    run = get_run_row(conn, run_id)
    if not file_bytes:
        raise AppError("INVALID_FILE", "Fișier gol.")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise AppError("FILE_TOO_LARGE", "Fișierul depășește 15 MB.")
    text, method = invoice_extract.extract_text(file_bytes, file_name)
    parsed = invoice_extract.parse_invoice_text(text)
    dup = find_duplicate(conn, parsed["invoice_number"], parsed["supplier_name"])
    if dup:
        raise AppError(
            "DUPLICATE_INVOICE",
            f"Factura {parsed['invoice_number']} a fost deja încărcată ({dup['run_name'] or '-'}).",
            {"invoice_id": dup["id"], "run_id": dup["run_id"]},
        )
    suffix = ".pdf" if invoice_extract._is_pdf(file_bytes, file_name) else (
        "." + file_name.rsplit(".", 1)[-1].lower() if "." in (file_name or "") else ""
    )
    rel_path = f"{uuid.uuid4().hex}{suffix}"
    (db.FILES_DIR / rel_path).write_bytes(file_bytes)
    inv_id = conn.execute(
        """INSERT INTO invoices (run_id, number, invoice_date, supplier_name, supplier_vat, customer_name,
                                 customer_vat, customer_phone, delivery_address, file_name, file_path,
                                 raw_text, extraction_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            run["id"], parsed["invoice_number"], parsed["invoice_date"], parsed["supplier_name"],
            parsed["supplier_vat"], parsed["customer_name"], parsed["customer_vat"], parsed["customer_phone"],
            parsed["delivery_address"], file_name, rel_path, text or None, method,
        ),
    ).lastrowid
    _insert_lines(conn, inv_id, parsed["lines"])
    return serialize_invoice(conn, get_invoice_row(conn, inv_id), with_lines=True)


def save_invoice(conn, vals):
    """Edit an invoice header and (optionally) replace its lines. Lines can only be replaced
    while the delivery is not recorded (to keep returned quantities consistent)."""
    inv = get_invoice_row(conn, vals.get("id"))
    mapping = {
        "name": "number", "invoice_date": "invoice_date", "supplier_name": "supplier_name",
        "supplier_vat": "supplier_vat", "customer_name": "customer_name", "customer_vat": "customer_vat",
        "customer_phone": "customer_phone", "delivery_address": "delivery_address", "notes": "notes",
    }
    fields = {col: _s(vals.get(key)) for key, col in mapping.items() if key in vals}
    if fields.get("number"):
        dup = find_duplicate(conn, fields["number"], fields.get("supplier_name", inv["supplier_name"]), exclude_id=inv["id"])
        if dup:
            raise AppError("DUPLICATE_INVOICE", f"Există deja factura {fields['number']} ({dup['run_name'] or '-'}).")
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE invoices SET {sets} WHERE id = ?", (*fields.values(), inv["id"]))
    if "lines" in vals:
        if inv["delivery_state"] != "pending":
            raise AppError("VALIDATION_ERROR", "Livrarea este înregistrată; resetați statusul înainte de a modifica liniile.")
        conn.execute("DELETE FROM lines WHERE invoice_id = ?", (inv["id"],))
        _insert_lines(conn, inv["id"], vals.get("lines") or [])
    return serialize_invoice(conn, get_invoice_row(conn, inv["id"]), with_lines=True, include_text=True)


def remove_invoice(conn, invoice_id):
    inv = get_invoice_row(conn, invoice_id)
    if inv["delivery_state"] != "pending":
        raise AppError("VALIDATION_ERROR", "Factura are livrarea înregistrată; resetați statusul întâi.")
    _delete_file(inv["file_path"])
    conn.execute("DELETE FROM invoices WHERE id = ?", (inv["id"],))


def invoice_file(conn, invoice_id):
    inv = get_invoice_row(conn, invoice_id)
    if not inv["file_path"]:
        raise AppError("NOT_FOUND", "Factura nu are fișier.", status=404)
    path = db.FILES_DIR / inv["file_path"]
    if not path.exists():
        raise AppError("NOT_FOUND", "Fișierul nu mai există.", status=404)
    return path, inv["file_name"] or path.name


# ---------------------------------------------------------------------------
# Delivery tracking
# ---------------------------------------------------------------------------

def set_delivery(conn, invoice_id, status, note=None, lines=None, note_given=False):
    """status: pending | delivered | not_delivered | partial (final state derived from returned qty)."""
    inv = get_invoice_row(conn, invoice_id)
    if status not in DELIVERY_STATES:
        raise AppError("VALIDATION_ERROR", "Status de livrare invalid.")
    if status in ("pending", "delivered"):
        conn.execute("UPDATE lines SET return_qty = 0, return_reason = NULL WHERE invoice_id = ?", (inv["id"],))
    elif status == "not_delivered":
        conn.execute(
            "UPDATE lines SET return_qty = quantity, return_reason = COALESCE(return_reason, 'refused') WHERE invoice_id = ?",
            (inv["id"],),
        )
    if lines:
        existing = {r["id"]: r for r in conn.execute("SELECT * FROM lines WHERE invoice_id = ?", (inv["id"],))}
        for vals in lines:
            row = existing.get(int(vals.get("id") or 0))
            if not row:
                continue
            upd = {}
            if status == "partial" and "return_qty" in vals:
                qty = _f(vals.get("return_qty"))
                if qty < 0 or qty > max(row["quantity"], 0.0) + 1e-6:
                    raise AppError(
                        "VALIDATION_ERROR",
                        f"Cantitatea returnată pentru „{row['product_name']}” trebuie să fie între 0 și {row['quantity']:g}.",
                    )
                upd["return_qty"] = qty
            if "return_reason" in vals:
                upd["return_reason"] = vals["return_reason"] if vals.get("return_reason") in RETURN_REASONS else None
            if "delivery_note" in vals:
                upd["delivery_note"] = _s(vals.get("delivery_note"))
            if upd:
                sets = ", ".join(f"{k} = ?" for k in upd)
                conn.execute(f"UPDATE lines SET {sets} WHERE id = ?", (*upd.values(), row["id"]))
    final = status
    if status == "partial":
        returned, total = conn.execute(
            "SELECT COALESCE(SUM(return_qty), 0), COALESCE(SUM(quantity), 0) FROM lines WHERE invoice_id = ?", (inv["id"],)
        ).fetchone()
        final = "delivered" if returned <= 0 else ("not_delivered" if returned >= total else "partial")
    fields = {"delivery_state": final, "delivered_at": None if final == "pending" else _now()}
    if note_given:
        fields["delivery_note"] = _s(note)
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE invoices SET {sets} WHERE id = ?", (*fields.values(), inv["id"]))
    return serialize_invoice(conn, get_invoice_row(conn, inv["id"]), with_lines=True)


# ---------------------------------------------------------------------------
# Loading list / delivery report
# ---------------------------------------------------------------------------

def summary(conn, run_id=None, date_from=None, date_to=None, customer=None):
    run = None
    if run_id:
        run = get_run_row(conn, run_id)
        invs = conn.execute("SELECT * FROM invoices WHERE run_id = ? ORDER BY id", (run["id"],)).fetchall()
    else:
        sql = "SELECT i.* FROM invoices i JOIN runs r ON r.id = i.run_id WHERE 1=1"
        args = []
        if date_from:
            sql += " AND r.date >= ?"
            args.append(date_from)
        if date_to:
            sql += " AND r.date <= ?"
            args.append(date_to)
        if customer:
            sql += " AND lower(COALESCE(i.customer_name, '')) LIKE ?"
            args.append(f"%{customer.lower()}%")
        invs = conn.execute(sql + " ORDER BY r.date, i.id", args).fetchall()

    invoices = [serialize_invoice(conn, i, with_lines=True) for i in invs]
    catalog = {r["id"]: r for r in conn.execute(
        "SELECT * FROM catalog WHERE id IN (SELECT DISTINCT catalog_id FROM lines WHERE catalog_id IS NOT NULL)"
    )}
    rows = {}
    for inv in invoices:
        for ln in inv["lines"]:
            cat = catalog.get(ln["catalog_id"]) if ln["catalog_id"] else None
            key = f"cat:{cat['id']}" if cat else product_key(ln["product_code"], ln["product_name"])
            row = rows.get(key)
            if row is None:
                row = rows[key] = {
                    "product_key": key,
                    "product_code": cat["internal_code"] if cat else ln["product_code"],
                    "ean": cat["ean"] if cat else None,
                    "producer": cat["producer"] if cat else None,
                    "product_name": cat["name"] if cat else ln["product_name"],
                    "uom": ln["uom"],
                    "quantity": 0.0,
                    "delivered_qty": 0.0,
                    "returned_qty": 0.0,
                    "amount": 0.0,
                    "invoices": [],
                }
            row["quantity"] += ln["quantity"]
            row["delivered_qty"] += ln["delivered_qty"]
            row["returned_qty"] += ln["return_qty"]
            row["amount"] = round(row["amount"] + ln["amount"], 2)
            row["invoices"].append({
                "invoice_id": inv["id"],
                "invoice_name": inv["name"] or inv["file_name"],
                "customer_name": inv["customer_name"],
                "quantity": ln["quantity"],
                "returned_qty": ln["return_qty"],
                "return_reason": ln["return_reason"],
                "delivery_note": ln["delivery_note"],
            })
    products = sorted(rows.values(), key=lambda r: ((r["producer"] or "~").lower(), r["product_name"].lower()))
    producers = {}
    for r in products:
        p = producers.setdefault(r["producer"] or "", {
            "producer": r["producer"], "products": 0, "quantity": 0.0, "delivered_qty": 0.0, "returned_qty": 0.0,
        })
        p["products"] += 1
        p["quantity"] += r["quantity"]
        p["delivered_qty"] += r["delivered_qty"]
        p["returned_qty"] += r["returned_qty"]
    counts = {s: sum(1 for i in invoices if i["delivery_state"] == s) for s in DELIVERY_STATES}
    return {
        "run": serialize_run(conn, run) if run else None,
        "invoices": invoices,
        "products": products,
        "by_producer": sorted(producers.values(), key=lambda p: (p["producer"] or "~").lower()),
        "counts": counts,
        "totals": {
            "invoices": len(invoices),
            "quantity": sum(p["quantity"] for p in products),
            "delivered_qty": sum(p["delivered_qty"] for p in products),
            "returned_qty": sum(p["returned_qty"] for p in products),
            "amount": round(sum(i["amount_untaxed"] for i in invoices), 2),
        },
    }


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

def match_catalog(conn, name, code=None):
    """Return the catalog id for a line: code/EAN, exact normalized name, then fuzzy name."""
    if code:
        row = conn.execute(
            "SELECT id FROM catalog WHERE lower(internal_code) = lower(?) OR ean = ? LIMIT 1", (code, code)
        ).fetchone()
        if row:
            return row["id"]
    key = invoice_extract.normalize_key(name)
    if not key:
        return None
    row = conn.execute("SELECT id FROM catalog WHERE name_key = ? LIMIT 1", (key,)).fetchone()
    if row:
        return row["id"]
    first = key.split(" ", 1)[0]
    candidates = {r["name_key"]: r["id"] for r in conn.execute(
        "SELECT id, name_key FROM catalog WHERE name_key LIKE ?", (first + "%",)
    )}
    best = difflib.get_close_matches(key, list(candidates), n=1, cutoff=FUZZY_CUTOFF)
    return candidates[best[0]] if best else None


def rematch_all(conn):
    n = 0
    for row in conn.execute("SELECT id, product_name, product_code FROM lines").fetchall():
        cid = match_catalog(conn, row["product_name"], row["product_code"])
        conn.execute("UPDATE lines SET catalog_id = ? WHERE id = ?", (cid, row["id"]))
        n += 1 if cid else 0
    return n


def import_catalog(conn, file_bytes):
    try:
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001
        raise AppError("INVALID_FILE", "Fișierul nu este un Excel (.xlsx) valid.") from e
    rows = wb.worksheets[0].iter_rows(values_only=True)
    mapping = None
    for row in rows:
        norm = [invoice_extract.normalize_key(str(c)) if c is not None else "" for c in row]
        if "denumire" in norm or "denumire produs" in norm:
            mapping = {}
            for idx, header in enumerate(norm):
                field = CATALOG_COLUMNS.get(header)
                if field and field not in mapping.values():
                    mapping[idx] = field
            break
    if not mapping:
        raise AppError("INVALID_FILE", "Nu am găsit rândul de antet cu coloana „Denumire”.")

    created = updated = skipped = 0
    for row in rows:
        vals = {}
        for idx, field in mapping.items():
            value = row[idx] if idx < len(row) else None
            if value is None or value == "":
                continue
            if field == "price":
                value = float(value) if isinstance(value, (int, float)) else invoice_extract.parse_number(str(value))
            elif field == "vat_rate":
                if isinstance(value, (int, float)):
                    value = float(value) * 100 if float(value) < 1 else float(value)
                else:
                    value = invoice_extract.parse_number(str(value).split("%")[0].strip())
            else:
                value = str(value).strip()
                if field == "ean" and value.endswith(".0"):
                    value = value[:-2]
            if value is not None and value != "":
                vals[field] = value
        if not vals.get("name"):
            skipped += 1
            continue
        vals["name_key"] = invoice_extract.normalize_key(vals["name"])
        if vals.get("internal_code"):
            existing = conn.execute("SELECT id FROM catalog WHERE internal_code = ?", (vals["internal_code"],)).fetchone()
        else:
            existing = conn.execute(
                "SELECT id FROM catalog WHERE internal_code IS NULL AND name_key = ?", (vals["name_key"],)
            ).fetchone()
        if existing:
            sets = ", ".join(f"{k} = ?" for k in vals)
            conn.execute(f"UPDATE catalog SET {sets} WHERE id = ?", (*vals.values(), existing["id"]))
            updated += 1
        else:
            cols = ", ".join(vals)
            marks = ", ".join("?" for _ in vals)
            conn.execute(f"INSERT INTO catalog ({cols}) VALUES ({marks})", tuple(vals.values()))
            created += 1
    matched = rematch_all(conn)
    return {"created": created, "updated": updated, "skipped": skipped, "rematched_lines": matched}


def list_catalog(conn, query=None, limit=300):
    sql, args = "FROM catalog WHERE 1=1", []
    if query:
        q = f"%{query.lower()}%"
        sql += " AND (lower(name) LIKE ? OR lower(COALESCE(internal_code,'')) LIKE ? OR COALESCE(ean,'') LIKE ? OR lower(COALESCE(producer,'')) LIKE ?)"
        args += [q, q, q, q]
    total = conn.execute("SELECT COUNT(*) " + sql, args).fetchone()[0]
    rows = conn.execute("SELECT * " + sql + " ORDER BY producer, name LIMIT ?", (*args, min(int(limit or 300), 1000))).fetchall()
    return {
        "total": total,
        "products": [
            {
                "id": r["id"], "name": r["name"], "internal_code": r["internal_code"], "ean": r["ean"],
                "producer": r["producer"], "price": r["price"], "vat_rate": r["vat_rate"], "hs_code": r["hs_code"],
            }
            for r in rows
        ],
    }
