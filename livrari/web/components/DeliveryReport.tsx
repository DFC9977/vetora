"use client";

import type { DeliverySummary } from "../lib/types";
import { downloadCsv, formatMoney, formatQty } from "../lib/goods";
import { DeliveryBadge, reasonLabel } from "./shared";

/** Delivery report: invoices with their status + loaded/delivered/returned totals per product. */
export function DeliveryReport({ data, t, fileName }: { data: DeliverySummary; t: (k: string) => string; fileName: string }) {
  const returns = data.products.flatMap((p) =>
    p.invoices.filter((i) => i.returned_qty > 0).map((i) => ({ ...i, product_name: p.product_name, uom: p.uom })),
  );

  function exportCsv() {
    const rows: (string | number | null | undefined)[][] = [
      [t("deliveries.invoices")],
      [t("goods.number"), t("goods.invoiceDate"), t("deliveries.customer"), t("deliveries.value"), t("deliveries.status"), t("deliveries.deliveryNote")],
      ...data.invoices.map((i) => [
        i.name,
        i.invoice_date,
        i.customer_name,
        i.amount_untaxed,
        t(`deliveries.${i.delivery_state || "pending"}`),
        i.delivery_note,
      ]),
      [],
      [t("deliveries.products")],
      [t("goods.producer"), t("goods.code"), t("goods.product"), t("goods.uom"), t("deliveries.loaded"), t("deliveries.deliveredQty"), t("deliveries.returned")],
      ...data.products.map((p) => [p.producer, p.product_code, p.product_name, p.uom, p.quantity, p.delivered_qty, p.returned_qty]),
    ];
    downloadCsv(rows, fileName);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Stat label={t("deliveries.invoices")} value={String(data.totals.invoices)} />
        <Stat label={t("deliveries.delivered")} value={String(data.counts.delivered)} cls="text-emerald-700" />
        <Stat label={t("deliveries.partial")} value={String(data.counts.partial)} cls="text-amber-700" />
        <Stat label={t("deliveries.not_delivered")} value={String(data.counts.not_delivered)} cls="text-red-700" />
        <Stat label={t("deliveries.pending")} value={String(data.counts.pending)} />
        <Stat label={t("deliveries.loaded")} value={formatQty(data.totals.quantity)} />
        <Stat label={t("deliveries.deliveredQty")} value={formatQty(data.totals.delivered_qty)} cls="text-emerald-700" />
        <Stat label={t("deliveries.returned")} value={formatQty(data.totals.returned_qty)} cls="text-red-700" />
        <Stat label={t("deliveries.value")} value={formatMoney(data.totals.amount)} />
        <button type="button" className="px-3 py-1 rounded border bg-white no-print" onClick={exportCsv}>
          {t("goods.exportCsv")}
        </button>
      </div>

      <div className="overflow-auto border rounded bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-3 py-2 border-b">{t("goods.number")}</th>
              <th className="text-left px-3 py-2 border-b">{t("deliveries.customer")}</th>
              <th className="text-left px-3 py-2 border-b">{t("deliveries.address")}</th>
              <th className="text-right px-3 py-2 border-b">{t("deliveries.value")}</th>
              <th className="text-left px-3 py-2 border-b">{t("deliveries.status")}</th>
              <th className="text-left px-3 py-2 border-b">{t("deliveries.deliveryNote")}</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2 border-b whitespace-nowrap">
                  {i.name}
                  {i.run_name && !data.run && <div className="text-xs text-slate-500">{i.run_name}</div>}
                </td>
                <td className="px-3 py-2 border-b">{i.customer_name || "–"}</td>
                <td className="px-3 py-2 border-b text-xs">{i.delivery_address || "–"}</td>
                <td className="px-3 py-2 border-b text-right">{formatMoney(i.amount_untaxed)}</td>
                <td className="px-3 py-2 border-b">
                  <DeliveryBadge state={i.delivery_state || "pending"} t={t} />
                </td>
                <td className="px-3 py-2 border-b text-xs">{i.delivery_note || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-auto border rounded bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-3 py-2 border-b">{t("goods.producer")}</th>
              <th className="text-left px-3 py-2 border-b">{t("goods.code")}</th>
              <th className="text-left px-3 py-2 border-b">{t("goods.product")}</th>
              <th className="text-right px-3 py-2 border-b">{t("deliveries.loaded")}</th>
              <th className="text-right px-3 py-2 border-b">{t("deliveries.deliveredQty")}</th>
              <th className="text-right px-3 py-2 border-b">{t("deliveries.returned")}</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.product_key}>
                <td className="px-3 py-2 border-b text-xs">{p.producer || "–"}</td>
                <td className="px-3 py-2 border-b text-slate-500">{p.product_code || "–"}</td>
                <td className="px-3 py-2 border-b">{p.product_name}</td>
                <td className="px-3 py-2 border-b text-right">{formatQty(p.quantity)}</td>
                <td className="px-3 py-2 border-b text-right text-emerald-700">{formatQty(p.delivered_qty)}</td>
                <td className={`px-3 py-2 border-b text-right ${p.returned_qty ? "text-red-700 font-semibold" : "text-slate-400"}`}>
                  {formatQty(p.returned_qty)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("deliveries.returnsTitle")}</h2>
        {returns.length === 0 ? (
          <div className="text-sm text-slate-500">{t("deliveries.noReturns")}</div>
        ) : (
          <div className="overflow-auto border rounded bg-white">
            <table className="min-w-full text-sm">
              <tbody>
                {returns.map((r, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2 border-b">{r.invoice_name}</td>
                    <td className="px-3 py-2 border-b">{r.customer_name}</td>
                    <td className="px-3 py-2 border-b">{r.product_name}</td>
                    <td className="px-3 py-2 border-b text-right text-red-700 font-semibold">
                      {formatQty(r.returned_qty)} {r.uom || ""}
                    </td>
                    <td className="px-3 py-2 border-b">{reasonLabel(t, r.return_reason)}</td>
                    <td className="px-3 py-2 border-b text-xs">{r.delivery_note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="border rounded bg-white px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-semibold ${cls || ""}`}>{value}</div>
    </div>
  );
}
