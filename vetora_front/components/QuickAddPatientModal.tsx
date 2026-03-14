"use client";

import { useState } from "react";
import { api } from "../lib/apiClient";
import type { VetPatient } from "../lib/types";
import { mapApiErrorToMessage } from "../lib/errors";
import { useI18n } from "./I18nProvider";

type Props = {
  ownerId: number;
  ownerName: string;
  onClose: () => void;
  onSuccess: (patient: VetPatient) => void;
};

export function QuickAddPatientModal({ ownerId, ownerName, onClose, onSuccess }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [species, setSpecies] = useState<string>("dog");
  const [breed, setBreed] = useState("");
  const [gender, setGender] = useState<string>("unknown");
  const [birthDate, setBirthDate] = useState("");
  const [microchip, setMicrochip] = useState("");
  const [alertsShort, setAlertsShort] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("quickAddPatient.nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    const res = await api.createPatient({
      owner_id: ownerId,
      name: trimmedName,
      species: species || "dog",
      breed: breed.trim() || undefined,
      gender: gender || undefined,
      birth_date: birthDate.trim() || undefined,
      microchip: microchip.trim() || undefined,
      alerts_short: alertsShort.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    onSuccess(res.data as VetPatient);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" aria-modal="true" role="dialog">
      <div className="bg-white rounded shadow-lg w-full max-w-md p-4 space-y-3">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold text-sm">{t("quickAddPatient.title")} – {ownerName}</h3>
          <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </div>
        {error && (
          <div className="text-xs text-red-600 border border-red-200 bg-red-50 px-2 py-1 rounded">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <div>
            <label className="block text-xs mb-1">{t("quickAddPatient.name")} *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border px-2 py-1 w-full input-field"
              placeholder={t("quickAddPatient.namePlaceholder")}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs mb-1">{t("quickAddPatient.species")}</label>
            <select
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              className="border px-2 py-1 w-full input-field"
            >
              <option value="dog">{t("quickAddPatient.speciesDog")}</option>
              <option value="cat">{t("quickAddPatient.speciesCat")}</option>
              <option value="other">{t("quickAddPatient.speciesOther")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1">{t("quickAddPatient.breed")}</label>
            <input
              type="text"
              value={breed}
              onChange={(e) => setBreed(e.target.value)}
              className="border px-2 py-1 w-full input-field"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">{t("quickAddPatient.gender")}</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="border px-2 py-1 w-full input-field"
            >
              <option value="unknown">{t("quickAddPatient.genderUnknown")}</option>
              <option value="male">{t("quickAddPatient.genderMale")}</option>
              <option value="female">{t("quickAddPatient.genderFemale")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1">{t("quickAddPatient.birthDate")}</label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="border px-2 py-1 w-full input-field"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">{t("quickAddPatient.microchip")}</label>
            <input
              type="text"
              value={microchip}
              onChange={(e) => setMicrochip(e.target.value)}
              className="border px-2 py-1 w-full input-field"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">{t("quickAddPatient.notes")}</label>
            <input
              type="text"
              value={alertsShort}
              onChange={(e) => setAlertsShort(e.target.value)}
              className="border px-2 py-1 w-full input-field"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 border bg-white hover:bg-slate-50 text-xs input-field"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1 bg-sky-600 text-white text-xs hover:bg-sky-700 disabled:opacity-60 input-field"
            >
              {saving ? t("quickAddPatient.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
