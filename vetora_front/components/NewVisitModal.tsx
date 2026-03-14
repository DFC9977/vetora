"use client";

import { useState, useCallback } from "react";
import { api } from "../lib/apiClient";
import type { VetDoctor, VetPatient, VetClient, VetService } from "../lib/types";
import { toOdooDatetimeLocal } from "../lib/datetime";
import { mapApiErrorToMessage } from "../lib/errors";
import { useI18n } from "./I18nProvider";
import { QuickAddClientModal } from "./QuickAddClientModal";
import { QuickAddPatientModal } from "./QuickAddPatientModal";

export type NewVisitContext = {
  doctor: VetDoctor;
  start: Date;
};

type InitialPatient = {
  id: number;
  name: string;
  owner_name: string;
  owner_id?: number;
};

type Props = {
  context: NewVisitContext;
  services: VetService[];
  onClose: () => void;
  onCreated: () => void;
  initialPatient?: InitialPatient;
};

export function NewVisitModal({ context, services, onClose, onCreated, initialPatient }: Props) {
  const { t } = useI18n();
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<VetClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(
    initialPatient?.owner_id ?? null
  );
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<VetPatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(initialPatient?.id ?? null);
  const [serviceId, setServiceId] = useState<number | "">("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQuickAddClient, setShowQuickAddClient] = useState(false);
  const [showQuickAddPatient, setShowQuickAddPatient] = useState(false);

  const initialDateStr = context.start.toISOString().slice(0, 10);
  const initialTimeStr = context.start.toTimeString().slice(0, 5);
  const [dateStr, setDateStr] = useState(initialDateStr);
  const [timeStr, setTimeStr] = useState(initialTimeStr);

  function buildStartDate(): Date {
    const [year, month, day] = dateStr.split("-").map((v) => parseInt(v, 10));
    const [hour, minute] = timeStr.split(":").map((v) => parseInt(v, 10));
    const d = new Date();
    d.setFullYear(year || d.getFullYear());
    d.setMonth((month || 1) - 1);
    d.setDate(day || 1);
    d.setHours(hour || 0, minute || 0, 0, 0);
    return d;
  }

  const searchClients = useCallback(async () => {
    const res = await api.lookupClients({ query: clientQuery });
    if (res.ok) setClientResults(res.data);
    else setError(mapApiErrorToMessage(res.error));
  }, [clientQuery]);

  const searchPatients = useCallback(async () => {
    const payload = selectedClientId
      ? { query: patientQuery, owner_id: selectedClientId }
      : { query: patientQuery };
    const res = await api.lookupPatients(payload);
    if (res.ok) setPatientResults(res.data);
    else setError(mapApiErrorToMessage(res.error));
  }, [patientQuery, selectedClientId]);

  const clientList: VetClient[] = clientResults.slice();
  const patientList: { id: number; name: string; owner_name: string; owner_id: number }[] = (() => {
    const base = patientResults.map((p) => ({
      id: p.id,
      name: p.name,
      owner_name: p.owner_name,
      owner_id: p.owner_id,
    }));
    if (initialPatient && !base.find((p) => p.id === initialPatient.id)) {
      return [
        {
          id: initialPatient.id,
          name: initialPatient.name,
          owner_name: initialPatient.owner_name,
          owner_id: initialPatient.owner_id ?? 0,
        },
        ...base,
      ];
    }
    return base;
  })();

  const selectedPatient = patientList.find((p) => p.id === selectedPatientId);
  const selectedClientName =
    (selectedClientId && clientList.find((c) => c.id === selectedClientId)?.name) ??
    selectedPatient?.owner_name ??
    null;

  function handleClientSelected(patientOwnerId: number) {
    setSelectedClientId((prev) => (prev === patientOwnerId ? prev : patientOwnerId));
  }

  async function handleQuickAddClientSuccess(client: VetClient) {
    setSelectedClientId(client.id);
    setClientResults((prev) => (prev.some((c) => c.id === client.id) ? prev : [client, ...prev]));
    setShowQuickAddClient(false);
  }

  async function handleQuickAddPatientSuccess(patient: VetPatient) {
    setSelectedPatientId(patient.id);
    setSelectedClientId(patient.owner_id);
    setPatientResults((prev) =>
      prev.some((p) => p.id === patient.id) ? prev : [{ ...patient, owner_name: patient.owner_name ?? "" }, ...prev]
    );
    setShowQuickAddPatient(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatientId || !serviceId) {
      setError(t("newVisit.errorSelectClientPatientService"));
      return;
    }
    const service = services.find((s) => s.id === serviceId);
    const duration = service?.duration_minutes || 30;

    setSubmitting(true);
    setError(null);
    const startDate = buildStartDate();
    const res = await api.createVisit({
      pet_id: selectedPatientId,
      doctor_id: context.doctor.id,
      service_id: serviceId as number,
      start_at: toOdooDatetimeLocal(startDate),
      duration_minutes: duration,
      source: "manual",
      location_id: context.doctor.location_id || 1,
      is_urgent: isUrgent,
      notes: notes || undefined,
    });
    setSubmitting(false);

    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-full max-w-lg p-4 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-semibold text-sm">
            {t("newVisit.title")} – {context.doctor.short_name || context.doctor.name}
          </h2>
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </div>
        {error && (
          <div className="text-xs text-red-600 border border-red-200 bg-red-50 px-2 py-1 rounded">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs mb-1">{t("newVisit.date")}</label>
              <input
                type="date"
                className="border px-2 py-1 w-full input-field"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div className="w-24">
              <label className="block text-xs mb-1">{t("newVisit.time")}</label>
              <input
                type="time"
                className="border px-2 py-1 w-full input-field"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1">{t("newVisit.clientSearch")}</label>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
                className="border px-2 py-1 flex-1 min-w-0 input-field"
                placeholder={t("newVisit.clientPlaceholder")}
              />
              <button
                type="button"
                onClick={searchClients}
                className="px-3 py-1 border bg-white hover:bg-slate-50 text-xs input-field"
              >
                {t("newVisit.searchButton")}
              </button>
              <button
                type="button"
                onClick={() => setShowQuickAddClient(true)}
                className="px-3 py-1 border border-sky-600 text-sky-600 bg-white hover:bg-sky-50 text-xs input-field"
              >
                {t("newVisit.addClient")}
              </button>
            </div>
            {clientList.length > 0 && (
              <select
                className="mt-2 border px-2 py-1 w-full input-field"
                value={selectedClientId ?? ""}
                onChange={(e) =>
                  setSelectedClientId(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">{t("clients.listTitle")}</option>
                {clientList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` – ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs mb-1">{t("newVisit.patientSearch")}</label>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                className="border px-2 py-1 flex-1 min-w-0 input-field"
                placeholder={t("newVisit.patientPlaceholder")}
              />
              <button
                type="button"
                onClick={searchPatients}
                className="px-3 py-1 border bg-white hover:bg-slate-50 text-xs input-field"
              >
                {t("newVisit.searchButton")}
              </button>
              <button
                type="button"
                onClick={() => setShowQuickAddPatient(true)}
                disabled={!selectedClientId}
                className="px-3 py-1 border border-sky-600 text-sky-600 bg-white hover:bg-sky-50 text-xs input-field disabled:opacity-50 disabled:cursor-not-allowed"
                title={!selectedClientId ? t("newVisit.addPatient") : undefined}
              >
                {t("newVisit.addPatient")}
              </button>
            </div>
            {patientList.length > 0 && (
              <select
                className="mt-2 border px-2 py-1 w-full input-field"
                value={selectedPatientId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setSelectedPatientId(id);
                  const p = patientList.find((x) => x.id === id);
                  if (p?.owner_id) handleClientSelected(p.owner_id);
                }}
              >
                <option value="">{t("patients.listTitle")}</option>
                {patientList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} – {p.owner_name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs mb-1">{t("newVisit.serviceLabel")}</label>
            <select
              className="border px-2 py-1 w-full input-field"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">{t("newVisit.servicePlaceholder")}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={isUrgent}
                onChange={(e) => setIsUrgent(e.target.checked)}
              />
              {t("newVisit.urgent")}
            </label>
          </div>

          <div>
            <label className="block text-xs mb-1">{t("newVisit.notes")}</label>
            <textarea
              className="border px-2 py-1 w-full text-xs textarea-field"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 border bg-white hover:bg-slate-50 text-xs input-field"
            >
              {t("newVisit.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1 bg-sky-600 text-white text-xs hover:bg-sky-700 disabled:opacity-60 input-field"
            >
              {submitting ? t("newVisit.saving") : t("newVisit.create")}
            </button>
          </div>
        </form>
      </div>

      {showQuickAddClient && (
        <QuickAddClientModal
          onClose={() => setShowQuickAddClient(false)}
          onSuccess={handleQuickAddClientSuccess}
        />
      )}
      {showQuickAddPatient && selectedClientId && (
        <QuickAddPatientModal
          ownerId={selectedClientId}
          ownerName={selectedClientName ?? ""}
          onClose={() => setShowQuickAddPatient(false)}
          onSuccess={handleQuickAddPatientSuccess}
        />
      )}
    </div>
  );
}
