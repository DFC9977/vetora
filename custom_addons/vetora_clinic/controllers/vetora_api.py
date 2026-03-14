import logging
from datetime import datetime, timedelta

import pytz
from odoo import http, fields
from odoo.http import request
from odoo.exceptions import ValidationError, AccessError

_logger = logging.getLogger(__name__)


def _start_at_local_to_utc(start_at_str, tz_name):
    """Interpret start_at string as naive datetime in the given timezone; return UTC string for Odoo.
    Frontend sends local time (browser); we treat it as location time so schedule validation matches.
    """
    if not start_at_str or not tz_name:
        return start_at_str
    try:
        tz = pytz.timezone(tz_name)
        dt_naive = datetime.strptime(start_at_str.strip()[:19], "%Y-%m-%d %H:%M:%S")
        local_aware = tz.localize(dt_naive)
        utc_aware = local_aware.astimezone(pytz.UTC)
        return utc_aware.strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, pytz.exceptions.UnknownTimeZoneError) as e:
        _logger.warning("start_at timezone conversion failed: %s", e)
        return start_at_str


def _json_ok(data):
    return {"ok": True, "data": data}


def _json_error(code, message, details=None, http_status=400):
    payload = {"ok": False, "error": {"code": code, "message": message, "details": details or {}}}
    return request.make_json_response(payload, status=http_status)


def _map_validation_error(err):
    """Map ValidationError messages to stable error codes.

    NOTE: this uses simple substring checks based on messages raised in models.
    If we later introduce structured error objects, this function is the single
    place to update.
    """
    msg = str(err)
    code = "VALIDATION_ERROR"

    mapping = [
        ("Visit duration must be a multiple of 15", "INVALID_DURATION"),
        ("Visit is outside clinic schedule", "OUTSIDE_CLINIC_SCHEDULE"),
        ("Visit is outside doctor schedule", "OUTSIDE_DOCTOR_SCHEDULE"),
        ("Visit conflicts with a blocking interval", "BLOCK_CONFLICT"),
        ("Doctor already has a visit in this interval", "OVERLAP_VISIT"),
        ("Selected doctor is not eligible for this service", "INVALID_SERVICE_DOCTOR"),
        ("Doctor must be active", "INACTIVE_DOCTOR"),
        ("Service must be active", "INACTIVE_SERVICE"),
        ("Patient must have an owner defined", "MISSING_PATIENT_OWNER"),
        ("Client must match the owner of the patient", "MISSING_PATIENT_OWNER"),
        ("Invalid status transition", "INVALID_STATUS_TRANSITION"),
        ("Visit must have a patient and client", "MISSING_PATIENT_OWNER"),
        ("Visit must be checked in before moving to in consult", "INVALID_STATUS_TRANSITION"),
        ("Only scheduled visits can be confirmed", "INVALID_STATUS_TRANSITION"),
        ("Check-in is only allowed", "INVALID_STATUS_TRANSITION"),
        ("Visit can be marked done only", "INVALID_STATUS_TRANSITION"),
        ("Cancel is only allowed", "INVALID_STATUS_TRANSITION"),
        ("No-show is only allowed", "INVALID_STATUS_TRANSITION"),
        ("Only scheduled or confirmed visits can be rescheduled", "INVALID_STATUS_TRANSITION"),
        ("Location", "INVALID_LOCATION"),
    ]
    for snippet, c in mapping:
        if snippet in msg:
            code = c
            break

    return code, msg


def _serialize_visit(visit):
    return {
        "id": visit.id,
        "name": visit.name,
        "pet_id": visit.pet_id.id,
        "pet_name": visit.pet_id.name,
        "client_id": visit.client_id.id if visit.client_id else None,
        "client_name": visit.client_id.name if visit.client_id else None,
        "client_phone": visit.client_id.phone if visit.client_id else None,
        "doctor_id": visit.doctor_id.id,
        "doctor_name": visit.doctor_id.name,
        "service_id": visit.service_id.id,
        "service_name": visit.service_id.name,
        "company_id": visit.company_id.id,
        "location_id": visit.location_id.id,
        "start_at": visit.start_at,
        "end_at": visit.end_at,
        "duration_minutes": visit.duration_minutes,
        "status": visit.status,
        "source": visit.source,
        "is_urgent": visit.is_urgent,
        "notes": visit.notes,
        "service_price_snapshot": visit.service_price_snapshot,
    }


def _serialize_block(block):
    return {
        "id": block.id,
        "block_type": block.block_type,
        "doctor_id": block.doctor_id.id if block.doctor_id else None,
        "location_id": block.location_id.id if block.location_id else None,
        "start_at": block.start_at,
        "end_at": block.end_at,
        "reason": block.reason,
        "doctor_name": block.doctor_id.name if block.doctor_id else None,
        "location_name": block.location_id.name if block.location_id else None,
        "is_recurring": block.is_recurring,
    }


def _serialize_doctor(doc):
    return {
        "id": doc.id,
        "name": doc.name,
        "short_name": doc.short_name,
        "specialization": doc.specialization,
        "calendar_color": doc.calendar_color,
        "location_id": doc.location_id.id if doc.location_id else None,
        "company_id": doc.company_id.id,
    }


def _serialize_service(service):
    return {
        "id": service.id,
        "name": service.name,
        "category": service.category,
        "duration_minutes": service.duration_minutes,
        "default_price": service.default_price,
        "requires_doctor": service.requires_doctor,
        "company_id": service.company_id.id,
    }


def _float_to_hm(value):
    """Convert float hour (e.g. 8.5) to 'HH:MM' string."""
    if value is None:
        return None
    minutes = int(round(value * 60))
    hours, mins = divmod(minutes, 60)
    return f"{int(hours):02d}:{int(mins):02d}"


def _hm_to_float(value):
    """Convert 'HH:MM' string to float hour."""
    if not value:
        return None
    try:
        parts = value.split(":")
        if len(parts) != 2:
            return None
        hours = int(parts[0])
        minutes = int(parts[1])
        return hours + minutes / 60.0
    except Exception:
        return None


WEEKDAY_LABELS = {
    "0": "Monday",
    "1": "Tuesday",
    "2": "Wednesday",
    "3": "Thursday",
    "4": "Friday",
    "5": "Saturday",
    "6": "Sunday",
}


def _json_payload():
    """Return the JSON body as a dict. For type='json' routes, Odoo may pass params
    via kwargs or via request.jsonrequest (raw body or JSON-RPC 'params').
    Fallback: read raw HTTP body so we never miss payload when client sends plain JSON."""
    import json as _json
    body = getattr(request, "jsonrequest", None)
    if not body or not isinstance(body, dict):
        try:
            http_req = getattr(request, "httprequest", None)
            if http_req is not None:
                raw = http_req.get_data(as_text=True)
                if raw and raw.strip():
                    body = _json.loads(raw)
        except Exception:
            body = None
    if not body or not isinstance(body, dict):
        return {}
    if "params" in body:
        p = body["params"]
        if isinstance(p, list) and p:
            return p[0] if isinstance(p[0], dict) else {}
        if isinstance(p, dict):
            return p
    return body


class VetoraApiController(http.Controller):
    """JSON API for Vetora clinic backend."""

    # --- Calendar helpers ---

    @http.route("/vetora/json/calendar/day", type="json", auth="user", methods=["POST"])
    def calendar_day(self, **kwargs):
        """Return calendar data for a single day."""
        payload = {**_json_payload(), **kwargs}
        try:
            env = request.env
            date_str = payload.get("date")
            if not date_str:
                return _json_error("MISSING_DATE", "Field 'date' is required.")

            day = fields.Date.from_string(date_str)
            company_id = payload.get("company_id") or env.company.id
            location_id = payload.get("location_id")
            raw_doctor_ids = payload.get("doctor_ids") or []
            doctor_ids = []
            for x in raw_doctor_ids:
                try:
                    if x is not None:
                        doctor_ids.append(int(x))
                except (TypeError, ValueError):
                    pass

            # Datetime range [day_start, day_end) for the calendar day (naive; Odoo compares with stored UTC)
            day_start = datetime.combine(day, datetime.min.time())
            day_end = day_start + timedelta(days=1)

            Doctor = env["vet.doctor"].sudo()
            domain_doctor = [("active", "=", True), ("company_id", "=", company_id)]
            if location_id:
                domain_doctor.append(("location_id", "in", [False, location_id]))
            if doctor_ids:
                domain_doctor.append(("id", "in", doctor_ids))
            doctors = Doctor.search(domain_doctor)

            doctor_ids = doctors.ids

            # schedules
            weekday = str(day.weekday())
            sched_domain = [
                ("weekday", "=", weekday),
                ("active", "=", True),
                ("company_id", "=", company_id),
            ]
            if location_id:
                sched_domain.append(("location_id", "in", [False, location_id]))
            clinic_schedules = env["vet.schedule"].sudo().search(sched_domain)

            doc_sched_domain = list(sched_domain) + [
                ("doctor_id", "in", doctor_ids or [0])
            ]
            doctor_schedules = env["vet.doctor.schedule"].sudo().search(doc_sched_domain)

            # blocks
            block_domain = [
                ("active", "=", True),
                ("company_id", "=", company_id),
                ("start_at", "<", day_end),
                ("end_at", ">", day_start),
            ]
            if location_id:
                block_domain += [
                    "|",
                    ("location_id", "=", False),
                    ("location_id", "=", location_id),
                ]
            blocks = env["vet.block"].sudo().search(block_domain)

            # visits
            visit_domain = [
                ("company_id", "=", company_id),
                ("start_at", "<", day_end),
                ("end_at", ">", day_start),
            ]
            if location_id:
                visit_domain.append(("location_id", "=", location_id))
            if doctor_ids:
                visit_domain.append(("doctor_id", "in", doctor_ids))
            visits = env["vet.visit"].sudo().search(visit_domain)

            data = {
                "date": date_str,
                "doctors": [_serialize_doctor(d) for d in doctors],
                "clinic_schedules": [
                    {
                        "id": s.id,
                        "weekday": s.weekday,
                        "start_time": s.start_time,
                        "end_time": s.end_time,
                        "location_id": s.location_id.id if s.location_id else None,
                    }
                    for s in clinic_schedules
                ],
                "doctor_schedules": [
                    {
                        "id": s.id,
                        "doctor_id": s.doctor_id.id,
                        "weekday": s.weekday,
                        "start_time": s.start_time,
                        "end_time": s.end_time,
                        "location_id": s.location_id.id if s.location_id else None,
                    }
                    for s in doctor_schedules
                ],
                "blocks": [_serialize_block(b) for b in blocks],
                "visits": [_serialize_visit(v) for v in visits],
            }
            return _json_ok(data)
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except AccessError as e:
            return _json_error("ACCESS_ERROR", str(e), http_status=403)
        except Exception as e:
            _logger.exception("Unexpected error in calendar_day")
            return _json_error("SERVER_ERROR", "Unexpected server error.", {"detail": str(e)}, http_status=500)

    # --- Settings: clinic schedule ---
    # Persistence fix: payload is read from request body via _json_payload() because with type='json'
    # Odoo may pass the body as first positional arg, so **kwargs can be empty and 'schedules' was missing.
    # Save response is always built from DB (same domain as GET) so client gets real ids and refresh sees the same data.

    @http.route("/vetora/json/settings/clinic_schedule/get", type="json", auth="user", methods=["POST"])
    def settings_clinic_schedule_get(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        company_id = env.company.id
        location_id = payload.get("location_id")
        Schedule = env["vet.schedule"].sudo()
        domain = [("company_id", "=", company_id)]
        if location_id is not None:
            domain.append(("location_id", "=", location_id))
        schedules = Schedule.search(domain, order="weekday, start_time")
        _logger.info(
            "vetora clinic_schedule GET: user=%s company_id=%s location_id=%s domain=%s found=%s ids=%s",
            request.env.user.login,
            company_id,
            location_id,
            domain,
            len(schedules),
            schedules.ids,
        )
        for s in schedules:
            _logger.debug(
                "vet.schedule id=%s weekday=%s start=%s end=%s company_id=%s location_id=%s active=%s",
                s.id, s.weekday, s.start_time, s.end_time, s.company_id.id, s.location_id.id or None, s.active,
            )
        data = {
            "schedules": [
                {
                    "id": s.id,
                    "weekday": int(s.weekday),
                    "weekday_label": WEEKDAY_LABELS.get(s.weekday, s.weekday),
                    "start_time": _float_to_hm(s.start_time),
                    "end_time": _float_to_hm(s.end_time),
                    "location_id": s.location_id.id if s.location_id else None,
                    "location_name": s.location_id.name if s.location_id else None,
                }
                for s in schedules
            ]
        }
        return _json_ok(data)

    @http.route("/vetora/json/settings/clinic_schedule/save", type="json", auth="user", methods=["POST"])
    def settings_clinic_schedule_save(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        company_id = env.company.id
        location_id = payload.get("location_id")
        schedules_payload = payload.get("schedules")
        _logger.info(
            "vetora clinic_schedule SAVE: user=%s company_id=%s location_id=%s payload_keys=%s schedules_len=%s",
            request.env.user.login,
            company_id,
            location_id,
            list(payload.keys()),
            len(schedules_payload) if schedules_payload is not None else 0,
        )
        if schedules_payload is None:
            return _json_error(
                "MISSING_FIELDS",
                "Field 'schedules' is required.",
                {"fields": ["schedules"]},
            )

        Schedule = env["vet.schedule"].sudo()

        try:
            keep_ids = set()
            for item in schedules_payload:
                weekday = item.get("weekday")
                start_str = item.get("start_time")
                end_str = item.get("end_time")
                if weekday is None or start_str is None or end_str is None:
                    return _json_error(
                        "MISSING_FIELDS",
                        "Each schedule requires 'weekday', 'start_time' and 'end_time'.",
                        {"fields": ["weekday", "start_time", "end_time"]},
                    )
                start_float = _hm_to_float(start_str)
                end_float = _hm_to_float(end_str)
                if start_float is None or end_float is None or start_float >= end_float:
                    return _json_error(
                        "INVALID_TIME_RANGE",
                        "Start time must be before end time and use HH:MM format.",
                    )

                schedule_id = item.get("id")
                vals = {
                    "weekday": str(weekday),
                    "start_time": start_float,
                    "end_time": end_float,
                    "company_id": company_id,
                    "location_id": location_id,
                    "active": True,
                }
                if schedule_id:
                    schedule = Schedule.browse(schedule_id)
                    if not schedule.exists():
                        return _json_error(
                            "NOT_FOUND",
                            "Schedule not found.",
                            {"id": schedule_id},
                            http_status=404,
                        )
                    schedule.write(vals)
                    keep_ids.add(schedule_id)
                    _logger.info("vetora clinic_schedule SAVE: updated id=%s vals=%s", schedule_id, vals)
                else:
                    rec = Schedule.create(vals)
                    keep_ids.add(rec.id)
                    _logger.info("vetora clinic_schedule SAVE: created id=%s vals=%s", rec.id, vals)

            # Remove schedules that are no longer in the payload (so duplicates can be deleted).
            domain_remove = [("company_id", "=", company_id)]
            if location_id is not None:
                domain_remove.append(("location_id", "=", location_id))
            all_schedules = Schedule.search(domain_remove)
            to_remove = all_schedules.filtered(lambda s: s.id not in keep_ids)
            if to_remove:
                removed_ids = to_remove.ids
                to_remove.unlink()
                _logger.info("vetora clinic_schedule SAVE: removed %s obsolete schedule(s) ids=%s", len(removed_ids), removed_ids)

            # Flush so search in GET sees the new/updated records in the same transaction.
            env.flush_all()
            # Response must be from DB only (same domain as GET on refresh) so client gets real ids and consistent state.
            result = self.settings_clinic_schedule_get(**{"location_id": location_id})
            _logger.info("vetora clinic_schedule SAVE: returning %s schedules from DB", len(result.get("data", {}).get("schedules", [])))
            return result
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except Exception as e:
            _logger.exception("Unexpected error in settings_clinic_schedule_save")
            return _json_error(
                "SERVER_ERROR",
                "Unexpected server error.",
                {"detail": str(e)},
                http_status=500,
            )

    # --- Settings: doctors ---

    @http.route("/vetora/json/settings/doctors/list", type="json", auth="user", methods=["POST"])
    def settings_doctors_list(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        company_id = env.company.id
        Doctor = env["vet.doctor"].sudo()
        DocSchedule = env["vet.doctor.schedule"].sudo()
        doctors = Doctor.search([("company_id", "=", company_id)])

        _logger.info(
            "vetora settings_doctors_list: user=%s company_id=%s count=%s ids=%s",
            request.env.user.login,
            company_id,
            len(doctors),
            doctors.ids,
        )

        data_doctors = []
        for d in doctors:
            schedules = DocSchedule.search(
                [("doctor_id", "=", d.id), ("active", "=", True)],
                order="weekday, start_time",
            )
            data_doctors.append(
                {
                    "id": d.id,
                    "name": d.name,
                    "short_name": d.short_name,
                    "specialization": d.specialization,
                    "color": d.calendar_color,
                    "active": d.active,
                    "services": [
                        {"id": s.id, "name": s.name} for s in d.service_ids
                    ],
                    "schedules": [
                        {
                            "id": s.id,
                            "weekday": int(s.weekday),
                            "weekday_label": WEEKDAY_LABELS.get(s.weekday, s.weekday),
                            "start_time": _float_to_hm(s.start_time),
                            "end_time": _float_to_hm(s.end_time),
                        }
                        for s in schedules
                    ],
                }
            )

        return _json_ok({"doctors": data_doctors})

    @http.route("/vetora/json/settings/doctors/save", type="json", auth="user", methods=["POST"])
    def settings_doctors_save(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        company_id = env.company.id
        doctor_payload = payload.get("doctor") or {}
        name = doctor_payload.get("name")
        if not name:
            return _json_error(
                "MISSING_FIELDS",
                "Field 'doctor.name' is required.",
                {"fields": ["doctor.name"]},
            )

        Doctor = env["vet.doctor"].sudo()
        DocSchedule = env["vet.doctor.schedule"].sudo()

        doctor_id = doctor_payload.get("id")
        vals = {
            "name": name,
            "short_name": doctor_payload.get("short_name"),
            "specialization": doctor_payload.get("specialization"),
            "calendar_color": doctor_payload.get("color"),
            "active": doctor_payload.get("active", True),
            "company_id": company_id,
        }

        try:
            _logger.info(
                "vetora settings_doctors_save: user=%s company_id=%s doctor_id=%s payload_keys=%s",
                request.env.user.login,
                company_id,
                doctor_id,
                list(doctor_payload.keys()),
            )
            if doctor_id:
                doctor = Doctor.browse(doctor_id)
                if not doctor.exists():
                    return _json_error(
                        "NOT_FOUND",
                        "Doctor not found.",
                        {"id": doctor_id},
                        http_status=404,
                    )
                doctor.write(vals)
                _logger.info("vetora settings_doctors_save: updated doctor_id=%s vals=%s", doctor_id, vals)
            else:
                doctor = Doctor.create(vals)
                _logger.info("vetora settings_doctors_save: created doctor_id=%s vals=%s", doctor.id, vals)

            # services
            service_ids = doctor_payload.get("service_ids")
            if service_ids is not None:
                doctor.service_ids = [(6, 0, service_ids)]

            # schedules
            schedules_payload = doctor_payload.get("schedules")
            if schedules_payload is not None:
                existing = DocSchedule.search([("doctor_id", "=", doctor.id)])
                existing.unlink()
                for item in schedules_payload:
                    weekday = item.get("weekday")
                    start_str = item.get("start_time")
                    end_str = item.get("end_time")
                    if weekday is None or start_str is None or end_str is None:
                        return _json_error(
                            "MISSING_FIELDS",
                            "Each doctor schedule requires 'weekday', 'start_time' and 'end_time'.",
                            {"fields": ["weekday", "start_time", "end_time"]},
                        )
                    start_float = _hm_to_float(start_str)
                    end_float = _hm_to_float(end_str)
                    if start_float is None or end_float is None or start_float >= end_float:
                        return _json_error(
                            "INVALID_TIME_RANGE",
                            "Start time must be before end time and use HH:MM format.",
                        )
                    rec = DocSchedule.create(
                        {
                            "doctor_id": doctor.id,
                            "weekday": str(weekday),
                            "start_time": start_float,
                            "end_time": end_float,
                            "company_id": company_id,
                        }
                    )
                    _logger.info(
                        "vetora settings_doctors_save: created doctor_schedule_id=%s for doctor_id=%s weekday=%s %s-%s",
                        rec.id,
                        doctor.id,
                        weekday,
                        start_str,
                        end_str,
                    )

            # return representation for this doctor only
            full = self.settings_doctors_list()
            doctors_data = full["data"]["doctors"]
            doctor_data = next((d for d in doctors_data if d["id"] == doctor.id), None)
            return _json_ok({"doctor": doctor_data})
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except Exception as e:
            _logger.exception("Unexpected error in settings_doctors_save")
            return _json_error(
                "SERVER_ERROR",
                "Unexpected server error.",
                {"detail": str(e)},
                http_status=500,
            )

    # --- Settings: services ---

    @http.route("/vetora/json/settings/services/list", type="json", auth="user", methods=["POST"])
    def settings_services_list(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        company_id = env.company.id
        Service = env["vet.service"].sudo()
        services = Service.search([("company_id", "=", company_id)])
        data_services = []
        _logger.info(
            "vetora settings_services_list: user=%s company_id=%s count=%s ids=%s",
            request.env.user.login,
            company_id,
            len(services),
            services.ids,
        )

        for s in services:
            data_services.append(
                {
                    "id": s.id,
                    "name": s.name,
                    "category": s.category,
                    "duration_minutes": s.duration_minutes,
                    "price": s.default_price,
                    "color": s.color,
                    "active": s.active,
                    "eligible_doctors": [
                        {"id": d.id, "name": d.name} for d in s.eligible_doctor_ids
                    ],
                }
            )
        return _json_ok({"services": data_services})

    @http.route("/vetora/json/settings/services/save", type="json", auth="user", methods=["POST"])
    def settings_services_save(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        company_id = env.company.id
        service_payload = payload.get("service") or {}
        name = service_payload.get("name")
        if not name:
            return _json_error(
                "MISSING_FIELDS",
                "Field 'service.name' is required.",
                {"fields": ["service.name"]},
            )

        Service = env["vet.service"].sudo()
        service_id = service_payload.get("id")

        vals = {
            "name": name,
            "category": service_payload.get("category"),
            "duration_minutes": service_payload.get("duration_minutes") or 30,
            "default_price": service_payload.get("price"),
            "color": service_payload.get("color"),
            "active": service_payload.get("active", True),
            "company_id": company_id,
        }

        try:
            _logger.info(
                "vetora settings_services_save: user=%s company_id=%s service_id=%s payload_keys=%s",
                request.env.user.login,
                company_id,
                service_id,
                list(service_payload.keys()),
            )
            if service_id:
                service = Service.browse(service_id)
                if not service.exists():
                    return _json_error(
                        "NOT_FOUND",
                        "Service not found.",
                        {"id": service_id},
                        http_status=404,
                    )
                service.write(vals)
                _logger.info("vetora settings_services_save: updated service_id=%s vals=%s", service_id, vals)
            else:
                service = Service.create(vals)
                _logger.info("vetora settings_services_save: created service_id=%s vals=%s", service.id, vals)

            eligible_ids = service_payload.get("eligible_doctor_ids")
            if eligible_ids is not None:
                service.eligible_doctor_ids = [(6, 0, eligible_ids)]

            result = self.settings_services_list()
            services_data = result["data"]["services"]
            service_data = next((s for s in services_data if s["id"] == service.id), None)
            return _json_ok({"service": service_data})
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except Exception as e:
            _logger.exception("Unexpected error in settings_services_save")
            return _json_error(
                "SERVER_ERROR",
                "Unexpected server error.",
                {"detail": str(e)},
                http_status=500,
            )

    @http.route("/vetora/json/calendar/week", type="json", auth="user", methods=["POST"])
    def calendar_week(self, **kwargs):
        """Return calendar data for a full week (7 days)."""
        payload = {**_json_payload(), **kwargs}
        try:
            env = request.env
            date_str = payload.get("date")
            if not date_str:
                return _json_error("MISSING_DATE", "Field 'date' is required.")
            day = fields.Date.from_string(date_str)
            company_id = payload.get("company_id") or env.company.id
            location_id = payload.get("location_id")
            raw_doctor_ids = payload.get("doctor_ids") or []
            doctor_ids = []
            for x in raw_doctor_ids:
                try:
                    if x is not None:
                        doctor_ids.append(int(x))
                except (TypeError, ValueError):
                    pass

            start_day = day
            end_day = start_day + timedelta(days=7)
            day_start = datetime.combine(start_day, datetime.min.time())
            day_end = datetime.combine(end_day, datetime.min.time())

            Doctor = env["vet.doctor"].sudo()
            domain_doctor = [("active", "=", True), ("company_id", "=", company_id)]
            if location_id:
                domain_doctor.append(("location_id", "in", [False, location_id]))
            if doctor_ids:
                domain_doctor.append(("id", "in", doctor_ids))
            doctors = Doctor.search(domain_doctor)
            doctor_ids = doctors.ids

            # schedules: all weekdays in window
            sched_domain = [
                ("active", "=", True),
                ("company_id", "=", company_id),
            ]
            if location_id:
                sched_domain.append(("location_id", "in", [False, location_id]))
            clinic_schedules = env["vet.schedule"].sudo().search(sched_domain)
            doc_sched_domain = list(sched_domain) + [
                ("doctor_id", "in", doctor_ids or [0])
            ]
            doctor_schedules = env["vet.doctor.schedule"].sudo().search(doc_sched_domain)

            # blocks & visits over the whole week
            block_domain = [
                ("active", "=", True),
                ("company_id", "=", company_id),
                ("start_at", "<", day_end),
                ("end_at", ">", day_start),
            ]
            if location_id:
                block_domain += [
                    "|",
                    ("location_id", "=", False),
                    ("location_id", "=", location_id),
                ]
            blocks = env["vet.block"].sudo().search(block_domain)

            visit_domain = [
                ("company_id", "=", company_id),
                ("start_at", "<", day_end),
                ("end_at", ">", day_start),
            ]
            if location_id:
                visit_domain.append(("location_id", "=", location_id))
            if doctor_ids:
                visit_domain.append(("doctor_id", "in", doctor_ids))
            visits = env["vet.visit"].sudo().search(visit_domain)

            data = {
                "start_date": fields.Date.to_string(start_day),
                "end_date": fields.Date.to_string(end_day - timedelta(days=1)),
                "doctors": [_serialize_doctor(d) for d in doctors],
                "clinic_schedules": [
                    {
                        "id": s.id,
                        "weekday": s.weekday,
                        "start_time": s.start_time,
                        "end_time": s.end_time,
                        "location_id": s.location_id.id if s.location_id else None,
                    }
                    for s in clinic_schedules
                ],
                "doctor_schedules": [
                    {
                        "id": s.id,
                        "doctor_id": s.doctor_id.id,
                        "weekday": s.weekday,
                        "start_time": s.start_time,
                        "end_time": s.end_time,
                        "location_id": s.location_id.id if s.location_id else None,
                    }
                    for s in doctor_schedules
                ],
                "blocks": [_serialize_block(b) for b in blocks],
                "visits": [_serialize_visit(v) for v in visits],
            }
            return _json_ok(data)
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except AccessError as e:
            return _json_error("ACCESS_ERROR", str(e), http_status=403)
        except Exception as e:
            _logger.exception("Unexpected error in calendar_week")
            return _json_error("SERVER_ERROR", "Unexpected server error.", {"detail": str(e)}, http_status=500)

    # --- Visit CRUD ---

    @http.route("/vetora/json/visit/create", type="json", auth="user", methods=["POST"])
    def visit_create(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        try:
            required = [
                "pet_id",
                "doctor_id",
                "service_id",
                "start_at",
                "duration_minutes",
                "source",
                "location_id",
            ]
            missing = [f for f in required if f not in payload]
            if missing:
                return _json_error(
                    "MISSING_FIELDS",
                    "Missing required fields: %s" % ", ".join(missing),
                    {"fields": missing},
                )

            loc_id = payload["location_id"]
            location = env["vet.location"].sudo().browse(loc_id)
            if not location.exists():
                return _json_error(
                    "INVALID_LOCATION",
                    "Location is required and must exist.",
                    {"location_id": loc_id},
                )

            tz_name = location.tz or getattr(env.company, "tz", None) or "UTC"
            start_at_utc = _start_at_local_to_utc(payload["start_at"], tz_name)

            vals = {
                "pet_id": payload["pet_id"],
                "doctor_id": payload["doctor_id"],
                "service_id": payload["service_id"],
                "start_at": start_at_utc,
                "duration_minutes": payload["duration_minutes"],
                "source": payload["source"],
                "is_urgent": payload.get("is_urgent", False),
                "notes": payload.get("notes", ""),
                "location_id": loc_id,
                "company_id": payload.get("company_id") or env.company.id,
            }

            visit = env["vet.visit"].sudo().create([vals])[0]
            return _json_ok(_serialize_visit(visit))
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except AccessError as e:
            return _json_error("ACCESS_ERROR", str(e), http_status=403)
        except Exception as e:
            _logger.exception("Unexpected error in visit_create")
            return _json_error("SERVER_ERROR", "Unexpected server error.", {"detail": str(e)}, http_status=500)

    @http.route("/vetora/json/visit/update", type="json", auth="user", methods=["POST"])
    def visit_update(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        try:
            visit_id = payload.get("visit_id")
            if not visit_id:
                return _json_error("MISSING_VISIT_ID", "Field 'visit_id' is required.")
            visit = env["vet.visit"].sudo().browse(visit_id)
            if not visit.exists():
                return _json_error("NOT_FOUND", "Visit not found.", http_status=404)

            allowed_fields = {
                "start_at",
                "duration_minutes",
                "doctor_id",
                "service_id",
                "location_id",
                "is_urgent",
                "notes",
            }
            vals = {k: v for k, v in payload.items() if k in allowed_fields}
            if not vals:
                return _json_ok(_serialize_visit(visit))

            visit.write(vals)
            return _json_ok(_serialize_visit(visit))
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except AccessError as e:
            return _json_error("ACCESS_ERROR", str(e), http_status=403)
        except Exception as e:
            _logger.exception("Unexpected error in visit_update")
            return _json_error("SERVER_ERROR", "Unexpected server error.", {"detail": str(e)}, http_status=500)

    @http.route("/vetora/json/visit/reschedule", type="json", auth="user", methods=["POST"])
    def visit_reschedule(self, **payload):
        env = request.env
        try:
            visit_id = payload.get("visit_id")
            new_start_at = payload.get("new_start_at")
            if not visit_id or not new_start_at:
                return _json_error(
                    "MISSING_FIELDS",
                    "Fields 'visit_id' and 'new_start_at' are required.",
                )
            visit = env["vet.visit"].sudo().browse(visit_id)
            if not visit.exists():
                return _json_error("NOT_FOUND", "Visit not found.", http_status=404)

            new_visit = visit.action_reschedule(
                new_start_at=new_start_at,
                new_doctor_id=payload.get("new_doctor_id"),
                new_service_id=payload.get("new_service_id"),
                new_duration_minutes=payload.get("new_duration_minutes"),
                new_location_id=payload.get("new_location_id"),
                new_notes=payload.get("new_notes"),
            )

            data = {
                "old": _serialize_visit(visit),
                "new": _serialize_visit(new_visit),
            }
            return _json_ok(data)
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except AccessError as e:
            return _json_error("ACCESS_ERROR", str(e), http_status=403)
        except Exception as e:
            _logger.exception("Unexpected error in visit_reschedule")
            return _json_error("SERVER_ERROR", "Unexpected server error.", {"detail": str(e)}, http_status=500)

    @http.route("/vetora/json/visit/status", type="json", auth="user", methods=["POST"])
    def visit_change_status(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        try:
            visit_id = payload.get("visit_id")
            action = payload.get("action")
            if not visit_id or not action:
                return _json_error(
                    "MISSING_FIELDS",
                    "Fields 'visit_id' and 'action' are required.",
                )
            visit = env["vet.visit"].sudo().browse(visit_id)
            if not visit.exists():
                return _json_error("NOT_FOUND", "Visit not found.", http_status=404)

            actions_map = {
                "confirm": "action_confirm",
                "check_in": "action_check_in",
                "in_consult": "action_in_consult",
                "done": "action_done",
                "cancel": "action_cancel",
                "no_show": "action_no_show",
            }
            method_name = actions_map.get(action)
            if not method_name:
                return _json_error("INVALID_ACTION", "Unsupported action '%s'." % action)

            if method_name == "action_cancel":
                visit.action_cancel(reason=payload.get("reason"))
            else:
                getattr(visit, method_name)()

            return _json_ok(_serialize_visit(visit))
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except AccessError as e:
            return _json_error("ACCESS_ERROR", str(e), http_status=403)
        except Exception as e:
            _logger.exception("Unexpected error in visit_change_status")
            return _json_error("SERVER_ERROR", "Unexpected server error.", {"detail": str(e)}, http_status=500)

    # --- Blocks ---

    @http.route("/vetora/json/block/create", type="json", auth="user", methods=["POST"])
    def block_create(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        try:
            required = ["block_type", "start_at", "end_at"]
            missing = [f for f in required if f not in payload]
            if missing:
                return _json_error(
                    "MISSING_FIELDS",
                    "Missing required fields: %s" % ", ".join(missing),
                    {"fields": missing},
                )

            vals = {
                "block_type": payload["block_type"],
                "start_at": payload["start_at"],
                "end_at": payload["end_at"],
                "reason": payload.get("reason", ""),
                "doctor_id": payload.get("doctor_id"),
                "location_id": payload.get("location_id"),
                "company_id": payload.get("company_id") or env.company.id,
            }
            _logger.info(
                "vetora block_create: user=%s company_id=%s vals=%s",
                request.env.user.login,
                vals["company_id"],
                vals,
            )
            block = env["vet.block"].sudo().create([vals])[0]
            # conflict signaling is handled by visit validations; for block creation we just create
            return _json_ok(_serialize_block(block))
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            return _json_error(code, msg)
        except AccessError as e:
            return _json_error("ACCESS_ERROR", str(e), http_status=403)
        except Exception as e:
            _logger.exception("Unexpected error in block_create")
            return _json_error("SERVER_ERROR", "Unexpected server error.", {"detail": str(e)}, http_status=500)

    @http.route("/vetora/json/block/list", type="json", auth="user", methods=["POST"])
    def block_list(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        company_id = env.company.id
        date_str = payload.get("date")
        start_at_str = payload.get("start_at")
        end_at_str = payload.get("end_at")
        doctor_id = payload.get("doctor_id")
        location_id = payload.get("location_id")

        Block = env["vet.block"].sudo()
        domain = [("company_id", "=", company_id), ("active", "=", True)]

        if date_str and not (start_at_str or end_at_str):
            day = fields.Date.from_string(date_str)
            day_start = datetime.combine(day, datetime.min.time())
            day_end = day_start + timedelta(days=1)
            domain += [("start_at", "<", day_end), ("end_at", ">", day_start)]
        else:
            if start_at_str:
                start_dt = fields.Datetime.from_string(start_at_str)
                domain.append(("end_at", ">", start_dt))
            if end_at_str:
                end_dt = fields.Datetime.from_string(end_at_str)
                domain.append(("start_at", "<", end_dt))

        if doctor_id is not None:
            domain.append(("doctor_id", "=", doctor_id))
        if location_id is not None:
            domain.append(("location_id", "=", location_id))

        blocks = Block.search(domain, order="start_at")
        _logger.info(
            "vetora block_list: user=%s company_id=%s date=%s doctor_id=%s location_id=%s count=%s ids=%s domain=%s",
            request.env.user.login,
            company_id,
            date_str,
            doctor_id,
            location_id,
            len(blocks),
            blocks.ids,
            domain,
        )
        return _json_ok({"blocks": [_serialize_block(b) for b in blocks]})

    @http.route("/vetora/json/block/update", type="json", auth="user", methods=["POST"])
    def block_update(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        block_id = payload.get("block_id")
        values = payload.get("values") or {}
        if not block_id:
            return _json_error(
                "MISSING_FIELDS",
                "Field 'block_id' is required.",
                {"fields": ["block_id"]},
            )
        Block = env["vet.block"].sudo()
        block = Block.browse(block_id)
        if not block.exists():
            return _json_error("NOT_FOUND", "Block not found.", {"id": block_id}, http_status=404)

        allowed_fields = {
            "type": "block_type",
            "block_type": "block_type",
            "start_at": "start_at",
            "end_at": "end_at",
            "doctor_id": "doctor_id",
            "location_id": "location_id",
            "reason": "reason",
            "is_recurring": "is_recurring",
            "active": "active",
        }
        vals = {}
        for key, value in values.items():
            field_name = allowed_fields.get(key)
            if field_name:
                vals[field_name] = value

        if not vals:
            return _json_ok(_serialize_block(block))

        try:
            _logger.info(
                "vetora block_update: user=%s block_id=%s vals=%s",
                request.env.user.login,
                block_id,
                vals,
            )
            block.write(vals)
            return _json_ok(_serialize_block(block))
        except ValidationError as e:
            code, msg = _map_validation_error(e)
            if code == "VALIDATION_ERROR":
                code = "INVALID_BLOCK_INTERVAL"
            return _json_error(code, msg)
        except Exception as e:
            _logger.exception("Unexpected error in block_update")
            return _json_error(
                "SERVER_ERROR",
                "Unexpected server error.",
                {"detail": str(e)},
                http_status=500,
            )

    @http.route("/vetora/json/block/delete", type="json", auth="user", methods=["POST"])
    def block_delete(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        block_id = payload.get("block_id")
        if not block_id:
            return _json_error(
                "MISSING_FIELDS",
                "Field 'block_id' is required.",
                {"fields": ["block_id"]},
            )
        Block = env["vet.block"].sudo()
        block = Block.browse(block_id)
        if not block.exists():
            return _json_error("NOT_FOUND", "Block not found.", {"id": block_id}, http_status=404)
        try:
            _logger.info(
                "vetora block_delete: user=%s block_id=%s",
                request.env.user.login,
                block_id,
            )
            block.unlink()
            return _json_ok(True)
        except Exception as e:
            _logger.exception("Unexpected error in block_delete")
            return _json_error(
                "SERVER_ERROR",
                "Unexpected server error.",
                {"detail": str(e)},
                http_status=500,
            )

    # --- Lookups ---

    @http.route("/vetora/json/lookup/doctors", type="json", auth="user", methods=["POST"])
    def lookup_doctors(self, **payload):
        env = request.env
        company_id = payload.get("company_id") or env.company.id
        location_id = payload.get("location_id")
        Doctor = env["vet.doctor"].sudo()
        # Be tolerant: include doctors without company set, plus the current company.
        domain = [("active", "=", True)]
        if company_id:
            domain.append(("company_id", "in", [False, company_id]))
        if location_id:
            domain.append(("location_id", "in", [False, location_id]))
        doctors = Doctor.search(domain)
        return _json_ok([_serialize_doctor(d) for d in doctors])

    @http.route("/vetora/json/lookup/services", type="json", auth="user", methods=["POST"])
    def lookup_services(self, **payload):
        env = request.env
        company_id = payload.get("company_id") or env.company.id
        Service = env["vet.service"].sudo()
        domain = [("active", "=", True), ("company_id", "=", company_id)]
        if payload.get("doctor_id"):
            domain.append(("eligible_doctor_ids", "in", [payload["doctor_id"]]))
        services = Service.search(domain)
        return _json_ok([_serialize_service(s) for s in services])

    @http.route("/vetora/json/lookup/patients", type="json", auth="user", methods=["POST"])
    def lookup_patients(self, **payload):
        payload = {**_json_payload(), **payload}
        env = request.env
        query = (payload.get("query") or "").strip()
        owner_id = payload.get("owner_id")
        domain = [("active", "=", True)]
        if owner_id is not None:
            domain.append(("owner_id", "=", owner_id))
        if query:
            domain.append(("name", "ilike", query))
        patients = env["vet.pet"].sudo().search(domain, limit=50)
        data = [
            {
                "id": p.id,
                "name": p.name,
                "owner_id": p.owner_id.id,
                "owner_name": p.owner_id.name,
            }
            for p in patients
        ]
        return _json_ok(data)

    @http.route("/vetora/json/lookup/clients", type="json", auth="user", methods=["POST"])
    def lookup_clients(self, **payload):
        env = request.env
        query = payload.get("query", "").strip()
        domain = [("active", "=", True)]
        if query:
            domain.append(("name", "ilike", query))
        partners = env["res.partner"].sudo().search(domain, limit=50)
        data = [
            {
                "id": p.id,
                "name": p.name,
                "phone": p.phone,
                # Some Odoo installations may not define a separate 'mobile' field
                # on res.partner; be defensive and fall back to False.
                "mobile": getattr(p, "mobile", False),
                "email": p.email,
            }
            for p in partners
        ]
        return _json_ok(data)

    @http.route("/vetora/json/detail/patient", type="json", auth="user", methods=["POST"])
    def detail_patient(self, **payload):
        env = request.env
        pid = payload.get("patient_id")
        if not pid:
            return _json_error("MISSING_PATIENT_ID", "Field 'patient_id' is required.")
        patient = env["vet.pet"].sudo().browse(pid)
        if not patient.exists():
            return _json_error("NOT_FOUND", "Patient not found.", http_status=404)
        data = {
            "id": patient.id,
            "name": patient.name,
            "owner_id": patient.owner_id.id,
            "owner_name": patient.owner_id.name,
            "species": patient.species,
            "breed": patient.breed,
            "gender": patient.gender,
            "birth_date": patient.birth_date,
            "microchip": patient.microchip,
            "is_sterilized": patient.is_sterilized,
            "alerts_short": patient.alerts_short,
        }
        # Visit history for this patient (most recent first).
        Visit = env["vet.visit"].sudo()
        visits = Visit.search(
            [("pet_id", "=", patient.id)],
            order="start_at desc",
            limit=200,
        )
        history = []
        for v in visits:
            notes = v.notes or ""
            short_notes = notes[:120] if notes else ""
            history.append(
                {
                    "id": v.id,
                    "start_at": v.start_at,
                    "doctor_id": v.doctor_id.id,
                    "doctor_name": v.doctor_id.name,
                    "service_id": v.service_id.id,
                    "service_name": v.service_id.name,
                    "status": v.status,
                    "short_notes": short_notes,
                }
            )
        data["history"] = history
        return _json_ok(data)

    @http.route("/vetora/json/detail/client", type="json", auth="user", methods=["POST"])
    def detail_client(self, **payload):
        env = request.env
        cid = payload.get("client_id")
        if not cid:
            return _json_error("MISSING_CLIENT_ID", "Field 'client_id' is required.")
        client = env["res.partner"].sudo().browse(cid)
        if not client.exists():
            return _json_error("NOT_FOUND", "Client not found.", http_status=404)
        data = {
            "id": client.id,
            "name": client.name,
            "phone": client.phone,
            "mobile": getattr(client, "mobile", False),
            "email": client.email,
            "street": client.street,
            "city": client.city,
            "zip": client.zip,
            "country_id": client.country_id.id if client.country_id else None,
        }
        # Patients owned by this client.
        Patient = env["vet.pet"].sudo()
        patients = Patient.search([("owner_id", "=", client.id)])
        data["patients"] = [
            {
                "id": p.id,
                "name": p.name,
                "species": p.species,
                "breed": p.breed,
                "alerts_short": p.alerts_short,
            }
            for p in patients
        ]

        # Visit history for this client (most recent first).
        Visit = env["vet.visit"].sudo()
        visits = Visit.search(
            [("client_id", "=", client.id)],
            order="start_at desc",
            limit=200,
        )
        history = []
        for v in visits:
            notes = v.notes or ""
            short_notes = notes[:120] if notes else ""
            history.append(
                {
                    "id": v.id,
                    "start_at": v.start_at,
                    "patient_id": v.pet_id.id,
                    "patient_name": v.pet_id.name,
                    "doctor_id": v.doctor_id.id,
                    "doctor_name": v.doctor_id.name,
                    "service_id": v.service_id.id,
                    "service_name": v.service_id.name,
                    "status": v.status,
                    "short_notes": short_notes,
                }
            )
        data["history"] = history
        return _json_ok(data)

    # --- Quick create (from NewVisitModal) ---

    @http.route("/vetora/json/client/create", type="json", auth="user", methods=["POST"])
    def create_client(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        name = (payload.get("name") or "").strip()
        if not name:
            return _json_error(
                "MISSING_FIELDS",
                "Field 'name' is required.",
                {"fields": ["name"]},
            )
        Partner = env["res.partner"].sudo()
        vals = {
            "name": name,
            "phone": payload.get("phone") or False,
            "email": payload.get("email") or False,
            "street": payload.get("street") or False,
            "city": payload.get("city") or False,
            "zip": payload.get("zip") or False,
        }
        if "mobile" in Partner._fields:
            vals["mobile"] = payload.get("mobile") or False
        partner = Partner.create(vals)
        data = {
            "id": partner.id,
            "name": partner.name,
            "phone": partner.phone or None,
            "mobile": getattr(partner, "mobile", None) or None,
            "email": partner.email or None,
        }
        return _json_ok(data)

    @http.route("/vetora/json/patient/create", type="json", auth="user", methods=["POST"])
    def create_patient(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        owner_id = payload.get("owner_id")
        if not owner_id:
            return _json_error(
                "MISSING_FIELDS",
                "Field 'owner_id' (client) is required.",
                {"fields": ["owner_id"]},
            )
        name = (payload.get("name") or "").strip()
        if not name:
            return _json_error(
                "MISSING_FIELDS",
                "Field 'name' is required.",
                {"fields": ["name"]},
            )
        Partner = env["res.partner"].sudo()
        owner = Partner.browse(owner_id)
        if not owner.exists():
            return _json_error("NOT_FOUND", "Client not found.", {"id": owner_id}, http_status=404)
        Pet = env["vet.pet"].sudo()
        species = payload.get("species") or "dog"
        if species not in ("dog", "cat", "other"):
            species = "other"
        vals = {
            "name": name,
            "owner_id": owner_id,
            "species": species,
            "breed": payload.get("breed") or False,
            "gender": payload.get("gender") or "unknown",
            "birth_date": payload.get("birth_date") or False,
            "microchip": payload.get("microchip") or False,
            "alerts_short": payload.get("alerts_short") or False,
        }
        if vals["gender"] not in ("male", "female", "unknown"):
            vals["gender"] = "unknown"
        pet = Pet.create(vals)
        data = {
            "id": pet.id,
            "name": pet.name,
            "owner_id": pet.owner_id.id,
            "owner_name": pet.owner_id.name,
            "species": pet.species,
            "breed": pet.breed or None,
            "gender": pet.gender or None,
            "birth_date": str(pet.birth_date) if pet.birth_date else None,
            "microchip": pet.microchip or None,
        }
        return _json_ok(data)

