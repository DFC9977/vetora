from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class VetService(models.Model):
    _name = "vet.service"
    _description = "Veterinary Service"
    _order = "sequence, name"

    name = fields.Char(string="Name", required=True, translate=True)
    sequence = fields.Integer(string="Sequence", default=10)
    category = fields.Char(string="Category", translate=True)
    description_short = fields.Char(string="Short Description", translate=True)
    duration_minutes = fields.Integer(string="Duration (minutes)", required=True, default=30)
    default_price = fields.Monetary(string="Default Price", currency_field="currency_id")
    color = fields.Integer(string="Color Index")
    active = fields.Boolean(default=True)
    requires_doctor = fields.Boolean(string="Requires Doctor", default=True)
    eligible_doctor_ids = fields.Many2many(
        comodel_name="vet.doctor",
        relation="vet_service_doctor_rel",
        column1="service_id",
        column2="doctor_id",
        string="Eligible Doctors",
    )
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        default=lambda self: self.env.company,
        index=True,
    )
    currency_id = fields.Many2one(
        "res.currency",
        string="Currency",
        related="company_id.currency_id",
        readonly=True,
        store=True,
    )
    product_id = fields.Many2one(
        "product.product",
        string="Linked Product",
        help="Optional product used for invoicing this service.",
    )

    _sql_constraints = [
        (
            "duration_positive",
            "CHECK(duration_minutes > 0)",
            "Service duration must be strictly positive.",
        ),
    ]

    @api.constrains("duration_minutes")
    def _check_duration_minutes_multiple(self):
        for service in self:
            if service.duration_minutes % 15 != 0:
                raise ValidationError(
                    _("Service duration must be a multiple of 15 minutes.")
                )

