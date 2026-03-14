from odoo import api, fields, models


class VetDoctor(models.Model):
    _name = "vet.doctor"
    _description = "Veterinary Doctor"
    _order = "name"

    name = fields.Char(string="Name", required=True)
    short_name = fields.Char(string="Short Name")
    user_id = fields.Many2one(
        "res.users",
        string="User",
        help="Optional user account associated with this doctor.",
    )
    specialization = fields.Char(string="Specialization")
    calendar_color = fields.Integer(string="Calendar Color Index")
    active = fields.Boolean(default=True)
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        default=lambda self: self.env.company,
        index=True,
    )
    location_id = fields.Many2one(
        "vet.location",
        string="Location",
        help="Default location where this doctor works.",
    )
    service_ids = fields.Many2many(
        "vet.service",
        relation="vet_service_doctor_rel",
        column1="doctor_id",
        column2="service_id",
        string="Allowed Services",
    )

    _sql_constraints = [
        (
            "short_name_unique_per_company",
            "UNIQUE(short_name, company_id)",
            "Short name must be unique per company.",
        )
    ]

