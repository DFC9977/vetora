import type {
  ApiError,
  ApiResponse,
  CatalogProduct,
  DeliveryRun,
  DeliveryState,
  DeliverySummary,
  Invoice,
  InvoiceLine,
  ReturnReason,
  RunState,
} from "./types";

async function post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Serverul nu răspunde. Verificați conexiunea la internet." } };
  }
  try {
    const data = (await res.json()) as ApiResponse<T> | { detail?: unknown };
    if (data && typeof data === "object" && "ok" in data) return data;
    return { ok: false, error: { code: "HTTP_ERROR", message: `Eroare server (${res.status}).` } };
  } catch {
    return { ok: false, error: { code: "HTTP_ERROR", message: `Eroare server (${res.status}).` } };
  }
}

export function errorMessage(error?: ApiError): string {
  return error?.message || "A apărut o eroare.";
}

export function invoiceFileUrl(invoiceId: number) {
  return `/api/invoices/${invoiceId}/file`;
}

export const api = {
  listRuns: (p: { date_from?: string; date_to?: string; limit?: number }) => post<{ runs: DeliveryRun[] }>("/runs/list", p),
  saveRun: (p: {
    run: { id?: number; name?: string; date?: string; driver?: string; vehicle?: string; notes?: string; state?: RunState };
  }) => post<DeliveryRun>("/runs/save", p),
  getRun: (p: { run_id: number }) => post<DeliveryRun>("/runs/get", p),
  deleteRun: (p: { run_id: number }) => post<{ deleted: boolean }>("/runs/delete", p),
  uploadRunInvoice: (p: { run_id: number; file_base64: string; file_name: string }) => post<Invoice>("/runs/upload", p),

  getInvoice: (p: { invoice_id: number }) => post<Invoice>("/invoices/get", p),
  saveInvoice: (p: {
    invoice: {
      id: number;
      name?: string | null;
      invoice_date?: string | null;
      supplier_name?: string | null;
      supplier_vat?: string | null;
      customer_name?: string | null;
      customer_vat?: string | null;
      customer_phone?: string | null;
      delivery_address?: string | null;
      notes?: string | null;
      lines?: Partial<InvoiceLine>[];
    };
  }) => post<Invoice>("/invoices/save", p),
  removeRunInvoice: (p: { invoice_id: number }) => post<{ removed: boolean }>("/invoices/remove", p),

  updateDelivery: (p: {
    invoice_id: number;
    status: DeliveryState;
    note?: string | null;
    lines?: { id: number; return_qty?: number; return_reason?: ReturnReason | null; delivery_note?: string | null }[];
  }) => post<Invoice>("/delivery/update", p),
  deliverySummary: (p: { run_id?: number; date_from?: string; date_to?: string; customer?: string }) =>
    post<DeliverySummary>("/delivery/summary", p),

  importCatalog: (p: { file_base64: string; file_name?: string }) =>
    post<{ created: number; updated: number; skipped: number; rematched_lines: number }>("/catalog/import", p),
  listCatalog: (p: { query?: string; limit?: number }) => post<{ total: number; products: CatalogProduct[] }>("/catalog/list", p),
};
