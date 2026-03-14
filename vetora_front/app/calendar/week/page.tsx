"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/apiClient";
import type { CalendarWeekData, VetBlock, VetDoctor, VetService, VetVisit } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { VisitDetailModal } from "../../../components/VisitDetailModal";
import { RescheduleVisitModal } from "../../../components/RescheduleVisitModal";
import { parseOdooDatetime, formatTimeHM } from "../../../lib/datetime";
import { useI18n } from "../../../components/I18nProvider";

type StatusFilter = "all" | "scheduled" | "confirmed" | "checked_in" | "in_consult" | "done";

export default function WeekCalendarPage() {
  const { t } = useI18n();
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [monthView, setMonthView] = useState<Date>(() => new Date());
  const [data, setData] = useState<CalendarWeekData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDoctorId, setSelectedDoctorId] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [services, setServices] = useState<VetService[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [lookupDoctors, setLookupDoctors] = useState<VetDoctor[]>([]);

  const [selectedVisit, setSelectedVisit] = useState<VetVisit | null>(null);
  const [rescheduleVisit, setRescheduleVisit] = useState<VetVisit | null>(null);

  useEffect(() => {
    void loadWeek();
  }, [date]);

  useEffect(() => {
    // Keep mini-calendar anchored around the currently selected date.
    setMonthView(new Date(date));
  }, [date]);

  useEffect(() => {
    void loadServices();
  }, []);

  useEffect(() => {
    void loadDoctorsFallback();
  }, []);

  async function loadWeek() {
    setLoading(true);
    setError(null);
    const res = await api.calendarWeek({ date });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setData(null);
      return;
    }
    setData(res.data);
  }

  async function loadServices() {
    const res = await api.lookupServices({});
    if (res.ok) {
      const raw: any = res.data;
      const list: VetService[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.services)
          ? (raw.services as VetService[])
          : [];
      setServices(list);
    }
  }

  async function loadDoctorsFallback() {
    const res = await api.lookupDoctors({});
    if (res.ok) {
      const raw: any = res.data;
      const list: VetDoctor[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.doctors)
          ? (raw.doctors as VetDoctor[])
          : [];
      setLookupDoctors(list);
    }
  }

  function changeWeek(offsetDays: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + offsetDays);
    setDate(d.toISOString().slice(0, 10));
  }

  const days = useMemo(() => {
    if (!data || !data.start_date) return [];
    const start = new Date(data.start_date);
    if (Number.isNaN(start.getTime())) return [];
    const result: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      result.push(d);
    }
    return result;
  }, [data]);

  const filteredVisits = useMemo(() => {
    if (!data || !Array.isArray((data as any).visits)) return [];
    const q = searchQuery.trim().toLowerCase();
    const visits = (data as any).visits as VetVisit[];
    return visits.filter((v) => {
      if (selectedDoctorId !== "all" && v.doctor_id !== selectedDoctorId) return false;
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (selectedServiceId !== "all" && v.service_id !== selectedServiceId) return false;
      if (q) {
        const haystack = [v.pet_name, v.client_name, v.service_name, v.client_phone ?? ""]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data, selectedDoctorId, statusFilter, searchQuery]);

  const visitsByDoctorAndDay = useMemo(() => {
    const map = new Map<number, Map<string, VetVisit[]>>();
    for (const v of filteredVisits) {
      const start = parseOdooDatetime(v.start_at);
      const dayKey = start.toISOString().slice(0, 10);
      let byDay = map.get(v.doctor_id);
      if (!byDay) {
        byDay = new Map();
        map.set(v.doctor_id, byDay);
      }
      const arr = byDay.get(dayKey) || [];
      arr.push(v);
      arr.sort((a, b) => a.start_at.localeCompare(b.start_at));
      byDay.set(dayKey, arr);
    }
    return map;
  }, [filteredVisits]);

  const doctors: VetDoctor[] =
    (data && Array.isArray((data as any).doctors) && (data as any).doctors.length
      ? ((data as any).doctors as VetDoctor[])
      : lookupDoctors) ?? [];
  const blocks: VetBlock[] = data?.blocks ?? [];

  const clinicBlocksByDay = useMemo(() => {
    const map = new Map<string, VetBlock[]>();
    for (const d of days) {
      map.set(d.toISOString().slice(0, 10), []);
    }
    for (const b of blocks) {
      if (b.doctor_id) continue;
      const dayKey = b.start_at.slice(0, 10);
      if (!map.has(dayKey)) continue;
      const arr = map.get(dayKey)!;
      arr.push(b);
    }
    return map;
  }, [blocks, days]);

  const monthDays = useMemo(() => {
    const firstOfMonth = new Date(
      monthView.getFullYear(),
      monthView.getMonth(),
      1,
    );
    const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday=0
    const daysInMonth = new Date(
      monthView.getFullYear(),
      monthView.getMonth() + 1,
      0,
    ).getDate();

    const cells: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(monthView.getFullYear(), monthView.getMonth(), d));
    }
    while (cells.length % 7 !== 0) {
      cells.push(null);
    }
    return cells;
  }, [monthView]);

  const selectedDateObj = useMemo(() => new Date(date), [date]);

  return (
    <div className="flex gap-3">
      <aside className="w-64 rounded border bg-white px-3 py-3 space-y-4 text-xs">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-sm">{t("calendarWeek.sidebar.month")}</div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  const d = new Date(monthView);
                  d.setMonth(d.getMonth() - 1);
                  setMonthView(d);
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => {
                  const d = new Date(monthView);
                  d.setMonth(d.getMonth() + 1);
                  setMonthView(d);
                }}
              >
                ›
              </button>
            </div>
          </div>
          <div className="text-[11px] text-slate-700 mb-1">
            {monthView.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-[10px] text-center">
            {["L", "Ma", "Mi", "J", "V", "S", "D"].map((d) => (
              <div key={d} className="text-slate-500 mb-0.5">
                {d}
              </div>
            ))}
            {monthDays.map((cell, idx) => {
              if (!cell) {
                return <div key={idx} className="h-6" />;
              }
              const isSelected =
                cell.toDateString() === selectedDateObj.toDateString();
              const isInCurrentWeek =
                days.find((d) => d.toDateString() === cell.toDateString()) != null;
              return (
                <button
                  key={cell.toISOString()}
                  type="button"
                  className={`h-6 flex items-center justify-center rounded-full text-[11px] ${
                    isSelected
                      ? "bg-sky-600 text-white"
                      : isInCurrentWeek
                        ? "bg-slate-50 text-slate-700"
                        : "bg-transparent text-slate-700"
                  }`}
                  onClick={() => setDate(cell.toISOString().slice(0, 10))}
                >
                  {cell.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="font-semibold text-sm mb-2">{t("calendarWeek.sidebar.resources")}</div>
          <select
            className="w-full border rounded px-2 py-1 text-xs"
            value={selectedDoctorId}
            onChange={(e) =>
              setSelectedDoctorId(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
          >
            <option value="all">{t("calendarDay.allDoctors")}</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.short_name || d.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="font-semibold text-sm mb-1">{t("calendarWeek.sidebar.schedule")}</div>
          <p className="text-[11px] text-slate-600">
            {t("calendarWeek.sidebar.scheduleDescription")}
          </p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">{t("calendarWeek.title")}</h1>
          <span className="text-xs text-slate-500">
            {data?.start_date} – {data?.end_date}
          </span>
        </div>
        <div className="rounded border bg-white px-3 py-2 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-full bg-slate-50 p-1 text-xs">
                <a
                  href="/calendar"
                  className="px-3 py-1 rounded-full text-slate-600 hover:bg-white/60"
                >
                  Zi
                </a>
                <a
                  href="/calendar/week"
                  className="px-3 py-1 rounded-full bg-white font-semibold text-[#5c4acb]"
                >
                  Săptămână
                </a>
              </div>
              <button
                type="button"
                onClick={() => changeWeek(-7)}
              >
                {t("calendarWeek.previousWeek")}
              </button>
              <button
                type="button"
                onClick={() => setDate(new Date().toISOString().slice(0, 10))}
              >
                {t("calendarWeek.thisWeek")}
              </button>
              <button
                type="button"
                onClick={() => changeWeek(7)}
              >
                {t("calendarWeek.nextWeek")}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              className="border rounded px-2 py-1 text-sm"
              value={selectedDoctorId}
              onChange={(e) =>
                setSelectedDoctorId(
                  e.target.value === "all" ? "all" : Number(e.target.value),
                )
              }
            >
              <option value="all">{t("calendarDay.allDoctors")}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.short_name || d.name}
                </option>
              ))}
            </select>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">{t("calendarDay.allStatuses")}</option>
              <option value="scheduled">{t("statusLabels.scheduled")}</option>
              <option value="confirmed">{t("statusLabels.confirmed")}</option>
              <option value="checked_in">{t("statusLabels.checked_in")}</option>
              <option value="in_consult">{t("statusLabels.in_consult")}</option>
              <option value="done">{t("statusLabels.done")}</option>
            </select>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={selectedServiceId}
              onChange={(e) =>
                setSelectedServiceId(
                  e.target.value === "all" ? "all" : Number(e.target.value),
                )
              }
            >
              <option value="all">{t("calendarDay.allServices")}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder={t("common.searchPlaceholder")}
              className="border rounded px-2 py-1 text-sm min-w-[220px] flex-1"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="button"
              className="rounded border bg-white px-2 py-1 text-xs"
              onClick={() => {
                setSelectedDoctorId("all");
                setStatusFilter("all");
                setSelectedServiceId("all");
                setSearchQuery("");
              }}
            >
              {t("calendarDay.reset")}
            </button>
          </div>
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {loading && <div className="text-sm text-slate-500">{t("common.loading")}</div>}

        {!loading && data && (
          <div className="overflow-auto rounded border bg-white">
            {blocks.some((b) => !b.doctor_id) && (
              <div className="border-b bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                <div className="mb-1 font-semibold">{t("calendarWeek.clinicBlocks")}</div>
                <div className="flex flex-wrap gap-2">
                  {days.map((d) => {
                    const dayKey = d.toISOString().slice(0, 10);
                    const dayClinic = clinicBlocksByDay.get(dayKey) ?? [];
                    if (!dayClinic.length) {
                      return (
                        <div key={dayKey} className="min-w-[120px] text-slate-400">
                          {d.toLocaleDateString()}: –
                        </div>
                      );
                    }
                    return (
                      <div key={dayKey} className="min-w-[160px] space-y-0.5">
                        <div className="font-medium">{d.toLocaleDateString()}</div>
                        {dayClinic.map((b) => {
                          const start = parseOdooDatetime(b.start_at);
                          const end = parseOdooDatetime(b.end_at);
                          return (
                            <div
                              key={b.id}
                              className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900"
                            >
                              [Clinic block] {b.block_type}
                              {b.reason ? ` – ${b.reason}` : ""} ({formatTimeHM(start)}–{formatTimeHM(end)})
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border-b px-2 py-1 text-left">Doctor</th>
                  {days.map((d) => (
                    <th key={d.toISOString()} className="border-b px-2 py-1 text-left">
                      {d.toLocaleDateString()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doctors.map((doc) => (
                  <tr key={doc.id} className="border-b last:border-b-0">
                    <td className="border-r px-2 py-1 align-top text-xs font-semibold">
                      {doc.short_name || doc.name}
                    </td>
                    {days.map((d) => {
                      const dayKey = d.toISOString().slice(0, 10);
                      const byDay = visitsByDoctorAndDay.get(doc.id);
                      const visits = byDay?.get(dayKey) ?? [];
                      const dayBlocks = blocks.filter(
                        (b) => b.doctor_id === doc.id && b.start_at.slice(0, 10) === dayKey,
                      );
                      return (
                        <td key={dayKey} className="border-r px-2 py-1 align-top">
                          {dayBlocks.length > 0 && (
                            <ul className="mb-1 space-y-0.5">
                              {dayBlocks.map((b) => (
                                <li key={b.id}>
                                  <div className="rounded bg-slate-200 px-1 py-0.5 text-[10px] text-slate-700">
                                    [Block] {b.block_type}
                                    {b.reason ? ` – ${b.reason}` : ""}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                          {visits.length === 0 ? (
                            dayBlocks.length === 0 && (
                              <span className="text-[11px] text-slate-400">–</span>
                            )
                          ) : (
                            <ul className="space-y-1">
                              {visits.map((v) => {
                                const start = parseOdooDatetime(v.start_at);
                                return (
                                  <li key={v.id}>
                                    <button
                                      type="button"
                                      className="w-full rounded border bg-slate-50 px-1 py-0.5 text-left text-[11px] hover:bg-sky-50"
                                      onClick={() => setSelectedVisit(v)}
                                    >
                                      <span className="font-medium">{formatTimeHM(start)}</span>{" "}
                                      <span>{v.pet_name}</span>{" "}
                                      <span className="text-slate-500">({v.service_name})</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VisitDetailModal
        open={!!selectedVisit}
        visit={selectedVisit}
        doctors={doctors}
        onClose={() => setSelectedVisit(null)}
        onChanged={() => void loadWeek()}
        onRescheduleRequested={(visit) => setRescheduleVisit(visit)}
      />
      <RescheduleVisitModal
        open={!!rescheduleVisit}
        visit={rescheduleVisit}
        doctors={doctors}
        onClose={() => setRescheduleVisit(null)}
        onRescheduled={async () => {
          setRescheduleVisit(null);
          setSelectedVisit(null);
          await loadWeek();
        }}
      />

      <VisitDetailModal
        open={!!selectedVisit}
        visit={selectedVisit}
        doctors={doctors}
        onClose={() => setSelectedVisit(null)}
        onChanged={() => void loadWeek()}
        onRescheduleRequested={(visit) => setRescheduleVisit(visit)}
      />
      <RescheduleVisitModal
        open={!!rescheduleVisit}
        visit={rescheduleVisit}
        doctors={doctors}
        onClose={() => setRescheduleVisit(null)}
        onRescheduled={async () => {
          setRescheduleVisit(null);
          setSelectedVisit(null);
          await loadWeek();
        }}
      />
    </div>
  );
}

