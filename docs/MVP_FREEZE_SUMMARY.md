## Vetora MVP – Freeze Summary (Release Candidate)

### 1. Scope MVP delivered

- **Calendar Day View**: main operational screen with 15-minute slots, columns per doctor, active/inactive slots, doctor/clinic schedules, visits, and blocks.
- **Calendar Week View**: 7-day view with doctors as rows, visits and blocks per doctor/day, and clinic blocks band.
- **Settings**: Program cabinet, Doctors, Services, Blocks, all editable from `/settings/...`.
- **Patients**: List and detail, including visit history and New visit action.
- **Clients**: List and detail, including associated patients and visit history.
- **Blocks**: Create/edit/delete blocks from Settings and Day View calendar, visible in both Day and Week views.

### 2. Supported flows

- **New visit**
  - Create visit from an active free slot in Day View (time axis or doctor column).
  - Create visit from patient detail (`New visit` button with patient preselected).
- **Change status**
  - Quick status actions from Visit detail modal: confirm, check-in, in consult, done, cancel, no-show.
- **Cancel**
  - Cancel visit from Visit detail modal (status action) with backend validation.
- **Reschedule**
  - Reschedule visit from Visit detail modal via Reschedule modal:
    - Change time on same day.
    - Move to another day.
    - Optionally change doctor.
- **Create / edit / delete block**
  - From Day View:
    - Create block directly from a slot (per doctor, prefilled start/end).
    - Edit/delete existing blocks via Block modal.
  - From Settings / Blocks:
    - List, filter by date/doctor, create, edit, delete blocks.
- **Settings management**
  - Program cabinet: manage weekly clinic intervals per weekday.
  - Doctors: manage doctor master data, eligible services, and standard schedules.
  - Services: manage service catalog (duration, price, eligible doctors).
  - Blocks: manage blocking intervals across doctors and days.

### 3. Short architecture

- **Backend (Odoo / `vetora_clinic`)**
  - Source of truth for models, business rules, validations, and JSON endpoints.
  - Exposes JSON controllers for calendar day/week, visits, status changes, rescheduling, lookups, detail views, settings, and blocks.
- **Frontend (Next.js + TypeScript, `vetora_front`)**
  - Custom reception UI (App Router, React components, local state with hooks).
  - Focused on calendar operations, quick actions, and simple settings screens.
- **Proxy layer**
  - Next.js route handler at `/api/odoo/[...path]` forwards JSON-RPC calls to Odoo.
  - Handles cookies/session, CORS, and error normalization.

### 4. Key endpoints used

- **Calendar / visits**
  - `/vetora/json/calendar/day`
  - `/vetora/json/calendar/week`
  - `/vetora/json/visit/create`
  - `/vetora/json/visit/update`
  - `/vetora/json/visit/reschedule`
  - `/vetora/json/visit/status`
- **Lookups / detail**
  - `/vetora/json/lookup/doctors`
  - `/vetora/json/lookup/services`
  - `/vetora/json/lookup/patients`
  - `/vetora/json/lookup/clients`
  - `/vetora/json/detail/patient`
  - `/vetora/json/detail/client`
- **Settings**
  - `/vetora/json/settings/clinic_schedule/get`
  - `/vetora/json/settings/clinic_schedule/save`
  - `/vetora/json/settings/doctors/list`
  - `/vetora/json/settings/doctors/save`
  - `/vetora/json/settings/services/list`
  - `/vetora/json/settings/services/save`
- **Blocks**
  - `/vetora/json/block/create`
  - `/vetora/json/block/list`
  - `/vetora/json/block/update`
  - `/vetora/json/block/delete`

All endpoints are consumed via the typed client in `lib/apiClient.ts` and the `ApiResponse<T>` contract.

### 5. Out of scope for MVP

- **Billing UI** in the custom frontend (invoicing remains in standard Odoo UI).
- **Advanced medical records** (full EMR, clinical notes, attachments, diagnostics).
- **Drag & drop** re-scheduling in the calendar (only modal-based move is supported).
- **Analytics / dashboards** beyond basic lists and calendar views.
- **Reminders / notifications** (SMS, email, WhatsApp, automated follow-ups).
- **Resources / rooms** and multi-resource scheduling.
- **Complex multi-owner / co-owner models** for patients.

### 6. Known limitations (non-blocking)

- **Single-location assumptions**
  - Limitation: Current UI assumes a single active location per deployment.
  - Impact: Multi-location setups require careful configuration on the Odoo side.
  - Workaround: Run MVP per clinic/location; extend models and filters in a later phase.
  - Phase: 2+

- **No drag & drop on calendar**
  - Limitation: Visits can only be moved via the Reschedule modal.
  - Impact: Slightly slower operator workflow for heavy rescheduling days.
  - Workaround: Use quick reschedule flow (detail modal → reschedule → save).
  - Phase: 2 (optional)

- **Limited patient/client attributes in UI**
  - Limitation: Only core identity + alert fields are exposed; no heavy clinical history.
  - Impact: Deep medical history still requires Odoo or later extensions.
  - Workaround: Use Odoo back-office for detailed medical records when needed.
  - Phase: 2+

- **Simple conflict feedback**
  - Limitation: Conflict errors (overlap, block, outside schedule) are reported as messages, not as visual overlays.
  - Impact: User must adjust and retry based on the message.
  - Workaround: Rely on error texts mapped via `mapApiErrorToMessage`.
  - Phase: 2 (richer UI for conflicts)

### 7. Phase 2 / backlog (high level)

- **Calendar UX**
  - Drag & drop for rescheduling within a day and across days.
  - Additional calendar views (e.g., multi-location, resource-based).
- **Clinical depth**
  - Extended patient and visit data (diagnoses, procedures, attachments).
  - Basic EMR views aligned with existing Odoo models.
- **Notifications / reminders**
  - SMS / email reminders for visits and vaccinations.
  - Follow-up tasks and recalls.
- **Reporting**
  - Simple dashboards (daily load, no-shows, service mix).
  - Export tools for management.
- **Multi-location / resources**
  - First-class support for multiple locations and rooms/resources in calendar.

