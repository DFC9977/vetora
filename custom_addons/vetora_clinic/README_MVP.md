# Vetora Clinic MVP Backend

## 1. Scope

This addon (`vetora_clinic`) provides the veterinary clinic backend models and JSON API for Vetora, built on top of Odoo Community. It is the **single source of truth** for:

- Patients (animals)
- Visits / appointments
- Vaccinations (skeleton for later reminders)
- Services
- Doctors
- Locations
- Clinic and doctor schedules
- Blocking intervals

No separate backend (Node/FastAPI/etc.) is used. All business logic and validation live in Odoo.

---

## 2. Main Models

- `vet.pet`
  - Basic patient info: name, species, breed, sex, birth_date, microchip, active
  - Links: `owner_id` (client, `res.partner`), `visit_ids` (visits)
  - Extra MVP fields: `is_sterilized`, `alerts_short`

- `vet.visit`
  - Central object: **appointment + visit**
  - Links:
    - `pet_id` → `vet.pet`
    - `client_id` (readonly, stored) → `pet.owner_id`
    - `doctor_id` → `vet.doctor`
    - `service_id` → `vet.service`
    - `company_id` → `res.company`
    - `location_id` → `vet.location`
  - Time:
    - `start_at`, `duration_minutes`, `end_at`
    - `duration_minutes` must be **> 0** and a **multiple of 15**
  - Status:
    - `scheduled`, `confirmed`, `checked_in`, `in_consult`, `done`, `cancelled`, `no_show`, `rescheduled`
  - Source (Selection): `phone`, `reception`, `online`, `walk_in`, `internal`
  - Flags & meta: `is_urgent`, `notes`, `cancellation_reason`, `service_price_snapshot`
  - Lifecycle timestamps: `checked_in_at`, `in_consult_at`, `done_at`, `cancelled_at`, `no_show_at`
  - Re-scheduling links: `rescheduled_from_visit_id`, `rescheduled_to_visit_id`

- `vet.vaccination`
  - Skeleton for vaccinations: `pet_id`, `vaccine_type`, `date_administered`, `date_next`

- `vet.service`
  - Veterinary services catalog (NOT `product.template`):
    - `name`, `category`, `description_short`
    - `duration_minutes` (multiple of 15)
    - `default_price`, `color`, `active`
    - `requires_doctor`, `eligible_doctor_ids` (M2M `vet.doctor`)
    - `company_id`, optional `product_id` for invoicing

- `vet.doctor`
  - Operational doctors, separate from `res.users`:
    - `name`, `short_name`, `user_id` (optional), `specialization`
    - `calendar_color`, `active`
    - `company_id`, `location_id`
    - `service_ids` (M2M compatible services)

- `vet.location`
  - Clinic locations / points of care:
    - `name`, `company_id`, `tz` (timezone for validation), `active`

- `vet.schedule` and `vet.doctor.schedule`
  - Weekly schedules in **location timezone**:
    - `weekday` (0=Monday), `start_time`, `end_time` (floats, multiples of 15 minutes)
    - `company_id`, `location_id`, `active`
    - `vet.doctor.schedule` additionally links to `doctor_id`

- `vet.block`
  - Blocking intervals that override schedules:
    - `block_type` (leave, break, training, unavailable, manual, meeting)
    - `start_at`, `end_at`
    - `doctor_id` (optional), `location_id`, `company_id`
    - `reason`, `is_recurring` (flag only, recurrence engine not implemented yet), `active`

---

## 3. Validation Rules (Summary)

All critical validation lives in `vet.visit` and related models:

- **Duration**: `duration_minutes` > 0 and multiple of 15.
- **Ownership**: `pet_id` must have `owner_id`; `client_id` is readonly and must equal `pet.owner_id`.
- **Doctor & service**:
  - `doctor_id.active == True`
  - `service_id.active == True`
  - If `service.requires_doctor`, then `doctor_id` must be in `service.eligible_doctor_ids`.
- **Schedules**:
  - Visit must fit entirely within at least one `vet.schedule` interval for the clinic and location.
  - Visit must fit entirely within at least one `vet.doctor.schedule` interval for the doctor and location.
  - Schedule validation uses **location timezone** (or company calendar tz, or UTC), **never** the user timezone.
- **Blocks**:
  - Visit must not intersect any active `vet.block` matching company, location, and (doctor or global).
- **Overlap**:
  - For the same doctor/company/location, no overlapping visits are allowed for statuses:
    - `scheduled`, `confirmed`, `checked_in`, `in_consult`.
  - Statuses ignored for overlap: `done`, `cancelled`, `no_show`, `rescheduled`.
- **Status flow**:
  - Allowed transitions (simplified):
    - `scheduled → confirmed | checked_in | cancelled | no_show`
    - `confirmed → checked_in | cancelled | no_show`
    - `checked_in → in_consult | done | cancelled`
    - `in_consult → done | cancelled`
  - Terminal states: `done`, `cancelled`, `no_show`, `rescheduled` (no outgoing transitions).
- **Re-scheduling**:
  - `action_reschedule` allowed only from `scheduled` / `confirmed`.
  - Creates a **new** visit with status `scheduled` and new time/doctor/service/location as provided.
  - Old visit gets status `rescheduled` and links to the new one.
  - New visit runs full validation and snapshots current service price.

---

## 4. JSON API Endpoints

All endpoints are `type="json"`, `auth="user"`, and return either `ok/data` or `ok/error`.

### 4.1 Calendar

- **Day view**: `POST /vetora/json/calendar/day`
  - Input: `date`, optional `doctor_ids`, `company_id`, `location_id`.
  - Output: doctors, clinic_schedules, doctor_schedules, blocks, visits for that day.

- **Week view**: `POST /vetora/json/calendar/week`
  - Input: `date` (start), optional `doctor_ids`, `company_id`, `location_id`.
  - Output: same structures for a 7‑day window.

### 4.2 Visits

- **Create**: `POST /vetora/json/visit/create`
  - Required: `pet_id`, `doctor_id`, `service_id`, `start_at`, `duration_minutes`, `source`, `location_id`.
  - Optional: `company_id`, `is_urgent`, `notes`.

- **Update**: `POST /vetora/json/visit/update`
  - Required: `visit_id`.
  - Editable fields: `start_at`, `duration_minutes`, `doctor_id`, `service_id`, `location_id`, `is_urgent`, `notes`.

- **Reschedule**: `POST /vetora/json/visit/reschedule`
  - Required: `visit_id`, `new_start_at`.
  - Optional: `new_doctor_id`, `new_service_id`, `new_duration_minutes`, `new_location_id`, `new_notes`.
  - Output: `{ "old": visit, "new": visit }`.

- **Change status**: `POST /vetora/json/visit/status`
  - Required: `visit_id`, `action` ∈ {`confirm`, `check_in`, `in_consult`, `done`, `cancel`, `no_show`}.
  - Optional: `reason` (for `cancel`).

### 4.3 Blocks

- **Create block**: `POST /vetora/json/block/create`
  - Required: `block_type`, `start_at`, `end_at`.
  - Optional: `doctor_id`, `location_id`, `company_id`, `reason`.

### 4.4 Lookups

- `POST /vetora/json/lookup/doctors` — active doctors (optional `company_id`, `location_id`).
- `POST /vetora/json/lookup/services` — active services (optional `company_id`, `doctor_id`).
- `POST /vetora/json/lookup/patients` — search patients.
- `POST /vetora/json/lookup/clients` — search clients.
- `POST /vetora/json/detail/patient` — patient detail.
- `POST /vetora/json/detail/client` — client detail.

---

## 5. Error Handling

All API endpoints use a common error structure:

```json
{
  "ok": false,
  "error": {
    "code": "...",
    "message": "...",
    "details": { ... }
  }
}
```

`ValidationError` from models are mapped to stable error codes in `controllers/vetora_api.py`, e.g.:

- `OVERLAP_VISIT`
- `BLOCK_CONFLICT`
- `OUTSIDE_DOCTOR_SCHEDULE`
- `OUTSIDE_CLINIC_SCHEDULE`
- `INVALID_SERVICE_DOCTOR`
- `INVALID_DURATION`
- `INACTIVE_DOCTOR`
- `INACTIVE_SERVICE`
- `MISSING_PATIENT_OWNER`
- `INVALID_STATUS_TRANSITION`
- `INVALID_LOCATION`

---

## 6. Running Upgrades and Tests

From `E:\vetora\odoo` (with virtualenv active):

```bash
# Upgrade vetora_clinic in local DB
python odoo-bin -c odoo.conf -d vetora -u vetora_clinic

# Run tests for vetora_clinic (models + logic)
python odoo-bin -c odoo.conf -d vetora -u vetora_clinic --test-enable --stop-after-init
```

These commands assume the database is named `vetora` and `odoo.conf` is configured with the correct DB connection and addons path.

---

## 7. Out of Scope for MVP

The following are intentionally **not** implemented yet:

- Advanced medical record / full EMR.
- Complex room/resources scheduling.
- Recurring blocks engine (only a boolean flag exists).
- Automated reminders (email/SMS/WhatsApp) for vaccinations or visits.
- Client portal and self-service booking.
- Advanced analytics and reporting.
- Full front-end UI (the JSON API is ready for a custom frontend).

