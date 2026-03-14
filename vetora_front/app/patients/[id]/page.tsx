"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/apiClient";
import type { PatientDetail, PatientVisitHistoryEntry, VetDoctor, VetService } from "../../../lib/types";
import { parseOdooDatetime } from "../../../lib/datetime";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { NewVisitModal, NewVisitContext } from "../../../components/NewVisitModal";
import { useI18n } from "../../../components/I18nProvider";

export default function PatientDetailPage() {
  const params = useParams();
  const patientId = Number(params?.id);
  const { t } = useI18n();

  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [doctors, setDoctors] = useState<VetDoctor[]>([]);
  const [services, setServices] = useState<VetService[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newVisitContext, setNewVisitContext] = useState<NewVisitContext | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId || Number.isNaN(patientId)) {
      setError("Invalid patient id.");
      setLoading(false);
      return;
    }
    void loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [pRes, dRes, sRes] = await Promise.all([
        api.detailPatient({ patient_id: patientId }),
        api.lookupDoctors({}),
        api.lookupServices({}),
      ]);

      if (!pRes.ok) {
        setError(mapApiErrorToMessage(pRes.error));
        setPatient(null);
      } else {
        setPatient(pRes.data);
      }

      if (dRes.ok) {
        setDoctors(dRes.data);
      }
      if (sRes.ok) {
        setServices(sRes.data);
      }
    } finally {
      setLoading(false);
    }
  }

  const selectedDoctor = useMemo(
    () => doctors.find((d) => d.id === selectedDoctorId),
    [doctors, selectedDoctorId],
  );

  function handleNewVisitClick() {
    if (!patient || !selectedDoctor) return;
    const now = new Date();
    const context: NewVisitContext = {
      doctor: selectedDoctor,
      start: now,
    };
    setNewVisitContext(context);
    setSuccess(null);
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => history.back()}
        className="text-xs text-sky-700 hover:underline"
      >
        ← {t("patients.listTitle")}
      </button>

      {loading && <div className="text-sm text-slate-500">{t("common.loading")}</div>}
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {success && !loading && !error && (
        <div className="text-sm text-green-700 border border-green-200 bg-green-50 px-3 py-2 rounded">
          {success}
        </div>
      )}

      {patient && (
        <div className="space-y-4">
          <div className="bg-white border rounded p-4 space-y-2">
            <h1 className="text-lg font-semibold">
              {t("patients.detailTitle")}: {patient.name}
            </h1>
            <div className="text-sm text-slate-700">
              <div>
                <span className="font-medium">Owner:</span> {patient.owner_name}
              </div>
              {patient.species && (
                <div>
                  <span className="font-medium">Species:</span> {patient.species}
                </div>
              )}
              {patient.breed && (
                <div>
                  <span className="font-medium">Breed:</span> {patient.breed}
                </div>
              )}
              {patient.gender && (
                <div>
                  <span className="font-medium">Gender:</span> {patient.gender}
                </div>
              )}
              {patient.birth_date && (
                <div>
                  <span className="font-medium">Birth date:</span> {patient.birth_date}
                </div>
              )}
              {patient.microchip && (
                <div>
                  <span className="font-medium">Microchip:</span> {patient.microchip}
                </div>
              )}
            </div>
            {patient.alerts_short && (
              <div className="mt-2 text-sm text-red-700 border border-red-200 bg-red-50 px-3 py-2 rounded">
              <span className="font-medium">Alert:</span> {patient.alerts_short}
              </div>
            )}
          </div>

          <div className="bg-white border rounded p-4 space-y-3 text-sm">
            <div className="font-semibold text-sm">{t("patients.newVisit")}</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="border rounded px-2 py-1 min-w-[200px]"
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Select doctor</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.short_name || d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleNewVisitClick}
                disabled={!selectedDoctor}
                className="px-3 py-1 rounded border bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {t("patients.newVisit")}
              </button>
            </div>
            {!doctors.length && (
              <div className="text-xs text-slate-500">
                {/* Text tehnic; lăsat în engleză pentru administrator */}
                No doctors available. Please configure at least one doctor in Vetora configuration.
              </div>
            )}
          </div>

          <div className="bg-white border rounded p-4 space-y-2">
            <h2 className="text-sm font-semibold">{t("patients.historyTitle")}</h2>
            {(patient.history ?? []).length > 0 ? (
              <ul className="space-y-2 text-sm">
                {(patient.history ?? []).map((entry: PatientVisitHistoryEntry) => {
                  const start = parseOdooDatetime(entry.start_at);
                  const dateStr = start.toLocaleDateString();
                  const timeStr = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
                  return (
                    <li key={entry.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{dateStr} {timeStr}</span>
                        <span className="text-slate-600">{entry.doctor_name}</span>
                        <span className="text-slate-600">{entry.service_name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase text-slate-700">{entry.status}</span>
                      </div>
                      {entry.short_notes && (
                        <div className="mt-1 text-slate-600">{entry.short_notes}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-slate-500">{t("patients.historyEmpty")}</p>
            )}
          </div>
        </div>
      )}

      {newVisitContext && patient && (
        <NewVisitModal
          context={newVisitContext}
          services={services}
          initialPatient={{
            id: patient.id,
            name: patient.name,
            owner_name: patient.owner_name,
            owner_id: patient.owner_id,
          }}
          onClose={() => setNewVisitContext(null)}
          onCreated={() => {
            setNewVisitContext(null);
            setSuccess(t("common.successSaved"));
          }}
        />
      )}
    </div>
  );
}

