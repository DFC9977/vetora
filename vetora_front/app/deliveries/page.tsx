"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import type { DeliveryRun } from "../../lib/types";
import { mapApiErrorToMessage } from "../../lib/errors";
import { useI18n } from "../../components/I18nProvider";
import { formatMoney } from "../../lib/goods";
import { RUN_STATES } from "../../components/deliveries/shared";

export default function DeliveriesPage() {
  const { t } = useI18n();
  const [runs, setRuns] = useState<DeliveryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    void (async () => {
      const res = await api.listDeliveryRuns({});
      setLoading(false);
      if (!res.ok) {
        setError(mapApiErrorToMessage(res.error));
        return;
      }
      setRuns(res.data.runs || []);
    })();
  }, []);

  async function createRun() {
    const res = await api.saveDeliveryRun({ run: { date: newDate } });
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    window.location.href = `/deliveries/${res.data.id}`;
  }

  const stateLabel = (s: string) => t(RUN_STATES.find((x) => x.value === s)?.key || s);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t("deliveries.title")}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href="/deliveries/report" className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
            {t("deliveries.periodReport")}
          </a>
          <input type="date" className="border rounded px-2 py-1" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <button type="button" className="px-3 py-1 rounded bg-[#5c4acb] text-white hover:opacity-90" onClick={createRun}>
            + {t("deliveries.newRun")}
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-500">{t("common.loading")}</div>}
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {!loading && !error && runs.length === 0 && (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 px-3 py-2 rounded">{t("deliveries.runsEmpty")}</div>
      )}

      {runs.length > 0 && (
        <div className="overflow-auto border rounded bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 border-b">{t("deliveries.date")}</th>
                <th className="text-left px-3 py-2 border-b">{t("deliveries.run")}</th>
                <th className="text-left px-3 py-2 border-b">{t("deliveries.driver")}</th>
                <th className="text-left px-3 py-2 border-b">{t("deliveries.state")}</th>
                <th className="text-right px-3 py-2 border-b">{t("deliveries.invoices")}</th>
                <th className="text-left px-3 py-2 border-b">{t("deliveries.status")}</th>
                <th className="text-right px-3 py-2 border-b">{t("deliveries.value")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b">{r.date}</td>
                  <td className="px-3 py-2 border-b">
                    <a href={`/deliveries/${r.id}`} className="text-sky-700 hover:underline">
                      {r.name}
                    </a>
                  </td>
                  <td className="px-3 py-2 border-b">{r.driver || "–"}</td>
                  <td className="px-3 py-2 border-b">{stateLabel(r.state)}</td>
                  <td className="px-3 py-2 border-b text-right">{r.invoice_count}</td>
                  <td className="px-3 py-2 border-b text-xs">
                    <span className="text-emerald-700">✓ {r.delivered_count}</span> ·{" "}
                    <span className="text-amber-700">◐ {r.partial_count}</span> ·{" "}
                    <span className="text-red-700">✗ {r.not_delivered_count}</span> ·{" "}
                    <span className="text-slate-500">… {r.pending_count}</span>
                  </td>
                  <td className="px-3 py-2 border-b text-right">{formatMoney(r.amount_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
