"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/apiClient";
import type { VetBlock, VetDoctor } from "../lib/types";
import { mapApiErrorToMessage } from "../lib/errors";
import { toOdooDatetimeLocal } from "../lib/datetime";
import { useI18n } from "./I18nProvider";

type BlockModalProps = {
  open: boolean;
  block: VetBlock | null;
  initialSlot?: { doctor: VetDoctor | null; start: Date; end: Date };
  doctors: VetDoctor[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
};

const BLOCK_TYPES = [
  { value: "leave", labelKey: "block.typeLabels.leave" },
  { value: "break", labelKey: "block.typeLabels.break" },
  { value: "training", labelKey: "block.typeLabels.training" },
  { value: "unavailable", labelKey: "block.typeLabels.unavailable" },
  { value: "manual", labelKey: "block.typeLabels.manual" },
  { value: "meeting", labelKey: "block.typeLabels.meeting" },
];

export function BlockModal({ open, block, initialSlot, doctors, onClose, onSaved, onDeleted }: BlockModalProps) {
  const { t } = useI18n();
  const [blockType, setBlockType] = useState("manual");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [doctorId, setDoctorId] = useState<number | "">( "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (block) {
      // edit mode
      setBlockType(block.block_type);
      setReason(block.reason ?? "");
      setDoctorId(block.doctor_id ?? "");
      const toLocal = (s: string) => {
        const d = new Date(s.replace(" ", "T"));
        const pad = (n: number) => n.toString().padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
          d.getMinutes(),
        )}`;
      };
      setStartLocal(toLocal(block.start_at));
      setEndLocal(toLocal(block.end_at));
    } else if (initialSlot) {
      setBlockType("manual");
      setReason("");
      setDoctorId(initialSlot.doctor ? initialSlot.doctor.id : "");
      const pad = (n: number) => n.toString().padStart(2, "0");
      const toLocal = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setStartLocal(toLocal(initialSlot.start));
      setEndLocal(toLocal(initialSlot.end));
    } else {
      setBlockType("manual");
      setReason("");
      setDoctorId("");
      setStartLocal("");
      setEndLocal("");
    }
    setError(null);
    setPending(false);
  }, [open, block, initialSlot]);

  if (!open) return null;

  async function handleSave() {
    if (!startLocal || !endLocal) {
      setError(t("block.start") + " / " + t("block.end") + " " + t("reschedule.dateTimeRequired"));
      return;
    }
    const start = toOdooDatetimeLocal(new Date(startLocal));
    const end = toOdooDatetimeLocal(new Date(endLocal));
    setPending(true);
    setError(null);
    try {
      if (block) {
        const res = await api.updateBlock({
          block_id: block.id,
          values: {
            block_type: blockType,
            start_at: start,
            end_at: end,
            doctor_id: doctorId === "" ? null : doctorId,
            reason: reason || "",
          },
        });
        if (!res.ok) {
          setError(mapApiErrorToMessage(res.error));
        } else {
          onSaved();
          onClose();
        }
      } else {
        const res = await api.createBlock({
          block_type: blockType,
          start_at: start,
          end_at: end,
          doctor_id: doctorId === "" ? undefined : doctorId,
          reason: reason || undefined,
        });
        if (!res.ok) {
          setError(mapApiErrorToMessage(res.error));
        } else {
          onSaved();
          onClose();
        }
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!block) return;
    if (!confirm("Delete this block?")) return;
    setPending(true);
    setError(null);
    const res = await api.deleteBlock({ block_id: block.id });
    setPending(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    onDeleted();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded border bg-white p-5 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold pl-4">
            {block ? t("block.editTitle") : t("block.newTitle")}
          </h2>
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
            <label className="block font-medium text-slate-700">{t("block.type")}</label>
            <select
              className="mt-1 rounded border px-2 py-1"
              value={blockType}
              onChange={(e) => setBlockType(e.target.value)}
            >
              {BLOCK_TYPES.map((bt) => (
                <option key={bt.value} value={bt.value}>
                  {t(bt.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700">{t("block.start")}</label>
            <input
              type="datetime-local"
              className="mt-1 rounded border px-2 py-1"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">{t("block.end")}</label>
            <input
              type="datetime-local"
              className="mt-1 rounded border px-2 py-1"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">{t("block.doctor")}</label>
            <select
              className="mt-1 rounded border px-2 py-1"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">None</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.short_name || d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700">{t("block.reason")}</label>
            <input
              type="text"
              className="mt-1 border px-2 py-1 input-field"
              style={{ width: "96%" }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={pending}
            className="rounded border bg-sky-600 px-4 py-2 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {pending ? `${t("block.save")}…` : t("block.save")}
          </button>
          {block && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={pending}
              className="rounded border bg-white px-4 py-2 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {t("block.delete")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded border bg-white px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
          >
            {t("block.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

