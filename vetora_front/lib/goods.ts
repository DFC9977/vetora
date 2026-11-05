export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",", 2)[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function formatMoney(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return value.toLocaleString("ro-RO", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return value.toLocaleString("ro-RO", { maximumFractionDigits: 3 });
}

/** Parse user input accepting both "1.234,56" and "1234.56". */
export function parseInputNumber(raw: string): number {
  let t = (raw || "").trim().replace(/\s/g, "");
  if (!t) return 0;
  if (t.includes(",") && t.includes(".")) {
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (t.includes(",")) {
    t = t.replace(",", ".");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export function downloadBase64(base64: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const lower = fileName.toLowerCase();
  const type = lower.endsWith(".pdf")
    ? "application/pdf"
    : lower.match(/\.(png)$/)
      ? "image/png"
      : lower.match(/\.(jpe?g)$/)
        ? "image/jpeg"
        : "application/octet-stream";
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadCsv(rows: (string | number | null)[][], fileName: string) {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
