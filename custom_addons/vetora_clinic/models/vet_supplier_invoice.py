import base64

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

from ..tools import invoice_extract


class VetSupplierInvoice(models.Model):
    """Supplier invoice uploaded as PDF/scan, used to build a central goods registry.

    Flow: upload -> automatic extraction (text/OCR) -> user review of lines -> confirm.
    Only confirmed invoices are counted in the goods registry.
    """

    _name = "vet.supplier.invoice"
    _description = "Supplier Invoice (Goods Intake)"
    _order = "invoice_date desc, id desc"

    name = fields.Char(string="Invoice Number")
    supplier_name = fields.Char(string="Supplier")
    supplier_vat = fields.Char(string="Supplier VAT / CUI")
    customer_name = fields.Char(string="Customer")
    customer_vat = fields.Char(string="Customer VAT / CUI")
    customer_phone = fields.Char(string="Customer Phone")
    delivery_address = fields.Char(string="Delivery Address")

    # --- Delivery tracking ---
    run_id = fields.Many2one("vet.delivery.run", string="Delivery Run", index=True, ondelete="set null")
    delivery_state = fields.Selection(
        [
            ("pending", "To deliver"),
            ("delivered", "Delivered"),
            ("partial", "Partially delivered"),
            ("not_delivered", "Not delivered"),
        ],
        default="pending",
        required=True,
        index=True,
    )
    delivered_at = fields.Datetime(string="Delivered At")
    delivery_note = fields.Text(string="Delivery Note")
    invoice_date = fields.Date(string="Invoice Date")
    location_id = fields.Many2one("vet.location", string="Location")
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        default=lambda self: self.env.company,
        required=True,
        index=True,
    )
    state = fields.Selection(
        [("draft", "Draft"), ("confirmed", "Confirmed")],
        default="draft",
        required=True,
        index=True,
    )
    file_data = fields.Binary(string="Invoice File", attachment=True)
    file_name = fields.Char(string="File Name")
    extraction_method = fields.Selection(
        [("text", "PDF text"), ("ocr", "OCR"), ("manual", "Manual"), ("none", "Not extracted")],
        default="manual",
        string="Extraction",
    )
    raw_text = fields.Text(string="Extracted Text")
    notes = fields.Text(string="Notes")
    line_ids = fields.One2many("vet.supplier.invoice.line", "invoice_id", string="Lines", copy=True)
    amount_untaxed = fields.Float(string="Total (excl. VAT)", compute="_compute_amounts", store=True)
    line_count = fields.Integer(compute="_compute_amounts", store=True)

    @api.depends("line_ids.amount")
    def _compute_amounts(self):
        for rec in self:
            rec.amount_untaxed = sum(rec.line_ids.mapped("amount"))
            rec.line_count = len(rec.line_ids)

    # --- Extraction ---

    def _extraction_vals(self, file_bytes, file_name):
        text, method = invoice_extract.extract_text(file_bytes, file_name)
        parsed = invoice_extract.parse_invoice_text(text)
        vals = {
            "raw_text": text or False,
            "extraction_method": method,
            "line_ids": [(5, 0, 0)]
            + [
                (0, 0, {
                    "sequence": (i + 1) * 10,
                    "product_code": ln.get("product_code") or False,
                    "product_name": ln["product_name"],
                    "uom": ln.get("uom") or False,
                    "quantity": ln["quantity"],
                    "price_unit": ln["price_unit"],
                    "vat_rate": ln.get("vat_rate") or 0.0,
                    "discount_amount": ln.get("discount_amount") or 0.0,
                    "lot_number": ln.get("lot_number") or False,
                    "expiry_date": ln.get("expiry_date") or False,
                })
                for i, ln in enumerate(parsed["lines"])
            ],
        }
        for field, key in (
            ("name", "invoice_number"),
            ("invoice_date", "invoice_date"),
            ("supplier_name", "supplier_name"),
            ("supplier_vat", "supplier_vat"),
            ("customer_name", "customer_name"),
            ("customer_vat", "customer_vat"),
            ("customer_phone", "customer_phone"),
            ("delivery_address", "delivery_address"),
        ):
            if parsed.get(key):
                vals[field] = parsed[key]
        return vals

    @api.model
    def create_from_file(self, file_bytes, file_name, location_id=False, run_id=False):
        vals = {
            "file_data": base64.b64encode(file_bytes),
            "file_name": file_name,
            "location_id": location_id or False,
            "run_id": run_id or False,
        }
        vals.update(self._extraction_vals(file_bytes, file_name))
        invoice = self.create(vals)
        invoice.line_ids.action_match_catalog()
        return invoice

    def action_reextract(self):
        for rec in self:
            rec._check_draft()
            if not rec.file_data:
                raise ValidationError(_("No file attached to re-extract from."))
            rec.write(rec._extraction_vals(base64.b64decode(rec.file_data), rec.file_name))
            rec.line_ids.action_match_catalog()

    # --- Workflow ---

    def _check_draft(self):
        for rec in self:
            if rec.state != "draft":
                raise ValidationError(_("Only draft invoices can be modified."))

    def action_confirm(self):
        for rec in self:
            rec._check_draft()
            missing = []
            if not rec.name:
                missing.append("name")
            if not rec.supplier_name:
                missing.append("supplier_name")
            if not rec.invoice_date:
                missing.append("invoice_date")
            if missing:
                raise ValidationError(_("Invoice is missing required fields: %s", ", ".join(missing)))
            if not rec.line_ids:
                raise ValidationError(_("Invoice must have at least one line to be confirmed."))
            dup = self.search([
                ("id", "!=", rec.id),
                ("state", "=", "confirmed"),
                ("company_id", "=", rec.company_id.id),
                ("name", "=ilike", rec.name),
                ("supplier_name", "=ilike", rec.supplier_name),
            ], limit=1)
            if dup:
                raise ValidationError(_("Duplicate invoice: this supplier invoice number is already confirmed."))
        self.write({"state": "confirmed"})

    def _find_duplicates(self):
        """Other invoices with the same number and issuer (any state)."""
        self.ensure_one()
        if not self.name:
            return self.browse()
        domain = [
            ("id", "!=", self.id),
            ("company_id", "=", self.company_id.id),
            ("name", "=ilike", self.name),
        ]
        if self.supplier_name:
            domain.append(("supplier_name", "=ilike", self.supplier_name))
        return self.search(domain)

    def action_set_delivery(self, state, note=None, lines=None):
        """Record the delivery result.

        state: pending | delivered | not_delivered | partial
        lines (for partial): list of {id, return_qty, return_reason, delivery_note}
        For 'partial' the final state is derived from the line quantities.
        """
        valid = dict(self._fields["delivery_state"].selection)
        if state not in valid:
            raise ValidationError(_("Invalid delivery state."))
        for inv in self:
            if state in ("pending", "delivered"):
                inv.line_ids.write({"return_qty": 0.0, "return_reason": False})
            elif state == "not_delivered":
                for line in inv.line_ids:
                    line.write({"return_qty": line.quantity, "return_reason": line.return_reason or "refused"})
            if lines:
                by_id = {ln.id: ln for ln in inv.line_ids}
                for vals in lines:
                    line = by_id.get(int(vals.get("id") or 0))
                    if not line:
                        continue
                    upd = {}
                    if "return_qty" in vals and state == "partial":
                        upd["return_qty"] = float(vals.get("return_qty") or 0.0)
                    if "return_reason" in vals:
                        upd["return_reason"] = vals.get("return_reason") or False
                    if "delivery_note" in vals:
                        upd["delivery_note"] = (vals.get("delivery_note") or "").strip() or False
                    if upd:
                        line.write(upd)
            final = state
            if state == "partial":
                returned = sum(inv.line_ids.mapped("return_qty"))
                total = sum(inv.line_ids.mapped("quantity"))
                final = "delivered" if returned <= 0 else ("not_delivered" if returned >= total else "partial")
            vals = {"delivery_state": final, "delivered_at": False if final == "pending" else fields.Datetime.now()}
            if note is not None:
                vals["delivery_note"] = (note or "").strip() or False
            inv.write(vals)

    def action_reset_draft(self):
        self.write({"state": "draft"})

    def unlink(self):
        if any(rec.state == "confirmed" for rec in self):
            raise ValidationError(_("Confirmed invoices cannot be deleted. Reset to draft first."))
        return super().unlink()


class VetSupplierInvoiceLine(models.Model):
    _name = "vet.supplier.invoice.line"
    _description = "Supplier Invoice Line"
    _order = "invoice_id, sequence, id"

    invoice_id = fields.Many2one("vet.supplier.invoice", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer(default=10)
    product_code = fields.Char(string="Code")
    product_name = fields.Char(string="Product", required=True)
    product_key = fields.Char(
        string="Registry Key",
        compute="_compute_product_key",
        store=True,
        index=True,
        help="Normalized code or name used to aggregate the same product across invoices.",
    )
    uom = fields.Char(string="UoM")
    quantity = fields.Float(string="Quantity", default=1.0)
    price_unit = fields.Float(string="Unit Price")
    vat_rate = fields.Float(string="VAT %")
    discount_amount = fields.Float(string="Discount", help="Discount value (excl. VAT) applied to this line.")
    amount = fields.Float(string="Net Value (excl. VAT)", compute="_compute_amount", store=True)
    lot_number = fields.Char(string="Lot")
    expiry_date = fields.Date(string="Expiry")
    return_qty = fields.Float(string="Returned / Not Delivered Qty", default=0.0)
    return_reason = fields.Selection(
        [
            ("refused", "Refused by customer"),
            ("damaged", "Damaged"),
            ("missing", "Missing at loading"),
            ("wrong", "Wrong product"),
            ("other", "Other"),
        ],
        string="Return Reason",
    )
    delivered_qty = fields.Float(string="Delivered Qty", compute="_compute_delivered_qty", store=True)
    delivery_note = fields.Char(string="Delivery Note")
    catalog_id = fields.Many2one("vet.goods.product", string="Catalog Product", index=True, ondelete="set null")
    producer = fields.Char(related="catalog_id.producer", store=True, index=True)

    # Related fields used by the registry (stored so read_group can use them).
    state = fields.Selection(related="invoice_id.state", store=True, index=True)
    invoice_date = fields.Date(related="invoice_id.invoice_date", store=True, index=True)
    supplier_name = fields.Char(related="invoice_id.supplier_name", store=True)
    customer_name = fields.Char(related="invoice_id.customer_name", store=True)
    location_id = fields.Many2one(related="invoice_id.location_id", store=True, index=True)
    company_id = fields.Many2one(related="invoice_id.company_id", store=True, index=True)

    @api.depends("product_code", "product_name")
    def _compute_product_key(self):
        for line in self:
            key = invoice_extract.normalize_key(line.product_code) if line.product_code else ""
            line.product_key = ("code:" + key) if key else ("name:" + invoice_extract.normalize_key(line.product_name))

    @api.depends("quantity", "price_unit", "discount_amount")
    def _compute_amount(self):
        for line in self:
            line.amount = round((line.quantity or 0.0) * (line.price_unit or 0.0) - (line.discount_amount or 0.0), 2)

    @api.depends("quantity", "return_qty")
    def _compute_delivered_qty(self):
        for line in self:
            line.delivered_qty = (line.quantity or 0.0) - (line.return_qty or 0.0)

    @api.constrains("quantity", "return_qty")
    def _check_return_qty(self):
        for line in self:
            if line.return_qty < 0 or line.return_qty > max(line.quantity, 0.0) + 1e-6:
                raise ValidationError(_("Returned quantity must be between 0 and the invoiced quantity."))

    def action_match_catalog(self):
        """Link lines to the imported product catalog (code/EAN, exact name, then fuzzy name)."""
        Catalog = self.env["vet.goods.product"]
        for line in self:
            company = line.invoice_id.company_id
            line.catalog_id = Catalog._match(line.product_name, line.product_code, company)
