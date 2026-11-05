import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import db

    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "livrari.db")
    monkeypatch.setattr(db, "FILES_DIR", tmp_path / "files")
    db.init_db()
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
