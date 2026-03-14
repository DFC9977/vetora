# Raport audit persistență – Vetora (UI → Next.js proxy → Odoo → DB)

## 1. Cauza comună

**Body-ul JSON al request-ului nu era întotdeauna disponibil în controller-ele Odoo `type='json'`.**

- Frontend-ul trimite JSON simplu: `{ "doctor": { ... } }`, **fără** envelope JSON-RPC (`params`).
- În unele versiuni/configurații Odoo, pentru rute `type='json'`, framework-ul populează `request.jsonrequest` doar când body-ul respectă formatul JSON-RPC (ex. `params`). Pentru body „plain”, `request.jsonrequest` poate rămâne gol sau incomplet.
- Rezultat: controller-ul primea `payload = {}`, nu crea/actualiza nimic în DB, dar putea returna 200 sau răspuns construit din input, iar UI-ul afișa succes. La refresh, GET citea din DB și datele „salvate” lipseau.

**Fix aplicat:** în `_json_payload()` s-a adăugat un **fallback**: dacă `request.jsonrequest` lipsește sau nu e dict, se citește body-ul raw din `request.httprequest.get_data(as_text=True)` și se parsează ca JSON. Astfel toate rutele care folosesc `_json_payload()` primesc întotdeauna exact ce a trimis clientul, indiferent de formatul body-ului.

---

## 2. Cauze specifice pe entități

| Entitate        | Comportament specific |
|-----------------|------------------------|
| **Program cabinet** | Deja folosea răspunsul din DB după save (`settings_clinic_schedule_get`). Problema era doar payload-ul gol la save → acum e rezolvat prin `_json_payload()`. |
| **Doctori**     | Pe lângă payload: după save (doctor nou), UI-ul pornea `load()` și seta `selectedId` din răspuns. Lista se actualiza doar când `load()` termina; exista potențial de race. Acum: după save, listă și `selectedId` se actualizează imediat din `res.data.doctor`, apoi se pornește `load()` pentru sincronizare cu DB. |
| **Servicii**    | Același pattern ca la doctori: actualizare listă + `selectedId` din `res.data.service` imediat după save, apoi `load()`. |
| **Blocări**     | Create/update/delete făceau deja create/write/unlink pe `vet.block` și răspunsul era din record. Problema era doar payload-ul la create/update → rezolvat prin `_json_payload()`. |

---

## 3. Fișiere modificate

### Frontend (`vetora_front`)

- **`app/settings/doctors/page.tsx`**  
  După save cu succes: dacă există `res.data.doctor`, se setează `selectedId(saved.id)` și se actualizează lista cu `setDoctors(prev => [...fără saved, saved])`, apoi se apelează `void load()`.

- **`app/settings/services/page.tsx`**  
  Același pattern: după save, `setSelectedId(saved.id)` și `setServices(prev => [...fără saved, saved])`, apoi `void load()`.

### Backend Odoo (`vetora_clinic`)

- **`controllers/vetora_api.py`**  
  În `_json_payload()`: fallback care citește body-ul raw din `request.httprequest.get_data(as_text=True)`, parsează JSON și returnează dict-ul (inclusiv suport pentru `params` JSON-RPC dacă există). Toate rutele care folosesc deja `_json_payload()` beneficiază automat.

---

## 4. Endpoint-uri implicate (contractul rămâne același)

| Entitate   | GET (list) | CREATE/SAVE | UPDATE | DELETE |
|-----------|------------|-------------|--------|--------|
| Program cabinet | `POST /vetora/json/settings/clinic_schedule/get` | `POST /vetora/json/settings/clinic_schedule/save` | (în save) | — |
| Doctori   | `POST /vetora/json/settings/doctors/list` | `POST /vetora/json/settings/doctors/save` (id lipsă = create) | (în save) | — |
| Servicii  | `POST /vetora/json/settings/services/list` | `POST /vetora/json/settings/services/save` (id lipsă = create) | (în save) | — |
| Blocări   | `POST /vetora/json/block/list` | `POST /vetora/json/block/create` | `POST /vetora/json/block/update` | `POST /vetora/json/block/delete` |

Nicio rută nouă; doar citirea corectă a body-ului la toate.

---

## 5. Contract API standardizat

- **Request:** `Content-Type: application/json`, body = obiect JSON (ex. `{ "doctor": { ... } }`). Nu e obligatoriu envelope JSON-RPC.
- **Răspuns succes:** `{ "ok": true, "data": ... }`. Pentru save/create/update, `data` conține reprezentarea **din DB** (după create/write), nu doar echo la payload.
- **Răspuns eroare:** `{ "ok": false, "error": { "code", "message", "details" } }`.
- **GET/list:** același `company_id` (și, unde e cazul, `location_id`) ca la save; domain-ul de search este același pentru request-ul de save (în același request) și pentru request-ul de refresh (următorul GET).

---

## 6. Testare manuală (pas cu pas)

1. **Doctor nou**  
   - Setări → Doctori → „+ Nou” → completează nume (și opțional restul) → Salvează.  
   - Verifică: mesaj „Doctor saved.”  
   - Refresh la pagină (F5).  
   - Verifică: doctorul apare în listă și poate fi selectat.  
   - În Odoo: **Setări tehnică** → **Baze de date** sau direct în modelul `vet.doctor`: recordul există și are `company_id` corect.

2. **Serviciu nou**  
   - Setări → Servicii → „+ Nou” → nume, durată etc. → Salvează.  
   - Refresh.  
   - Verifică: serviciul apare în listă.  
   - În Odoo: modelul `vet.service` conține recordul.

3. **Bloc nou**  
   - Calendar (sau ecranul unde se creează blocuri) → creează bloc (tip, interval, opțional doctor/locație).  
   - Refresh.  
   - Verifică: blocul apare în listă/calendar.  
   - În Odoo: `vet.block` conține recordul.

4. **Program cabinet**  
   - Setări → Program cabinet → modifică ore/zile sau adaugă interval → Salvează.  
   - Refresh.  
   - Verifică: programul afișat este cel salvat (ore, zile).  
   - În Odoo: `vet.schedule` conține rândurile corespunzătoare companiei/locației.

5. **Editări pe entități existente**  
   - Editează un doctor existent (ex. nume scurt) → Salvează → Refresh: modificarea rămâne.  
   - La fel pentru serviciu, bloc (update) și program cabinet.

6. **Verificare în DB**  
   - După fiecare „Salvează” și refresh, în Odoo (modele `vet.schedule`, `vet.doctor`, `vet.doctor.schedule`, `vet.service`, `vet.block`) înregistrările au `company_id` al companiei curente și sunt vizibile la GET cu același context.

---

## Regula de bază (reconfirmată)

**Odoo este sursa de adevăr.**  
- Orice create/update trebuie să persiste în DB.  
- Răspunsul la save/create/update este construit din datele reale din DB (după create/write).  
- Frontend-ul nu mimează succesul: afișează succes doar pe baza răspunsului backend și actualizează state-ul din `res.data`; la refresh, datele vin doar din GET către Odoo.
