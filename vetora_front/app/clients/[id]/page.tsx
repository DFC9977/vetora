"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/apiClient";
import type { ClientDetail, ClientPatientSummary, ClientVisitHistoryEntry } from "../../../lib/types";
import { mapApiErrorToMessage } from "../../../lib/errors";
import { parseOdooDatetime } from "../../../lib/datetime";
import { useI18n } from "../../../components/I18nProvider";

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = Number(params?.id);
  const { t } = useI18n();

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId || Number.isNaN(clientId)) {
      setError("Invalid client id.");
      setLoading(false);
      return;
    }
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadData() {
    setLoading(true);
    setError(null);
    const res = await api.detailClient({ client_id: clientId });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setClient(null);
      return;
    }
    setClient(res.data);
  }

  const fullAddress =
    client && (client.street || client.city || client.zip)
      ? [client.street, client.city, client.zip].filter(Boolean).join(", ")
      : null;

  return (
    <div className="space-y-4">
      <button
        onClick={() => history.back()}
        className="text-xs text-sky-700 hover:underline"
      >
        ← {t("clients.listTitle")}
      </button>

      {loading && <div className="text-sm text-slate-500">{t("common.loading")}</div>}
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}

      {client && (
        <div className="space-y-4">
          <div className="bg-white border rounded p-4 space-y-2">
            <h1 className="text-lg font-semibold">
              {t("clients.detailTitle")}: {client.name}
            </h1>
            <div className="text-sm text-slate-700 space-y-1">
              {client.phone && (
                <div>
                  <span className="font-medium">Phone:</span> {client.phone}
                </div>
              )}
              {client.mobile && (
                <div>
                  <span className="font-medium">Mobile:</span> {client.mobile}
                </div>
              )}
              {client.email && (
                <div>
                  <span className="font-medium">Email:</span> {client.email}
                </div>
              )}
              {fullAddress && (
                <div>
                  <span className="font-medium">Address:</span> {fullAddress}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border rounded p-4 space-y-2">
            <h2 className="text-sm font-semibold">{t("clients.associatedPatients")}</h2>
            {(client.patients ?? []).length > 0 ? (
              <ul className="space-y-2 text-sm">
                {(client.patients ?? []).map((p: ClientPatientSummary) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-2">
                    <Link href={`/patients/${p.id}`} className="font-medium text-sky-700 hover:underline">
                      {p.name}
                    </Link>
                    {p.species && <span className="text-slate-600">{p.species}</span>}
                    {p.breed && <span className="text-slate-600">{p.breed}</span>}
                    {p.alerts_short && (
                      <span className="text-red-700 text-xs">Alert: {p.alerts_short}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">{t("clients.associatedPatientsEmpty")}</p>
            )}
          </div>

          <div className="bg-white border rounded p-4 space-y-2">
            <h2 className="text-sm font-semibold">{t("clients.historyTitle")}</h2>
            {(client.history ?? []).length > 0 ? (
              <ul className="space-y-2 text-sm">
                {(client.history ?? []).map((entry: ClientVisitHistoryEntry) => {
                  const start = parseOdooDatetime(entry.start_at);
                  const dateStr = start.toLocaleDateString();
                  const timeStr = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
                  return (
                    <li key={entry.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{dateStr} {timeStr}</span>
                        <Link href={`/patients/${entry.patient_id}`} className="text-sky-700 hover:underline">
                          {entry.patient_name}
                        </Link>
                        <span className="text-slate-600">{entry.doctor_name}</span>
                        <span className="text-slate-600">{entry.service_name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase text-slate-700">{entry.status}</span>
                      </div>
                      {entry.short_notes && (
                        <div className="mt-1 text-slate-600">{entry.short_notes}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-slate-500">{t("clients.historyEmpty")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

