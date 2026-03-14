## Arhitectură Vetora

Vetora este o aplicație pentru cabinete veterinare construită peste Odoo Community, folosind instalarea standard existentă în directorul `odoo`.

### Componente standard Odoo folosite

- **Contacts**: gestionarea proprietarilor de animale și a altor contacte.
- **Calendar**: programarea activităților interne și a consulturilor.
- **Appointments**: managementul programărilor, folosind modulul standard de programări Odoo.
- **Sales**: generarea de oferte și comenzi de vânzare legate de servicii veterinare.
- **Invoicing**: emiterea facturilor pe baza serviciilor și produselor vândute.

### Addon custom Vetora

- **Addon `vetora_clinic`** în `custom_addons/vetora_clinic`:
  - Conține modelele veterinare principale (`vet.pet`, `vet.visit`, `vet.vaccination`).
  - Conține view-urile, meniurile și regulile de acces specifice Vetora.
  - Folosește modelele standard Odoo (de ex. `res.partner`) pentru entități generale precum proprietarii.

### Separarea logicii veterinare

- **Nu se modifică Odoo core** sau modulele standard.
- Toată logica specifică domeniului veterinar este implementată doar în addon-urile custom din `custom_addons`.
- Addon-ul `vetora_clinic` extinde funcționalitățile Odoo prin modele și view-uri noi, păstrând compatibilitatea cu Odoo Community.

