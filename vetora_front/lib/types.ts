export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export type VetDoctor = {
  id: number;
  name: string;
  short_name: string | null;
  specialization: string | null;
  calendar_color: number | null;
  location_id: number | null;
  company_id: number;
};

export type VetService = {
  id: number;
  name: string;
  category: string | null;
  duration_minutes: number;
  default_price: number;
  requires_doctor: boolean;
  company_id: number;
};

export type VetVisit = {
  id: number;
  name: string;
  pet_id: number;
  pet_name: string;
  client_id: number | null;
  client_name: string | null;
  client_phone?: string | null;
  doctor_id: number;
  doctor_name: string;
  service_id: number;
  service_name: string;
  company_id: number;
  location_id: number;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  status: string;
  source: string;
  is_urgent: boolean;
  notes: string | null;
  service_price_snapshot: number | null;
};

export type VetBlock = {
  id: number;
  block_type: string;
  doctor_id: number | null;
  location_id: number | null;
  start_at: string;
  end_at: string;
  reason: string | null;
  doctor_name?: string | null;
  location_name?: string | null;
  is_recurring?: boolean;
};

export type VetPatient = {
  id: number;
  name: string;
  owner_id: number;
  owner_name: string;
};

export type VetClient = {
  id: number;
  name: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
};

export type PatientDetail = {
  id: number;
  name: string;
  owner_id: number;
  owner_name: string;
  species: string | null;
  breed: string | null;
  gender: string | null;
  birth_date: string | null;
  microchip: string | null;
  is_sterilized: boolean;
  alerts_short: string | null;
  history: PatientVisitHistoryEntry[];
};

export type PatientVisitHistoryEntry = {
  id: number;
  start_at: string;
  doctor_id: number;
  doctor_name: string;
  service_id: number;
  service_name: string;
  status: string;
  short_notes: string;
};

export type ClientDetail = {
  id: number;
  name: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country_id: number | null;
  patients: ClientPatientSummary[];
  history: ClientVisitHistoryEntry[];
};

export type ClientPatientSummary = {
  id: number;
  name: string;
  species: string | null;
  breed: string | null;
  alerts_short: string | null;
};

export type ClientVisitHistoryEntry = {
  id: number;
  start_at: string;
  patient_id: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  service_id: number;
  service_name: string;
  status: string;
  short_notes: string;
};

export type ClinicScheduleEntry = {
  id: number;
  weekday: number;
  weekday_label: string;
  start_time: string;
  end_time: string;
  location_id: number | null;
  location_name: string | null;
};

export type DoctorSettings = {
  id: number;
  name: string;
  short_name: string | null;
  specialization: string | null;
  color: number | null;
  active: boolean;
  services: { id: number; name: string }[];
  schedules: {
    id: number;
    weekday: number;
    weekday_label: string;
    start_time: string;
    end_time: string;
  }[];
};

export type ServiceSettings = {
  id: number;
  name: string;
  category: string | null;
  duration_minutes: number;
  price: number | null;
  color: number | null;
  active: boolean;
  eligible_doctors: { id: number; name: string }[];
};

export type CalendarDayPayload = {
  date: string;
  company_id?: number;
  location_id?: number;
  doctor_ids?: number[];
};

export type CalendarDayData = {
  date: string;
  doctors: VetDoctor[];
  clinic_schedules: {
    id: number;
    weekday: string;
    start_time: number;
    end_time: number;
    location_id: number | null;
  }[];
  doctor_schedules: {
    id: number;
    doctor_id: number;
    weekday: string;
    start_time: number;
    end_time: number;
    location_id: number | null;
  }[];
  blocks: VetBlock[];
  visits: VetVisit[];
};

export type CalendarWeekData = {
  start_date: string;
  end_date: string;
  doctors: VetDoctor[];
  clinic_schedules: {
    id: number;
    weekday: string;
    start_time: number;
    end_time: number;
    location_id: number | null;
  }[];
  doctor_schedules: {
    id: number;
    doctor_id: number;
    weekday: string;
    start_time: number;
    end_time: number;
    location_id: number | null;
  }[];
  blocks: VetBlock[];
  visits: VetVisit[];
};


// --- Supplier invoices / goods registry ---

export type SupplierInvoiceLine = {
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

export type ReturnReason = "refused" | "damaged" | "missing" | "wrong" | "other";
export type DeliveryState = "pending" | "delivered" | "partial" | "not_delivered";
export type RunState = "planned" | "loaded" | "in_progress" | "done";

export type SupplierInvoice = {
  id: number;
  name: string | null;
  supplier_name: string | null;
  supplier_vat: string | null;
  customer_name: string | null;
  customer_vat: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  run_id?: number | null;
  run_name?: string | null;
  delivery_state?: DeliveryState;
  delivered_at?: string | null;
  delivery_note?: string | null;
  invoice_date: string | null;
  location_id: number | null;
  location_name: string | null;
  state: "draft" | "confirmed";
  file_name: string | null;
  has_file: boolean;
  extraction_method: "text" | "ocr" | "manual" | "none";
  amount_untaxed: number;
  line_count: number;
  notes: string | null;
  lines?: SupplierInvoiceLine[];
  raw_text?: string;
};

export type GoodsRegistryRow = {
  product_key: string;
  catalog_id: number | null;
  product_code: string | null;
  ean: string | null;
  producer: string | null;
  product_name: string;
  uom: string | null;
  total_quantity: number;
  total_amount: number;
  total_discount: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  last_price: number;
  last_date: string | null;
  last_supplier: string | null;
  invoice_count: number;
  suppliers: string[];
  customers: string[];
};

export type GoodsProducerSummary = {
  producer: string | null;
  products: number;
  total_quantity: number;
  total_amount: number;
};

export type GoodsRegistryData = {
  rows: GoodsRegistryRow[];
  by_producer: GoodsProducerSummary[];
  totals: { products: number; quantity: number; amount: number; invoices: number; unmatched: number };
};

export type GoodsCatalogProduct = {
  id: number;
  name: string;
  internal_code: string | null;
  ean: string | null;
  producer: string | null;
  price: number;
  vat_rate: number;
  hs_code: string | null;
};

// --- Delivery runs ---

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
  invoices?: SupplierInvoice[];
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
  invoices: SupplierInvoice[];
  products: DeliveryProductRow[];
  by_producer: { producer: string | null; products: number; quantity: number; delivered_qty: number; returned_qty: number }[];
  counts: Record<DeliveryState, number>;
  totals: { invoices: number; quantity: number; delivered_qty: number; returned_qty: number; amount: number };
};
