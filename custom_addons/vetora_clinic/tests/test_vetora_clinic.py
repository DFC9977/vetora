from odoo.tests.common import TransactionCase
from odoo.exceptions import ValidationError
from odoo import fields


class TestVetoraClinic(TransactionCase):
    def setUp(self):
        super().setUp()
        self.company = self.env.company
        self.location = self.env["vet.location"].create(
            {
                "name": "Main Clinic",
                "company_id": self.company.id,
            }
        )
        self.doctor = self.env["vet.doctor"].create(
            {
                "name": "Dr. Test",
                "short_name": "DT",
                "company_id": self.company.id,
                "location_id": self.location.id,
            }
        )
        self.service = self.env["vet.service"].create(
            {
                "name": "Consultation",
                "duration_minutes": 30,
                "default_price": 100.0,
                "requires_doctor": True,
                "eligible_doctor_ids": [(4, self.doctor.id)],
                "company_id": self.company.id,
            }
        )
        # Wide schedules to avoid schedule-related failures in model tests
        for weekday in [str(i) for i in range(7)]:
            self.env["vet.schedule"].create(
                {
                    "weekday": weekday,
                    "start_time": 0.0,
                    "end_time": 23.75,  # 23:45, multiple of 15 minutes
                    "company_id": self.company.id,
                    "location_id": self.location.id,
                }
            )
            self.env["vet.doctor.schedule"].create(
                {
                    "doctor_id": self.doctor.id,
                    "weekday": weekday,
                    "start_time": 0.0,
                    "end_time": 23.75,
                    "company_id": self.company.id,
                    "location_id": self.location.id,
                }
            )
        self.owner = self.env["res.partner"].create({"name": "Owner"})
        self.pet = self.env["vet.pet"].create(
            {
                "name": "Rex",
                "owner_id": self.owner.id,
                "species": "dog",
            }
        )

    def _base_visit_vals(self, overrides=None):
        vals = {
            "pet_id": self.pet.id,
            "doctor_id": self.doctor.id,
            "service_id": self.service.id,
            "company_id": self.company.id,
            "location_id": self.location.id,
            "start_at": "2026-03-09 09:00:00",  # Monday
            "duration_minutes": 30,
            "source": "reception",
        }
        if overrides:
            vals.update(overrides)
        return vals

    def test_service_invalid_duration(self):
        with self.assertRaises(ValidationError):
            self.env["vet.service"].create(
                {
                    "name": "Bad",
                    "duration_minutes": 20,
                    "company_id": self.company.id,
                }
            )

    def test_visit_invalid_duration(self):
        with self.assertRaises(ValidationError):
            self.env["vet.visit"].create(
                [self._base_visit_vals({"duration_minutes": 10})]
            )

    def test_doctor_ineligible_for_service(self):
        other_doctor = self.env["vet.doctor"].create(
            {
                "name": "Dr. Other",
                "short_name": "DO",
                "company_id": self.company.id,
                "location_id": self.location.id,
            }
        )
        with self.assertRaises(ValidationError):
            self.env["vet.visit"].create(
                [self._base_visit_vals({"doctor_id": other_doctor.id})]
            )

    def test_overlap_same_doctor(self):
        Visit = self.env["vet.visit"]
        Visit.create([self._base_visit_vals()])
        with self.assertRaises(ValidationError):
            Visit.create(
                [self._base_visit_vals({"start_at": "2026-03-09 09:15:00"})]
            )

    def test_block_conflict(self):
        # Create a block overlapping the desired visit interval
        self.env["vet.block"].create(
            {
                "block_type": "manual",
                "start_at": "2026-03-09 09:00:00",
                "end_at": "2026-03-09 10:00:00",
                "doctor_id": self.doctor.id,
                "location_id": self.location.id,
                "company_id": self.company.id,
            }
        )
        with self.assertRaises(ValidationError):
            self.env["vet.visit"].create([self._base_visit_vals()])

    def test_status_transitions_happy_path(self):
        visit = self.env["vet.visit"].create([self._base_visit_vals()])[0]
        visit.action_confirm()
        visit.action_check_in()
        visit.action_in_consult()
        visit.action_done()
        self.assertEqual(visit.status, "done")
        self.assertIsNotNone(visit.checked_in_at)
        self.assertIsNotNone(visit.in_consult_at)
        self.assertIsNotNone(visit.done_at)

    def test_status_invalid_transition(self):
        visit = self.env["vet.visit"].create([self._base_visit_vals()])[0]
        visit.action_confirm()
        visit.action_check_in()
        visit.action_done()
        with self.assertRaises(ValidationError):
            visit.action_confirm()

    def test_reschedule_creates_new_visit_and_links(self):
        Visit = self.env["vet.visit"]
        visit = Visit.create([self._base_visit_vals()])[0]
        visit.action_confirm()
        new_visit = visit.action_reschedule(
            new_start_at="2026-03-09 11:00:00",
            new_notes="Rescheduled",
        )
        self.assertEqual(visit.status, "rescheduled")
        self.assertEqual(visit.rescheduled_to_visit_id.id, new_visit.id)
        self.assertEqual(new_visit.rescheduled_from_visit_id.id, visit.id)
        self.assertEqual(new_visit.status, "scheduled")
        self.assertEqual(
            new_visit.start_at,
            fields.Datetime.from_string("2026-03-09 11:00:00"),
        )
        self.assertNotEqual(new_visit.id, visit.id)

