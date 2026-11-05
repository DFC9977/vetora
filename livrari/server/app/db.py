"""SQLite storage. One file (DATA_DIR/livrari.db); uploaded PDFs are kept in DATA_DIR/files."""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = DATA_DIR / "livrari.db"
FILES_DIR = DATA_DIR / "files"

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    driver TEXT,
    vehicle TEXT,
    notes TEXT,
    state TEXT NOT NULL DEFAULT 'planned',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_runs_date ON runs(date);

CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    number TEXT,
    invoice_date TEXT,
    supplier_name TEXT,
    supplier_vat TEXT,
    customer_name TEXT,
    customer_vat TEXT,
    customer_phone TEXT,
    delivery_address TEXT,
    file_name TEXT,
    file_path TEXT,
    raw_text TEXT,
    extraction_method TEXT,
    notes TEXT,
    delivery_state TEXT NOT NULL DEFAULT 'pending',
    delivered_at TEXT,
    delivery_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_run ON invoices(run_id);

CREATE TABLE IF NOT EXISTS lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL DEFAULT 0,
    product_code TEXT,
    product_name TEXT NOT NULL,
    product_key TEXT,
    uom TEXT,
    quantity REAL NOT NULL DEFAULT 0,
    price_unit REAL NOT NULL DEFAULT 0,
    vat_rate REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    lot_number TEXT,
    expiry_date TEXT,
    catalog_id INTEGER REFERENCES catalog(id) ON DELETE SET NULL,
    return_qty REAL NOT NULL DEFAULT 0,
    return_reason TEXT,
    delivery_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON lines(invoice_id);

CREATE TABLE IF NOT EXISTS catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    internal_code TEXT UNIQUE,
    ean TEXT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    producer TEXT,
    price REAL NOT NULL DEFAULT 0,
    vat_rate REAL NOT NULL DEFAULT 0,
    hs_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_catalog_key ON catalog(name_key);
CREATE INDEX IF NOT EXISTS idx_catalog_ean ON catalog(ean);
"""


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)


@contextmanager
def transaction():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
