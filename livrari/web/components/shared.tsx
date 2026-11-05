"use client";

import type { DeliveryState, ReturnReason, RunState } from "../lib/types";

export const RETURN_REASONS: { value: ReturnReason; key: string }[] = [
  { value: "refused", key: "deliveries.reasonRefused" },
  { value: "damaged", key: "deliveries.reasonDamaged" },
  { value: "missing", key: "deliveries.reasonMissing" },
  { value: "wrong", key: "deliveries.reasonWrong" },
  { value: "other", key: "deliveries.reasonOther" },
];

export const RUN_STATES: { value: RunState; key: string }[] = [
  { value: "planned", key: "deliveries.statePlanned" },
  { value: "loaded", key: "deliveries.stateLoaded" },
  { value: "in_progress", key: "deliveries.stateInProgress" },
  { value: "done", key: "deliveries.stateDone" },
];

const STATE_CLASSES: Record<DeliveryState, string> = {
  pending: "bg-slate-50 text-slate-600 border-slate-300",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  not_delivered: "bg-red-50 text-red-700 border-red-200",
};

export function DeliveryBadge({ state, t }: { state: DeliveryState; t: (k: string) => string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${STATE_CLASSES[state]}`}>
      {t(`deliveries.${state}`)}
    </span>
  );
}

export function reasonLabel(t: (k: string) => string, reason: ReturnReason | null | undefined) {
  const r = RETURN_REASONS.find((x) => x.value === reason);
  return r ? t(r.key) : "";
}
