"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/apiClient";
import type { VetDoctor, VetVisit } from "../lib/types";
import { mapApiErrorToMessage } from "../lib/errors";
import { parseOdooDatetime, toOdooDatetimeLocal } from "../lib/datetime";
import { useI18n } from "../components/I18nProvider";

type RescheduleVisitModalProps = {
  open: boolean;
  visit: VetVisit | null;
  doctors: VetDoctor[];
  onClose: () => void;
  onRescheduled: () => void;
};

export function RescheduleVisitModal({ open, visit, doctors, onClose, onRescheduled }: RescheduleVisitModalProps) {
  const { t } = useI18n();
  const [dateStr, setDateStr] = useState<string>("");
  const [timeStr, setTimeStr] = useState<string>("");
  const [doctorId, setDoctorId] = useState<number | "same">("same");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visit) return;
    const start = parseOdooDatetime(visit.start_at);
    const pad = (n: number) => n.toString().padStart(2, "0");
    setDateStr(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
    setTimeStr(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
    setDoctorId("same");
  }, [visit]);

  if (!open || !visit) return null;

  const durationMinutes = (parseOdooDatetime(visit.end_at).getTime() - parseOdooDatetime(visit.start_at).getTime()) / 60000;

  async function submit() {
    if (!dateStr || !timeStr) {
      setError(t("reschedule.dateTimeRequired"));
      return;
    }
    const newStart = toOdooDatetimeLocal(new Date(`${dateStr}T${timeStr}:00`));
    setPending(true);
    setError(null);
    const payload: any = {
      visit_id: visit.id,
      new_start_at: newStart,
      new_duration_minutes: durationMinutes,
    };
    if (doctorId !== "same") {
      payload.new_doctor_id = doctorId;
    }
    const res = await api.rescheduleVisit(payload);
    setPending(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    onRescheduled();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded border bg-white p-4 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("reschedule.title")}</h2>
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
        <div className="space-y-3 text-sm">
          <div>
            <span className="font-medium">{t("reschedule.current")}:</span>{" "}
            {visit.start_at} → {visit.end_at}
          </div>
          <div>
            <label className="block font-medium text-slate-700">{t("reschedule.newDate")}</label>
            <input
              type="date"
              className="mt-1 rounded border px-2 py-1"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">{t("reschedule.newTime")}</label>
            <input
              type="time"
              className="mt-1 rounded border px-2 py-1"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">{t("reschedule.doctor")}</label>
            <select
              className="mt-1 rounded border px-2 py-1"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value === "same" ? "same" : Number(e.target.value))}
            >
              <option value="same">Keep current ({visit.doctor_name})</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.short_name || d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-slate-500">Duration: {durationMinutes} minutes.</div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            className="rounded border bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {pending ? `${t("reschedule.reschedule")}…` : t("reschedule.reschedule")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            {t("reschedule.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

