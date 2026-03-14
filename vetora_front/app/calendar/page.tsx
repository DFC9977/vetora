"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/apiClient";
import type { CalendarDayData, VetBlock, VetDoctor, VetService, VetVisit } from "../../lib/types";
import { getDaySlotsForDate, parseOdooDatetime, formatTimeHM } from "../../lib/datetime";
import { mapApiErrorToMessage } from "../../lib/errors";
import { NewVisitModal } from "../../components/NewVisitModal";
import { VisitDetailModal } from "../../components/VisitDetailModal";
import { RescheduleVisitModal } from "../../components/RescheduleVisitModal";
import { BlockModal } from "../../components/BlockModal";
import { useI18n } from "../../components/I18nProvider";

type StatusFilter = "all" | "scheduled" | "confirmed" | "checked_in" | "in_consult" | "done";

export default function CalendarPage() {
  const { t } = useI18n();
  const [isClient, setIsClient] = useState(false);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<CalendarDayData | null>(null);
  const [doctors, setDoctors] = useState<VetDoctor[]>([]);
  const [services, setServices] = useState<VetService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedServiceId, setSelectedServiceId] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVisit, setSelectedVisit] = useState<VetVisit | null>(null);
  const [rescheduleVisit, setRescheduleVisit] = useState<VetVisit | null>(null);
  const [editingBlock, setEditingBlock] = useState<VetBlock | null>(null);
  const [blockCreateContext, setBlockCreateContext] = useState<{ doctor: VetDoctor | null; start: Date; end: Date } | null>(null);
  const [newVisitContext, setNewVisitContext] = useState<{
    doctor: VetDoctor;
    start: Date;
  } | null>(null);

  useEffect(() => {
    setIsClient(true);
    void loadLookups();
  }, []);

  useEffect(() => {
    void loadCalendar();
  }, [date, selectedDoctorId]);

  async function loadLookups() {
    const [docRes, srvRes] = await Promise.all([
      api.lookupDoctors({}),
      api.lookupServices({}),
    ]);
    if (docRes.ok) {
      const raw = docRes.data as any;
      const list: VetDoctor[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.doctors)
          ? (raw.doctors as VetDoctor[])
          : [];
      setDoctors(list);
    }
    if (srvRes.ok) {
      const raw = srvRes.data as any;
      const list: VetService[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.services)
          ? (raw.services as VetService[])
          : [];
      setServices(list);
    }
  }

  async function loadCalendar() {
    setLoading(true);
    setError(null);
    const res = await api.calendarDay({
      date,
      doctor_ids: selectedDoctorId === "all" ? undefined : [selectedDoctorId],
    });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setData(null);
      return;
    }
    setData(res.data);
  }

  const daySlots = useMemo(() => {
    // Derive visible interval from doctor/clinic schedules for the selected day.
    if (!data) {
      return getDaySlotsForDate(date, 7, 21, 15);
    }

    const d = new Date(date + "T00:00:00");
    const jsWeekday = d.getDay(); // 0=Sunday .. 6=Saturday
    const weekday = jsWeekday === 0 ? "6" : String(jsWeekday - 1); // Python Monday=0..Sunday=6

    const allDoctorScheds = (data.doctor_schedules || []).filter(
      (s) => s.weekday === weekday,
    );
    const clinicScheds = (data.clinic_schedules || []).filter(
      (s) => s.weekday === weekday,
    );

    const source =
      allDoctorScheds.length > 0
        ? allDoctorScheds
        : clinicScheds.length > 0
          ? clinicScheds
          : null;

    if (!source) {
      return getDaySlotsForDate(date, 7, 21, 15);
    }

    const startTimes = source.map((s) => s.start_time);
    const endTimes = source.map((s) => s.end_time);

    const minStart = Math.floor(Math.min(...startTimes));
    const maxEnd = Math.ceil(Math.max(...endTimes));

    // Safety fallback if values are somehow invalid.
    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || minStart >= maxEnd) {
      return getDaySlotsForDate(date, 7, 21, 15);
    }

    return getDaySlotsForDate(date, minStart, maxEnd, 15);
  }, [date, data]);

  const visitsByDoctor = useMemo(() => {
    const map = new Map<number, VetVisit[]>();
    if (!data || !Array.isArray((data as any).visits)) return map;
    const q = searchQuery.trim().toLowerCase();
    for (const v of (data as any).visits as VetVisit[]) {
      if (statusFilter !== "all" && v.status !== statusFilter) continue;
      if (selectedServiceId !== "all" && v.service_id !== selectedServiceId) continue;
      if (q) {
        const haystack = [
          v.pet_name,
          v.client_name,
          v.service_name,
          v.client_phone ?? "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      const arr = map.get(v.doctor_id) || [];
      arr.push(v);
      map.set(v.doctor_id, arr);
    }
    return map;
  }, [data, statusFilter, selectedServiceId, searchQuery]);

  // Active time intervals (minutes from midnight) per doctor for the current day,
  // based on doctor schedules with fallback to clinic schedules.
  const activeIntervalsByDoctor = useMemo(() => {
    const map = new Map<number, { start: number; end: number }[]>();
    if (!data) return map;

    const d = new Date(date + "T00:00:00");
    const jsWeekday = d.getDay(); // 0=Sunday .. 6=Saturday
    const weekday = jsWeekday === 0 ? "6" : String(jsWeekday - 1); // match Python Monday=0..Sunday=6

    const clinic = (data.clinic_schedules || []).filter((s) => s.weekday === weekday);

    const doctorList: VetDoctor[] = Array.isArray((data as any)?.doctors)
      ? ((data as any).doctors as VetDoctor[])
      : doctors;

    const toIntervals = (startTime: number, endTime: number) => {
      const start = Math.round(startTime * 60);
      const end = Math.round(endTime * 60);
      return { start, end };
    };

    for (const doc of doctorList) {
      const docScheds = (data.doctor_schedules || []).filter(
        (s) => s.doctor_id === doc.id && s.weekday === weekday,
      );
      const base = docScheds.length ? docScheds : clinic;
      const intervals = base.map((s) => toIntervals(s.start_time, s.end_time));
      map.set(doc.id, intervals);
    }

    return map;
  }, [data, date, doctors]);

  function handleToday() {
    setDate(new Date().toISOString().slice(0, 10));
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDate(e.target.value);
  }

  const visibleDoctors = useMemo(() => {
    // Prefer doctors coming from calendar payload; if empty, fall back to lookup list.
    const fromData: VetDoctor[] = Array.isArray((data as any)?.doctors)
      ? ((data as any).doctors as VetDoctor[])
      : [];
    const doctorsList: VetDoctor[] = fromData.length ? fromData : doctors;

    if (!doctorsList.length) return [] as VetDoctor[];
    if (selectedDoctorId === "all") return doctorsList;
    return doctorsList.filter((d) => d.id === selectedDoctorId);
  }, [data, doctors, selectedDoctorId]);

  function handleTimeAxisClick(slot: Date) {
    const doctorsList = visibleDoctors;
    if (!doctorsList.length) return;
    const doctor =
      selectedDoctorId === "all"
        ? doctorsList[0]
        : doctorsList.find((d) => d.id === selectedDoctorId) || doctorsList[0];
    setNewVisitContext({ doctor, start: slot });
  }

  function handleNewVisitClick() {
    const doctorsList = visibleDoctors;
    if (!doctorsList.length) return;
    const now = new Date();
    // Snap to next 15-minute slot on selected date.
    const baseDate = new Date(date + "T00:00:00");
    const minutes = now.getHours() * 60 + now.getMinutes();
    const snapped = Math.ceil(minutes / 15) * 15;
    const snappedDate = new Date(baseDate.getTime() + snapped * 60 * 1000);
    const doctor =
      selectedDoctorId === "all"
        ? doctorsList[0]
        : doctorsList.find((d) => d.id === selectedDoctorId) || doctorsList[0];
    setNewVisitContext({ doctor, start: snappedDate });
  }

  // Avoid server/client HTML mismatches by rendering the calendar
  // only on the client, after the first mount.
  if (!isClient) {
    return (
      <div className="flex flex-col h-full gap-3">
        <div className="text-sm text-slate-500">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">{t("calendarDay.title")}</h1>
        <div className="text-xs text-slate-500">{date}</div>
      </div>
      <CalendarToolbar
        t={t}
        date={date}
        onDateChange={handleDateChange}
        onToday={handleToday}
        doctors={doctors}
        onNewVisit={handleNewVisitClick}
        selectedDoctorId={selectedDoctorId}
        setSelectedDoctorId={setSelectedDoctorId}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        services={services}
        selectedServiceId={selectedServiceId}
        setSelectedServiceId={setSelectedServiceId}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onResetFilters={() => {
          setSelectedDoctorId("all");
          setStatusFilter("all");
          setSelectedServiceId("all");
          setSearchQuery("");
        }}
      />
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {loading && <div className="text-sm text-slate-500">Loading calendar...</div>}
      {data && (
        <CalendarGrid
          slots={daySlots}
          doctors={visibleDoctors}
          visitsByDoctor={visitsByDoctor}
          t={t}
          services={services}
          blocks={data.blocks || []}
          onTimeAxisClick={handleTimeAxisClick}
          onSlotClick={(doctor, slot) => setNewVisitContext({ doctor, start: slot })}
          onBlockClick={(block) => setEditingBlock(block)}
          activeIntervalsByDoctor={activeIntervalsByDoctor}
          onCreateBlockFromSlot={(doctor, slot) => {
            const end = new Date(slot.getTime() + 15 * 60 * 1000);
            setBlockCreateContext({ doctor, start: slot, end });
          }}
          onVisitClick={(visit) => setSelectedVisit(visit)}
        />
      )}
      {newVisitContext && (
        <NewVisitModal
          context={newVisitContext}
          services={services}
          onClose={() => setNewVisitContext(null)}
          onCreated={() => {
            setNewVisitContext(null);
            void loadCalendar();
          }}
        />
      )}
      <VisitDetailModal
        open={!!selectedVisit}
        visit={selectedVisit}
        doctors={visibleDoctors.length ? visibleDoctors : doctors}
        onClose={() => setSelectedVisit(null)}
        onChanged={() => void loadCalendar()}
        onRescheduleRequested={(visit) => setRescheduleVisit(visit)}
      />
      <RescheduleVisitModal
        open={!!rescheduleVisit}
        visit={rescheduleVisit}
        doctors={visibleDoctors.length ? visibleDoctors : doctors}
        onClose={() => setRescheduleVisit(null)}
        onRescheduled={async () => {
          setRescheduleVisit(null);
          setSelectedVisit(null);
          await loadCalendar();
        }}
      />
      <BlockModal
        open={!!blockCreateContext}
        block={null}
        initialSlot={blockCreateContext ? { doctor: blockCreateContext.doctor, start: blockCreateContext.start, end: blockCreateContext.end } : undefined}
        doctors={visibleDoctors.length ? visibleDoctors : doctors}
        onClose={() => setBlockCreateContext(null)}
        onSaved={async () => {
          setBlockCreateContext(null);
          await loadCalendar();
        }}
        onDeleted={async () => {
          setBlockCreateContext(null);
          await loadCalendar();
        }}
      />
      <BlockModal
        open={!!editingBlock}
        block={editingBlock}
        doctors={visibleDoctors.length ? visibleDoctors : doctors}
        onClose={() => setEditingBlock(null)}
        onSaved={async () => {
          setEditingBlock(null);
          await loadCalendar();
        }}
        onDeleted={async () => {
          setEditingBlock(null);
          await loadCalendar();
        }}
      />
    </div>
  );
}

type ToolbarProps = {
  t: (key: string) => string;
  date: string;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToday: () => void;
  doctors: VetDoctor[];
  onNewVisit: () => void;
  selectedDoctorId: number | "all";
  setSelectedDoctorId: (v: number | "all") => void;
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  services: VetService[];
  selectedServiceId: number | "all";
  setSelectedServiceId: (v: number | "all") => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  onResetFilters: () => void;
};

function CalendarToolbar(props: ToolbarProps) {
  const doctorOptions = Array.isArray(props.doctors) ? props.doctors : [];

  return (
    <div className="rounded border bg-white px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-slate-50 p-1 text-xs">
            <a
              href="/calendar"
              className="px-3 py-1 rounded-full bg-white font-semibold text-[#5c4acb]"
            >
              Zi
            </a>
            <a
              href="/calendar/week"
              className="px-3 py-1 rounded-full text-slate-500 hover:bg-white/60"
            >
              Săptămână
            </a>
          </div>
          <button onClick={props.onToday}>{props.t("calendarDay.today")}</button>
          <input type="date" value={props.date} onChange={props.onDateChange} />
        </div>
        <button
          onClick={props.onNewVisit}
          className="rounded border border-[#875A7B] bg-[#875A7B] text-white text-sm hover:bg-[#704878]"
        >
          {props.t("calendarDay.newVisit")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={props.selectedDoctorId}
          onChange={(e) =>
            props.setSelectedDoctorId(
              e.target.value === "all" ? "all" : Number(e.target.value),
            )
          }
        >
          <option value="all">{props.t("calendarDay.allDoctors")}</option>
          {doctorOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.short_name || d.name}
            </option>
          ))}
        </select>
        <select
          value={props.selectedServiceId}
          onChange={(e) =>
            props.setSelectedServiceId(
              e.target.value === "all" ? "all" : Number(e.target.value),
            )
          }
        >
          <option value="all">{props.t("calendarDay.allServices")}</option>
          {props.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={props.statusFilter}
          onChange={(e) => props.setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">{props.t("calendarDay.allStatuses")}</option>
          <option value="scheduled">{props.t("statusLabels.scheduled")}</option>
          <option value="confirmed">{props.t("statusLabels.confirmed")}</option>
          <option value="checked_in">
            {props.t("statusLabels.checked_in")}
          </option>
          <option value="in_consult">
            {props.t("statusLabels.in_consult")}
          </option>
          <option value="done">{props.t("statusLabels.done")}</option>
        </select>
        <input
          type="text"
          placeholder={props.t("common.searchPlaceholder")}
          className="min-w-[220px] flex-1"
          value={props.searchQuery}
          onChange={(e) => props.setSearchQuery(e.target.value)}
        />
        <button type="button" onClick={props.onResetFilters} className="text-xs">
          {props.t("calendarDay.reset")}
        </button>
      </div>
    </div>
  );
}

type GridProps = {
  slots: Date[];
  doctors: VetDoctor[];
  visitsByDoctor: Map<number, VetVisit[]>;
  services: VetService[];
  t: (key: string) => string;
  blocks: VetBlock[];
  onTimeAxisClick: (slot: Date) => void;
  onSlotClick: (doctor: VetDoctor, slot: Date) => void;
  onBlockClick: (block: VetBlock) => void;
  activeIntervalsByDoctor: Map<number, { start: number; end: number }[]>;
  onCreateBlockFromSlot: (doctor: VetDoctor, slot: Date) => void;
  onVisitClick: (visit: VetVisit) => void;
};

function CalendarGrid({
  slots,
  doctors,
  visitsByDoctor,
  services,
  t,
  blocks,
  onTimeAxisClick,
  onSlotClick,
  onBlockClick,
  activeIntervalsByDoctor,
  onCreateBlockFromSlot,
  onVisitClick,
}: GridProps) {
  return (
    <div className="flex border rounded bg-white overflow-auto h-[calc(100vh-150px)]">
      <TimeAxis slots={slots} onSlotClick={onTimeAxisClick} />
      <div className="flex flex-1">
        {doctors.map((doctor) => (
          <DoctorColumn
            key={doctor.id}
            doctor={doctor}
            slots={slots}
            t={t}
            visits={visitsByDoctor.get(doctor.id) || []}
            services={services}
            blocks={blocks.filter((b) => b.doctor_id === doctor.id)}
            activeIntervals={activeIntervalsByDoctor.get(doctor.id) || []}
            onSlotClick={onSlotClick}
            onBlockClick={onBlockClick}
            onCreateBlockFromSlot={onCreateBlockFromSlot}
            onVisitClick={onVisitClick}
          />
        ))}
      </div>
    </div>
  );
}

function TimeAxis({ slots, onSlotClick }: { slots: Date[]; onSlotClick?: (slot: Date) => void }) {
  return (
    <div className="w-16 border-r bg-slate-50 text-xs text-slate-500">
      {slots.map((slot) => (
        <div key={slot.getTime()} className="h-6 px-1 flex items-start">
          <span
            onClick={() => onSlotClick?.(slot)}
            style={{ cursor: onSlotClick ? "pointer" : "default" }}
          >
            {formatTimeHM(slot)}
          </span>
        </div>
      ))}
    </div>
  );
}

type DoctorColumnProps = {
  doctor: VetDoctor;
  slots: Date[];
  t: (key: string) => string;
  visits: VetVisit[];
  services: VetService[];
  blocks: VetBlock[];
  activeIntervals: { start: number; end: number }[];
  onSlotClick: (doctor: VetDoctor, slot: Date) => void;
  onBlockClick: (block: VetBlock) => void;
  onCreateBlockFromSlot: (doctor: VetDoctor, slot: Date) => void;
  onVisitClick: (visit: VetVisit) => void;
};

function DoctorColumn({
  doctor,
  slots,
  t,
  visits,
  services,
  blocks,
  activeIntervals,
  onSlotClick,
  onBlockClick,
  onCreateBlockFromSlot,
  onVisitClick,
}: DoctorColumnProps) {
  const serviceById = useMemo(() => {
    const map = new Map<number, VetService>();
    for (const s of services) map.set(s.id, s);
    return map;
  }, [services]);

  return (
    <div className="flex-1 border-r last:border-r-0 relative">
      <div className="sticky top-0 z-10 bg-white border-b px-2 py-1 text-xs font-semibold">
        {doctor.short_name || doctor.name}
      </div>
      <div className="relative">
        {slots.map((slot) => {
          const slotStart = slot.getTime();
          const slotEnd = slotStart + 15 * 60 * 1000;
          const slotMinutes = slot.getHours() * 60 + slot.getMinutes();

          const isBlocked = blocks.some((b) => {
            const bStart = parseOdooDatetime(b.start_at).getTime();
            const bEnd = parseOdooDatetime(b.end_at).getTime();
            return bStart < slotEnd && bEnd > slotStart;
          });

          const isInActiveInterval =
            activeIntervals.length === 0 ||
            activeIntervals.some((iv) => slotMinutes >= iv.start && slotMinutes < iv.end);
          const isInactive = activeIntervals.length > 0 && !isInActiveInterval;

          const baseClasses = "h-6 border-b border-slate-100 flex";
          const stateClass = isInactive
            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
            : isBlocked
              ? "bg-slate-200 cursor-not-allowed"
              : "hover:bg-slate-50 cursor-pointer";

          return (
            <div key={slot.getTime()} className={`${baseClasses} ${stateClass}`}>
              <button
                type="button"
                className="flex-1"
                onClick={() => {
                  if (isBlocked || isInactive) return;
                  onSlotClick(doctor, slot);
                }}
              />
              <button
                type="button"
                className="w-7 border-l text-[9px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isInactive) return;
                  onCreateBlockFromSlot(doctor, slot);
                }}
                disabled={isInactive}
              >
                ■
              </button>
            </div>
          );
        })}
        {blocks.map((block) => (
          <BlockCard key={block.id} block={block} slots={slots} onClick={() => onBlockClick(block)} />
        ))}
        {visits.map((visit) => (
          <VisitCard
            key={visit.id}
            visit={visit}
            slots={slots}
            service={serviceById.get(visit.service_id) || null}
            t={t}
            onClick={() => onVisitClick(visit)}
          />
        ))}
      </div>
    </div>
  );
}

type NewVisitModalProps = {
  context: { doctor: VetDoctor; start: Date };
  services: VetService[];
  onClose: () => void;
  onCreated: () => void;
};
type VisitCardProps = {
  visit: VetVisit;
  t: (key: string) => string;
  slots: Date[];
  service: VetService | null;
  onClick: () => void;
};
type BlockCardProps = {
  block: VetBlock;
  slots: Date[];
  onClick: () => void;
};

function VisitCard({ visit, slots, service, t, onClick }: VisitCardProps) {
  const start = parseOdooDatetime(visit.start_at);
  const end = parseOdooDatetime(visit.end_at);
  const durationMinutes = (end.getTime() - start.getTime()) / 60000;
  const slotMinutes = 15;
  const slotHeight = 24; // px, matches h-6
  const firstSlotStart = slots[0];

  const offsetMinutes = (start.getTime() - firstSlotStart.getTime()) / 60000;
  const top = (offsetMinutes / slotMinutes) * slotHeight;
  const height = (durationMinutes / slotMinutes) * slotHeight;

  const statusColor = getStatusColor(visit.status);

  return (
    <div
      className="absolute left-1 right-1 rounded border text-xs px-1 py-0.5 overflow-hidden shadow-sm"
      style={{ top, height, backgroundColor: statusColor.bg, borderColor: statusColor.border }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div className="flex justify-between items-center">
        <span className="truncate text-[11px]">
          <span className="font-semibold">{t("visitDetail.patient")}:</span>{" "}
          <span className="font-semibold">{visit.pet_name}</span>
        </span>
        <span className="ml-1 shrink-0 text-[11px]">{formatTimeHM(start)}</span>
      </div>
      <div className="truncate text-[11px]">
        <span className="font-semibold">{t("visitDetail.service")}:</span>{" "}
        <span>{service?.name ?? visit.service_name}</span>
        {visit.is_urgent && <span className="ml-1 text-red-700 font-semibold">URGENT</span>}
      </div>
      {visit.client_name && (
        <div className="truncate text-[10px] text-slate-700">
          <span className="font-semibold">{t("visitDetail.client")}:</span>{" "}
          <span>{visit.client_name}</span>
        </div>
      )}
      <div className="text-[10px] uppercase text-slate-700 mt-0.5">{visit.status}</div>
    </div>
  );
}

function BlockCard({ block, slots, onClick }: BlockCardProps) {
  const start = parseOdooDatetime(block.start_at);
  const end = parseOdooDatetime(block.end_at);
  const durationMinutes = (end.getTime() - start.getTime()) / 60000;
  const slotMinutes = 15;
  const slotHeight = 24;
  const firstSlotStart = slots[0];

  const offsetMinutes = (start.getTime() - firstSlotStart.getTime()) / 60000;
  const top = (offsetMinutes / slotMinutes) * slotHeight;
  const height = (durationMinutes / slotMinutes) * slotHeight;

  return (
    <div
      className="absolute left-1 right-1 rounded border border-slate-400 bg-slate-200/70 text-[10px] px-1 py-0.5 overflow-hidden cursor-pointer"
      style={{ top, height }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div className="font-semibold truncate">{block.block_type}</div>
      {block.reason && <div className="truncate">{block.reason}</div>}
    </div>
  );
}

function getStatusColor(status: string): { bg: string; border: string } {
  switch (status) {
    case "scheduled":
      // warm golden for scheduled
      return { bg: "#fdf3d7", border: "#f4c26b" };
    case "confirmed":
      // lilac for active
      return { bg: "#efe9ff", border: "#8b7cf6" };
    case "checked_in":
      return { bg: "#fef4d8", border: "#f1b452" };
    case "in_consult":
      return { bg: "#fde4f0", border: "#e48bb3" };
    case "done":
      // soft green for done
      return { bg: "#e7f6ea", border: "#58b26b" };
    case "cancelled":
      return { bg: "#fde2e2", border: "#d97373" };
    case "no_show":
      return { bg: "#fdf0d6", border: "#d69a4a" };
    case "rescheduled":
      return { bg: "#f3e8ff", border: "#9b73f3" };
    default:
      return { bg: "#e5e7eb", border: "#9ca3af" };
  }
}
