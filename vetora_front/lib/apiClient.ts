import {
  ApiResponse,
  CalendarDayData,
  CalendarWeekData,
  VetClient,
  VetDoctor,
  VetService,
  VetVisit,
  PatientDetail,
  ClientDetail,
  VetPatient,
  ClinicScheduleEntry,
  DoctorSettings,
  ServiceSettings,
  VetBlock,
} from "./types";

// Always call the local Next.js API proxy, which forwards to Odoo.
const BASE_PATH = "/api/odoo";

async function requestJson<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_PATH}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
    credentials: "include",
  });

  const rawText = await res.text();

  if (!res.ok) {
    try {
      const errBody = JSON.parse(rawText) as { error?: { message?: string; data?: { message?: string } } };
      const msg =
        errBody?.error?.data?.message ?? errBody?.error?.message ?? `HTTP ${res.status}`;
      return {
        ok: false,
        error: {
          code: "HTTP_ERROR",
          message: typeof msg === "string" ? msg : `HTTP ${res.status}`,
          details: { status: res.status },
        },
      } as ApiResponse<T>;
    } catch {
      return {
        ok: false,
        error: {
          code: "HTTP_ERROR",
          message: `HTTP ${res.status} ${res.statusText}`,
          details: { raw: rawText.slice(0, 300) },
        },
      } as ApiResponse<T>;
    }
  }

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;

    // Odoo JSON-RPC error envelope: { "jsonrpc": "2.0", "error": {...}, "id": ... }
    if (parsed && typeof parsed === "object" && "error" in parsed && parsed.error) {
      const err = parsed.error as { message?: string; data?: { message?: string } };
      const message = err?.data?.message ?? err?.message ?? "Unknown error";
      return {
        ok: false,
        error: {
          code: "JSON_RPC_ERROR",
          message: typeof message === "string" ? message : "Unknown error",
          details: err,
        },
      } as ApiResponse<T>;
    }

    // Odoo JSON controllers (type="json") return a JSON-RPC envelope:
    // { "jsonrpc": "2.0", "id": ..., "result": { ok, data|error } }
    if (parsed && typeof parsed === "object" && "result" in parsed) {
      const inner = (parsed as { result: unknown }).result;
      if (inner && typeof inner === "object" && "ok" in (inner as object)) {
        return inner as ApiResponse<T>;
      }
      // If result does not follow our contract, treat it as successful payload.
      return { ok: true, data: inner as T };
    }

    // If backend follows the { ok, data | error } contract, use it as-is.
    if (parsed && typeof parsed === "object" && "ok" in parsed) {
      return parsed as ApiResponse<T>;
    }

    return { ok: true, data: parsed as T };
  } catch {
    return {
      ok: false,
      error: {
        code: "HTTP_ERROR",
        message: `Backend returned ${res.status} ${res.statusText} for ${path}`,
        details: { raw: rawText.slice(0, 300) },
      },
    } as ApiResponse<T>;
  }
}

export const api = {
  calendarDay(payload: { date: string; company_id?: number; location_id?: number; doctor_ids?: number[] }) {
    return requestJson<CalendarDayData>("/vetora/json/calendar/day", payload);
  },

  calendarWeek(payload: { date: string; company_id?: number; location_id?: number; doctor_ids?: number[] }) {
    return requestJson<CalendarWeekData>("/vetora/json/calendar/week", payload);
  },

  createVisit(payload: {
    pet_id: number;
    doctor_id: number;
    service_id: number;
    start_at: string;
    duration_minutes: number;
    source: string;
    location_id: number;
    company_id?: number;
    is_urgent?: boolean;
    notes?: string;
  }) {
    return requestJson<VetVisit>("/vetora/json/visit/create", payload);
  },

  updateVisit(payload: {
    visit_id: number;
    start_at?: string;
    duration_minutes?: number;
    doctor_id?: number;
    service_id?: number;
    location_id?: number;
    is_urgent?: boolean;
    notes?: string;
  }) {
    return requestJson<VetVisit>("/vetora/json/visit/update", payload);
  },

  rescheduleVisit(payload: {
    visit_id: number;
    new_start_at: string;
    new_doctor_id?: number;
    new_service_id?: number;
    new_duration_minutes?: number;
    new_location_id?: number;
    new_notes?: string;
  }) {
    return requestJson<{ old: VetVisit; new: VetVisit }>("/vetora/json/visit/reschedule", payload);
  },

  changeVisitStatus(payload: { visit_id: number; action: string; reason?: string }) {
    return requestJson<VetVisit>("/vetora/json/visit/status", payload);
  },

  createBlock(payload: {
    block_type: string;
    start_at: string;
    end_at: string;
    doctor_id?: number;
    location_id?: number;
    company_id?: number;
    reason?: string;
  }) {
    return requestJson<unknown>("/vetora/json/block/create", payload);
  },

  lookupDoctors(payload: { company_id?: number; location_id?: number }) {
    return requestJson<VetDoctor[]>("/vetora/json/lookup/doctors", payload);
  },

  lookupServices(payload: { company_id?: number; doctor_id?: number }) {
    return requestJson<VetService[]>("/vetora/json/lookup/services", payload);
  },

  lookupPatients(payload: { query?: string; owner_id?: number | null }) {
    return requestJson<VetPatient[]>("/vetora/json/lookup/patients", payload);
  },

  lookupClients(payload: { query?: string }) {
    return requestJson<VetClient[]>("/vetora/json/lookup/clients", payload);
  },

  createClient(payload: { name: string; phone?: string; email?: string; street?: string; city?: string; zip?: string; mobile?: string }) {
    return requestJson<VetClient>("/vetora/json/client/create", payload);
  },

  createPatient(payload: {
    owner_id: number;
    name: string;
    species?: string;
    breed?: string;
    gender?: string;
    birth_date?: string;
    microchip?: string;
    alerts_short?: string;
  }) {
    return requestJson<VetPatient & { birth_date?: string | null; microchip?: string | null }>("/vetora/json/patient/create", payload);
  },

  detailPatient(payload: { patient_id: number }) {
    return requestJson<PatientDetail>("/vetora/json/detail/patient", payload);
  },

  detailClient(payload: { client_id: number }) {
    return requestJson<ClientDetail>("/vetora/json/detail/client", payload);
  },

  // Settings: clinic schedule
  getClinicSchedules(payload: { location_id?: number | null }) {
    return requestJson<{ schedules: ClinicScheduleEntry[] }>("/vetora/json/settings/clinic_schedule/get", payload);
  },

  saveClinicSchedules(payload: {
    location_id?: number | null;
    schedules: { id?: number; weekday: number; start_time: string; end_time: string }[];
  }) {
    return requestJson<{ schedules: ClinicScheduleEntry[] }>("/vetora/json/settings/clinic_schedule/save", payload);
  },

  // Settings: doctors
  listDoctorsSettings() {
    return requestJson<{ doctors: DoctorSettings[] }>("/vetora/json/settings/doctors/list", {});
  },

  saveDoctorSettings(payload: {
    doctor: {
      id?: number;
      name: string;
      short_name?: string;
      specialization?: string;
      color?: number;
      active?: boolean;
      service_ids?: number[];
      schedules?: { id?: number; weekday: number; start_time: string; end_time: string }[];
    };
  }) {
    return requestJson<{ doctor: DoctorSettings }>("/vetora/json/settings/doctors/save", payload);
  },

  // Settings: services
  listServicesSettings() {
    return requestJson<{ services: ServiceSettings[] }>("/vetora/json/settings/services/list", {});
  },

  saveServiceSettings(payload: {
    service: {
      id?: number;
      name: string;
      category?: string;
      duration_minutes?: number;
      price?: number;
      color?: number;
      active?: boolean;
      eligible_doctor_ids?: number[];
    };
  }) {
    return requestJson<{ service: ServiceSettings }>("/vetora/json/settings/services/save", payload);
  },

  // Blocks: manage
  listBlocks(payload: {
    date?: string;
    start_at?: string;
    end_at?: string;
    doctor_id?: number | null;
    location_id?: number | null;
  }) {
    return requestJson<{ blocks: VetBlock[] }>("/vetora/json/block/list", payload);
  },

  updateBlock(payload: {
    block_id: number;
    values: {
      type?: string;
      block_type?: string;
      start_at?: string;
      end_at?: string;
      doctor_id?: number | null;
      location_id?: number | null;
      reason?: string;
      is_recurring?: boolean;
      active?: boolean;
    };
  }) {
    return requestJson<VetBlock>("/vetora/json/block/update", payload);
  },

  deleteBlock(payload: { block_id: number }) {
    return requestJson<boolean>("/vetora/json/block/delete", payload);
  },
};

