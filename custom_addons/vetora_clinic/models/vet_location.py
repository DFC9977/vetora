from odoo import fields, models


class VetLocation(models.Model):
    _name = "vet.location"
    _description = "Veterinary Location"
    _order = "name"

    name = fields.Char(string="Name", required=True)
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        default=lambda self: self.env.company,
        required=True,
        index=True,
    )
    tz = fields.Char(
        string="Timezone",
        help="Timezone used for schedule validation. "
        "If empty, the company timezone is used.",
    )
    active = fields.Boolean(default=True)

