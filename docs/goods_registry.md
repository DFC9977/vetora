## Modul: Colectare centralizată marfă din facturi

### Flux
1. **Catalog produse** (`/goods/catalog`) – se importă lista Excel a distribuitorului
   (coloane: `CATEGORIE`, `Cod INTERN`, `COD EAN`, `Denumire`, `Pret`, `TVA`, `COD VAMAL`).
   Re-importul actualizează produsele după `Cod INTERN`. `CATEGORIE` = producător.
2. **Încărcare facturi** (`/goods`) – PDF (unul sau mai multe). Se extrag automat:
   serie/număr, dată, emitent + CUI, cumpărător + CUI, linii (denumire, UM, cantitate,
   preț, TVA, lot, data expirării). Rândurile `Discount` se atașează produsului de deasupra
   (scad valoarea, nu cantitatea). Fiecare linie se potrivește cu catalogul
   (cod/EAN → denumire exactă → denumire aproximativă).
3. **Verificare** (`/goods/<id>`) – liniile se pot corecta manual, apoi **Confirmă**.
   Doar facturile confirmate intră în registru. Nr. factură + emitent duplicat este blocat.
4. **Registru centralizat** (`/goods/registry`) – cantități și valori nete agregate pe
   produs din catalog, plus sumar pe producător; filtre pe perioadă, producător, client,
   produs; export CSV.

### Extragere text
- PDF-uri generate electronic: `pypdf` (inclus în Odoo), fără dependențe noi.
- Scanări (imagine / PDF scanat): OCR opțional – necesită pe server `tesseract-ocr`
  (+ `tesseract-ocr-ron`), `pytesseract`, `Pillow`, și pentru PDF scanat `pdf2image` + `poppler-utils`.
  Fără acestea factura se creează goală și liniile se introduc manual.

### Cod
- `custom_addons/vetora_clinic/tools/invoice_extract.py` – extragere + parsare (Python pur, testabil separat).
- `models/vet_supplier_invoice.py` – `vet.supplier.invoice`, `vet.supplier.invoice.line`.
- `models/vet_goods_product.py` – `vet.goods.product` (catalog, import xlsx, potrivire).
- API: `/vetora/json/supplier_invoice/{upload,list,get,save,action,file}`,
  `/vetora/json/goods_registry`, `/vetora/json/goods_catalog/{import,list}`.
