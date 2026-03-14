from datetime import timedelta

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class VetVisit(models.Model):
    _name = "vet.visit"
    _description = "Veterinary Visit"
    _order = "start_at desc, id desc"

    STATUS_SELECTION = [
        ("scheduled", "Scheduled"),
        ("confirmed", "Confirmed"),
        ("checked_in", "Checked In"),
        ("in_consult", "In Consult"),
        ("done", "Done"),
        ("cancelled", "Cancelled"),
        ("no_show", "No Show"),
        ("rescheduled", "Rescheduled"),
    ]

    SOURCE_SELECTION = [
        ("phone", "Phone"),
        ("reception", "Reception"),
        ("online", "Online"),
        ("walk_in", "Walk-in"),
        ("internal", "Internal"),
    ]

    name = fields.Char(
        string="Visit Reference",
        readonly=True,
        copy=False,
        default=lambda self: _("New"),
    )
    pet_id = fields.Many2one(
        "vet.pet",
        string="Patient",
        required=True,
        ondelete="restrict",
    )
    client_id = fields.Many2one(
        "res.partner",
        string="Client",
        related="pet_id.owner_id",
        store=True,
        readonly=True,
    )
    doctor_id = fields.Many2one("vet.doctor", string="Doctor", required=True)
    service_id = fields.Many2one("vet.service", string="Service", required=True)
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        default=lambda self: self.env.company,
        required=True,
        index=True,
    )
    location_id = fields.Many2one("vet.location", string="Location", required=True)

    start_at = fields.Datetime(string="Start", required=True)
    duration_minutes = fields.Integer(string="Duration (minutes)", required=True)
    end_at = fields.Datetime(string="End", required=True)

    status = fields.Selection(
        STATUS_SELECTION,
        string="Status",
        required=True,
        default="scheduled",
    )
    source = fields.Selection(
        SOURCE_SELECTION,
        string="Source",
        required=True,
        default="reception",
    )
    is_urgent = fields.Boolean(string="Urgent", default=False)
    active = fields.Boolean(default=True)

    notes = fields.Text(string="Notes")
    cancellation_reason = fields.Char(string="Cancellation Reason")

    rescheduled_from_visit_id = fields.Many2one(
        "vet.visit",
        string="Rescheduled From",
        readonly=True,
    )
    rescheduled_to_visit_id = fields.Many2one(
        "vet.visit",
        string="Rescheduled To",
        readonly=True,
    )

    checked_in_at = fields.Datetime(string="Checked In At", readonly=True)
    in_consult_at = fields.Datetime(string="In Consult At", readonly=True)
    done_at = fields.Datetime(string="Done At", readonly=True)
    cancelled_at = fields.Datetime(string="Cancelled At", readonly=True)
    no_show_at = fields.Datetime(string="No Show At", readonly=True)

    service_price_snapshot = fields.Monetary(
        string="Service Price Snapshot",
        currency_field="currency_id",
        help="Price of the service at the time of scheduling.",
    )
    currency_id = fields.Many2one(
        "res.currency",
        related="company_id.currency_id",
        store=True,
        readonly=True,
    )

    _sql_constraints = [
        (
            "duration_positive",
            "CHECK(duration_minutes > 0)",
            "Visit duration must be strictly positive.",
        ),
    ]

    @api.constrains("duration_minutes")
    def _check_duration_multiple(self):
        for visit in self:
            if visit.duration_minutes % 15 != 0:
                raise ValidationError(
                    _("Visit duration must be a multiple of 15 minutes.")
                )

    @api.constrains("pet_id")
    def _check_patient_owner(self):
        for visit in self:
            if visit.pet_id and not visit.pet_id.owner_id:
                raise ValidationError(
                    _("Patient must have an owner defined to create a visit.")
                )

    @api.constrains("start_at", "end_at")
    def _check_interval_order(self):
        for visit in self:
            if visit.start_at and visit.end_at and visit.end_at <= visit.start_at:
                raise ValidationError(_("End time must be after start time."))

    @api.model_create_multi
    def create(self, vals_list):  # type: ignore[override]
        for vals in vals_list:
            if vals.get("name", _("New")) == _("New"):
                vals["name"] = (
                    self.env["ir.sequence"].next_by_code("vet.visit") or _("New")
                )
            # compute end_at if missing
            if vals.get("start_at") and vals.get("duration_minutes"):
                start_dt = fields.Datetime.from_string(vals["start_at"])
                vals["end_at"] = start_dt + timedelta(
                    minutes=int(vals["duration_minutes"])
                )
            # snapshot price from service if not provided
            if not vals.get("service_price_snapshot") and vals.get("service_id"):
                service = self.env["vet.service"].browse(vals["service_id"])
                vals["service_price_snapshot"] = service.default_price
        records = super().create(vals_list)
        records._check_business_rules()
        return records

    def write(self, vals):  # type: ignore[override]
        # recompute end_at when needed
        if "start_at" in vals or "duration_minutes" in vals:
            for visit in self:
                start_dt = fields.Datetime.from_string(
                    vals.get("start_at", visit.start_at)
                )
                duration = int(vals.get("duration_minutes", visit.duration_minutes))
                vals["end_at"] = start_dt + timedelta(minutes=duration)
        # validate status transition before applying
        self._validate_status_transition(vals)
        res = super().write(vals)
        self._check_business_rules()
        return res

    # --- Business validation helpers ---

    def _check_business_rules(self):
        for visit in self:
            if not visit.pet_id or not visit.client_id:
                raise ValidationError(_("Visit must have a patient and client."))
            if visit.client_id != visit.pet_id.owner_id:
                raise ValidationError(
                    _("Client must match the owner of the patient.")
                )
            if not visit.doctor_id or not visit.service_id:
                raise ValidationError(_("Visit must have a doctor and a service."))
            if not visit.doctor_id.active:
                raise ValidationError(_("Doctor must be active."))
            if not visit.service_id.active:
                raise ValidationError(_("Service must be active."))
            if visit.service_id.requires_doctor and visit.doctor_id not in visit.service_id.eligible_doctor_ids:
                raise ValidationError(
                    _("Selected doctor is not eligible for this service.")
                )
            visit._check_schedule_constraints()
            visit._check_block_conflicts()
            visit._check_overlap_with_other_visits()

    def _get_local_times(self):
        """Return (start_local, end_local, weekday_str, tz) for schedule checks.

        The timezone source of truth is the location's timezone, then the company
        timezone (if defined), and finally UTC. User timezone is NOT used for
        validation.
        """
        self.ensure_one()
        tz = self.location_id.tz or getattr(self.company_id, "tz", None) or "UTC"
        ctx_self = self.with_context(tz=tz)
        start_local = fields.Datetime.context_timestamp(ctx_self, self.start_at)
        end_local = fields.Datetime.context_timestamp(ctx_self, self.end_at)
        weekday = str(start_local.weekday())
        return start_local, end_local, weekday, tz

    def _check_schedule_constraints(self):
        """Ensure visit fits within clinic and doctor schedule for the day."""
        self.ensure_one()
        start_local, end_local, weekday, _tz = self._get_local_times()
        start_minutes = start_local.hour * 60 + start_local.minute
        end_minutes = end_local.hour * 60 + end_local.minute

        def _has_covering_interval(model_name, extra_domain=None):
            domain = [
                ("weekday", "=", weekday),
                ("active", "=", True),
                ("company_id", "=", self.company_id.id),
            ]
            if self.location_id:
                domain.append(
                    ("location_id", "in", [False, self.location_id.id])
                )
            if extra_domain:
                domain += extra_domain
            records = self.env[model_name].search(domain)
            for rec in records:
                start = int(round(rec.start_time * 60))
                end = int(round(rec.end_time * 60))
                if start <= start_minutes and end_minutes <= end:
                    return True
            return False

        if not _has_covering_interval("vet.schedule"):
            raise ValidationError(_("Visit is outside clinic schedule."))

        if not _has_covering_interval(
            "vet.doctor.schedule", extra_domain=[("doctor_id", "=", self.doctor_id.id)]
        ):
            raise ValidationError(_("Visit is outside doctor schedule."))

    def _check_block_conflicts(self):
        """Ensure visit does not fall inside blocking intervals."""
        self.ensure_one()
        domain = [
            ("active", "=", True),
            ("company_id", "=", self.company_id.id),
            ("start_at", "<", self.end_at),
            ("end_at", ">", self.start_at),
        ]
        domain += [
            "|",
            ("doctor_id", "=", False),
            ("doctor_id", "=", self.doctor_id.id),
        ]
        if self.location_id:
            domain = domain + [
                "|",
                ("location_id", "=", False),
                ("location_id", "=", self.location_id.id),
            ]
        conflicts = self.env["vet.block"].search(domain, limit=1)
        if conflicts:
            raise ValidationError(_("Visit conflicts with a blocking interval."))

    def _check_overlap_with_other_visits(self):
        """Ensure no overlapping active visits for the same doctor."""
        self.ensure_one()
        active_statuses = {"scheduled", "confirmed", "checked_in", "in_consult"}
        domain = [
            ("id", "!=", self.id),
            ("doctor_id", "=", self.doctor_id.id),
            ("company_id", "=", self.company_id.id),
            ("status", "in", list(active_statuses)),
            ("start_at", "<", self.end_at),
            ("end_at", ">", self.start_at),
        ]
        if self.location_id:
            domain.append(("location_id", "=", self.location_id.id))
        conflict = self.search(domain, limit=1)
        if conflict:
            raise ValidationError(_("Doctor already has a visit in this interval."))

    # --- Status transitions ---

    def _validate_status_transition(self, vals):
        if "status" not in vals:
            return
        for visit in self:
            old = visit.status
            new = vals["status"]
            if not old:
                continue
            if old == new:
                continue
            if not self._is_allowed_transition(old, new):
                raise ValidationError(
                    _("Invalid status transition: %s → %s") % (old, new)
                )

    @staticmethod
    def _is_allowed_transition(old, new):
        allowed = {
            "scheduled": {"confirmed", "checked_in", "cancelled", "no_show", "rescheduled"},
            "confirmed": {"checked_in", "cancelled", "no_show", "rescheduled"},
            "checked_in": {"in_consult", "done", "cancelled"},
            "in_consult": {"done", "cancelled"},
            "done": set(),
            "cancelled": set(),
            "no_show": set(),
            "rescheduled": set(),
        }
        return new in allowed.get(old, set())

    # public actions

    def action_confirm(self):
        """Set status to confirmed from scheduled."""
        for visit in self:
            if visit.status != "scheduled":
                raise ValidationError(_("Only scheduled visits can be confirmed."))
            visit.write({"status": "confirmed"})
        return True

    def action_check_in(self):
        """Mark patient as arrived (checked_in)."""
        now = fields.Datetime.now()
        for visit in self:
            if visit.status not in {"scheduled", "confirmed"}:
                raise ValidationError(
                    _("Check-in is only allowed from scheduled or confirmed.")
                )
            values = {"status": "checked_in"}
            if not visit.checked_in_at:
                values["checked_in_at"] = now
            visit.write(values)
        return True

    def action_in_consult(self):
        """Move visit to in_consult."""
        now = fields.Datetime.now()
        for visit in self:
            if visit.status != "checked_in":
                raise ValidationError(
                    _("Visit must be checked in before moving to in consult.")
                )
            visit.write({"status": "in_consult", "in_consult_at": now})
        return True

    def action_done(self):
        """Mark visit as done."""
        now = fields.Datetime.now()
        for visit in self:
            if visit.status not in {"checked_in", "in_consult"}:
                raise ValidationError(
                    _("Visit can be marked done only from checked in or in consult.")
                )
            visit.write({"status": "done", "done_at": now})
        return True

    def action_cancel(self, reason=None):
        """Cancel visit from scheduled/confirmed/checked_in."""
        now = fields.Datetime.now()
        for visit in self:
            if visit.status not in {"scheduled", "confirmed", "checked_in"}:
                raise ValidationError(
                    _("Cancel is only allowed from scheduled, confirmed or checked in.")
                )
            vals = {"status": "cancelled", "cancelled_at": now}
            if reason:
                vals["cancellation_reason"] = reason
            visit.write(vals)
        return True

    def action_no_show(self):
        """Mark visit as no_show from scheduled/confirmed."""
        now = fields.Datetime.now()
        for visit in self:
            if visit.status not in {"scheduled", "confirmed"}:
                raise ValidationError(
                    _("No-show is only allowed from scheduled or confirmed.")
                )
            visit.write({"status": "no_show", "no_show_at": now})
        return True

    def action_reschedule(
        self,
        new_start_at,
        new_doctor_id=None,
        new_service_id=None,
        new_duration_minutes=None,
        new_location_id=None,
        new_notes=None,
    ):
        """Create a new visit and mark current one as rescheduled.

        - allowed only from scheduled / confirmed
        - new visit starts as scheduled
        - all normal business rules apply to the new visit
        """
        self.ensure_one()
        if self.status not in {"scheduled", "confirmed"}:
            raise ValidationError(
                _("Only scheduled or confirmed visits can be rescheduled.")
            )

        vals = {
            "pet_id": self.pet_id.id,
            "doctor_id": new_doctor_id or self.doctor_id.id,
            "service_id": new_service_id or self.service_id.id,
            "company_id": self.company_id.id,
            "location_id": new_location_id or self.location_id.id,
            "start_at": new_start_at,
            "duration_minutes": new_duration_minutes or self.duration_minutes,
            "status": "scheduled",
            "source": self.source,
            "is_urgent": self.is_urgent,
            "notes": new_notes or self.notes,
        }

        new_visit = self.create([vals])[0]
        self.write(
            {
                "status": "rescheduled",
                "rescheduled_to_visit_id": new_visit.id,
            }
        )
        new_visit.rescheduled_from_visit_id = self.id
        return new_visit

