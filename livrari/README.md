# Vetora Livrări

Aplicație pentru livrarea mărfii din facturi, **fără Odoo și fără logare**:

1. Se creează o **cursă** pentru ziua respectivă (dată, șofer, mașină).
2. Se **încarcă PDF-urile facturilor** emise în acea zi (mai multe deodată). Din fiecare factură se extrag
   automat: număr, dată, client, CUI, adresă de livrare, telefon, produse (cantitate, preț, lot, expirare,
   discount). O factură încărcată de două ori este refuzată.
3. **Listă încărcare** – totalul de încărcat din depozit pe fiecare produs (grupat pe producător), cu
   defalcarea pe clienți. Se tipărește și se bifează la încărcare – o singură încărcare pentru toate facturile.
4. **Evidența livrării**, pe fiecare factură (merge de pe telefon): *Livrat integral* / *Parțial – retur*
   (cantitate returnată pe produs + motiv: refuzat, deteriorat, lipsă la încărcare, produs greșit, altul
   + notă) / *Nelivrat* + notă de livrare. Ora livrării se salvează automat.
5. **Raport livrare** pe cursă și **Raport perioadă** (mai multe zile / un client): facturile duse și statusul
   lor, cantitățile încărcat / livrat / returnat pe produs, lista retururilor. Tipărire + export CSV.
6. **Catalog produse** – importul listei Excel (CATEGORIE, Cod INTERN, COD EAN, Denumire, Pret, TVA, COD VAMAL);
   produsele din facturi sunt potrivite automat cu catalogul (cod/EAN → denumire → denumire aproximativă).

## Instalare pe server (Docker)

Cerințe: Docker + Docker Compose.

```bash
git clone <repo> && cd vetora/livrari
docker compose up -d --build
```

Aplicația pornește pe `http://127.0.0.1:8000`. Datele (baza `livrari.db` + PDF-urile) sunt în `livrari/data/` –
**faceți backup la acest folder** (ex. zilnic cu `cron`).

Actualizare după modificări: `git pull && docker compose up -d --build`.

### Domeniul app.vetora.ro (HTTPS)

1. DNS: înregistrare `A` pentru `app.vetora.ro` către IP-ul serverului.
2. Reverse proxy către `127.0.0.1:8000`. Exemple:

**Caddy** (HTTPS automat) – `/etc/caddy/Caddyfile`:
```
app.vetora.ro {
    request_body {
        max_size 25MB
    }
    reverse_proxy 127.0.0.1:8000
}
```

**nginx** (+ `certbot --nginx -d app.vetora.ro` pentru certificat):
```nginx
server {
    server_name app.vetora.ro;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Fără logare – de știut
Aplicația este deschisă oricui are adresa (conține nume, adrese și telefoane de clienți). Dacă vreți totuși o
protecție simplă, completați `APP_USER` și `APP_PASSWORD` în `docker-compose.yml` și reporniți: browserul va
cere o singură dată utilizator/parolă (comună pentru toți).

## Instalare fără Docker

```bash
# interfața
cd livrari/web && npm ci && npm run build          # rezultă web/out
# serverul
cd ../server && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
DATA_DIR=/var/lib/vetora-livrari uvicorn app.main:app --host 127.0.0.1 --port 8000
```
(pentru pornire automată: un serviciu `systemd` cu comanda de mai sus.)

## Facturi scanate
PDF-urile generate electronic (ca facturile CityVet) sunt citite direct. Pentru scanări/poze este necesar OCR
(`tesseract-ocr`, `tesseract-ocr-ron`, `poppler-utils` + `pip install pytesseract pdf2image Pillow`); fără OCR,
factura se creează fără produse și acestea se pot adăuga manual din „Editează factura”.

## Dezvoltare
```bash
cd livrari/server && pip install -r requirements.txt pytest httpx && python -m pytest -q
uvicorn app.main:app --reload --port 8000           # API (+ /api/docs)
cd ../web && npm ci && npm run dev                   # interfața pe :3000, /api -> :8000
```

## Structură
- `server/app/invoice_extract.py` – extragerea textului din PDF și parsarea facturii.
- `server/app/services.py` – logica (curse, facturi, livrări, rapoarte, catalog), SQLite.
- `server/app/main.py` – API-ul HTTP (`POST /api/...`) + servirea interfeței.
- `web/` – interfața (Next.js, export static).
