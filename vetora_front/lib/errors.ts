import type { ApiError } from "./types";

export function mapApiErrorToMessage(error?: ApiError): string {
  if (!error) {
    return "Unexpected error while calling the backend.";
  }

  switch (error.code) {
    case "INVALID_DURATION":
      return "Duration must be a positive multiple of 15 minutes.";
    case "OVERLAP_VISIT":
      return "This doctor already has a visit in that time interval.";
    case "BLOCK_CONFLICT":
      return "The selected interval conflicts with a blocking period.";
    case "OUTSIDE_CLINIC_SCHEDULE":
      return "The visit is outside the clinic schedule.";
    case "OUTSIDE_DOCTOR_SCHEDULE":
      return "The visit is outside the doctor's schedule.";
    case "INVALID_SERVICE_DOCTOR":
      return "Selected doctor is not allowed to perform this service.";
    case "INACTIVE_DOCTOR":
      return "Selected doctor is inactive.";
    case "INACTIVE_SERVICE":
      return "Selected service is inactive.";
    case "MISSING_PATIENT_OWNER":
      return "Patient must have an owner before scheduling a visit.";
    case "INVALID_STATUS_TRANSITION":
      return "This status change is not allowed for the current visit.";
    case "INVALID_LOCATION":
      return "Invalid location for this operation.";
    case "MISSING_FIELDS":
      return "Some required information is missing. Please fill in all required fields.";
    case "INVALID_TIME_RANGE":
      return "Start time must be before end time and use a valid time format.";
    case "INVALID_BLOCK_INTERVAL":
      return "Blocking interval is invalid. End must be after start.";
    case "NOT_FOUND":
      return "Requested record was not found. It may have been deleted or you may not have access.";
    default:
      return error.message || "An unexpected error occurred.";
  }
}

