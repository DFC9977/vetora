"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/apiClient";
import type { SupplierInvoice } from "../../lib/types";
import { mapApiErrorToMessage } from "../../lib/errors";
import { useI18n } from "../../components/I18nProvider";
import { fileToBase64, formatMoney } from "../../lib/goods";
import { StateBadge, extractionLabel } from "../../components/GoodsBadges";

export default function GoodsInvoicesPage() {
  const { t } = useI18n();
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"" | "draft" | "confirmed">("");
  const [supplier, setSupplier] = useState("");
  const [customer, setCustomer] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await api.listSupplierInvoices({
      state: state || undefined,
      supplier: supplier || undefined,
      customer: customer || undefined,
    });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setInvoices([]);
      return;
    }
    setInvoices(res.data.invoices || []);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    let lastId: number | null = null;
    for (const file of Array.from(files)) {
      const file_base64 = await fileToBase64(file);
      const res = await api.uploadSupplierInvoice({ file_base64, file_name: file.name });
      if (!res.ok) {
        setError(`${file.name}: ${mapApiErrorToMessage(res.error)}`);
        continue;
      }
      lastId = res.data.id;
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (files.length === 1 && lastId) {
      window.location.href = `/goods/${lastId}`;
      return;
    }
    await load();
  }

  async function handleNewManual() {
    const res = await api.saveSupplierInvoice({ invoice: { lines: [] } });
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    window.location.href = `/goods/${res.data.id}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t("goods.invoicesTitle")}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href="/goods/registry" className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
            {t("goods.openRegistry")}
          </a>
          <a href="/goods/catalog" className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
            {t("goods.openCatalog")}
          </a>
          <button type="button" onClick={handleNewManual} className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
            {t("goods.newManual")}
          </button>
          <label className="px-3 py-1 rounded bg-[#5c4acb] text-white cursor-pointer hover:opacity-90">
            {uploading ? t("goods.uploading") : t("goods.upload")}
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </label>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <select className="border rounded px-2 py-1" value={state} onChange={(e) => setState(e.target.value as typeof state)}>
          <option value="">{t("goods.allStates")}</option>
          <option value="draft">{t("goods.draft")}</option>
          <option value="confirmed">{t("goods.confirmed")}</option>
        </select>
        <input
          type="text"
          placeholder={t("goods.filterSupplier")}
          className="border rounded px-2 py-1 min-w-[220px]"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
        <input
          type="text"
          placeholder={t("goods.filterCustomer")}
          className="border rounded px-2 py-1 min-w-[220px]"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        />
        <button type="submit" className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
          {t("goods.filter")}
        </button>
      </form>

      {(loading || uploading) && (
        <div className="text-sm text-slate-500">{uploading ? t("goods.uploading") : t("common.loading")}</div>
      )}
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {!loading && !error && invoices.length === 0 && (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 px-3 py-2 rounded">
          {t("goods.noInvoices")}
        </div>
      )}

      {invoices.length > 0 && (
        <div className="overflow-auto border rounded bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 border-b">{t("goods.invoiceDate")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.number")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.supplier")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.customer")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.lines")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.total")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.extraction")}</th>
                <th className="text-left px-3 py-2 border-b">{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b">{inv.invoice_date || "–"}</td>
                  <td className="px-3 py-2 border-b">
                    <a href={`/goods/${inv.id}`} className="text-sky-700 hover:underline">
                      {inv.name || inv.file_name || `#${inv.id}`}
                    </a>
                  </td>
                  <td className="px-3 py-2 border-b">{inv.supplier_name || "–"}</td>
                  <td className="px-3 py-2 border-b">{inv.customer_name || "–"}</td>
                  <td className="px-3 py-2 border-b text-right">{inv.line_count}</td>
                  <td className="px-3 py-2 border-b text-right">{formatMoney(inv.amount_untaxed)}</td>
                  <td className="px-3 py-2 border-b">{extractionLabel(t, inv.extraction_method)}</td>
                  <td className="px-3 py-2 border-b">
                    <StateBadge state={inv.state} label={t(`goods.${inv.state}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
