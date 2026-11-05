"use client";

import { useState } from "react";
import { api } from "../lib/api";
import type { DeliveryState, ReturnReason, SupplierInvoice } from "../lib/types";
import { errorMessage as mapApiErrorToMessage } from "../lib/api";
import { formatMoney, formatQty, parseInputNumber } from "../lib/goods";
import { DeliveryBadge, RETURN_REASONS } from "./shared";

function formatUtc(value: string) {
  const d = new Date(value.replace(" ", "T") + (value.endsWith("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" });
}

type LineEdit = { id: number; return_qty: string; return_reason: ReturnReason | ""; delivery_note: string };

function toEdits(inv: SupplierInvoice): LineEdit[] {
  return (inv.lines || []).map((l) => ({
    id: l.id as number,
    return_qty: l.return_qty ? String(l.return_qty) : "",
    return_reason: l.return_reason || "",
    delivery_note: l.delivery_note || "",
  }));
}

export function DeliveryCard({
  invoice,
  t,
  onChanged,
  onRemoved,
}: {
  invoice: SupplierInvoice;
  t: (k: string) => string;
  onChanged: (inv: SupplierInvoice) => void;
  onRemoved: (id: number) => void;
}) {
  const state = invoice.delivery_state || "pending";
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(invoice.delivery_note || "");
  const [edits, setEdits] = useState<LineEdit[]>(toEdits(invoice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(status: DeliveryState) {
    setBusy(true);
    setError(null);
    const res = await api.updateDelivery({
      invoice_id: invoice.id,
      status,
      note,
      lines:
        status === "partial" || expanded
          ? edits.map((e) => ({
              id: e.id,
              return_qty: parseInputNumber(e.return_qty),
              return_reason: e.return_reason || null,
              delivery_note: e.delivery_note || null,
            }))
          : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setEdits(toEdits(res.data));
    setExpanded(false);
    onChanged(res.data);
  }

  async function remove() {
    if (!window.confirm(t("deliveries.confirmRemove"))) return;
    const res = await api.removeRunInvoice({ invoice_id: invoice.id });
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    onRemoved(invoice.id);
  }

  const setEdit = (id: number, patch: Partial<LineEdit>) =>
    setEdits((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const btn = "px-3 py-1 rounded border text-sm";

  return (
    <div className="border rounded bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{invoice.customer_name || "–"}</span>
            <DeliveryBadge state={state} t={t} />
          </div>
          <div className="text-xs text-slate-500">
            {invoice.name || invoice.file_name} · {invoice.invoice_date || ""} · {formatMoney(invoice.amount_untaxed)} lei
          </div>
          {invoice.delivery_address && <div className="text-sm">📍 {invoice.delivery_address}</div>}
          {invoice.customer_phone && (
            <div className="text-sm">
              📞 <a className="text-sky-700" href={`tel:${invoice.customer_phone.replace(/\s/g, "")}`}>{invoice.customer_phone}</a>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <a href={`/invoice/?id=${invoice.id}`} className="text-xs text-sky-700 hover:underline">
            {t("deliveries.editInvoice")}
          </a>
          {state === "pending" && (
            <button type="button" className="link-button text-xs text-red-700" onClick={remove}>
              {t("deliveries.remove")}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="text-left py-1">{t("goods.product")}</th>
            <th className="text-right py-1">{t("goods.quantity")}</th>
            {expanded ? (
              <>
                <th className="text-right py-1">{t("deliveries.returnQty")}</th>
                <th className="text-left py-1 px-1">{t("deliveries.returnReason")}</th>
                <th className="text-left py-1">{t("deliveries.lineNote")}</th>
              </>
            ) : (
              <th className="text-right py-1">{t("deliveries.returned")}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {(invoice.lines || []).map((l) => {
            const e = edits.find((x) => x.id === l.id);
            return (
              <tr key={l.id} className="border-b">
                <td className="py-1">
                  {l.product_name}
                  {l.lot_number && <span className="text-xs text-slate-500"> · Lot {l.lot_number}</span>}
                </td>
                <td className="py-1 text-right whitespace-nowrap">
                  {formatQty(l.quantity)} {l.uom || ""}
                </td>
                {expanded && e ? (
                  <>
                    <td className="py-1 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="border rounded px-2 py-1 text-right"
                        style={{ width: 70 }}
                        value={e.return_qty}
                        onChange={(ev) => setEdit(e.id, { return_qty: ev.target.value })}
                      />
                    </td>
                    <td className="py-1 px-1">
                      <select
                        className="border rounded px-1 py-1"
                        value={e.return_reason}
                        onChange={(ev) => setEdit(e.id, { return_reason: ev.target.value as ReturnReason | "" })}
                      >
                        <option value="">–</option>
                        {RETURN_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {t(r.key)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1">
                      <input
                        type="text"
                        className="border rounded px-2 py-1 w-full"
                        style={{ minWidth: 120 }}
                        value={e.delivery_note}
                        onChange={(ev) => setEdit(e.id, { delivery_note: ev.target.value })}
                      />
                    </td>
                  </>
                ) : (
                  <td className="py-1 text-right">
                    {l.return_qty ? (
                      <span className="text-red-700">
                        {formatQty(l.return_qty)}
                        {l.delivery_note && <span className="text-xs text-slate-500"> ({l.delivery_note})</span>}
                      </span>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <textarea
        className="border rounded px-2 py-1 w-full text-sm"
        rows={2}
        placeholder={t("deliveries.notePlaceholder")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}

      <div className="flex flex-wrap gap-2 no-print">
        {expanded ? (
          <>
            <button type="button" disabled={busy} className={`${btn} bg-[#5c4acb] text-white`} onClick={() => void submit("partial")}>
              {t("deliveries.saveDelivery")}
            </button>
            <button type="button" disabled={busy} className={btn} onClick={() => setExpanded(false)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} className={`${btn} bg-emerald-50 text-emerald-700 border-emerald-200`} onClick={() => void submit("delivered")}>
              ✓ {t("deliveries.markDelivered")}
            </button>
            <button type="button" disabled={busy} className={`${btn} bg-amber-50 text-amber-700 border-amber-200`} onClick={() => setExpanded(true)}>
              {t("deliveries.markPartial")}
            </button>
            <button type="button" disabled={busy} className={`${btn} bg-red-50 text-red-700 border-red-200`} onClick={() => void submit("not_delivered")}>
              ✗ {t("deliveries.markNotDelivered")}
            </button>
            {state !== "pending" && (
              <button type="button" disabled={busy} className={btn} onClick={() => void submit("pending")}>
                {t("deliveries.resetPending")}
              </button>
            )}
          </>
        )}
      </div>
      {invoice.delivered_at && state !== "pending" && (
        <div className="text-xs text-slate-500">
          {t("deliveries.deliveredAt")}: {formatUtc(invoice.delivered_at)}
        </div>
      )}
    </div>
  );
}
