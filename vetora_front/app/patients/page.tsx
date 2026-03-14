"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import type { VetPatient } from "../../lib/types";
import { mapApiErrorToMessage } from "../../lib/errors";
import { useI18n } from "../../components/I18nProvider";

export default function PatientsPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<VetPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadPatients();
  }, []);

  async function loadPatients(search?: string) {
    setLoading(true);
    setError(null);
    const res = await api.lookupPatients({ query: search ?? "" });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setPatients([]);
      return;
    }
    setPatients(res.data);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    await loadPatients(query);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("patients.listTitle")}</h1>

      <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="text"
          placeholder={t("patients.searchPlaceholder")}
          className="border rounded px-2 py-1 min-w-[240px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className="px-3 py-1 rounded border bg-white hover:bg-slate-50"
        >
          {t("common.save")}
        </button>
      </form>

      {loading && <div className="text-sm text-slate-500">{t("common.loading")}</div>}
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {!loading && !error && patients.length === 0 && (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 px-3 py-2 rounded">
          {t("patients.historyEmpty")}
        </div>
      )}

      {patients.length > 0 && (
        <div className="overflow-auto border rounded bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 border-b">{t("patients.listTitle")}</th>
                <th className="text-left px-3 py-2 border-b">Owner</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b">
                    <a href={`/patients/${p.id}`} className="text-sky-700 hover:underline">
                      {p.name}
                    </a>
                  </td>
                  <td className="px-3 py-2 border-b">{p.owner_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

