"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/apiClient";
import type { DeliveryRun, DeliverySummary, RunState, SupplierInvoice } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { useI18n } from "../../../components/I18nProvider";
import { fileToBase64 } from "../../../lib/goods";
import { DeliveryCard } from "../../../components/deliveries/DeliveryCard";
import { LoadingList } from "../../../components/deliveries/LoadingList";
import { DeliveryReport } from "../../../components/deliveries/DeliveryReport";
import { RUN_STATES } from "../../../components/deliveries/shared";

type Tab = "invoices" | "loading" | "report";

export default function DeliveryRunPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const runId = Number(params?.id);

  const [run, setRun] = useState<DeliveryRun | null>(null);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [form, setForm] = useState({ name: "", date: "", driver: "", vehicle: "", notes: "", state: "planned" as RunState });
  const [tab, setTab] = useState<Tab>("invoices");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (runId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (tab !== "invoices") void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function load() {
    setLoading(true);
    const res = await api.getDeliveryRun({ run_id: runId });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    applyRun(res.data);
    setInvoices(res.data.invoices || []);
  }

  function applyRun(r: DeliveryRun) {
    setRun(r);
    setForm({
      name: r.name,
      date: r.date || "",
      driver: r.driver || "",
      vehicle: r.vehicle || "",
      notes: r.notes || "",
      state: r.state,
    });
  }

  async function loadSummary() {
    const res = await api.deliverySummary({ run_id: runId });
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setSummary(res.data);
    if (res.data.run) applyRun(res.data.run);
  }

  async function saveRun(patch?: Partial<typeof form>) {
    const next = { ...form, ...(patch || {}) };
    setForm(next);
    const res = await api.saveDeliveryRun({ run: { id: runId, ...next } });
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    applyRun(res.data);
    setInfo(t("deliveries.saved"));
    setTimeout(() => setInfo(null), 2000);
  }

  async function deleteRun() {
    if (!window.confirm(t("deliveries.confirmDeleteRun"))) return;
    const res = await api.deleteDeliveryRun({ run_id: runId });
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    window.location.href = "/deliveries";
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const errors: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setUploadProgress(t("deliveries.uploading").replace("{done}", String(i + 1)).replace("{total}", String(list.length)));
      const file = list[i];
      const res = await api.uploadRunInvoice({ run_id: runId, file_base64: await fileToBase64(file), file_name: file.name });
      if (!res.ok) errors.push(`${file.name}: ${mapApiErrorToMessage(res.error)}`);
      else setInvoices((prev) => [...prev, res.data]);
    }
    setUploadProgress(null);
    setUploadErrors(errors);
    if (fileInput.current) fileInput.current.value = "";
    await refreshRun();
  }

  async function refreshRun() {
    const res = await api.getDeliveryRun({ run_id: runId });
    if (res.ok) applyRun(res.data);
  }

  function onInvoiceChanged(inv: SupplierInvoice) {
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? inv : i)));
    void refreshRun();
  }

  function onInvoiceRemoved(id: number) {
    setInvoices((prev) => prev.filter((i) => i.id !== id));
    void refreshRun();
  }

  if (loading) return <div className="text-sm text-slate-500">{t("common.loading")}</div>;
  if (!run) return <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>;

  const tabBtn = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={tab === key ? "px-3 py-1 rounded-full bg-[#5c4acb] text-white text-sm" : "px-3 py-1 rounded-full bg-white text-sm"}
    >
      {label}
    </button>
  );

  const field = (key: "name" | "driver" | "vehicle", label: string) => (
    <label className="space-y-1">
      <span className="text-xs text-slate-500">{t(label)}</span>
      <input
        type="text"
        className="border rounded px-2 py-1 w-full"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        onBlur={() => void saveRun()}
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-3">
          <a href="/deliveries" className="text-sm text-sky-700 hover:underline">
            ← {t("deliveries.backToRuns")}
          </a>
          <h1 className="text-lg font-semibold">{run.name}</h1>
          {info && <span className="text-xs text-emerald-700">{info}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {tab !== "invoices" && (
            <button type="button" className="px-3 py-1 rounded border bg-white text-sm" onClick={() => window.print()}>
              🖨 {t("deliveries.print")}
            </button>
          )}
          <button type="button" className="px-3 py-1 rounded border border-red-200 text-red-700 bg-white text-sm" onClick={deleteRun}>
            {t("deliveries.deleteRun")}
          </button>
        </div>
      </div>

      <div className="print-only">
        <h1 className="text-lg font-semibold">
          {run.name} · {run.date} {run.driver ? `· ${t("deliveries.driver")}: ${run.driver}` : ""}{" "}
          {run.vehicle ? `· ${run.vehicle}` : ""}
        </h1>
        <div className="text-sm">{tab === "loading" ? t("deliveries.loadingList") : t("deliveries.report")}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm bg-white border rounded p-3 no-print">
        {field("name", "deliveries.run")}
        <label className="space-y-1">
          <span className="text-xs text-slate-500">{t("deliveries.date")}</span>
          <input type="date" className="border rounded px-2 py-1 w-full" value={form.date} onChange={(e) => void saveRun({ date: e.target.value })} />
        </label>
        {field("driver", "deliveries.driver")}
        {field("vehicle", "deliveries.vehicle")}
        <label className="space-y-1">
          <span className="text-xs text-slate-500">{t("deliveries.state")}</span>
          <select className="border rounded px-2 py-1 w-full" value={form.state} onChange={(e) => void saveRun({ state: e.target.value as RunState })}>
            {RUN_STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.key)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 md:col-span-3">
          <span className="text-xs text-slate-500">{t("deliveries.notes")}</span>
          <input
            type="text"
            className="border rounded px-2 py-1 w-full"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            onBlur={() => void saveRun()}
          />
        </label>
      </div>

      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}

      <div className="flex flex-wrap items-center gap-2 no-print">
        {tabBtn("invoices", `${t("deliveries.invoices")} (${run.invoice_count})`)}
        {tabBtn("loading", t("deliveries.loadingList"))}
        {tabBtn("report", t("deliveries.report"))}
        <span className="text-xs text-slate-500">
          {run.pending_count > 0
            ? t("deliveries.pendingLeft").replace("{n}", String(run.pending_count))
            : run.invoice_count > 0
              ? t("deliveries.allInvoicesDone")
              : ""}
        </span>
      </div>

      {tab === "invoices" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="px-3 py-1 rounded bg-[#5c4acb] text-white cursor-pointer hover:opacity-90 text-sm">
              {uploadProgress || `⬆ ${t("deliveries.uploadInvoices")}`}
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/*"
                multiple
                className="hidden"
                disabled={!!uploadProgress}
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </label>
          </div>
          {uploadErrors.length > 0 && (
            <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">
              {t("deliveries.uploadErrors")}
              <ul>
                {uploadErrors.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
          {invoices.length === 0 && (
            <div className="text-sm text-slate-500 border border-dashed border-slate-300 px-3 py-2 rounded">{t("deliveries.noInvoices")}</div>
          )}
          {invoices.map((inv) => (
            <DeliveryCard key={inv.id} invoice={inv} t={t} onChanged={onInvoiceChanged} onRemoved={onInvoiceRemoved} />
          ))}
        </div>
      )}

      {tab === "loading" && summary && <LoadingList data={summary} t={t} />}
      {tab === "report" && summary && <DeliveryReport data={summary} t={t} fileName={`raport-livrare-${run.date}.csv`} />}
      {tab !== "invoices" && !summary && <div className="text-sm text-slate-500">{t("common.loading")}</div>}
    </div>
  );
}
