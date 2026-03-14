from odoo import fields, models


class VetVaccination(models.Model):
    _name = "vet.vaccination"
    _description = "Veterinary Vaccination"

    name = fields.Char(string="Vaccination Reference")
    pet_id = fields.Many2one(
        comodel_name="vet.pet",
        string="Patient",
        ondelete="restrict",
    )
    vaccine_type = fields.Char(string="Vaccine Type")
    date_administered = fields.Date(string="Administration Date")
    date_next = fields.Date(string="Next Due Date")
    # Reminder logic and scheduled actions will be added in a later stage.

