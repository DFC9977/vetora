export type ApiError = { code: string; message: string; details?: Record<string, unknown> };
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type ReturnReason = "refused" | "damaged" | "missing" | "wrong" | "other";
export type DeliveryState = "pending" | "delivered" | "partial" | "not_delivered";
export type RunState = "planned" | "loaded" | "in_progress" | "done";

export type InvoiceLine = {
  id?: number;
  product_code: string | null;
  product_name: string;
  uom: string | null;
  quantity: number;
  price_unit: number;
  vat_rate: number;
  discount_amount: number;
  amount?: number;
  lot_number: string | null;
  expiry_date: string | null;
  catalog_id?: number | null;
  catalog_code?: string | null;
  producer?: string | null;
  return_qty?: number;
  delivered_qty?: number;
  return_reason?: ReturnReason | null;
  delivery_note?: string | null;
};

export type Invoice = {
  id: number;
  name: string | null;
  invoice_date: string | null;
  supplier_name: string | null;
  supplier_vat: string | null;
  customer_name: string | null;
  customer_vat: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  run_id?: number | null;
  run_name?: string | null;
  file_name: string | null;
  has_file: boolean;
  extraction_method: "text" | "ocr" | "manual" | "none";
  notes: string | null;
  delivery_state?: DeliveryState;
  delivered_at?: string | null;
  delivery_note?: string | null;
  amount_untaxed: number;
  line_count: number;
  lines?: InvoiceLine[];
  raw_text?: string;
};

// Backwards-compatible alias used by the shared components.
export type SupplierInvoice = Invoice;

export type DeliveryRun = {
  id: number;
  name: string;
  date: string | null;
  driver: string | null;
  vehicle: string | null;
  notes: string | null;
  state: RunState;
  invoice_count: number;
  pending_count: number;
  delivered_count: number;
  partial_count: number;
  not_delivered_count: number;
  amount_total: number;
  invoices?: Invoice[];
};

export type DeliveryProductRow = {
  product_key: string;
  product_code: string | null;
  ean: string | null;
  producer: string | null;
  product_name: string;
  uom: string | null;
  quantity: number;
  delivered_qty: number;
  returned_qty: number;
  amount: number;
  invoices: {
    invoice_id: number;
    invoice_name: string | null;
    customer_name: string | null;
    quantity: number;
    returned_qty: number;
    return_reason: ReturnReason | null;
    delivery_note: string | null;
  }[];
};

export type DeliverySummary = {
  run: DeliveryRun | null;
  invoices: Invoice[];
  products: DeliveryProductRow[];
  by_producer: { producer: string | null; products: number; quantity: number; delivered_qty: number; returned_qty: number }[];
  counts: Record<DeliveryState, number>;
  totals: { invoices: number; quantity: number; delivered_qty: number; returned_qty: number; amount: number };
};

export type CatalogProduct = {
  id: number;
  name: string;
  internal_code: string | null;
  ean: string | null;
  producer: string | null;
  price: number;
  vat_rate: number;
  hs_code: string | null;
};
