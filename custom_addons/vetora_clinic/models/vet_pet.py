from odoo import api, fields, models


class VetPet(models.Model):
    _name = "vet.pet"
    _description = "Veterinary Patient"

    name = fields.Char(string="Animal Name", required=True)
    owner_id = fields.Many2one(
        comodel_name="res.partner",
        string="Owner",
        required=True,
        help="Owner of the animal, using the standard Contacts model.",
    )
    species = fields.Selection(
        selection=[
            ("dog", "Dog"),
            ("cat", "Cat"),
            ("other", "Other"),
        ],
        string="Species",
        required=True,
        default="dog",
    )
    breed = fields.Char(string="Breed")
    gender = fields.Selection(
        selection=[
            ("male", "Male"),
            ("female", "Female"),
            ("unknown", "Unknown"),
        ],
        string="Sex",
        default="unknown",
    )
    birth_date = fields.Date(string="Date of Birth")
    microchip = fields.Char(string="Microchip")
    active = fields.Boolean(string="Active", default=True)
    is_sterilized = fields.Boolean(string="Sterilized")
    alerts_short = fields.Char(string="Alerts / Notes")
    visit_ids = fields.One2many(
        comodel_name="vet.visit",
        inverse_name="pet_id",
        string="Visits",
        readonly=True,
    )

