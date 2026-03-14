from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class VetBlock(models.Model):
    _name = "vet.block"
    _description = "Veterinary Blocking Interval"
    _order = "start_at"

    BLOCK_TYPES = [
        ("leave", "Leave"),
        ("break", "Break"),
        ("training", "Training"),
        ("unavailable", "Unavailable"),
        ("manual", "Manual Block"),
        ("meeting", "Meeting"),
    ]

    name = fields.Char(string="Description")
    block_type = fields.Selection(BLOCK_TYPES, string="Block Type", required=True)
    start_at = fields.Datetime(string="Start", required=True)
    end_at = fields.Datetime(string="End", required=True)
    doctor_id = fields.Many2one("vet.doctor", string="Doctor")
    location_id = fields.Many2one("vet.location", string="Location")
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        default=lambda self: self.env.company,
        index=True,
    )
    reason = fields.Char(string="Reason")
    active = fields.Boolean(default=True)
    is_recurring = fields.Boolean(
        string="Recurring",
        help="Structure placeholder for future recurring logic. "
        "Recurrence rules are not implemented in the MVP.",
    )

    @api.constrains("start_at", "end_at")
    def _check_block_interval(self):
        for rec in self:
            if rec.end_at <= rec.start_at:
                raise ValidationError(_("End time must be after start time."))

