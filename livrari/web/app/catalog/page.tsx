"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { CatalogProduct as GoodsCatalogProduct } from "../../lib/types";
import { errorMessage as mapApiErrorToMessage } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { fileToBase64, formatMoney } from "../../lib/goods";

export default function GoodsCatalogPage() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<GoodsCatalogProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load("");
  }, []);

  async function load(q: string = query) {
    setLoading(true);
    setError(null);
    const res = await api.listCatalog({ query: q || undefined, limit: 300 });
    setLoading(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      setProducts([]);
      return;
    }
    setProducts(res.data.products || []);
    setTotal(res.data.total || 0);
  }

  async function handleImport(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    setSuccess(null);
    const res = await api.importCatalog({ file_base64: await fileToBase64(file), file_name: file.name });
    setImporting(false);
    if (fileInput.current) fileInput.current.value = "";
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    setSuccess(
      t("goods.importResult")
        .replace("{created}", String(res.data.created))
        .replace("{updated}", String(res.data.updated))
        .replace("{skipped}", String(res.data.skipped)),
    );
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <a href="/" className="text-sm text-sky-700 hover:underline">
            ← {t("deliveries.backToRuns")}
          </a>
          <h1 className="text-lg font-semibold">{t("goods.catalogTitle")}</h1>
        </div>
        <label className="px-3 py-1 rounded bg-[#5c4acb] text-white cursor-pointer hover:opacity-90 text-sm">
          {importing ? t("goods.importing") : t("goods.importCatalog")}
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            disabled={importing}
            onChange={(e) => void handleImport(e.target.files)}
          />
        </label>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <input
          type="text"
          placeholder={t("goods.catalogSearch")}
          className="border rounded px-2 py-1 min-w-[220px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="px-3 py-1 rounded border bg-white hover:bg-slate-50">
          {t("goods.search")}
        </button>
        {total > 0 && (
          <span className="text-xs text-slate-500">
            {t("goods.showing").replace("{shown}", String(products.length)).replace("{total}", String(total))}
          </span>
        )}
      </form>

      {loading && <div className="text-sm text-slate-500">{t("common.loading")}</div>}
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">{error}</div>}
      {success && <div className="text-sm text-emerald-700 border border-emerald-200 bg-emerald-50 px-3 py-2 rounded">{success}</div>}
      {!loading && !error && products.length === 0 && (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 px-3 py-2 rounded">{t("goods.catalogEmpty")}</div>
      )}

      {products.length > 0 && (
        <div className="overflow-auto border rounded bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 border-b">{t("goods.producer")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.code")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.ean")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.product")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.listPrice")}</th>
                <th className="text-right px-3 py-2 border-b">{t("goods.vat")}</th>
                <th className="text-left px-3 py-2 border-b">{t("goods.hsCode")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border-b text-xs">{p.producer || "–"}</td>
                  <td className="px-3 py-2 border-b">{p.internal_code || "–"}</td>
                  <td className="px-3 py-2 border-b text-slate-500">{p.ean || "–"}</td>
                  <td className="px-3 py-2 border-b">{p.name}</td>
                  <td className="px-3 py-2 border-b text-right">{formatMoney(p.price)}</td>
                  <td className="px-3 py-2 border-b text-right">{p.vat_rate ? `${p.vat_rate}%` : "–"}</td>
                  <td className="px-3 py-2 border-b text-slate-500">{p.hs_code || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
