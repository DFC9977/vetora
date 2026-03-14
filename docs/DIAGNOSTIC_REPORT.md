# Raport diagnostic: date salvate din UI nu ajung în Odoo

**Cerință:** Verificare fără modificări. Simptom: datele salvate din UI nu persistă în Odoo; datele create direct în Odoo apar corect în UI.

---

## 1. Proxy Next.js (`app/api/odoo/[...path]/route.ts`)

### Cookie-uri din request către Odoo
- **Da.** Header-ul `cookie` este trimis la Odoo: `cookie: req.headers.get("cookie") ?? ""` (linia 27). Cookie-urile din request-ul incoming către Next.js sunt transmise către Odoo.

### Set-Cookie din răspunsul Odoo către browser
- **Nu.** Răspunsul proxy-ului construiește headers doar cu `Content-Type` (liniile 41–45). Nu se copiază niciun header din răspunsul Odoo (ex. `Set-Cookie`). Dacă Odoo trimite `Set-Cookie` pentru sesiune, acesta **nu** ajunge la browser. Sesiuinea ar putea să nu fie stabilită/corectă pentru request-uri făcute exclusiv prin proxy.

### Metode HTTP
- **Doar POST.** Există un singur handler: `export async function POST(...)`. Nu există handler pentru GET. Toate apelurile (read și write) trec prin POST; nu există diferență de tratament între read și write în proxy.

---

## 2. apiClient.ts

### Cum este detectată eroarea
- Se citește body-ul răspunsului ca JSON. Nu se verifică explicit `result.error` din envelope-ul JSON-RPC.
- Logica: (1) dacă există `parsed.result` și `inner.ok` → se returnează `inner` (deci se respectă `ok: true/false` din contractul nostru); (2) dacă există cheia `ok` în `parsed` → se returnează `parsed` as-is; (3) **altfel** → se returnează `{ ok: true, data: parsed }`.
- Eroarea bazată pe HTTP (non-2xx) apare doar în blocul `catch` după `JSON.parse` (ex. body invalid); în cazul unui body JSON valid nu se verifică `res.status` sau `res.ok`. Deci **nu** se folosește în mod explicit HTTP status code pentru a marca eroare atunci când body-ul este JSON valid.

### Cazuri în care răspuns Odoo cu `"error"` este tratat ca succes
- **Da, există.** Dacă Odoo returnează un răspuns JSON-RPC de eroare (ex. excepție neprinsă în controller), de forma `{ "jsonrpc": "2.0", "error": { "message": "...", "data": ... }, "id": ... }`, atunci:
  - `"result" in parsed` este false;
  - `"ok" in parsed` este false (există cheia `"error"`, nu `"ok"`);
  - se ajunge la ramura finală: `return { ok: true, data: parsed as T }`.
- Deci **răspunsul cu `error` din JSON-RPC este tratat ca succes** (`ok: true`), iar UI-ul poate afișa succes fără ca operația să fi reușit.

### Content-Type la mutații
- **Da.** Toate request-urile (inclusiv create/update) folosesc `requestJson`, care trimite `headers: { "Content-Type": "application/json" }` și `body: JSON.stringify(body ?? {})`. Mutațiile au `Content-Type: application/json`.

---

## 3. Controller Odoo (vetora_clinic) – visit_create și altele

### Try/except care returnează `{"ok": true}` la eșec
- **Nu.** În `visit_create` (și celelalte handlers verificate) la excepție se apelează `_json_error(...)`, care returnează `{"ok": False, "error": {...}}` cu status HTTP 400/403/500. Nu există ramură care să returneze `ok: true` în caz de eșec.

### env.cr.commit()
- **Nu** se apelează `env.cr.commit()`. Se lasă Odoo să gestioneze tranzacția (commit la final de request). Comportament corect.

### Validări care ridică excepții „silențios”
- Nu există validări care să înghită excepții. `ValidationError` și `AccessError` sunt prinse și convertite în `_json_error`. Orice altă excepție intră în `except Exception` și se returnează `_json_error("SERVER_ERROR", ...)`.

### Observație critică: payload la visit_*
- **`visit_create`** (linia 805): semnătura este `def visit_create(self, **payload):` și **nu** se folosește `_json_payload()`. Payload-ul vine doar din `**payload` (kwargs). La rute Odoo `type='json'`, dacă clientul trimite body JSON „plain” (fără envelope JSON-RPC cu `params`), framework-ul poate pasa body-ul ca prim argument pozițional; în acest caz **kwargs sunt goale** și `payload` este `{}`.
- La fel: **`visit_update`** (850), **`visit_reschedule`** (885), **`visit_change_status`** (923) – toate folosesc `**payload` fără `_json_payload()`.
- În schimb, **settings (schedule, doctors, services), blocks (create/list/update/delete), client/create, patient/create** folosesc `payload = {**_json_payload(), **kwargs}` și deci citesc corect body-ul.
- Consecință: pentru visit create/update/reschedule/status, dacă body-ul ajunge doar ca argument pozițional, controller-ul vede `payload == {}` → lipsește `visit_id` / câmpurile obligatorii → returnează eroare (ex. MISSING_FIELDS). **Datele nu sunt scrise în DB** pentru că controller-ul iese pe ramura de eroare înainte de create/write.

---

## 4. NewVisitModal și form de save

### După `api.createVisit(...)`
- Se verifică **`result.ok`**: `if (!res.ok) { setError(mapApiErrorToMessage(res.error)); return; }` (liniile 151–155). Eroarea este setată în state și se face `return`; nu se apelează `onCreated()`.
- Eroarea **este afișată** în UI: `{error && ( <div className="... text-red-600 ..."> {error} </div> )}` (liniile 171–174).

### Payload trimis
- Nu există `console.log` al payload-ului înainte de fetch în `NewVisitModal`. Payload-ul este construit în `handleSubmit` și trimis direct la `api.createVisit({ pet_id, doctor_id, service_id, start_at, duration_minutes, source, location_id, is_urgent, notes })`; nu este logat în consolă.

---

## 5. Loguri Odoo

- În **`E:\vetora\odoo\odoo.conf`** nu este setat `logfile`. Implicit, Odoo scrie logurile la **stdout/stderr** (în terminalul unde rulează `python odoo-bin -c ...`).
- Nu există un fișier de log fix (ex. `logfile = ...`) de verificat în proiect. Pentru erori legate de `/vetora/`, trebuie urmărit output-ul în consola unde rulează Odoo; acolo pot apărea Traceback-uri la excepții neprinse sau logate cu `_logger.exception(...)`.

---

## Rezumat: probleme identificate și cauze probabile

| # | Problemă | Cauză probabilă |
|---|----------|------------------|
| 1 | **Set-Cookie de la Odoo nu ajunge la browser** | Proxy-ul construiește răspunsul doar cu `Content-Type`; nu copiază header-ele din răspunsul Odoo (inclusiv `Set-Cookie`). Sesiuinea poate să nu fie setată/corectă când se folosește doar proxy-ul. |
| 2 | **Răspuns JSON-RPC cu `error` tratat ca succes** | În `apiClient.ts`, dacă body-ul este `{ "jsonrpc": "2.0", "error": {...}, "id": ... }` (fără `result` și fără `ok`), se ajunge la ramura `return { ok: true, data: parsed }`. UI-ul poate afișa succes chiar când Odoo a returnat eroare. |
| 3 | **Eroarea nu se bazează pe HTTP status** | Pentru body JSON valid, `requestJson` nu verifică `res.ok` sau `res.status`. Un 500 cu body JSON-RPC error poate fi interpretat ca succes conform logicii de mai sus. |
| 4 | **Visit create/update/reschedule/status nu citesc body-ul cu _json_payload()** | Controllerele `visit_create`, `visit_update`, `visit_reschedule`, `visit_change_status` folosesc doar `**payload`. Cu body JSON plain, payload-ul poate fi gol → MISSING_FIELDS / MISSING_VISIT_ID → **datele nu sunt scrise în DB**. Aceasta este cauza cea mai directă pentru „datele salvate din UI nu ajung în Odoo” la **vizite**. |
| 5 | **Fără log al payload-ului în UI la create visit** | În NewVisitModal nu există log în consolă al payload-ului înainte de fetch; debug-ul trebuie făcut din Network sau din proxy/Odoo. |

**Concluzie:** Pentru **vizite**, cauza cea mai probabilă este (4): endpoint-urile `visit_*` nu folosesc `_json_payload()`, deci primesc payload gol și returnează eroare înainte de create/write. Pentru **alte entități** (program, doctori, servicii, blocuri, client, pacient) controllerele folosesc deja `_json_payload()`; dacă și acolo datele nu persistă, trebuie verificate (1) sesiunea/cookie și (2) tratamentul răspunsurilor cu `error` în apiClient (2–3).
