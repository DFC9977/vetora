import type { SupplierInvoice } from "../lib/types";

export function extractionLabel(t: (k: string) => string, method: SupplierInvoice["extraction_method"]) {
  const map: Record<string, string> = {
    text: "goods.extractionText",
    ocr: "goods.extractionOcr",
    manual: "goods.extractionManual",
    none: "goods.extractionNone",
  };
  return t(map[method] || "goods.extractionNone");
}

export function StateBadge({ state, label }: { state: SupplierInvoice["state"]; label: string }) {
  const cls =
    state === "confirmed"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}
