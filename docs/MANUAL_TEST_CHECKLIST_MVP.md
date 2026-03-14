## Vetora MVP – Manual Test Checklist

Use this checklist for structured manual QA of the MVP. Each test has an ID, short steps, and expected result.

---

### A. Authentication / Access

- **A-01 – Login to Odoo**
  - **Steps**: Start Odoo server; open the Vetora frontend (`http://localhost:3000`); log in via Odoo session (as configured).
  - **Expected**: Frontend loads without CORS/auth errors; calendar is accessible for an authenticated user.

---

### B. Calendar Day View (`/calendar`)

- **B-01 – Create visit from active slot**
  - **Steps**: Open `/calendar`; pick an active free slot in a doctor column; click the slot; complete New visit form (patient, service, doctor, time) and save.
  - **Expected**: Visit appears in the correct slot for the selected doctor; no backend validation errors when data is valid.

- **B-02 – Blocked slot does not open New visit**
  - **Steps**: Ensure a block exists that overlaps a time for a doctor; click inside the blocked area.
  - **Expected**: `NewVisitModal` does not open; block remains visible.

- **B-03 – Inactive slot does not open New visit**
  - **Steps**: Navigate to a time outside doctor/clinic schedule; click that slot.
  - **Expected**: `NewVisitModal` does not open; slot has distinct inactive styling.

- **B-04 – Click visit opens detail**
  - **Steps**: Click an existing visit card.
  - **Expected**: `VisitDetailModal` opens with patient, client, doctor, service, time, status, notes.

- **B-05 – Status: Confirm**
  - **Steps**: From `VisitDetailModal`, click **Confirm**.
  - **Expected**: Modal closes; visit status changes to `confirmed`; calendar refreshes.

- **B-06 – Status: Check-in**
  - **Steps**: From `VisitDetailModal`, click **Check-in**.
  - **Expected**: Status changes to `checked_in`; visit card updates color; no invalid transition error.

- **B-07 – Status: In consult**
  - **Steps**: From `VisitDetailModal`, click **In consult**.
  - **Expected**: Status changes to `in_consult`; color updates.

- **B-08 – Status: Done**
  - **Steps**: From `VisitDetailModal`, click **Done**.
  - **Expected**: Status becomes `done`; visit remains visible for the day.

- **B-09 – Status: Cancel**
  - **Steps**: From `VisitDetailModal`, click **Cancel**.
  - **Expected**: Status changes to `cancelled` when transition is allowed; errors are shown if backend blocks transition.

- **B-10 – Status: No-show**
  - **Steps**: From `VisitDetailModal`, click **No-show**.
  - **Expected**: Status becomes `no_show` only from allowed states; invalid transitions return clear error messages.

- **B-11 – Reschedule to another time same doctor**
  - **Steps**: Open `VisitDetailModal` → **Reschedule**; change time on the same date; submit.
  - **Expected**: Visit moves to new time slot for same doctor; old visit is handled according to backend reschedule rules; calendar refreshes.

- **B-12 – Reschedule to another doctor**
  - **Steps**: In `RescheduleVisitModal`, change doctor; keep valid time; submit.
  - **Expected**: Visit appears under new doctor at the selected time; no overlap or schedule errors for valid input.

- **B-13 – Create block from slot**
  - **Steps**: In Day View, pick an active free slot; click the small **Block** control; fill Block modal; save.
  - **Expected**: New block appears for that doctor and time; overlapping slots become non-bookable.

- **B-14 – Edit block**
  - **Steps**: Click an existing block card; adjust time or type; save.
  - **Expected**: Block updates; Day View re-renders with new interval.

- **B-15 – Delete block**
  - **Steps**: Open Block modal from an existing block; delete via **Delete**; confirm.
  - **Expected**: Block disappears from Day View; affected slots become free again.

- **B-16 – Filter by doctor**
  - **Steps**: Use doctor dropdown; select a specific doctor.
  - **Expected**: Only the chosen doctor column is displayed; visits/blocks match doctor.

- **B-17 – Filter by status**
  - **Steps**: Use status filter; choose `scheduled`, then `done`.
  - **Expected**: Only visits with the selected status are visible; others are hidden.

- **B-18 – Filter by service**
  - **Steps**: Use service filter; select a specific service.
  - **Expected**: Only visits for that service remain visible.

- **B-19 – Search by patient**
  - **Steps**: Type part of patient name in search; observe visit list.
  - **Expected**: Only visits with matching `pet_name` remain visible.

- **B-20 – Search by client**
  - **Steps**: Type part of client name in search.
  - **Expected**: Only visits with matching `client_name` remain visible.

- **B-21 – Search by phone**
  - **Steps**: Type client phone substring in search.
  - **Expected**: Only visits with matching `client_phone` remain visible.

- **B-22 – Reset filters**
  - **Steps**: Apply doctor, status, service filters and search; click **Reset**.
  - **Expected**: Filters and search clear to defaults; all doctors and visits for the day are visible again.

---

### C. Calendar Week View (`/calendar/week`)

- **C-01 – Page load**
  - **Steps**: Open `/calendar/week`.
  - **Expected**: Week grid renders with 7 days, doctor rows, and any existing visits/blocks.

- **C-02 – Week navigation**
  - **Steps**: Click **Previous week**, **This week**, **Next week**.
  - **Expected**: Date range label changes; data updates accordingly without errors.

- **C-03 – Click visit opens detail**
  - **Steps**: Click a visit button in Week View.
  - **Expected**: `VisitDetailModal` opens with correct visit data.

- **C-04 – Quick status from Week View**
  - **Steps**: From Week View, open detail modal and change status (e.g., Confirm).
  - **Expected**: Status updates; Week View refreshes and card reflects new status.

- **C-05 – Reschedule from Week View**
  - **Steps**: From Week View detail modal, open Reschedule; change time or doctor; submit.
  - **Expected**: Week data reloads; visit moves to correct doctor/day/time.

- **C-06 – Doctor blocks visible**
  - **Steps**: For a week with doctor-specific blocks, inspect doctor/day cells.
  - **Expected**: Doctor blocks are visible inside each cell, clearly marked as blocks.

- **C-07 – Clinic/general blocks visible**
  - **Steps**: For a week with clinic-level blocks (no doctor), inspect top band.
  - **Expected**: Clinic blocks band at top shows blocks grouped by day with type, reason, hours.

- **C-08 – Filter by doctor**
  - **Steps**: Change doctor filter from `All doctors` to a specific doctor.
  - **Expected**: Table still lists all doctors, but visits visible follow filter (only visits for selected doctor).

- **C-09 – Filter by status**
  - **Steps**: Apply status filter (e.g., `scheduled`).
  - **Expected**: Only visits with that status are shown in Week View.

- **C-10 – Filter by service**
  - **Steps**: Use service filter to select one service.
  - **Expected**: Only visits for that service remain visible.

- **C-11 – Search by patient / client / phone**
  - **Steps**: Use search input with patient name, client name, then phone fragment.
  - **Expected**: Visit list in Week View filters to those matching the term across patient, client, service, or phone.

- **C-12 – Reset filters**
  - **Steps**: Apply doctor/status/service/search; click **Reset**.
  - **Expected**: All filters cleared; full week data is visible again.

---

### D. Settings (`/settings/...`)

- **D-01 – Program load/save**
  - **Steps**: Open `/settings/program`; verify current weekly intervals; add a new interval; save; reload page.
  - **Expected**: Success message; added interval persists after reload; no validation errors for valid times.

- **D-02 – Doctor create**
  - **Steps**: Open `/settings/doctors`; click **+ New**; fill minimal fields (name, services, schedule); save.
  - **Expected**: New doctor appears in the doctor list and is available in calendar filters and New visit modal.

- **D-03 – Doctor update**
  - **Steps**: Select existing doctor; change specialization or schedule; save.
  - **Expected**: Changes persist; calendar Day/Week reflect new schedule for that doctor.

- **D-04 – Service create**
  - **Steps**: Open `/settings/services`; click **+ New**; fill required fields including duration multiple of 15; save.
  - **Expected**: New service appears in service list and in New visit modal; invalid durations are rejected with clear messages.

- **D-05 – Service update**
  - **Steps**: Edit an existing service (duration, price, eligible doctors); save.
  - **Expected**: Changes persist; only eligible doctors can be used for that service in visits.

- **D-06 – Block create/update/delete (Settings)**
  - **Steps**: Open `/settings/blocks`; set date/doctor; click **+ New block**; fill fields; create; edit same block; update; delete.
  - **Expected**: List updates accordingly; blocks also appear in Day/Week where applicable; invalid intervals show clear error messages.

---

### E. Patients (`/patients`, `/patients/[id]`)

- **E-01 – Patient list search**
  - **Steps**: Open `/patients`; search by patient name and/or owner.
  - **Expected**: List filters accordingly; each row links to patient detail.

- **E-02 – Patient history render**
  - **Steps**: Open `/patients/[id]` for a patient with visits.
  - **Expected**: History section lists visits (date/time, doctor, service, status, short notes) in reverse chronological order.

- **E-03 – Patient history empty state**
  - **Steps**: Open patient detail with no visit history.
  - **Expected**: History section shows clear message (e.g., “No visit history yet.”).

- **E-04 – New visit from patient detail**
  - **Steps**: On patient detail, click **New visit**; complete and save.
  - **Expected**: New visit is created for that patient; appears in Day View and history list after refresh.

---

### F. Clients (`/clients`, `/clients/[id]`)

- **F-01 – Client list search**
  - **Steps**: Open `/clients`; search by client name or phone.
  - **Expected**: List filters; each row links to client detail.

- **F-02 – Associated patients render**
  - **Steps**: Open `/clients/[id]` where client has patients.
  - **Expected**: Associated patients list shows each patient with species/breed and alert snippet; patient names link to `/patients/[id]`.

- **F-03 – Client history render**
  - **Steps**: On the same client detail, inspect History section.
  - **Expected**: List of visits (date/time, patient, doctor, service, status, short notes) with patient name clickable.

---

### G. Regression checks

- **G-01 – Day View still usable end-to-end**
  - **Steps**: Perform full cycle: create visit → confirm → check-in → in consult → done.
  - **Expected**: All transitions succeed where allowed; calendar refreshes correctly.

- **G-02 – Week View reflects Day changes**
  - **Steps**: Create/reschedule/cancel a visit in Day View; open Week View for same week.
  - **Expected**: Week View shows updated visit state and position.

- **G-03 – Blocks consistent between Settings and Day/Week**
  - **Steps**: Create or edit block in Settings; verify Day and Week reflect changes; then update from Day View.
  - **Expected**: All three areas (Settings, Day, Week) stay consistent without stale data.

