import difflib
import io
import logging

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

from ..tools import invoice_extract

_logger = logging.getLogger(__name__)

# Header aliases (normalized) -> field name, for the catalog Excel import.
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

FUZZY_CUTOFF = 0.88


class VetGoodsProduct(models.Model):
    """Product catalog (imported from the distributor price list) used to centralize invoice lines."""

    _name = "vet.goods.product"
    _description = "Goods Catalog Product"
    _order = "producer, name"

    name = fields.Char(required=True)
    name_key = fields.Char(compute="_compute_name_key", store=True, index=True)
    internal_code = fields.Char(string="Internal Code", index=True)
    ean = fields.Char(string="EAN", index=True)
    producer = fields.Char(string="Producer / Category", index=True)
    price = fields.Float(string="List Price (excl. VAT)")
    vat_rate = fields.Float(string="VAT %")
    hs_code = fields.Char(string="HS Code")
    active = fields.Boolean(default=True)
    company_id = fields.Many2one(
        "res.company", default=lambda self: self.env.company, required=True, index=True
    )

    @api.depends("name")
    def _compute_name_key(self):
        for rec in self:
            rec.name_key = invoice_extract.normalize_key(rec.name)

    # --- Matching ---

    @api.model
    def _match(self, name, code=None, company=None):
        company = company or self.env.company
        base = [("company_id", "=", company.id)]
        if code:
            rec = self.search(base + ["|", ("internal_code", "=ilike", code), ("ean", "=", code)], limit=1)
            if rec:
                return rec
        key = invoice_extract.normalize_key(name)
        if not key:
            return self.browse()
        rec = self.search(base + [("name_key", "=", key)], limit=1)
        if rec:
            return rec
        # Fuzzy: compare against products sharing the first word (brand) to keep it cheap.
        first = key.split(" ", 1)[0]
        candidates = self.search_read(base + [("name_key", "=like", first + "%")], ["name_key"])
        if not candidates:
            return self.browse()
        keys = {c["name_key"]: c["id"] for c in candidates}
        best = difflib.get_close_matches(key, list(keys), n=1, cutoff=FUZZY_CUTOFF)
        return self.browse(keys[best[0]]) if best else self.browse()

    # --- Import ---

    @api.model
    def import_xlsx(self, file_bytes):
        """Create/update catalog products from an Excel price list. Returns counters."""
        try:
            import openpyxl
        except ImportError as e:  # pragma: no cover - openpyxl ships with Odoo
            raise ValidationError(_("openpyxl is required to import Excel files.")) from e
        try:
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        except Exception as e:  # noqa: BLE001
            raise ValidationError(_("The file is not a valid Excel (.xlsx) file.")) from e
        ws = wb.worksheets[0]
        rows = ws.iter_rows(values_only=True)

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
            raise ValidationError(_("Header row with a 'Denumire' column was not found."))

        company = self.env.company
        existing_by_code = {
            p.internal_code: p for p in self.with_context(active_test=False).search(
                [("company_id", "=", company.id), ("internal_code", "!=", False)]
            )
        }
        created = updated = skipped = 0
        to_create = []
        for row in rows:
            vals = {}
            for idx, field in mapping.items():
                value = row[idx] if idx < len(row) else None
                if value is None or value == "":
                    continue
                if field in ("price",):
                    value = invoice_extract.parse_number(str(value)) if not isinstance(value, (int, float)) else float(value)
                elif field == "vat_rate":
                    if isinstance(value, (int, float)):
                        value = float(value) * 100 if float(value) < 1 else float(value)
                    else:
                        value = invoice_extract.parse_number(str(value).split("%")[0].strip())
                else:
                    value = str(value).strip()
                    if field == "ean" and value.endswith(".0"):
                        value = value[:-2]
                if value is not None:
                    vals[field] = value
            if not vals.get("name"):
                skipped += 1
                continue
            vals["active"] = True
            code = vals.get("internal_code")
            if code and code in existing_by_code:
                existing_by_code[code].write(vals)
                updated += 1
            else:
                vals["company_id"] = company.id
                to_create.append(vals)
                created += 1
        if to_create:
            self.create(to_create)
        return {"created": created, "updated": updated, "skipped": skipped}
