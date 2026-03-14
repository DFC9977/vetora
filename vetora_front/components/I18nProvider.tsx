"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

export type Language = "ro" | "hu";

type Messages = Record<string, any>;

const messages: Record<Language, Messages> = {
  ro: {
    appTitle: "Vetora Clinic",
    nav: {
      calendar: "Calendar",
      patients: "Pacienți",
      clients: "Clienți",
      settings: "Setări",
    },
    common: {
      loading: "Se încarcă...",
      save: "Salvează",
      cancel: "Anulează",
      delete: "Șterge",
      new: "Nou",
      none: "–",
      date: "Dată",
      doctor: "Doctor",
      service: "Serviciu",
      status: "Status",
      searchPlaceholder: "Caută pacient, client, telefon",
      successSaved: "Modificările au fost salvate.",
    },
    language: {
      ro: "RO",
      hu: "HU",
      label: "Limbă",
    },
    calendarDay: {
      title: "Calendar zi",
      today: "Astăzi",
      newVisit: "Programare nouă",
      allDoctors: "Toți doctorii",
      allServices: "Toate serviciile",
      allStatuses: "Toate statusurile",
      reset: "Resetează",
      blockShort: "Bloc",
    },
    calendarWeek: {
      title: "Calendar săptămână",
      previousWeek: "Săptămâna anterioară",
      thisWeek: "Săptămâna aceasta",
      nextWeek: "Săptămâna viitoare",
      clinicBlocks: "Blocări clinică",
      sidebar: {
        month: "Calendar lună",
        resources: "Doctori / resurse",
        schedule: "Program",
        scheduleDescription: "Programul exact este definit în setările de Program cabinet și Doctori.",
      },
    },
    newVisit: {
      title: "Programare nouă",
      date: "Dată",
      time: "Oră",
      clientSearch: "Client (proprietar)",
      clientPlaceholder: "Caută client după nume sau telefon",
      addClient: "Adaugă client",
      patientSearch: "Pacient (animal)",
      patientPlaceholder: "Nume sau proprietar",
      searchButton: "Caută",
      addPatient: "Adaugă pacient",
      serviceLabel: "Serviciu",
      servicePlaceholder: "Alege serviciul",
      urgent: "Urgent",
      notes: "Note",
      errorSelectPatientService: "Te rog selectează pacientul și serviciul.",
      errorSelectClientPatientService: "Te rog selectează clientul, pacientul și serviciul.",
      cancel: "Anulează",
      create: "Creează programarea",
      saving: "Se salvează...",
    },
    quickAddClient: {
      title: "Client nou",
      name: "Nume complet",
      namePlaceholder: "Nume și prenume",
      nameRequired: "Numele este obligatoriu.",
      phone: "Telefon",
      phonePlaceholder: "Telefon",
      email: "Email",
      emailPlaceholder: "Email (opțional)",
      saving: "Se salvează...",
    },
    quickAddPatient: {
      title: "Pacient nou",
      name: "Nume",
      namePlaceholder: "Numele animalului",
      nameRequired: "Numele este obligatoriu.",
      species: "Specie",
      breed: "Rasă (opțional)",
      gender: "Sex (opțional)",
      birthDate: "Data nașterii (opțional)",
      microchip: "Microcip (opțional)",
      notes: "Observații (opțional)",
      saving: "Se salvează...",
      speciesDog: "Câine",
      speciesCat: "Pisică",
      speciesOther: "Altele",
      genderMale: "Masculin",
      genderFemale: "Feminin",
      genderUnknown: "Necunoscut",
    },
    statusLabels: {
      scheduled: "Programat",
      confirmed: "Confirmat",
      checked_in: "Sosit",
      in_consult: "În consult",
      done: "Finalizat",
      cancelled: "Anulat",
      no_show: "Neprezentat",
      rescheduled: "Reprogramat",
    },
    visitDetail: {
      title: "Detaliu programare",
      patient: "Pacient",
      client: "Client",
      phone: "Telefon",
      doctor: "Doctor",
      service: "Serviciu",
      start: "Început",
      end: "Sfârșit",
      status: "Status",
      notes: "Note",
      confirm: "Confirmă",
      checkIn: "Check‑in",
      inConsult: "În consult",
      done: "Finalizat",
      cancel: "Anulează",
      noShow: "Neprezentat",
      reschedule: "Reprogramează",
    },
    reschedule: {
      title: "Reprogramează vizita",
      current: "Curent",
      newDate: "Dată nouă",
      newTime: "Oră început nouă",
      doctor: "Doctor",
      duration: "Durată",
      reschedule: "Reprogramează",
      cancel: "Anulează",
      dateTimeRequired: "Data și ora sunt obligatorii.",
    },
    block: {
      newTitle: "Blocare nouă",
      editTitle: "Editează blocarea",
      type: "Tip",
      start: "Început",
      end: "Sfârșit",
      doctor: "Doctor",
      reason: "Motiv",
      save: "Salvează",
      delete: "Șterge",
      cancel: "Anulează",
      typeLabels: {
        leave: "Concediu / liber",
        break: "Pauză",
        training: "Training",
        unavailable: "Indisponibil",
        manual: "Blocare manuală",
        meeting: "Ședință",
      },
    },
    settings: {
      title: "Setări",
      program: "Program cabinet",
      doctors: "Doctori",
      services: "Servicii",
      blocks: "Blocări",
      loading: "Se încarcă setările…",
    },
    settingsServices: {
      listTitle: "Servicii",
      newTitle: "Serviciu nou",
      editTitle: "Editează serviciul",
      name: "Denumire",
      nameRequired: "Denumirea serviciului este obligatorie.",
      category: "Categorie",
      duration: "Durată (minute, multiplu de 15)",
      durationInvalid: "Durata trebuie să fie un multiplu pozitiv de 15 minute.",
      price: "Preț",
      color: "Culoare (număr)",
      active: "Activ",
      eligibleDoctors: "Doctori eligibili",
      noServices: "Nu există servicii. Adaugă unul nou.",
      noDoctors: "Nu există doctori definiți.",
      saveSuccess: "Serviciul a fost salvat.",
    },
    patients: {
      listTitle: "Pacienți",
      detailTitle: "Detaliu pacient",
      historyTitle: "Istoric vizite",
      historyEmpty: "Nu există vizite pentru acest pacient.",
      newVisit: "Programare nouă",
      searchPlaceholder: "Caută pacient sau proprietar",
    },
    clients: {
      listTitle: "Clienți",
      detailTitle: "Detaliu client",
      associatedPatients: "Pacienți asociați",
      associatedPatientsEmpty: "Nu există pacienți asociați.",
      historyTitle: "Istoric vizite",
      historyEmpty: "Nu există vizite pentru acest client.",
      searchPlaceholder: "Caută client sau telefon",
    },
  },
  hu: {
    appTitle: "Vetora Klinika",
    nav: {
      calendar: "Naptár",
      patients: "Páciensek",
      clients: "Ügyfelek",
      settings: "Beállítások",
    },
    common: {
      loading: "Betöltés…",
      save: "Mentés",
      cancel: "Mégse",
      delete: "Törlés",
      new: "Új",
      none: "–",
      date: "Dátum",
      doctor: "Orvos",
      service: "Szolgáltatás",
      status: "Állapot",
      searchPlaceholder: "Keresés: páciens, ügyfél, telefon",
      successSaved: "Változtatások elmentve.",
    },
    language: {
      ro: "RO",
      hu: "HU",
      label: "Nyelv",
    },
    calendarDay: {
      title: "Napi naptár",
      today: "Ma",
      newVisit: "Új időpont",
      allDoctors: "Összes orvos",
      allServices: "Összes szolgáltatás",
      allStatuses: "Összes állapot",
      reset: "Visszaállítás",
      blockShort: "Blokk",
    },
    calendarWeek: {
      title: "Heti naptár",
      previousWeek: "Előző hét",
      thisWeek: "Aktuális hét",
      nextWeek: "Következő hét",
      clinicBlocks: "Klinikai blokkolások",
      sidebar: {
        month: "Havi naptár",
        resources: "Orvosok / erőforrások",
        schedule: "Rendelési idő",
        scheduleDescription: "A pontos rendelési idő a Rendelő program és az Orvosok beállításainál adható meg.",
      },
    },
    newVisit: {
      title: "Új időpont",
      date: "Dátum",
      time: "Idő",
      clientSearch: "Ügyfél (tulajdonos)",
      clientPlaceholder: "Ügyfél keresése név vagy telefon alapján",
      addClient: "Ügyfél hozzáadása",
      patientSearch: "Páciens (állat)",
      patientPlaceholder: "Név vagy tulajdonos",
      searchButton: "Keresés",
      addPatient: "Páciens hozzáadása",
      serviceLabel: "Szolgáltatás",
      servicePlaceholder: "Szolgáltatás kiválasztása",
      urgent: "Sürgős",
      notes: "Megjegyzés",
      errorSelectPatientService: "Kérjük, válasszon pácienst és szolgáltatást.",
      errorSelectClientPatientService: "Kérjük, válassza ki az ügyfelet, a pácienst és a szolgáltatást.",
      cancel: "Mégse",
      create: "Időpont létrehozása",
      saving: "Mentés...",
    },
    quickAddClient: {
      title: "Új ügyfél",
      name: "Teljes név",
      namePlaceholder: "Vezetéknév és keresztnév",
      nameRequired: "A név kötelező.",
      phone: "Telefon",
      phonePlaceholder: "Telefon",
      email: "Email",
      emailPlaceholder: "Email (opcionális)",
      saving: "Mentés...",
    },
    quickAddPatient: {
      title: "Új páciens",
      name: "Név",
      namePlaceholder: "Az állat neve",
      nameRequired: "A név kötelező.",
      species: "Faj",
      breed: "Fajta (opcionális)",
      gender: "Nem (opcionális)",
      birthDate: "Születési dátum (opcionális)",
      microchip: "Mikrocsipp (opcionális)",
      notes: "Megjegyzés (opcionális)",
      saving: "Mentés...",
      speciesDog: "Kutya",
      speciesCat: "Macska",
      speciesOther: "Egyéb",
      genderMale: "Hím",
      genderFemale: "Nőstény",
      genderUnknown: "Ismeretlen",
    },
    statusLabels: {
      scheduled: "Időpont foglalva",
      confirmed: "Megerősítve",
      checked_in: "Megérkezett",
      in_consult: "Vizsgálaton",
      done: "Befejezve",
      cancelled: "Lemondva",
      no_show: "Nem jelent meg",
      rescheduled: "Átütemezve",
    },
    visitDetail: {
      title: "Időpont részletei",
      patient: "Páciens",
      client: "Ügyfél",
      phone: "Telefon",
      doctor: "Orvos",
      service: "Szolgáltatás",
      start: "Kezdet",
      end: "Vége",
      status: "Állapot",
      notes: "Megjegyzés",
      confirm: "Megerősít",
      checkIn: "Bejelentkezés",
      inConsult: "Vizsgálaton",
      done: "Befejezve",
      cancel: "Lemondás",
      noShow: "Nem jött el",
      reschedule: "Átütemezés",
    },
    reschedule: {
      title: "Időpont átütemezése",
      current: "Jelenlegi",
      newDate: "Új dátum",
      newTime: "Új kezdési idő",
      doctor: "Orvos",
      duration: "Időtartam",
      reschedule: "Átütemez",
      cancel: "Mégse",
      dateTimeRequired: "A dátum és az idő kötelező.",
    },
    block: {
      newTitle: "Új blokk",
      editTitle: "Blokk szerkesztése",
      type: "Típus",
      start: "Kezdet",
      end: "Vége",
      doctor: "Orvos",
      reason: "Ok",
      save: "Mentés",
      delete: "Törlés",
      cancel: "Mégse",
      typeLabels: {
        leave: "Szabadság",
        break: "Szünet",
        training: "Képzés",
        unavailable: "Nem elérhető",
        manual: "Kézi blokk",
        meeting: "Meeting",
      },
    },
    settings: {
      title: "Beállítások",
      program: "Rendelő program",
      doctors: "Orvosok",
      services: "Szolgáltatások",
      blocks: "Blokkolások",
      loading: "Beállítások betöltése…",
    },
    settingsServices: {
      listTitle: "Szolgáltatások",
      newTitle: "Új szolgáltatás",
      editTitle: "Szolgáltatás szerkesztése",
      name: "Megnevezés",
      nameRequired: "A szolgáltatás neve kötelező.",
      category: "Kategória",
      duration: "Időtartam (perc, 15 többszöröse)",
      durationInvalid: "Az időtartamnak pozitív, 15-tel osztható számnak kell lennie.",
      price: "Ár",
      color: "Szín (szám)",
      active: "Aktív",
      eligibleDoctors: "Alkalmazható orvosok",
      noServices: "Nincsenek szolgáltatások. Hozzon létre egyet.",
      noDoctors: "Nincsenek orvosok definiálva.",
      saveSuccess: "A szolgáltatás mentve.",
    },
    patients: {
      listTitle: "Páciensek",
      detailTitle: "Páciens adatai",
      historyTitle: "Vizsgálati előzmények",
      historyEmpty: "Nincsenek vizsgálatok ehhez a pácienshez.",
      newVisit: "Új időpont",
      searchPlaceholder: "Keresés: páciens vagy tulajdonos",
    },
    clients: {
      listTitle: "Ügyfelek",
      detailTitle: "Ügyfél adatai",
      associatedPatients: "Kapcsolódó páciensek",
      associatedPatientsEmpty: "Nincsenek kapcsolódó páciensek.",
      historyTitle: "Vizsgálati előzmények",
      historyEmpty: "Nincsenek vizsgálatok ehhez az ügyfélhez.",
      searchPlaceholder: "Keresés: ügyfél vagy telefon",
    },
  },
};

type I18nContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const STORAGE_KEY = "vetora_lang";

function getNested(messagesForLang: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let current: any = messagesForLang;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return typeof current === "string" ? current : undefined;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("ro");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Language | null;
      if (stored === "ro" || stored === "hu") {
        setLangState(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  function setLang(next: Language) {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

  function t(key: string): string {
    const primary = getNested(messages[lang], key);
    if (primary) return primary;
    const fallback = getNested(messages.ro, key);
    return fallback ?? key;
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

