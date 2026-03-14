"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/apiClient";
import type { ServiceSettings, DoctorSettings } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { useI18n } from "../../../components/I18nProvider";

export default function ServicesSettingsPage() {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceSettings[]>([]);
  const [doctors, setDoctors] = useState<DoctorSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<{
    name: string;
    category: string;
    duration_minutes: string;
    price: string;
    color: string;
    active: boolean;
    eligible_doctor_ids: number[];
  }>({
    name: "",
    category: "",
    duration_minutes: "30",
    price: "",
    color: "",
    active: true,
    eligible_doctor_ids: [],
  });
  const [formDirty, setFormDirty] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    const [sRes, dRes] = await Promise.all([
      api.listServicesSettings(),
      api.listDoctorsSettings(),
    ]);
    setLoading(false);
    if (!sRes.ok) {
      setError(mapApiErrorToMessage(sRes.error));
      setServices([]);
    } else {
      const list = Array.isArray(sRes.data?.services) ? sRes.data.services : [];
      setServices(list);
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    }
    if (dRes.ok) setDoctors(Array.isArray(dRes.data?.doctors) ? dRes.data.doctors : []);
  }

  useEffect(() => {
    const svc = services.find((s) => s.id === selectedId);
    if (!svc) {
      setForm({
        name: "",
        category: "",
        duration_minutes: "30",
        price: "",
        color: "",
        active: true,
        eligible_doctor_ids: [],
      });
      setFormDirty(false);
      return;
    }
    setForm({
      name: svc.name,
      category: svc.category ?? "",
      duration_minutes: String(svc.duration_minutes),
      price: svc.price != null ? String(svc.price) : "",
      color: svc.color != null ? String(svc.color) : "",
      active: svc.active,
      eligible_doctor_ids: svc.eligible_doctors.map((d) => d.id),
    });
    setFormDirty(false);
  }, [selectedId, services]);

  function updateForm<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormDirty(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError(t("settingsServices.nameRequired"));
      return;
    }
    const duration = parseInt(form.duration_minutes, 10);
    if (Number.isNaN(duration) || duration < 15 || duration % 15 !== 0) {
      setError(t("settingsServices.durationInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await api.saveServiceSettings({
      service: {
        id: selectedId ?? undefined,
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        duration_minutes: duration,
        price: form.price !== "" ? parseFloat(form.price) : undefined,
        color: form.color !== "" ? Number(form.color) : undefined,
        active: form.active,
        eligible_doctor_ids: form.eligible_doctor_ids,
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setSuccess(t("settingsServices.saveSuccess"));
    setFormDirty(false);
    if (res.data.service) {
      const saved = res.data.service;
      setSelectedId(saved.id);
      setServices((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        const without = arr.filter((s) => s.id !== saved.id);
        return [...without, saved];
      });
    }
    void load();
  }

  function createNew() {
    setSelectedId(null);
    setForm({
      name: "",
      category: "",
      duration_minutes: "30",
      price: "",
      color: "",
      active: true,
      eligible_doctor_ids: [],
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
              <h2 className="text-sm font-semibold">{t("settingsServices.listTitle")}</h2>
              <button type="button" onClick={createNew} className="text-xs text-sky-600 hover:underline">
                + {t("common.new")}
              </button>
            </div>
            <ul className="space-y-1 text-sm">
              {(services ?? []).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full rounded px-2 py-1 text-left ${selectedId === s.id ? "bg-sky-100 font-medium" : "hover:bg-slate-100"}`}
                  >
                    {s.name}
                  </button>
                </li>
              ))}
              {(services ?? []).length === 0 && (
                <li className="text-slate-500">{t("settingsServices.noServices")}</li>
              )}
            </ul>
          </div>

          <div className="flex-1 rounded border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">
              {selectedId ? t("settingsServices.editTitle") : t("settingsServices.newTitle")}
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block font-medium text-slate-700">
                  {t("settingsServices.name")} *
                </label>
                <input
                  type="text"
                  className="mt-1 w-full border px-2 py-1 input-field"
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value)}
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">{t("settingsServices.category")}</label>
                <input
                  type="text"
                  className="mt-1 w-full border px-2 py-1 input-field"
                  value={form.category}
                  onChange={(e) => updateForm("category", e.target.value)}
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">{t("settingsServices.duration")}</label>
                <input
                  type="number"
                  min={15}
                  step={15}
                  className="mt-1 w-24 rounded border px-2 py-1"
                  value={form.duration_minutes}
                  onChange={(e) => updateForm("duration_minutes", e.target.value)}
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">{t("settingsServices.price")}</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="mt-1 w-28 rounded border px-2 py-1"
                  value={form.price}
                  onChange={(e) => updateForm("price", e.target.value)}
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700">{t("settingsServices.color")}</label>
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
                <label htmlFor="active">{t("settingsServices.active")}</label>
              </div>
              <div>
                <label className="block font-medium text-slate-700">
                  {t("settingsServices.eligibleDoctors")}
                </label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {doctors.map((d) => (
                    <label key={d.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={form.eligible_doctor_ids.includes(d.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateForm("eligible_doctor_ids", [...form.eligible_doctor_ids, d.id]);
                          } else {
                            updateForm(
                              "eligible_doctor_ids",
                              form.eligible_doctor_ids.filter((id) => id !== d.id)
                            );
                          }
                        }}
                      />
                      <span>{d.short_name || d.name}</span>
                    </label>
                  ))}
                  {doctors.length === 0 && (
                    <span className="text-slate-500">{t("settingsServices.noDoctors")}</span>
                  )}
                </div>
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
