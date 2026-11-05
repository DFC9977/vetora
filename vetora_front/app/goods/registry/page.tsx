"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/apiClient";
import type { GoodsRegistryData } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { useI18n } from "../../../components/I18nProvider";
import { downloadCsv, formatMoney, formatQty } from "../../../lib/goods";

type Filters = {
  date_from: string;
  date_to: string;
  supplier: string;
  customer: string;
  producer: string;
  product: string;
};

const EMPTY_FILTERS: Filters = { date_from: "", date_to: "", supplier: "", customer: "", producer: "", product: "" };

export default function GoodsRegistryPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<GoodsRegistryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load(EMPTY_FILTERS);
  }, []);

  async function load(f: Filters = filters) {
    setLoading(true);
    setError(null);
    const payload: Record<string, string> = {};
    (Object.keys(f) as (keyof Filters)[]).forEach((k) => {
      if (f[k].trim()) payload[k] = f[k].trim();
    });
    const res = await api.goodsRegistry(payload);
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setData(null);
      return;
    }
    setData(res.data);
  }

  function filterByProducer(producer: string | null) {
    const next = { ...filters, producer: producer || "" };
    setFilters(next);
    void load(next);
  }

  function exportCsv() {
    if (!data) return;
    const header = [
      t("goods.producer"),
      t("goods.code"),
      t("goods.ean"),
      t("goods.product"),
      t("goods.uom"),
      t("goods.totalQty"),
      t("goods.totalValue"),
      t("goods.discount"),
      t("goods.avgPrice"),
      t("goods.lastPrice"),
      t("goods.lastPurchase"),
      t("goods.invoiceCount"),
      t("goods.customers"),
    ];
    const rows = data.rows.map((r) => [
      r.producer,
      r.product_code,
      r.ean,
      r.product_name,
      r.uom,
      r.total_quantity,
      r.total_amount,
      r.total_discount,
      r.avg_price,
      r.last_price,
      r.last_date,
      r.invoice_count,
      r.customers.join(", "),
    ]);
    downloadCsv([header, ...rows], `registru-marfa-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const textFilter = (key: keyof Filters, label: string) => (
    <input
      type="text"
      placeholder={t(label)}
      className="border rounded px-2 py-1 min-w-[180px]"
      value={filters[key]}
      onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <a href="/goods" className="text-sm text-sky-700 hover:underline">
            ← {t("goods.backToInvoices")}
          </a>
          <h1 className="text-lg font-semibold">{t("goods.registryTitle")}</h1>
        </div>
        <button type="button" disabled={!data?.rows.length} onClick={exportCsv} className="px-3 py-1 rounded border bg-white hover:bg-slate-50 text-sm disabled:opacity-50">
          {t("goods.exportCsv")}
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex flex-wrap items-end gap-2 text-sm"
      >
        <label className="flex flex-col">
          <span className="text-xs text-slate-500">{t("goods.dateFrom")}</span>
          <input type="date" className="border rounded px-2 py-1" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-slate-500">{t("goods.dateTo")}</span>
          <input type="date" className="border rounded px-2 py-1" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </label>
        {textFilter("producer", "goods.filterProducer")}
        {textFilter("customer", "goods.filterCustomer")}
        {textFilter("product", "goods.filterProduct")}
        <button type="submit" className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
          {t("goods.filter")}
        </button>
      </form>

      {loading && <div className="text-sm text-slate-500">{t("common.loading")}</div>}
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}

      {data && (
        <div className="flex flex-wrap gap-3 text-sm">
          <Stat label={t("goods.products")} value={String(data.totals.products)} />
          <Stat label={t("goods.totalQty")} value={formatQty(data.totals.quantity)} />
          <Stat label={t("goods.invoiceCount")} value={String(data.totals.invoices)} />
          <Stat label={t("goods.totalValue")} value={formatMoney(data.totals.amount)} />
          {data.totals.unmatched > 0 && <Stat label={t("goods.unmatched")} value={String(data.totals.unmatched)} warn />}
        </div>
      )}

      {data && data.by_producer.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{t("goods.byProducer")}</h2>
          <div className="overflow-auto border rounded bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 border-b">{t("goods.producer")}</th>
                  <th className="text-right px-3 py-2 border-b">{t("goods.products")}</th>
                  <th className="text-right px-3 py-2 border-b">{t("goods.totalQty")}</th>
                  <th className="text-right px-3 py-2 border-b">{t("goods.totalValue")}</th>
                </tr>
              </thead>
              <tbody>
                {data.by_producer.map((p) => (
                  <tr key={p.producer || "-"} className="hover:bg-slate-50">
                    <td className="px-3 py-2 border-b">
                      {p.producer ? (
                        <button type="button" className="text-sky-700 hover:underline" onClick={() => filterByProducer(p.producer)}>
                          {p.producer}
                        </button>
                      ) : (
                        <span className="text-amber-700">{t("goods.notInCatalog")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-b text-right">{p.products}</td>
                    <td className="px-3 py-2 border-b text-right font-medium">{formatQty(p.total_quantity)}</td>
                    <td className="px-3 py-2 border-b text-right">{formatMoney(p.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.rows.length === 0 && !loading && (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 px-3 py-2 rounded">{t("goods.registryEmpty")}</div>
      )}

      {data && data.rows.length > 0 && (
        <div className="overflow-auto border rounded bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 border-b">{t("goods.producer")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.code")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.product")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.uom")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.totalQty")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.totalValue")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.avgPrice")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.lastPrice")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.lastPurchase")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.invoiceCount")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.customers")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.product_key} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b text-xs">
                    {r.producer || <span className="text-amber-700">{t("goods.notInCatalog")}</span>}
                  </td>
                  <td className="px-3 py-2 border-b text-slate-500">{r.product_code || "–"}</td>
                  <td className="px-3 py-2 border-b">{r.product_name}</td>
                  <td className="px-3 py-2 border-b">{r.uom || "–"}</td>
                  <td className="px-3 py-2 border-b text-right font-medium">{formatQty(r.total_quantity)}</td>
                  <td className="px-3 py-2 border-b text-right">
                    {formatMoney(r.total_amount)}
                    {r.total_discount > 0 && (
                      <div className="text-xs text-slate-500">
                        {t("goods.discount")}: {formatMoney(r.total_discount)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 border-b text-right">{formatMoney(r.avg_price)}</td>
                  <td className="px-3 py-2 border-b text-right">{formatMoney(r.last_price)}</td>
                  <td className="px-3 py-2 border-b">{r.last_date || "–"}</td>
                  <td className="px-3 py-2 border-b text-right">{r.invoice_count}</td>
                  <td className="px-3 py-2 border-b text-xs">{r.customers.join(", ") || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`border rounded px-3 py-2 ${warn ? "bg-amber-50 border-amber-200" : "bg-white"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-semibold ${warn ? "text-amber-700" : ""}`}>{value}</div>
    </div>
  );
}
