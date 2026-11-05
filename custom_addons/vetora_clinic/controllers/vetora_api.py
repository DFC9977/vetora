import base64
import binascii
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


SUPPLIER_INVOICE_MAX_BYTES = 15 * 1024 * 1024


def _to_float(value):
    if value in (None, "", False):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(" ", "").replace(",", "."))
    except ValueError:
        return 0.0


def _get_supplier_invoice(payload):
    try:
        inv_id = int(payload.get("invoice_id") or 0)
    except (TypeError, ValueError):
        return None
    if not inv_id:
        return None
    invoice = request.env["vet.supplier.invoice"].browse(inv_id).exists()
    return invoice or None


def _supplier_invoice_domain(env, payload):
    """Common filters for supplier invoices and their lines (same field names on both models)."""
    domain = [("company_id", "=", payload.get("company_id") or env.company.id)]
    if payload.get("date_from"):
        domain.append(("invoice_date", ">=", payload["date_from"]))
    if payload.get("date_to"):
        domain.append(("invoice_date", "<=", payload["date_to"]))
    if payload.get("location_id"):
        domain.append(("location_id", "=", int(payload["location_id"])))
    supplier = (payload.get("supplier") or "").strip()
    if supplier:
        domain.append(("supplier_name", "ilike", supplier))
    customer = (payload.get("customer") or "").strip()
    if customer:
        domain.append(("customer_name", "ilike", customer))
    return domain


def _serialize_supplier_invoice(inv, with_lines=False):
    data = {
        "id": inv.id,
        "name": inv.name or None,
        "supplier_name": inv.supplier_name or None,
        "supplier_vat": inv.supplier_vat or None,
        "customer_name": inv.customer_name or None,
        "customer_vat": inv.customer_vat or None,
        "customer_phone": inv.customer_phone or None,
        "delivery_address": inv.delivery_address or None,
        "run_id": inv.run_id.id if inv.run_id else None,
        "run_name": inv.run_id.name if inv.run_id else None,
        "delivery_state": inv.delivery_state,
        "delivered_at": fields.Datetime.to_string(inv.delivered_at) if inv.delivered_at else None,
        "delivery_note": inv.delivery_note or None,
        "invoice_date": str(inv.invoice_date) if inv.invoice_date else None,
        "location_id": inv.location_id.id if inv.location_id else None,
        "location_name": inv.location_id.name if inv.location_id else None,
        "state": inv.state,
        "file_name": inv.file_name or None,
        "has_file": bool(inv.file_data),
        "extraction_method": inv.extraction_method,
        "amount_untaxed": inv.amount_untaxed,
        "line_count": inv.line_count,
        "notes": inv.notes or None,
    }
    if with_lines:
        data["lines"] = [
            {
                "id": ln.id,
                "product_code": ln.product_code or None,
                "product_name": ln.product_name,
                "uom": ln.uom or None,
                "quantity": ln.quantity,
                "price_unit": ln.price_unit,
                "vat_rate": ln.vat_rate,
                "discount_amount": ln.discount_amount,
                "amount": ln.amount,
                "lot_number": ln.lot_number or None,
                "expiry_date": str(ln.expiry_date) if ln.expiry_date else None,
                "catalog_id": ln.catalog_id.id if ln.catalog_id else None,
                "catalog_code": ln.catalog_id.internal_code if ln.catalog_id else None,
                "producer": ln.catalog_id.producer if ln.catalog_id else None,
                "return_qty": ln.return_qty,
                "delivered_qty": ln.delivered_qty,
                "return_reason": ln.return_reason or None,
                "delivery_note": ln.delivery_note or None,
            }
            for ln in inv.line_ids
        ]
    return data



def _serialize_run(run):
    return {
        "id": run.id,
        "name": run.name,
        "date": str(run.date) if run.date else None,
        "driver": run.driver or None,
        "vehicle": run.vehicle or None,
        "notes": run.notes or None,
        "state": run.state,
        "invoice_count": run.invoice_count,
        "pending_count": run.pending_count,
        "delivered_count": run.delivered_count,
        "partial_count": run.partial_count,
        "not_delivered_count": run.not_delivered_count,
        "amount_total": round(run.amount_total, 2),
    }


def _aggregate_delivery_goods(invoices):
    """Per-product totals for a set of invoices: loaded (invoiced), delivered and returned quantities,
    with the per-invoice breakdown (used for the loading list and the delivery report)."""
    rows = {}
    for inv in invoices:
        for ln in inv.line_ids:
            key = f"cat:{ln.catalog_id.id}" if ln.catalog_id else ln.product_key
            row = rows.get(key)
            if row is None:
                row = rows[key] = {
                    "product_key": key,
                    "product_code": ln.catalog_id.internal_code if ln.catalog_id else (ln.product_code or None),
                    "ean": ln.catalog_id.ean if ln.catalog_id else None,
                    "producer": ln.catalog_id.producer if ln.catalog_id else None,
                    "product_name": ln.catalog_id.name if ln.catalog_id else ln.product_name,
                    "uom": ln.uom or None,
                    "quantity": 0.0,
                    "delivered_qty": 0.0,
                    "returned_qty": 0.0,
                    "amount": 0.0,
                    "invoices": [],
                }
            row["quantity"] += ln.quantity
            row["delivered_qty"] += ln.delivered_qty
            row["returned_qty"] += ln.return_qty
            row["amount"] = round(row["amount"] + ln.amount, 2)
            row["invoices"].append({
                "invoice_id": inv.id,
                "invoice_name": inv.name or inv.file_name,
                "customer_name": inv.customer_name or None,
                "quantity": ln.quantity,
                "returned_qty": ln.return_qty,
                "return_reason": ln.return_reason or None,
                "delivery_note": ln.delivery_note or None,
            })
    result = sorted(rows.values(), key=lambda r: ((r["producer"] or "~").lower(), r["product_name"].lower()))
    producers = {}
    for r in result:
        p = producers.setdefault(r["producer"] or "", {
            "producer": r["producer"], "products": 0, "quantity": 0.0, "delivered_qty": 0.0, "returned_qty": 0.0,
        })
        p["products"] += 1
        p["quantity"] += r["quantity"]
        p["delivered_qty"] += r["delivered_qty"]
        p["returned_qty"] += r["returned_qty"]
    return result, sorted(producers.values(), key=lambda p: (p["producer"] or "~").lower())

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


    # --- Supplier invoices / goods registry ---

    @http.route("/vetora/json/supplier_invoice/upload", type="json", auth="user", methods=["POST"])
    def supplier_invoice_upload(self, **kwargs):
        """Create a draft supplier invoice from an uploaded PDF/image (base64) and extract its lines."""
        payload = {**_json_payload(), **kwargs}
        env = request.env
        file_b64 = payload.get("file_base64") or ""
        file_name = (payload.get("file_name") or "").strip() or "factura"
        if not file_b64:
            return _json_error("MISSING_FIELDS", "Field 'file_base64' is required.", {"fields": ["file_base64"]})
        if "," in file_b64[:100] and file_b64.startswith("data:"):
            file_b64 = file_b64.split(",", 1)[1]
        try:
            file_bytes = base64.b64decode(file_b64, validate=False)
        except (binascii.Error, ValueError):
            return _json_error("INVALID_FILE", "File content is not valid base64.")
        if len(file_bytes) > SUPPLIER_INVOICE_MAX_BYTES:
            return _json_error("FILE_TOO_LARGE", "File is larger than 15 MB.")
        location_id = payload.get("location_id")
        try:
            invoice = env["vet.supplier.invoice"].create_from_file(
                file_bytes, file_name, location_id=int(location_id) if location_id else False
            )
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        return _json_ok(_serialize_supplier_invoice(invoice, with_lines=True))

    @http.route("/vetora/json/supplier_invoice/list", type="json", auth="user", methods=["POST"])
    def supplier_invoice_list(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        domain = _supplier_invoice_domain(env, payload)
        if payload.get("state") in ("draft", "confirmed"):
            domain.append(("state", "=", payload["state"]))
        invoices = env["vet.supplier.invoice"].search(domain, limit=int(payload.get("limit") or 200))
        return _json_ok({"invoices": [_serialize_supplier_invoice(inv) for inv in invoices]})

    @http.route("/vetora/json/supplier_invoice/get", type="json", auth="user", methods=["POST"])
    def supplier_invoice_get(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        invoice = _get_supplier_invoice(payload)
        if not invoice:
            return _json_error("NOT_FOUND", "Invoice not found.", {"id": payload.get("invoice_id")}, http_status=404)
        data = _serialize_supplier_invoice(invoice, with_lines=True)
        data["raw_text"] = invoice.raw_text or ""
        return _json_ok(data)

    @http.route("/vetora/json/supplier_invoice/save", type="json", auth="user", methods=["POST"])
    def supplier_invoice_save(self, **kwargs):
        """Save header fields and replace all lines of a draft invoice (manual review)."""
        payload = {**_json_payload(), **kwargs}
        env = request.env
        vals_in = payload.get("invoice") or {}
        Invoice = env["vet.supplier.invoice"]
        invoice = _get_supplier_invoice({"invoice_id": vals_in.get("id")}) if vals_in.get("id") else Invoice
        if vals_in.get("id") and not invoice:
            return _json_error("NOT_FOUND", "Invoice not found.", {"id": vals_in.get("id")}, http_status=404)
        vals = {}
        for key in ("name", "supplier_name", "supplier_vat", "customer_name", "customer_vat",
                    "customer_phone", "delivery_address", "invoice_date", "notes"):
            if key in vals_in:
                vals[key] = (vals_in.get(key) or "").strip() or False
        if "location_id" in vals_in:
            vals["location_id"] = int(vals_in["location_id"]) if vals_in.get("location_id") else False
        if "lines" in vals_in:
            commands = [(5, 0, 0)]
            for i, ln in enumerate(vals_in.get("lines") or []):
                name = (ln.get("product_name") or "").strip()
                if not name:
                    continue
                commands.append((0, 0, {
                    "sequence": (i + 1) * 10,
                    "product_code": (ln.get("product_code") or "").strip() or False,
                    "product_name": name,
                    "uom": (ln.get("uom") or "").strip() or False,
                    "quantity": _to_float(ln.get("quantity")),
                    "price_unit": _to_float(ln.get("price_unit")),
                    "vat_rate": _to_float(ln.get("vat_rate")),
                    "discount_amount": _to_float(ln.get("discount_amount")),
                    "lot_number": (ln.get("lot_number") or "").strip() or False,
                    "expiry_date": ln.get("expiry_date") or False,
                }))
            vals["line_ids"] = commands
        try:
            if invoice:
                invoice._check_draft()
                invoice.write(vals)
            else:
                vals.setdefault("extraction_method", "manual")
                invoice = Invoice.create(vals)
            if "line_ids" in vals:
                invoice.line_ids.action_match_catalog()
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        return _json_ok(_serialize_supplier_invoice(invoice, with_lines=True))

    @http.route("/vetora/json/supplier_invoice/action", type="json", auth="user", methods=["POST"])
    def supplier_invoice_action(self, **kwargs):
        """Run a workflow action: confirm | reset_draft | reextract | delete."""
        payload = {**_json_payload(), **kwargs}
        invoice = _get_supplier_invoice(payload)
        if not invoice:
            return _json_error("NOT_FOUND", "Invoice not found.", {"id": payload.get("invoice_id")}, http_status=404)
        action = payload.get("action")
        try:
            if action == "confirm":
                invoice.action_confirm()
            elif action == "reset_draft":
                invoice.action_reset_draft()
            elif action == "reextract":
                invoice.action_reextract()
            elif action == "delete":
                invoice.unlink()
                return _json_ok({"deleted": True})
            else:
                return _json_error("INVALID_ACTION", "Unknown action.", {"action": action})
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        return _json_ok(_serialize_supplier_invoice(invoice, with_lines=True))

    @http.route("/vetora/json/supplier_invoice/file", type="json", auth="user", methods=["POST"])
    def supplier_invoice_file(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        invoice = _get_supplier_invoice(payload)
        if not invoice or not invoice.file_data:
            return _json_error("NOT_FOUND", "File not found.", http_status=404)
        return _json_ok({
            "file_name": invoice.file_name,
            "file_base64": invoice.file_data.decode() if isinstance(invoice.file_data, bytes) else invoice.file_data,
        })

    @http.route("/vetora/json/goods_registry", type="json", auth="user", methods=["POST"])
    def goods_registry(self, **kwargs):
        """Central goods registry: confirmed invoice lines aggregated per product.

        Lines matched to the catalog are grouped by catalog product; the others by
        normalized code/name. Also returns a per-producer summary.
        Filters: date_from, date_to, location_id, supplier, customer, producer, product.
        """
        payload = {**_json_payload(), **kwargs}
        env = request.env
        domain = _supplier_invoice_domain(env, payload)
        domain.append(("state", "=", "confirmed"))
        product_q = (payload.get("product") or "").strip()
        if product_q:
            domain += ["|", "|", ("product_name", "ilike", product_q), ("product_code", "ilike", product_q),
                       ("catalog_id.internal_code", "ilike", product_q)]
        producer_q = (payload.get("producer") or "").strip()
        if producer_q:
            domain.append(("producer", "ilike", producer_q))
        lines = env["vet.supplier.invoice.line"].search(domain, order="invoice_date asc, id asc")

        rows = {}
        for ln in lines:
            key = f"cat:{ln.catalog_id.id}" if ln.catalog_id else ln.product_key
            row = rows.get(key)
            if row is None:
                row = rows[key] = {
                    "product_key": key,
                    "catalog_id": ln.catalog_id.id if ln.catalog_id else None,
                    "product_code": ln.catalog_id.internal_code if ln.catalog_id else (ln.product_code or None),
                    "ean": ln.catalog_id.ean if ln.catalog_id else None,
                    "producer": ln.catalog_id.producer if ln.catalog_id else None,
                    "product_name": ln.catalog_id.name if ln.catalog_id else ln.product_name,
                    "uom": ln.uom or None,
                    "total_quantity": 0.0,
                    "total_amount": 0.0,
                    "total_discount": 0.0,
                    "invoice_ids": set(),
                    "suppliers": set(),
                    "customers": set(),
                    "min_price": None,
                    "max_price": None,
                }
            row["total_quantity"] += ln.quantity
            row["total_amount"] += ln.amount
            row["total_discount"] += ln.discount_amount
            row["invoice_ids"].add(ln.invoice_id.id)
            if ln.supplier_name:
                row["suppliers"].add(ln.supplier_name)
            if ln.customer_name:
                row["customers"].add(ln.customer_name)
            row["min_price"] = ln.price_unit if row["min_price"] is None else min(row["min_price"], ln.price_unit)
            row["max_price"] = ln.price_unit if row["max_price"] is None else max(row["max_price"], ln.price_unit)
            # lines are ordered by date: the last one seen is the latest
            row["last_price"] = ln.price_unit
            row["last_date"] = str(ln.invoice_date) if ln.invoice_date else None
            row["last_supplier"] = ln.supplier_name or None
            if not ln.catalog_id:
                row["product_name"] = ln.product_name
            row["uom"] = ln.uom or row["uom"]

        result = []
        producers = {}
        for row in rows.values():
            qty = row["total_quantity"]
            row["avg_price"] = round(row["total_amount"] / qty, 4) if qty else 0.0
            row["total_amount"] = round(row["total_amount"], 2)
            row["total_discount"] = round(row["total_discount"], 2)
            row["invoice_count"] = len(row.pop("invoice_ids"))
            row["suppliers"] = sorted(row["suppliers"])
            row["customers"] = sorted(row["customers"])
            result.append(row)
            pkey = row["producer"] or ""
            prod = producers.setdefault(pkey, {"producer": row["producer"], "products": 0, "total_quantity": 0.0, "total_amount": 0.0})
            prod["products"] += 1
            prod["total_quantity"] += qty
            prod["total_amount"] = round(prod["total_amount"] + row["total_amount"], 2)
        result.sort(key=lambda r: ((r["producer"] or "~").lower(), r["product_name"].lower()))
        by_producer = sorted(producers.values(), key=lambda p: -p["total_amount"])
        return _json_ok({
            "rows": result,
            "by_producer": by_producer,
            "totals": {
                "products": len(result),
                "quantity": sum(r["total_quantity"] for r in result),
                "amount": round(sum(r["total_amount"] for r in result), 2),
                "invoices": len(set(lines.mapped("invoice_id").ids)),
                "unmatched": sum(1 for r in result if not r["catalog_id"]),
            },
        })

    # --- Goods catalog ---

    @http.route("/vetora/json/goods_catalog/import", type="json", auth="user", methods=["POST"])
    def goods_catalog_import(self, **kwargs):
        """Import/update the product catalog from an Excel price list (base64), then re-match draft lines."""
        payload = {**_json_payload(), **kwargs}
        env = request.env
        file_b64 = payload.get("file_base64") or ""
        if not file_b64:
            return _json_error("MISSING_FIELDS", "Field 'file_base64' is required.", {"fields": ["file_base64"]})
        try:
            file_bytes = base64.b64decode(file_b64.split(",", 1)[1] if file_b64.startswith("data:") else file_b64)
        except (binascii.Error, ValueError):
            return _json_error("INVALID_FILE", "File content is not valid base64.")
        if len(file_bytes) > SUPPLIER_INVOICE_MAX_BYTES:
            return _json_error("FILE_TOO_LARGE", "File is larger than 15 MB.")
        try:
            counters = env["vet.goods.product"].import_xlsx(file_bytes)
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        # Re-match all lines of the company (catalog changed).
        lines = env["vet.supplier.invoice.line"].search([("company_id", "=", env.company.id)])
        lines.action_match_catalog()
        counters["rematched_lines"] = len(lines.filtered("catalog_id"))
        return _json_ok(counters)

    @http.route("/vetora/json/goods_catalog/list", type="json", auth="user", methods=["POST"])
    def goods_catalog_list(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        domain = [("company_id", "=", env.company.id)]
        query = (payload.get("query") or "").strip()
        if query:
            domain += ["|", "|", "|", ("name", "ilike", query), ("internal_code", "ilike", query),
                       ("ean", "ilike", query), ("producer", "ilike", query)]
        Product = env["vet.goods.product"]
        limit = min(int(payload.get("limit") or 200), 1000)
        products = Product.search(domain, limit=limit)
        return _json_ok({
            "total": Product.search_count(domain),
            "products": [
                {
                    "id": p.id,
                    "name": p.name,
                    "internal_code": p.internal_code or None,
                    "ean": p.ean or None,
                    "producer": p.producer or None,
                    "price": p.price,
                    "vat_rate": p.vat_rate,
                    "hs_code": p.hs_code or None,
                }
                for p in products
            ],
        })

    # --- Delivery runs (daily loading + delivery tracking) ---

    @http.route("/vetora/json/delivery_run/list", type="json", auth="user", methods=["POST"])
    def delivery_run_list(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        domain = [("company_id", "=", env.company.id)]
        if payload.get("date_from"):
            domain.append(("date", ">=", payload["date_from"]))
        if payload.get("date_to"):
            domain.append(("date", "<=", payload["date_to"]))
        runs = env["vet.delivery.run"].search(domain, limit=int(payload.get("limit") or 100))
        return _json_ok({"runs": [_serialize_run(r) for r in runs]})

    @http.route("/vetora/json/delivery_run/save", type="json", auth="user", methods=["POST"])
    def delivery_run_save(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        env = request.env
        vals_in = payload.get("run") or {}
        Run = env["vet.delivery.run"]
        vals = {}
        for key in ("name", "driver", "vehicle", "notes"):
            if key in vals_in:
                vals[key] = (vals_in.get(key) or "").strip() or False
        if vals_in.get("date"):
            vals["date"] = vals_in["date"]
        if vals_in.get("state") in ("planned", "loaded", "in_progress", "done"):
            vals["state"] = vals_in["state"]
        try:
            if vals_in.get("id"):
                run = Run.browse(int(vals_in["id"])).exists()
                if not run:
                    return _json_error("NOT_FOUND", "Run not found.", http_status=404)
                run.write(vals)
            else:
                if not vals.get("name"):
                    date_label = vals.get("date") or str(fields.Date.context_today(Run))
                    vals["name"] = f"Cursa {date_label}"
                run = Run.create(vals)
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        return _json_ok(_serialize_run(run))

    @http.route("/vetora/json/delivery_run/get", type="json", auth="user", methods=["POST"])
    def delivery_run_get(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        run = request.env["vet.delivery.run"].browse(int(payload.get("run_id") or 0)).exists()
        if not run:
            return _json_error("NOT_FOUND", "Run not found.", http_status=404)
        data = _serialize_run(run)
        data["invoices"] = [_serialize_supplier_invoice(inv, with_lines=True) for inv in run.invoice_ids.sorted("id")]
        return _json_ok(data)

    @http.route("/vetora/json/delivery_run/delete", type="json", auth="user", methods=["POST"])
    def delivery_run_delete(self, **kwargs):
        payload = {**_json_payload(), **kwargs}
        run = request.env["vet.delivery.run"].browse(int(payload.get("run_id") or 0)).exists()
        if not run:
            return _json_error("NOT_FOUND", "Run not found.", http_status=404)
        try:
            run.invoice_ids.filtered(lambda i: i.state == "draft").unlink()
            run.unlink()
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        return _json_ok({"deleted": True})

    @http.route("/vetora/json/delivery_run/upload", type="json", auth="user", methods=["POST"])
    def delivery_run_upload(self, **kwargs):
        """Upload one invoice PDF into a run. Rejects an invoice already uploaded (same number + issuer)."""
        payload = {**_json_payload(), **kwargs}
        env = request.env
        run = env["vet.delivery.run"].browse(int(payload.get("run_id") or 0)).exists()
        if not run:
            return _json_error("NOT_FOUND", "Run not found.", http_status=404)
        file_b64 = payload.get("file_base64") or ""
        file_name = (payload.get("file_name") or "").strip() or "factura.pdf"
        if not file_b64:
            return _json_error("MISSING_FIELDS", "Field 'file_base64' is required.", {"fields": ["file_base64"]})
        try:
            file_bytes = base64.b64decode(file_b64.split(",", 1)[1] if file_b64.startswith("data:") else file_b64)
        except (binascii.Error, ValueError):
            return _json_error("INVALID_FILE", "File content is not valid base64.")
        if len(file_bytes) > SUPPLIER_INVOICE_MAX_BYTES:
            return _json_error("FILE_TOO_LARGE", "File is larger than 15 MB.")
        try:
            invoice = env["vet.supplier.invoice"].create_from_file(file_bytes, file_name, run_id=run.id)
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        dup = invoice._find_duplicates()[:1]
        if dup:
            where = dup.run_id.name if dup.run_id else "-"
            name = invoice.name
            invoice.unlink()
            return _json_error(
                "DUPLICATE_INVOICE",
                f"Factura {name} a fost deja încărcată ({where}).",
                {"invoice_id": dup.id, "run_id": dup.run_id.id if dup.run_id else None, "run_name": where},
            )
        return _json_ok(_serialize_supplier_invoice(invoice, with_lines=True))

    @http.route("/vetora/json/delivery_run/remove_invoice", type="json", auth="user", methods=["POST"])
    def delivery_run_remove_invoice(self, **kwargs):
        """Remove an invoice from its run (deletes it if still a draft without delivery)."""
        payload = {**_json_payload(), **kwargs}
        invoice = _get_supplier_invoice(payload)
        if not invoice:
            return _json_error("NOT_FOUND", "Invoice not found.", http_status=404)
        if invoice.delivery_state != "pending":
            return _json_error("VALIDATION_ERROR", "Factura are deja livrarea înregistrată; resetați statusul întâi.")
        try:
            if invoice.state == "draft":
                invoice.unlink()
            else:
                invoice.run_id = False
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        return _json_ok({"removed": True})

    @http.route("/vetora/json/delivery/update", type="json", auth="user", methods=["POST"])
    def delivery_update(self, **kwargs):
        """Record the delivery result of an invoice.

        payload: invoice_id, status (pending|delivered|partial|not_delivered), note,
                 lines: [{id, return_qty, return_reason, delivery_note}]
        """
        payload = {**_json_payload(), **kwargs}
        invoice = _get_supplier_invoice(payload)
        if not invoice:
            return _json_error("NOT_FOUND", "Invoice not found.", http_status=404)
        try:
            invoice.action_set_delivery(
                payload.get("status") or "delivered",
                note=payload.get("note") if "note" in payload else None,
                lines=payload.get("lines") or None,
            )
        except ValidationError as e:
            return _json_error("VALIDATION_ERROR", str(e))
        return _json_ok(_serialize_supplier_invoice(invoice, with_lines=True))

    @http.route("/vetora/json/delivery/summary", type="json", auth="user", methods=["POST"])
    def delivery_summary(self, **kwargs):
        """Loading list + delivery report for one run (run_id) or for a period (date_from/date_to).

        Returns invoices (with delivery status), per-product totals (loaded/delivered/returned),
        per-producer totals and status counters.
        """
        payload = {**_json_payload(), **kwargs}
        env = request.env
        Invoice = env["vet.supplier.invoice"]
        run = None
        if payload.get("run_id"):
            run = env["vet.delivery.run"].browse(int(payload["run_id"])).exists()
            if not run:
                return _json_error("NOT_FOUND", "Run not found.", http_status=404)
            invoices = run.invoice_ids.sorted("id")
        else:
            domain = [("company_id", "=", env.company.id), ("run_id", "!=", False)]
            if payload.get("date_from"):
                domain.append(("run_id.date", ">=", payload["date_from"]))
            if payload.get("date_to"):
                domain.append(("run_id.date", "<=", payload["date_to"]))
            customer = (payload.get("customer") or "").strip()
            if customer:
                domain.append(("customer_name", "ilike", customer))
            invoices = Invoice.search(domain, order="id")
        products, by_producer = _aggregate_delivery_goods(invoices)
        counts = {s: len(invoices.filtered(lambda i, s=s: i.delivery_state == s))
                  for s in ("pending", "delivered", "partial", "not_delivered")}
        return _json_ok({
            "run": _serialize_run(run) if run else None,
            "invoices": [_serialize_supplier_invoice(inv, with_lines=True) for inv in invoices],
            "products": products,
            "by_producer": by_producer,
            "counts": counts,
            "totals": {
                "invoices": len(invoices),
                "quantity": sum(p["quantity"] for p in products),
                "delivered_qty": sum(p["delivered_qty"] for p in products),
                "returned_qty": sum(p["returned_qty"] for p in products),
                "amount": round(sum(invoices.mapped("amount_untaxed")), 2),
            },
        })
