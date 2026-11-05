"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/apiClient";
import type { DeliverySummary } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { useI18n } from "../../../components/I18nProvider";
import { DeliveryReport } from "../../../components/deliveries/DeliveryReport";

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 12).toISOString().slice(0, 10);
}

export default function DeliveryPeriodReportPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState({ date_from: monthStart(), date_to: new Date().toISOString().slice(0, 10), customer: "" });
  const [data, setData] = useState<DeliverySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await api.deliverySummary({
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      customer: filters.customer || undefined,
    });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setData(res.data);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-3">
          <a href="/deliveries" className="text-sm text-sky-700 hover:underline">
            ← {t("deliveries.backToRuns")}
          </a>
          <h1 className="text-lg font-semibold">{t("deliveries.reportTitle")}</h1>
        </div>
        <button type="button" className="px-3 py-1 rounded border bg-white text-sm" onClick={() => window.print()}>
          🖨 {t("deliveries.print")}
        </button>
      </div>
      <div className="print-only">
        <h1 className="text-lg font-semibold">
          {t("deliveries.reportTitle")}: {filters.date_from} – {filters.date_to}
        </h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex flex-wrap items-end gap-2 text-sm no-print"
      >
        <label className="flex flex-col">
          <span className="text-xs text-slate-500">{t("goods.dateFrom")}</span>
          <input type="date" className="border rounded px-2 py-1" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-slate-500">{t("goods.dateTo")}</span>
          <input type="date" className="border rounded px-2 py-1" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </label>
        <input
          type="text"
          placeholder={t("goods.filterCustomer")}
          className="border rounded px-2 py-1 min-w-[180px]"
          value={filters.customer}
          onChange={(e) => setFilters({ ...filters, customer: e.target.value })}
        />
        <button type="submit" className="px-3 py-1 rounded border bg-white">
          {t("goods.filter")}
        </button>
      </form>

      {loading && <div className="text-sm text-slate-500">{t("common.loading")}</div>}
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {data && <DeliveryReport data={data} t={t} fileName={`raport-livrari-${filters.date_from}_${filters.date_to}.csv`} />}
    </div>
  );
}
