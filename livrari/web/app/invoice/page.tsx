"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, errorMessage, invoiceFileUrl } from "../../lib/api";
import type { Invoice } from "../../lib/types";
import { useT } from "../../lib/i18n";
import { formatMoney, parseInputNumber } from "../../lib/goods";
import { DeliveryBadge } from "../../components/shared";

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

const HEADER_FIELDS = [
  ["name", "goods.number", "text"],
  ["invoice_date", "goods.invoiceDate", "date"],
  ["supplier_name", "goods.supplier", "text"],
  ["supplier_vat", "goods.supplierVat", "text"],
  ["customer_name", "goods.customer", "text"],
  ["customer_vat", "goods.customerVat", "text"],
  ["customer_phone", "deliveries.phone", "text"],
  ["delivery_address", "deliveries.address", "text"],
] as const;

type HeaderKey = (typeof HEADER_FIELDS)[number][0] | "notes";
type HeaderForm = Record<HeaderKey, string>;

const LINE_FIELDS = [
  "product_code",
  "product_name",
  "uom",
  "quantity",
  "price_unit",
  "vat_rate",
  "discount_amount",
  "lot_number",
  "expiry_date",
] as const;
const NUMERIC: readonly string[] = ["quantity", "price_unit", "vat_rate", "discount_amount"];
const MIN_WIDTH: Record<string, number> = {
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

let seq = 0;
const newKey = () => `l${++seq}`;

function toForm(inv: Invoice): { header: HeaderForm; lines: LineForm[] } {
  return {
    header: {
      name: inv.name || "",
      invoice_date: inv.invoice_date || "",
      supplier_name: inv.supplier_name || "",
      supplier_vat: inv.supplier_vat || "",
      customer_name: inv.customer_name || "",
      customer_vat: inv.customer_vat || "",
      customer_phone: inv.customer_phone || "",
      delivery_address: inv.delivery_address || "",
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
  uom: "BUC",
  quantity: "1",
  price_unit: "",
  vat_rate: "",
  discount_amount: "",
  lot_number: "",
  expiry_date: "",
  catalog_code: null,
  producer: null,
});

export default function InvoicePageWrapper() {
  return (
    <Suspense>
      <InvoicePage />
    </Suspense>
  );
}

function InvoicePage() {
  const t = useT();
  const invoiceId = Number(useSearchParams().get("id"));
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [header, setHeader] = useState<HeaderForm | null>(null);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!invoiceId) return;
    void (async () => {
      const res = await api.getInvoice({ invoice_id: invoiceId });
      setLoading(false);
      if (!res.ok) {
        setError(errorMessage(res.error));
        return;
      }
      apply(res.data);
    })();
  }, [invoiceId]);

  function apply(inv: Invoice) {
    setInvoice(inv);
    const f = toForm(inv);
    setHeader(f.header);
    setLines(f.lines);
  }

  const linesLocked = (invoice?.delivery_state || "pending") !== "pending";

  async function save() {
    if (!header) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const res = await api.saveInvoice({
      invoice: {
        id: invoiceId,
        ...header,
        invoice_date: header.invoice_date || null,
        ...(linesLocked
          ? {}
          : {
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
            }),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    apply(res.data);
    setSuccess(t("common.successSaved"));
  }

  const lineNet = (l: LineForm) =>
    parseInputNumber(l.quantity) * parseInputNumber(l.price_unit) - parseInputNumber(l.discount_amount);
  const total = lines.reduce((s, l) => s + lineNet(l), 0);
  const setLine = (key: string, field: keyof LineForm, value: string) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  if (loading) return <div className="text-sm text-slate-500">{t("common.loading")}</div>;
  if (!invoice || !header) {
    return <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>;
  }
  const input = "border rounded px-2 py-1 w-full disabled:bg-slate-50 disabled:text-slate-600";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {invoice.run_id && (
            <a href={`/run/?id=${invoice.run_id}`} className="text-sm text-sky-700 hover:underline">
              ← {t("deliveries.backToRun")}
            </a>
          )}
          <h1 className="text-lg font-semibold">{invoice.name || invoice.file_name || `#${invoice.id}`}</h1>
          <DeliveryBadge state={invoice.delivery_state || "pending"} t={t} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {invoice.has_file && (
            <a href={invoiceFileUrl(invoice.id)} target="_blank" rel="noreferrer" className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
              {t("goods.viewFile")}
            </a>
          )}
          <button type="button" disabled={busy} onClick={() => void save()} className="px-3 py-1 rounded bg-[#5c4acb] text-white hover:opacity-90">
            {t("common.save")}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {success && <div className="text-sm text-emerald-700 border border-emerald-200 bg-emerald-50 px-3 py-2 rounded">{success}</div>}
      <div className="text-xs text-slate-600 border border-slate-200 bg-slate-50 px-3 py-2 rounded">
        {linesLocked
          ? "Livrarea este înregistrată – produsele nu se mai pot modifica. Resetați statusul livrării din cursă pentru corecturi."
          : t("goods.reviewHint")}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm bg-white border rounded p-3">
        {HEADER_FIELDS.map(([field, label, type]) => (
          <label key={field} className="space-y-1">
            <span className="text-xs text-slate-500">{t(label)}</span>
            <input type={type} className={input} value={header[field]} onChange={(e) => setHeader({ ...header, [field]: e.target.value })} />
          </label>
        ))}
        <label className="space-y-1 md:col-span-4">
          <span className="text-xs text-slate-500">{t("goods.notes")}</span>
          <input type="text" className={input} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
        </label>
      </div>

      {lines.length === 0 && !linesLocked && (
        <div className="text-sm text-amber-700 border border-amber-200 bg-amber-50 px-3 py-2 rounded">{t("goods.noLinesExtracted")}</div>
      )}

      <div className="overflow-auto border rounded bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-2 py-2 border-b">#</th>
              <th className="text-left px-2 py-2 border-b">{t("goods.code")}</th>
              <th className="text-left px-2 py-2 border-b">{t("goods.product")}</th>
              <th className="text-left px-2 py-2 border-b">{t("goods.uom")}</th>
              <th className="text-right px-2 py-2 border-b">{t("goods.quantity")}</th>
              <th className="text-right px-2 py-2 border-b">{t("goods.priceUnit")}</th>
              <th className="text-right px-2 py-2 border-b">{t("goods.vat")}</th>
              <th className="text-right px-2 py-2 border-b">{t("goods.discount")}</th>
              <th className="text-left px-2 py-2 border-b">{t("goods.lot")}</th>
              <th className="text-left px-2 py-2 border-b">{t("goods.expiry")}</th>
              <th className="text-right px-2 py-2 border-b">{t("goods.value")}</th>
              <th className="text-left px-2 py-2 border-b">{t("goods.catalogMatch")}</th>
              {!linesLocked && <th className="px-2 py-2 border-b" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.key}>
                <td className="px-2 py-1 border-b text-slate-500">{idx + 1}</td>
                {LINE_FIELDS.map((field) => (
                  <td key={field} className="px-2 py-1 border-b">
                    <input
                      type={field === "expiry_date" ? "date" : "text"}
                      inputMode={NUMERIC.includes(field) ? "decimal" : undefined}
                      disabled={linesLocked}
                      style={{ minWidth: MIN_WIDTH[field] }}
                      className={`${input} ${NUMERIC.includes(field) ? "text-right" : ""}`}
                      value={l[field]}
                      onChange={(e) => setLine(l.key, field, e.target.value)}
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
                {!linesLocked && (
                  <td className="px-2 py-1 border-b text-right">
                    <button type="button" className="link-button text-xs text-red-700" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
                      {t("goods.removeLine")}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={10} className="px-2 py-2 text-right">
                {t("goods.total")}
              </td>
              <td className="px-2 py-2 text-right">{formatMoney(total)}</td>
              <td colSpan={linesLocked ? 1 : 2} />
            </tr>
          </tfoot>
        </table>
      </div>
      {!linesLocked && (
        <button type="button" onClick={() => setLines((p) => [...p, emptyLine()])} className="px-3 py-1 rounded border bg-white hover:bg-slate-50 text-sm">
          + {t("goods.addLine")}
        </button>
      )}

      {invoice.raw_text && (
        <div className="text-sm">
          <button type="button" className="link-button text-sky-700" onClick={() => setShowRaw((v) => !v)}>
            {t("goods.rawText")} {showRaw ? "▲" : "▼"}
          </button>
          {showRaw && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs bg-slate-50 border rounded p-3">{invoice.raw_text}</pre>}
        </div>
      )}
    </div>
  );
}
