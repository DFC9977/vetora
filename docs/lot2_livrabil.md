# LOT 2 – Livrabil UI Setări + History

## 1. Fișiere modificate și create

### Create
- `app/settings/layout.tsx` – layout comun Settings cu header și navigație internă (Program, Doctori, Servicii, Blocări)
- `app/settings/page.tsx` – redirect la `/settings/program`
- `app/settings/program/page.tsx` – pagină Program cabinet (listă intervale pe zile, add/edit/remove, save)
- `app/settings/doctors/page.tsx` – pagină Doctori (listă + formular create/edit)
- `app/settings/services/page.tsx` – pagină Servicii (listă + formular create/edit)
- `app/settings/blocks/page.tsx` – pagină Blocări (filtre date/doctor, listă, create/edit/delete)
- `docs/lot2_livrabil.md` – acest fișier

### Modificate
- `app/layout.tsx` – adăugat link „Settings” în nav
- `app/patients/[id]/page.tsx` – secțiune **History** (listă cronologică vizite, date/ora, doctor, serviciu, status, short_notes; empty: „No visit history yet.”)
- `app/clients/[id]/page.tsx` – secțiune **Associated patients** (listă cu link la `/patients/[id]`) și secțiune **History** (listă cronologică vizite cu patient_name, doctor_name, service_name, status, short_notes); înlocuit placeholder-ul „Associated patients not available in current API”

---

## 2. Pagini noi

| Rută | Descriere |
|------|-----------|
| `/settings` | Redirect la `/settings/program` |
| `/settings/program` | Program cabinet: intervale pe zile, add/remove/edit, save |
| `/settings/doctors` | Listă doctori, formular create/edit (name, short_name, specialization, color, active, services, schedules) |
| `/settings/services` | Listă servicii, formular create/edit (name, category, duration_minutes, price, color, active, eligible_doctor_ids) |
| `/settings/blocks` | Listă blocări (filtre date, doctor), create / edit / delete |

---

## 3. Componente noi

Nu s-au creat componente separate în `components/`. Logica este în paginile din `app/settings/...` și în secțiunile adăugate în `app/patients/[id]/page.tsx` și `app/clients/[id]/page.tsx`. Dacă se dorește refactor ulterior, se pot extrage de exemplu: `SettingsNav`, `ClinicScheduleEditor`, `DoctorSettingsForm`, `ServiceSettingsForm`, `BlockEditor`, `PatientHistoryList`, `ClientHistoryList`, `AssociatedPatientsList`.

---

## 4. Fluxuri UI care funcționează acum

- **Settings**
  - Navigare între Program / Doctori / Servicii / Blocări din header-ul Settings.
  - **Program**: încărcare intervale, add interval (zi + start/end), editare/remove pe rânduri, save (trimite lista completă); reset la ultimele date salvate.
  - **Doctori**: încărcare listă doctori + servicii; selectare doctor din listă; formular name, short_name, specialization, color, active, eligible services (checkboxes), schedules (zi + start/end, add/remove rânduri); create doctor nou; save.
  - **Servicii**: încărcare listă servicii + doctori; selectare serviciu; formular name, category, duration_minutes, price, color, active, eligible doctors; create serviciu nou; save.
  - **Blocări**: filtre date + doctor; listă blocări; buton New block; formular type, start, end, doctor, reason (și la edit: is_recurring); create / update / delete; refresh list după fiecare acțiune.
- **Patient detail** (`/patients/[id]`)
  - Secțiune **History**: listă vizite în ordine descrescătoare (dată/ora, doctor, serviciu, status, short_notes); empty state „No visit history yet.”; fluxul existent (date pacient, New visit) neschimbat.
- **Client detail** (`/clients/[id]`)
  - **Associated patients**: listă pacienți cu link către `/patients/[id]`; empty „No associated patients.”
  - **History**: listă vizite cu patient_name (link la pacient), doctor_name, service_name, status, short_notes; empty „No visit history yet.”; datele de contact și adresă rămân ca înainte.

---

## 5. Ce rămâne pentru LOT 3

- Week View
- Mutare complexă din calendar (modale quick action, etc.)
- Refactor/îmbunătățiri majore în calendar (fără schimbări de scope în LOT 2)
- Posibil: componente reutilizabile extrase din paginile Settings (opțional)

---

## 6. Checklist testare manuală

- [ ] **Settings – Program**: deschidere `/settings/program`, încărcare intervale; add interval (zi + ore); editare start/end; remove interval; Save → verificare că datele rămân după refresh; Reset anulează modificările nesalvate.
- [ ] **Settings – Doctori**: deschidere `/settings/doctors`; selectare doctor din listă, modificare câmpuri (name, short_name, services, schedules); Save → date actualizate; + New → formular gol, completare, Save → doctor nou apare în listă.
- [ ] **Settings – Servicii**: deschidere `/settings/services`; selectare serviciu, modificare (name, duration_minutes, eligible doctors etc.); Save; + New → serviciu nou, Save.
- [ ] **Settings – Blocări**: deschidere `/settings/blocks`; alegere dată și eventual doctor; listă blocări; + New block → completare type, start, end, doctor, reason → Create → blocă nouă în listă; Edit pe o blocare → modificare → Update; Delete → confirmare → blocă dispare.
- [ ] **Patient detail – History**: deschidere `/patients/[id]` pentru un pacient cu vizite; secțiunea History afișează listă cronologică (dată, oră, doctor, serviciu, status, notițe); pentru pacient fără vizite: „No visit history yet.”
- [ ] **Client detail – Associated patients**: deschidere `/clients/[id]`; secțiunea Associated patients listează pacienții cu link către fișa pacientului; click pe link → `/patients/[id]`.
- [ ] **Client detail – History**: secțiunea History afișează vizitele clientului (dată, oră, pacient cu link, doctor, serviciu, status, notițe); empty state când nu există vizite.
