"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/apiClient";
import type { ClinicScheduleEntry } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { useI18n } from "../../../components/I18nProvider";

const WEEKDAYS = [
  { value: 0, label: "Luni" },
  { value: 1, label: "Marți" },
  { value: 2, label: "Miercuri" },
  { value: 3, label: "Joi" },
  { value: 4, label: "Vineri" },
  { value: 5, label: "Sâmbătă" },
  { value: 6, label: "Duminică" },
];

type LocalSchedule = { id?: number; weekday: number; start_time: string; end_time: string };

function sortByWeekdayThenTime(local: LocalSchedule[]): { s: LocalSchedule; index: number }[] {
  return local
    .map((s, index) => ({ s, index }))
    .sort((a, b) => {
      if (a.s.weekday !== b.s.weekday) return a.s.weekday - b.s.weekday;
      return a.s.start_time.localeCompare(b.s.start_time);
    });
}

export default function ProgramCabinetPage() {
  const { t } = useI18n();
  const [schedules, setSchedules] = useState<ClinicScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const [local, setLocal] = useState<LocalSchedule[]>([]);

  const [addWeekday, setAddWeekday] = useState(0);
  const [addStart, setAddStart] = useState("09:00");
  const [addEnd, setAddEnd] = useState("17:00");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await api.getClinicSchedules({});
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setSchedules([]);
      setLocal([]);
      return;
    }
    const nextSchedules = res.data.schedules as ClinicScheduleEntry[];
    setSchedules(nextSchedules);
    setLocal(
      nextSchedules.map((s) => ({
        id: s.id,
        weekday: s.weekday,
        start_time: s.start_time,
        end_time: s.end_time,
      })),
    );
  }

  function updateRow(index: number, field: "start_time" | "end_time", value: string) {
    setLocal((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      void save(next);
      return next;
    });
  }

  function removeRow(index: number) {
    setLocal((prev) => {
      const next = prev.filter((_, i) => i !== index);
      void save(next);
      return next;
    });
  }

  function addInterval() {
    setLocal((prev) => {
      const next = [...prev, { weekday: addWeekday, start_time: addStart, end_time: addEnd }];
      void save(next);
      return next;
    });
  }

  async function save(nextLocal: LocalSchedule[]) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await api.saveClinicSchedules({
      schedules: nextLocal.map((s) => ({
        id: s.id,
        weekday: s.weekday,
        start_time: s.start_time,
        end_time: s.end_time,
      })),
    });
    setSaving(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setSaving(false);
      return;
    }

    // Actualizăm state-ul din răspunsul backend-ului ca să avem ID-uri reale (persistate în DB).
    const saved = (res.data?.schedules ?? []) as ClinicScheduleEntry[];
    setSchedules(saved);
    setLocal(
      saved.map((s) => ({
        id: s.id,
        weekday: s.weekday,
        start_time: s.start_time,
        end_time: s.end_time,
      })),
    );
    setSaving(false);
    setSuccess(t("common.successSaved"));
  }

  const sorted = sortByWeekdayThenTime(local);

  return (
    <div className="space-y-4">
      {loading && <div className="text-sm text-slate-500">{t("settings.loading")}</div>}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      {!loading && (
        <>
          <div className="rounded border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">{t("settings.program")} — interval nou</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded border px-2 py-1 text-sm"
                value={addWeekday}
                onChange={(e) => setAddWeekday(Number(e.target.value))}
              >
                {WEEKDAYS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                className="rounded border px-2 py-1 text-sm"
                value={addStart}
                onChange={(e) => setAddStart(e.target.value)}
              />
              <span className="text-slate-500">–</span>
              <input
                type="time"
                className="rounded border px-2 py-1 text-sm"
                value={addEnd}
                onChange={(e) => setAddEnd(e.target.value)}
              />
              <button
                type="button"
                onClick={addInterval}
                className="rounded border bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-700"
              >
                {t("common.save")}
              </button>
            </div>
          </div>

          <div className="rounded border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">Program pe zile</h2>
            {local.length === 0 ? (
              <p className="text-sm text-slate-500">Nu există intervale. Adaugă unul mai sus.</p>
            ) : (
              <ul className="space-y-3">
                {WEEKDAYS.map((w) => {
                  const dayEntries = sorted.filter((x) => x.s.weekday === w.value);
                  if (dayEntries.length === 0) return null;
                  return (
                    <li key={w.value}>
                      <span className="text-sm font-medium text-slate-700">{w.label}</span>
                      <ul className="mt-1 space-y-1 pl-4">
                        {dayEntries.map(({ s: entry, index: i }) => (
                          <li key={`${w.value}-${i}-${entry.start_time}`} className="flex items-center gap-2 text-sm">
                            <input
                              type="time"
                              className="w-28 rounded border px-1 py-0.5"
                              value={entry.start_time}
                              onChange={(e) => updateRow(i, "start_time", e.target.value)}
                            />
                            <span className="text-slate-500">–</span>
                            <input
                              type="time"
                              className="w-28 rounded border px-1 py-0.5"
                              value={entry.end_time}
                              onChange={(e) => updateRow(i, "end_time", e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => removeRow(i)}
                              className="text-red-600 hover:underline"
                            >
                              Șterge
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

        </>
      )}
    </div>
  );
}
