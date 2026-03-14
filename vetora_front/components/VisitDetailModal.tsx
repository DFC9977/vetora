"use client";

import { useState } from "react";
import { api } from "../lib/apiClient";
import type { VetVisit, VetDoctor } from "../lib/types";
import { mapApiErrorToMessage } from "../lib/errors";
import { parseOdooDatetime, formatTimeHM } from "../lib/datetime";
import { useI18n } from "./I18nProvider";

type VisitDetailModalProps = {
  open: boolean;
  visit: VetVisit | null;
  doctors: VetDoctor[];
  onClose: () => void;
  onChanged: () => void;
  onRescheduleRequested: (visit: VetVisit) => void;
};

const STATUS_ACTIONS: { key: string; label: string }[] = [
  { key: "confirm", label: "visitDetail.confirm" },
  { key: "check_in", label: "visitDetail.checkIn" },
  { key: "in_consult", label: "visitDetail.inConsult" },
  { key: "done", label: "visitDetail.done" },
  { key: "cancel", label: "visitDetail.cancel" },
  { key: "no_show", label: "visitDetail.noShow" },
];

export function VisitDetailModal({
  open,
  visit,
  doctors,
  onClose,
  onChanged,
  onRescheduleRequested,
}: VisitDetailModalProps) {
  const { t } = useI18n();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open || !visit) return null;

  const start = parseOdooDatetime(visit.start_at);
  const end = parseOdooDatetime(visit.end_at);

  async function runStatusAction(action: string) {
    setPendingAction(action);
    setError(null);
    const res = await api.changeVisitStatus({ visit_id: visit.id, action });
    setPendingAction(null);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    onChanged();
    onClose();
  }

  const doctor = doctors.find((d) => d.id === visit.doctor_id);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded border bg-white p-4 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("visitDetail.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-1 text-sm">
          <div>
            <span className="font-medium">{t("visitDetail.patient")}:</span> {visit.pet_name}
          </div>
          {visit.client_name && (
            <div>
              <span className="font-medium">{t("visitDetail.client")}:</span> {visit.client_name}
            </div>
          )}
          {visit.client_phone && (
            <div>
              <span className="font-medium">{t("visitDetail.phone")}:</span> {visit.client_phone}
            </div>
          )}
          <div>
            <span className="font-medium">{t("visitDetail.doctor")}:</span>{" "}
            {doctor?.short_name || visit.doctor_name}
          </div>
          <div>
            <span className="font-medium">{t("visitDetail.service")}:</span> {visit.service_name}
          </div>
          <div>
            <span className="font-medium">{t("visitDetail.start")}:</span>{" "}
            {start.toLocaleDateString()} {formatTimeHM(start)}
          </div>
          <div>
            <span className="font-medium">{t("visitDetail.end")}:</span>{" "}
            {end.toLocaleDateString()} {formatTimeHM(end)}
          </div>
          <div>
            <span className="font-medium">{t("visitDetail.status")}:</span> {t(
              `statusLabels.${visit.status}`,
            )}
          </div>
          {visit.notes && (
            <div>
              <span className="font-medium">{t("visitDetail.notes")}:</span> {visit.notes}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_ACTIONS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => void runStatusAction(a.key)}
              disabled={!!pendingAction}
              className="rounded border bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200 disabled:opacity-60"
            >
              {t(a.label)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onRescheduleRequested(visit)}
            className="rounded border bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-700"
          >
            {t("visitDetail.reschedule")}
          </button>
        </div>
      </div>
    </div>
  );
}

