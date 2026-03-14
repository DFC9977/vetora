"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/apiClient";
import type { DoctorSettings, ServiceSettings } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { useI18n } from "../../../components/I18nProvider";

const WEEKDAYS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

type ScheduleRow = { id?: number; weekday: number; start_time: string; end_time: string };

export default function DoctorsSettingsPage() {
  const { t } = useI18n();
  const [doctors, setDoctors] = useState<DoctorSettings[]>([]);
  const [services, setServices] = useState<ServiceSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<{
    name: string;
    short_name: string;
    specialization: string;
    color: string;
    active: boolean;
    service_ids: number[];
    schedules: ScheduleRow[];
  }>({
    name: "",
    short_name: "",
    specialization: "",
    color: "",
    active: true,
    service_ids: [],
    schedules: [],
  });
  const [formDirty, setFormDirty] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load(keepSelectedId?: number | null) {
    setLoading(true);
    setError(null);
    const [dRes, sRes] = await Promise.all([
      api.listDoctorsSettings(),
      api.listServicesSettings(),
    ]);
    setLoading(false);
    if (!dRes.ok) {
      setError(mapApiErrorToMessage(dRes.error));
      setDoctors([]);
    } else {
      const list = Array.isArray(dRes.data?.doctors) ? dRes.data.doctors : [];
      setDoctors(list);
      if (keepSelectedId !== undefined) {
        setSelectedId(keepSelectedId);
      } else if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    }
    if (sRes.ok) setServices(Array.isArray(sRes.data?.services) ? sRes.data.services : []);
  }

  useEffect(() => {
    const list = doctors ?? [];
    const doc = list.find((d) => d.id === selectedId);
    if (!doc) {
      // selectedId is null → "new" mode; reset form but preserve formDirty
      // so the Save button stays visible if the user already started typing.
      setForm({
        name: "",
        short_name: "",
        specialization: "",
        color: "",
        active: true,
        service_ids: [],
        schedules: [],
      });
      return;
    }
    setForm({
      name: doc.name,
      short_name: doc.short_name ?? "",
      specialization: doc.specialization ?? "",
      color: doc.color != null ? String(doc.color) : "",
      active: doc.active,
      service_ids: doc.services.map((s) => s.id),
      schedules: doc.schedules.map((s) => ({
        id: s.id,
        weekday: s.weekday,
        start_time: s.start_time,
        end_time: s.end_time,
      })),
    });
    setFormDirty(false);
  }, [selectedId, doctors]);

  function updateForm<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormDirty(true);
  }

  function updateSchedule(index: number, field: "start_time" | "end_time" | "weekday", value: string | number) {
    setForm((prev) => {
      const next = [...prev.schedules];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, schedules: next };
    });
    setFormDirty(true);
  }

  function addScheduleRow() {
    setForm((prev) => ({
      ...prev,
      schedules: [...prev.schedules, { weekday: 0, start_time: "09:00", end_time: "17:00" }],
    }));
    setFormDirty(true);
  }

  function removeScheduleRow(index: number) {
    setForm((prev) => ({
      ...prev,
      schedules: prev.schedules.filter((_, i) => i !== index),
    }));
    setFormDirty(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await api.saveDoctorSettings({
      doctor: {
        id: selectedId ?? undefined,
        name: form.name.trim(),
        short_name: form.short_name.trim() || undefined,
        specialization: form.specialization.trim() || undefined,
        color: form.color !== "" ? Number(form.color) : undefined,
        active: form.active,
        service_ids: form.service_ids,
        schedules: form.schedules.map((s) => ({
          id: s.id,
          weekday: s.weekday,
          start_time: s.start_time,
          end_time: s.end_time,
        })),
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setSuccess("Doctor saved.");
    setFormDirty(false);
    const savedId = res.data.doctor?.id ?? null;
    void load(savedId);
  }

  function createNew() {
    setSelectedId(null);
    setForm({
      name: "",
      short_name: "",
      specialization: "",
      color: "",
      active: true,
      service_ids: [],
      schedules: [],
    });
    setFormDirty(true);
  }

  return (
    <div className="space-y-4">
      {loading && <div className="text-sm text-slate-500">{t("settings.loading")}</div>}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}
      {success && (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div>
      )}

      {!loading && (
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="w-full rounded border bg-white p-4 sm:w-56">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("settings.doctors")}</h2>
              <button
                type="button"
                onClick={createNew}
                className="text-xs text-sky-600 hover:underline"
              >
                + {t("common.new")}
              </button>
            </div>
            <ul className="space-y-1 text-sm">
              {(doctors ?? []).map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={`w-full rounded px-2 py-1 text-left ${selectedId === d.id ? "bg-sky-100 font-medium" : "hover:bg-slate-100"}`}
                  >
                    {d.short_name || d.name}
                  </button>
                </li>
              ))}
              {(doctors ?? []).length === 0 && (
                <li className="text-slate-500">Nu există doctori definiți.</li>
              )}
            </ul>
          </div>

          <div className="flex-1 rounded border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">
              {selectedId ? "Editează doctor" : "Doctor nou"}
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block font-medium text-slate-700">Nume *</label>
                <input
                  type="text"
                  className="mt-1 w-full max-w-md rounded border px-2 py-1"
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value)}
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Nume scurt</label>
                <input
                  type="text"
                  className="mt-1 w-full max-w-md rounded border px-2 py-1"
                  value={form.short_name}
                  onChange={(e) => updateForm("short_name", e.target.value)}
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Specializare</label>
                <input
                  type="text"
                  className="mt-1 w-full max-w-md rounded border px-2 py-1"
                  value={form.specialization}
                  onChange={(e) => updateForm("specialization", e.target.value)}
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">Culoare (număr)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-24 rounded border px-2 py-1"
                  value={form.color}
                  onChange={(e) => updateForm("color", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => updateForm("active", e.target.checked)}
                />
                <label htmlFor="active">Active</label>
              </div>
              <div>
                <label className="block font-medium text-slate-700">Servicii eligibile</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={form.service_ids.includes(s.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateForm("service_ids", [...form.service_ids, s.id]);
                          } else {
                            updateForm(
                              "service_ids",
                              form.service_ids.filter((id) => id !== s.id)
                            );
                          }
                        }}
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                  {services.length === 0 && (
                    <span className="text-slate-500">Nu există servicii definite.</span>
                  )}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block font-medium text-slate-700">Program standard</label>
                  <button
                    type="button"
                    onClick={addScheduleRow}
                    className="text-xs text-sky-600 hover:underline"
                  >
                    + rând nou
                  </button>
                </div>
                <ul className="space-y-2">
                  {form.schedules.map((row, idx) => (
                    <li key={idx} className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded border px-2 py-1"
                        value={row.weekday}
                        onChange={(e) => updateSchedule(idx, "weekday", Number(e.target.value))}
                      >
                        {WEEKDAYS.map((w) => (
                          <option key={w.value} value={w.value}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="time"
                        className="rounded border px-2 py-1"
                        value={row.start_time}
                        onChange={(e) => updateSchedule(idx, "start_time", e.target.value)}
                      />
                      <span className="text-slate-500">–</span>
                      <input
                        type="time"
                        className="rounded border px-2 py-1"
                        value={row.end_time}
                        onChange={(e) => updateSchedule(idx, "end_time", e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => removeScheduleRow(idx)}
                        className="text-red-600 hover:underline"
                      >
                        Șterge
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {formDirty && (
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !form.name.trim()}
                  className="rounded border bg-sky-600 px-4 py-2 text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {saving ? `${t("common.save")}…` : t("common.save")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
