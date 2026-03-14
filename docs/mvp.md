## MVP Vetora

MVP-ul Vetora se concentrează pe gestionarea de bază a activității unei clinici veterinare, fără funcționalități avansate sau automatizări complexe.

### Programări

- **Scop**: organizarea vizitelor în clinică pe baza programărilor.
- Se bazează pe modulul standard de programări/Calendar Odoo pentru a evita duplicarea funcționalităților.

### Pacient / animal (`vet.pet`)

- **Scop**: evidența pacienților (animale) tratați în clinică.
- Leagă fiecare animal de un proprietar (contact Odoo standard).
- Păstrează informațiile de bază despre animal (specie, rasă, sex, dată naștere, microcip, status activ).

### Vizită / consult (`vet.visit`)

- **Scop**: înregistrarea vizitelor și consultațiilor veterinare.
- Fiecare vizită este legată de un pacient și proprietar și, ulterior, de medic și programare.
- În MVP se pregătește doar scheletul modelului și al view-urilor, fără logică medicală complexă.

### Vaccinare + reminders (`vet.vaccination`)

- **Scop**: evidența vaccinărilor realizate pentru fiecare pacient.
- Se vor stoca informații precum tipul vaccinului, data administrării și data următoarei doze.
- În această etapă se definește doar structura de bază; reminders-urile automate și job-urile programate vor fi adăugate ulterior.

