"use client";

import type { DeliverySummary } from "../lib/types";
import { formatQty } from "../lib/goods";

function perInvoice(rows: DeliverySummary["products"][number]["invoices"]) {
  const merged = new Map<number, { label: string; quantity: number }>();
  for (const i of rows) {
    const cur = merged.get(i.invoice_id) || { label: `${i.customer_name || ""} (${i.invoice_name || ""})`.trim(), quantity: 0 };
    cur.quantity += i.quantity;
    merged.set(i.invoice_id, cur);
  }
  return Array.from(merged.values());
}

/** Centralized loading list: total quantity to load per product, grouped by producer. */
export function LoadingList({ data, t }: { data: DeliverySummary; t: (k: string) => string }) {
  const groups = new Map<string, DeliverySummary["products"]>();
  for (const p of data.products) {
    const key = p.producer || t("goods.notInCatalog");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return (
    <div className="space-y-3">
      <div className="text-sm">
        <b>{t("deliveries.totalToLoad")}:</b> {formatQty(data.totals.quantity)} {t("deliveries.bucati")} · {data.products.length}{" "}
        {t("deliveries.products").toLowerCase()} · {data.totals.invoices} {t("deliveries.invoices").toLowerCase()}
      </div>
      {Array.from(groups.entries()).map(([producer, rows]) => (
        <div key={producer} className="border rounded bg-white overflow-auto">
          <div className="px-3 py-2 bg-slate-50 border-b font-semibold text-sm flex justify-between">
            <span>{producer}</span>
            <span>
              {formatQty(rows.reduce((s, r) => s + r.quantity, 0))} {t("deliveries.bucati")}
            </span>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="text-left px-3 py-1 w-8">✓</th>
                <th className="text-left px-3 py-1">{t("goods.code")}</th>
                <th className="text-left px-3 py-1">{t("goods.product")}</th>
                <th className="text-right px-3 py-1">{t("goods.totalQty")}</th>
                <th className="text-left px-3 py-1">{t("deliveries.perInvoice")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_key} className="border-b">
                  <td className="px-3 py-2">
                    <span className="inline-block border rounded" style={{ width: 16, height: 16 }} />
                  </td>
                  <td className="px-3 py-2 text-slate-500">{r.product_code || "–"}</td>
                  <td className="px-3 py-2">{r.product_name}</td>
                  <td className="px-3 py-2 text-right font-semibold text-lg whitespace-nowrap">
                    {formatQty(r.quantity)} <span className="text-xs text-slate-500">{r.uom || ""}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {perInvoice(r.invoices)
                      .map((i) => `${i.label}: ${formatQty(i.quantity)}`)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
