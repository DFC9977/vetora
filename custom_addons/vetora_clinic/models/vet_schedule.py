from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


WEEKDAY_SELECTION = [
    ("0", "Monday"),
    ("1", "Tuesday"),
    ("2", "Wednesday"),
    ("3", "Thursday"),
    ("4", "Friday"),
    ("5", "Saturday"),
    ("6", "Sunday"),
]


class VetClinicSchedule(models.Model):
    _name = "vet.schedule"
    _description = "Clinic Schedule"
    _order = "weekday, start_time"

    name = fields.Char(string="Description")
    weekday = fields.Selection(WEEKDAY_SELECTION, string="Weekday", required=True)
    start_time = fields.Float(
        string="Start Time",
        help="Hour expressed in local time (e.g. 8.5 for 08:30).",
        required=True,
    )
    end_time = fields.Float(
        string="End Time",
        help="Hour expressed in local time (e.g. 17.0 for 17:00).",
        required=True,
    )
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
        help="Clinic location where this schedule applies.",
    )

    @api.constrains("start_time", "end_time")
    def _check_time_range(self):
        for rec in self:
            if rec.start_time >= rec.end_time:
                raise ValidationError(_("Start time must be before end time."))
            for time_value in (rec.start_time, rec.end_time):
                minutes = int(round(time_value * 60))
                if minutes < 0 or minutes >= 24 * 60:
                    raise ValidationError(_("Time must be within a single day."))
                if minutes % 15 != 0:
                    raise ValidationError(
                        _("Schedule times must be multiples of 15 minutes.")
                    )


class VetDoctorSchedule(models.Model):
    _name = "vet.doctor.schedule"
    _description = "Doctor Schedule"
    _order = "doctor_id, weekday, start_time"

    doctor_id = fields.Many2one("vet.doctor", string="Doctor", required=True)
    weekday = fields.Selection(WEEKDAY_SELECTION, string="Weekday", required=True)
    start_time = fields.Float(string="Start Time", required=True)
    end_time = fields.Float(string="End Time", required=True)
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
        help="Location where this doctor schedule applies.",
    )

    @api.constrains("start_time", "end_time")
    def _check_time_range(self):
        for rec in self:
            if rec.start_time >= rec.end_time:
                raise ValidationError(_("Start time must be before end time."))
            for time_value in (rec.start_time, rec.end_time):
                minutes = int(round(time_value * 60))
                if minutes < 0 or minutes >= 24 * 60:
                    raise ValidationError(_("Time must be within a single day."))
                if minutes % 15 != 0:
                    raise ValidationError(
                        _("Schedule times must be multiples of 15 minutes.")
                    )

