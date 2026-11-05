"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/apiClient";
import type { SupplierInvoice } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { useI18n } from "../../../components/I18nProvider";
import { StateBadge, extractionLabel } from "../../../components/GoodsBadges";
import { downloadBase64, formatMoney, parseInputNumber } from "../../../lib/goods";

type LineForm = {
  key: string;
  product_code: string;
  product_name: string;
  uom: string;
  quantity: string;
  price_unit: string;
  vat_rate: string;
  discount_amount: string;
  lot_number: string;
  expiry_date: string;
  catalog_code: string | null;
  producer: string | null;
};

type HeaderForm = {
  name: string;
  supplier_name: string;
  supplier_vat: string;
  customer_name: string;
  customer_vat: string;
  invoice_date: string;
  notes: string;
};

const NUMERIC_FIELDS: readonly string[] = ["quantity", "price_unit", "vat_rate", "discount_amount"];

const FIELD_MIN_WIDTH: Record<string, number> = {
  product_code: 80,
  product_name: 280,
  uom: 56,
  quantity: 64,
  price_unit: 80,
  vat_rate: 48,
  discount_amount: 72,
  lot_number: 96,
  expiry_date: 130,
};

let lineSeq = 0;
const newKey = () => `l${++lineSeq}`;

function toForm(inv: SupplierInvoice): { header: HeaderForm; lines: LineForm[] } {
  return {
    header: {
      name: inv.name || "",
      supplier_name: inv.supplier_name || "",
      supplier_vat: inv.supplier_vat || "",
      customer_name: inv.customer_name || "",
      customer_vat: inv.customer_vat || "",
      invoice_date: inv.invoice_date || "",
      notes: inv.notes || "",
    },
    lines: (inv.lines || []).map((l) => ({
      key: newKey(),
      product_code: l.product_code || "",
      product_name: l.product_name,
      uom: l.uom || "",
      quantity: String(l.quantity ?? ""),
      price_unit: String(l.price_unit ?? ""),
      vat_rate: l.vat_rate ? String(l.vat_rate) : "",
      discount_amount: l.discount_amount ? String(l.discount_amount) : "",
      lot_number: l.lot_number || "",
      expiry_date: l.expiry_date || "",
      catalog_code: l.catalog_code ?? null,
      producer: l.producer ?? null,
    })),
  };
}

const emptyLine = (): LineForm => ({
  key: newKey(),
  product_code: "",
  product_name: "",
  uom: "",
  quantity: "1",
  price_unit: "",
  vat_rate: "",
  discount_amount: "",
  lot_number: "",
  expiry_date: "",
  catalog_code: null,
  producer: null,
});

export default function SupplierInvoiceDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const invoiceId = Number(params?.id);

  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null);
  const [header, setHeader] = useState<HeaderForm | null>(null);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (invoiceId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  function apply(inv: SupplierInvoice) {
    setInvoice((prev) => ({ ...inv, raw_text: inv.raw_text ?? prev?.raw_text }));
    const f = toForm(inv);
    setHeader(f.header);
    setLines(f.lines);
  }

  async function load() {
    setLoading(true);
    setError(null);
    const res = await api.getSupplierInvoice({ invoice_id: invoiceId });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    apply(res.data);
  }

  const readonly = invoice?.state === "confirmed";

  async function save(): Promise<boolean> {
    if (!header) return false;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const res = await api.saveSupplierInvoice({
      invoice: {
        id: invoiceId,
        ...header,
        invoice_date: header.invoice_date || null,
        lines: lines
          .filter((l) => l.product_name.trim())
          .map((l) => ({
            product_code: l.product_code.trim() || null,
            product_name: l.product_name.trim(),
            uom: l.uom.trim() || null,
            quantity: parseInputNumber(l.quantity),
            price_unit: parseInputNumber(l.price_unit),
            vat_rate: parseInputNumber(l.vat_rate),
            discount_amount: parseInputNumber(l.discount_amount),
            lot_number: l.lot_number.trim() || null,
            expiry_date: l.expiry_date || null,
          })),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return false;
    }
    apply(res.data);
    setSuccess(t("common.successSaved"));
    return true;
  }

  async function runAction(action: "confirm" | "reset_draft" | "reextract" | "delete") {
    if (action === "delete" && !window.confirm(t("goods.confirmDelete"))) return;
    if (action === "confirm" && !(await save())) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const res = await api.supplierInvoiceAction({ invoice_id: invoiceId, action });
    setBusy(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    if (action === "delete") {
      window.location.href = "/goods";
      return;
    }
    if (action === "reextract") {
      await load();
      return;
    }
    apply(res.data);
  }

  async function viewFile() {
    const res = await api.getSupplierInvoiceFile({ invoice_id: invoiceId });
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    downloadBase64(res.data.file_base64, res.data.file_name || "factura.pdf");
  }

  function updateLine(key: string, field: keyof LineForm, value: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  }

  const lineNet = (l: LineForm) =>
    parseInputNumber(l.quantity) * parseInputNumber(l.price_unit) - parseInputNumber(l.discount_amount);
  const total = lines.reduce((sum, l) => sum + lineNet(l), 0);

  if (loading) return <div className="text-sm text-slate-500">{t("common.loading")}</div>;
  if (!invoice || !header) {
    return <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>;
  }

  const input = "border rounded px-2 py-1 w-full disabled:bg-slate-50 disabled:text-slate-600";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <a href="/goods" className="text-sm text-sky-700 hover:underline">
            ← {t("goods.backToInvoices")}
          </a>
          <h1 className="text-lg font-semibold">{invoice.name || invoice.file_name || `#${invoice.id}`}</h1>
          <StateBadge state={invoice.state} label={t(`goods.${invoice.state}`)} />
          <span className="text-xs text-slate-500">
            {t("goods.extraction")}: {extractionLabel(t, invoice.extraction_method)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {invoice.has_file && (
            <button type="button" onClick={viewFile} className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
              {t("goods.viewFile")}
            </button>
          )}
          {!readonly && invoice.has_file && (
            <button type="button" disabled={busy} onClick={() => void runAction("reextract")} className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
              {t("goods.reextract")}
            </button>
          )}
          {!readonly && (
            <>
              <button type="button" disabled={busy} onClick={() => void runAction("delete")} className="px-3 py-1 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50">
                {t("common.delete")}
              </button>
              <button type="button" disabled={busy} onClick={() => void save()} className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
                {t("common.save")}
              </button>
              <button type="button" disabled={busy} onClick={() => void runAction("confirm")} className="px-3 py-1 rounded bg-[#5c4acb] text-white hover:opacity-90">
                {t("goods.confirm")}
              </button>
            </>
          )}
          {readonly && (
            <button type="button" disabled={busy} onClick={() => void runAction("reset_draft")} className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
              {t("goods.resetDraft")}
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {success && <div className="text-sm text-emerald-700 border border-emerald-200 bg-emerald-50 px-3 py-2 rounded">{success}</div>}
      <div className="text-xs text-slate-600 border border-slate-200 bg-slate-50 px-3 py-2 rounded">
        {readonly ? t("goods.confirmedReadonly") : t("goods.reviewHint")}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm bg-white border rounded p-3">
        {(
          [
            ["name", "goods.number", "text"],
            ["supplier_name", "goods.supplier", "text"],
            ["supplier_vat", "goods.supplierVat", "text"],
            ["invoice_date", "goods.invoiceDate", "date"],
            ["customer_name", "goods.customer", "text"],
            ["customer_vat", "goods.customerVat", "text"],
          ] as const
        ).map(([field, label, type]) => (
          <label key={field} className="space-y-1">
            <span className="text-xs text-slate-500">{t(label)}</span>
            <input
              type={type}
              disabled={readonly}
              className={input}
              value={header[field]}
              onChange={(e) => setHeader({ ...header, [field]: e.target.value })}
            />
          </label>
        ))}
        <label className="space-y-1 md:col-span-2">
          <span className="text-xs text-slate-500">{t("goods.notes")}</span>
          <input type="text" disabled={readonly} className={input} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
        </label>
      </div>

      {lines.length === 0 && !readonly && (
        <div className="text-sm text-amber-700 border border-amber-200 bg-amber-50 px-3 py-2 rounded">{t("goods.noLinesExtracted")}</div>
      )}

      <div className="overflow-auto border rounded bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-2 py-2 border-b w-8">#</th>
              <th className="text-left px-2 py-2 border-b w-32">{t("goods.code")}</th>
              <th className="text-left px-2 py-2 border-b">{t("goods.product")}</th>
              <th className="text-left px-2 py-2 border-b w-20">{t("goods.uom")}</th>
              <th className="text-right px-2 py-2 border-b w-24">{t("goods.quantity")}</th>
              <th className="text-right px-2 py-2 border-b w-28">{t("goods.priceUnit")}</th>
              <th className="text-right px-2 py-2 border-b w-20">{t("goods.vat")}</th>
              <th className="text-right px-2 py-2 border-b w-24">{t("goods.discount")}</th>
              <th className="text-left px-2 py-2 border-b w-28">{t("goods.lot")}</th>
              <th className="text-left px-2 py-2 border-b w-32">{t("goods.expiry")}</th>
              <th className="text-right px-2 py-2 border-b w-28">{t("goods.value")}</th>
              <th className="text-left px-2 py-2 border-b">{t("goods.catalogMatch")}</th>
              {!readonly && <th className="px-2 py-2 border-b w-20" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.key}>
                <td className="px-2 py-1 border-b text-slate-500">{idx + 1}</td>
                {(
                  ["product_code", "product_name", "uom", "quantity", "price_unit", "vat_rate", "discount_amount", "lot_number", "expiry_date"] as const
                ).map((field) => (
                  <td key={field} className="px-2 py-1 border-b">
                    <input
                      type={field === "expiry_date" ? "date" : "text"}
                      style={{ minWidth: FIELD_MIN_WIDTH[field] }}
                      inputMode={NUMERIC_FIELDS.includes(field) ? "decimal" : undefined}
                      disabled={readonly}
                      className={`${input} ${NUMERIC_FIELDS.includes(field) ? "text-right" : ""}`}
                      value={l[field]}
                      onChange={(e) => updateLine(l.key, field, e.target.value)}
                    />
                  </td>
                ))}
                <td className="px-2 py-1 border-b text-right">{formatMoney(lineNet(l))}</td>
                <td className="px-2 py-1 border-b text-xs">
                  {l.catalog_code ? (
                    <span className="text-emerald-700">
                      {l.catalog_code}
                      {l.producer && <span className="text-slate-500"> · {l.producer}</span>}
                    </span>
                  ) : (
                    <span className="text-amber-700">{t("goods.notInCatalog")}</span>
                  )}
                </td>
                {!readonly && (
                  <td className="px-2 py-1 border-b text-right">
                    <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}>
                      {t("goods.removeLine")}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={10} className="px-2 py-2 text-right">{t("goods.total")}</td>
              <td className="px-2 py-2 text-right">{formatMoney(total)}</td>
              <td />
              {!readonly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      {!readonly && (
        <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])} className="px-3 py-1 rounded border bg-white hover:bg-slate-50 text-sm">
          + {t("goods.addLine")}
        </button>
      )}

      {invoice.raw_text && (
        <div className="text-sm">
          <button type="button" className="text-sky-700 hover:underline" onClick={() => setShowRaw((v) => !v)}>
            {t("goods.rawText")} {showRaw ? "▲" : "▼"}
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs bg-slate-50 border rounded p-3">{invoice.raw_text}</pre>
          )}
        </div>
      )}
    </div>
  );
}
