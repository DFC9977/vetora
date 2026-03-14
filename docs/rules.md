## Reguli de dezvoltare Vetora

### Separarea clară față de Odoo core

- **Nu se modifică niciodată Odoo core** (codul de bază Odoo).
- **Nu se modifică addon-urile standard Odoo** (doar se folosesc/extind prin modele și view-uri noi).

### Locația codului custom

- **Tot codul custom Vetora** trebuie să fie în directorul `custom_addons`.
- Addon-ul principal al proiectului este `custom_addons/vetora_clinic`.
- Nu se creează copii sau fork-uri locale ale modulelor standard Odoo.

### Modul de lucru și livrare

- **Task-urile se implementează incremental**, cu pași mici și clari.
- **Nu se adaugă funcționalități extra** care nu sunt cerute explicit pentru această etapă.
- **Nu se face refactor nesolicitat** în module sau fișiere care nu sunt legate direct de task.

### Dependințe și compatibilitate

- **Fără dependențe externe inutile** sau biblioteci care nu sunt necesare pentru MVP.
- Se folosesc doar module standard Odoo și addon-urile custom Vetora.
- Structura addon-urilor trebuie să rămână **simplă, curată și compatibilă cu Odoo Community**.

### Securitate și calitate

- Configurațiile de securitate (grupuri și acces) trebuie definite minim, dar corect, pentru dezvoltare.
- Orice logică avansată (reminders automate, integrare SMS, facturare automată, workflow complex) se adaugă doar în etape ulterioare clar definite.

