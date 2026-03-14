"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/apiClient";
import type { VetBlock, DoctorSettings } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { toOdooDatetimeLocal } from "../../../lib/datetime";

const BLOCK_TYPES = [
  { value: "leave", label: "Leave" },
  { value: "break", label: "Break" },
  { value: "training", label: "Training" },
  { value: "unavailable", label: "Unavailable" },
  { value: "manual", label: "Manual Block" },
  { value: "meeting", label: "Meeting" },
];

function toDatetimeLocalInput(dt: string): string {
  if (!dt) return "";
  const d = new Date(dt.replace(" ", "T"));
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalInput(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  return toOdooDatetimeLocal(d);
}

export default function BlocksSettingsPage() {
  const [blocks, setBlocks] = useState<VetBlock[]>([]);
  const [doctors, setDoctors] = useState<DoctorSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const [filterDate, setFilterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterDoctorId, setFilterDoctorId] = useState<number | "">("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{
    block_type: string;
    start_at: string;
    end_at: string;
    doctor_id: number | "";
    reason: string;
    is_recurring: boolean;
  }>({
    block_type: "manual",
    start_at: "",
    end_at: "",
    doctor_id: "",
    reason: "",
    is_recurring: false,
  });

  useEffect(() => {
    void loadDoctors();
  }, []);

  useEffect(() => {
    void loadBlocks();
  }, [filterDate, filterDoctorId]);

  async function loadDoctors() {
    const res = await api.listDoctorsSettings();
    if (res.ok) setDoctors(res.data.doctors);
  }

  async function loadBlocks() {
    setLoading(true);
    setError(null);
    const res = await api.listBlocks({
      date: filterDate,
      doctor_id: filterDoctorId === "" ? undefined : filterDoctorId,
    });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setBlocks([]);
    } else {
      setBlocks(res.data.blocks);
    }
  }

  function openCreate() {
    const today = new Date().toISOString().slice(0, 10);
    setForm({
      block_type: "manual",
      start_at: `${today}T09:00`,
      end_at: `${today}T10:00`,
      doctor_id: filterDoctorId !== "" ? filterDoctorId : "",
      reason: "",
      is_recurring: false,
    });
    setCreateOpen(true);
    setEditingId(null);
  }

  function openEdit(block: VetBlock) {
    setForm({
      block_type: block.block_type,
      start_at: toDatetimeLocalInput(block.start_at),
      end_at: toDatetimeLocalInput(block.end_at),
      doctor_id: block.doctor_id ?? "",
      reason: block.reason ?? "",
      is_recurring: block.is_recurring ?? false,
    });
    setEditingId(block.id);
    setCreateOpen(false);
  }

  function closeForm() {
    setCreateOpen(false);
    setEditingId(null);
  }

  async function handleCreate() {
    if (!form.start_at || !form.end_at) {
      setError("Start and end are required.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await api.createBlock({
      block_type: form.block_type,
      start_at: fromDatetimeLocalInput(form.start_at),
      end_at: fromDatetimeLocalInput(form.end_at),
      doctor_id: form.doctor_id !== "" ? form.doctor_id : undefined,
      reason: form.reason || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setSuccess("Block created.");
    closeForm();
    void loadBlocks();
  }

  async function handleUpdate() {
    if (editingId == null || !form.start_at || !form.end_at) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await api.updateBlock({
      block_id: editingId,
      values: {
        block_type: form.block_type,
        start_at: fromDatetimeLocalInput(form.start_at),
        end_at: fromDatetimeLocalInput(form.end_at),
        doctor_id: form.doctor_id !== "" ? form.doctor_id : null,
        reason: form.reason || undefined,
        is_recurring: form.is_recurring,
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setSuccess("Block updated.");
    closeForm();
    void loadBlocks();
  }

  async function handleDelete(blockId: number) {
    if (!confirm("Delete this block?")) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await api.deleteBlock({ block_id: blockId });
    setSaving(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setSuccess("Block deleted.");
    closeForm();
    void loadBlocks();
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}
      {success && (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded border bg-white p-4">
        <label className="flex items-center gap-2 text-sm">
          <span>Date</span>
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span>Doctor</span>
          <select
            className="rounded border px-2 py-1"
            value={filterDoctorId}
            onChange={(e) => setFilterDoctorId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">All</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.short_name || d.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={openCreate}
          className="rounded border bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700"
        >
          + New block
        </button>
      </div>

      {loading && <div className="text-sm text-slate-500">Loading blocks…</div>}
      {!loading && blocks.length === 0 && !createOpen && editingId == null && (
        <div className="rounded border bg-white p-4 text-sm text-slate-500">No blocks for this date/doctor.</div>
      )}
      {!loading && blocks.length > 0 && (
        <div className="rounded border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-b px-3 py-2 text-left font-medium">Type</th>
                <th className="border-b px-3 py-2 text-left font-medium">Start</th>
                <th className="border-b px-3 py-2 text-left font-medium">End</th>
                <th className="border-b px-3 py-2 text-left font-medium">Doctor</th>
                <th className="border-b px-3 py-2 text-left font-medium">Reason</th>
                <th className="border-b px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{BLOCK_TYPES.find((t) => t.value === b.block_type)?.label ?? b.block_type}</td>
                  <td className="px-3 py-2">{b.start_at}</td>
                  <td className="px-3 py-2">{b.end_at}</td>
                  <td className="px-3 py-2">{b.doctor_name ?? "–"}</td>
                  <td className="px-3 py-2">{b.reason ?? "–"}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => openEdit(b)}
                      className="text-sky-600 hover:underline"
                    >
                      Edit
                    </button>
                    {" | "}
                    <button
                      type="button"
                      onClick={() => void handleDelete(b.id)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(createOpen || editingId != null) && (
        <div className="rounded border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {createOpen ? "New block" : "Edit block"}
          </h2>
          <div className="space-y-3 text-sm">
            <div>
              <label className="block font-medium">Type</label>
              <select
                className="mt-1 rounded border px-2 py-1"
                value={form.block_type}
                onChange={(e) => setForm((p) => ({ ...p, block_type: e.target.value }))}
              >
                {BLOCK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium">Start</label>
              <input
                type="datetime-local"
                className="mt-1 rounded border px-2 py-1"
                value={form.start_at}
                onChange={(e) => setForm((p) => ({ ...p, start_at: e.target.value }))}
              />
            </div>
            <div>
              <label className="block font-medium">End</label>
              <input
                type="datetime-local"
                className="mt-1 rounded border px-2 py-1"
                value={form.end_at}
                onChange={(e) => setForm((p) => ({ ...p, end_at: e.target.value }))}
              />
            </div>
            <div>
              <label className="block font-medium">Doctor</label>
              <select
                className="mt-1 rounded border px-2 py-1"
                value={form.doctor_id}
                onChange={(e) =>
                  setForm((p) => ({ ...p, doctor_id: e.target.value === "" ? "" : Number(e.target.value) }))
                }
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
              <label className="block font-medium">Reason</label>
              <input
                type="text"
                className="mt-1 w-full max-w-md rounded border px-2 py-1"
                value={form.reason}
                onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              />
            </div>
            {!createOpen && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="recurring"
                  checked={form.is_recurring}
                  onChange={(e) => setForm((p) => ({ ...p, is_recurring: e.target.checked }))}
                />
                <label htmlFor="recurring">Recurring</label>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={createOpen ? () => void handleCreate() : () => void handleUpdate()}
                disabled={saving}
                className="rounded border bg-sky-600 px-4 py-2 text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : createOpen ? "Create" : "Update"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded border bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
