from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class VetDeliveryRun(models.Model):
    """A delivery run (usually one per day): the invoices whose goods are loaded together."""

    _name = "vet.delivery.run"
    _description = "Delivery Run"
    _order = "date desc, id desc"

    name = fields.Char(required=True, default=lambda self: _("Run %s", fields.Date.context_today(self)))
    date = fields.Date(required=True, default=fields.Date.context_today, index=True)
    driver = fields.Char()
    vehicle = fields.Char()
    notes = fields.Text()
    state = fields.Selection(
        [
            ("planned", "Planned"),
            ("loaded", "Loaded"),
            ("in_progress", "On the road"),
            ("done", "Done"),
        ],
        default="planned",
        required=True,
        index=True,
    )
    company_id = fields.Many2one(
        "res.company", default=lambda self: self.env.company, required=True, index=True
    )
    invoice_ids = fields.One2many("vet.supplier.invoice", "run_id", string="Invoices")
    invoice_count = fields.Integer(compute="_compute_stats")
    pending_count = fields.Integer(compute="_compute_stats")
    delivered_count = fields.Integer(compute="_compute_stats")
    partial_count = fields.Integer(compute="_compute_stats")
    not_delivered_count = fields.Integer(compute="_compute_stats")
    amount_total = fields.Float(compute="_compute_stats")

    @api.depends("invoice_ids.delivery_state", "invoice_ids.amount_untaxed")
    def _compute_stats(self):
        for run in self:
            invs = run.invoice_ids
            run.invoice_count = len(invs)
            run.pending_count = len(invs.filtered(lambda i: i.delivery_state == "pending"))
            run.delivered_count = len(invs.filtered(lambda i: i.delivery_state == "delivered"))
            run.partial_count = len(invs.filtered(lambda i: i.delivery_state == "partial"))
            run.not_delivered_count = len(invs.filtered(lambda i: i.delivery_state == "not_delivered"))
            run.amount_total = sum(invs.mapped("amount_untaxed"))

    def unlink(self):
        if any(run.invoice_ids.filtered(lambda i: i.delivery_state != "pending") for run in self):
            raise ValidationError(_("A run with recorded deliveries cannot be deleted."))
        return super().unlink()
