"use client";

import { useState } from "react";
import { api } from "../lib/apiClient";
import type { VetClient } from "../lib/types";
import { mapApiErrorToMessage } from "../lib/errors";
import { useI18n } from "./I18nProvider";

type Props = {
  onClose: () => void;
  onSuccess: (client: VetClient) => void;
};

export function QuickAddClientModal({ onClose, onSuccess }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("quickAddClient.nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    const res = await api.createClient({
      name: trimmedName,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      setError(mapApiErrorToMessage(res.error));
      return;
    }
    onSuccess(res.data);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" aria-modal="true" role="dialog">
      <div className="bg-white rounded shadow-lg w-full max-w-md p-4 space-y-3">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold text-sm">{t("quickAddClient.title")}</h3>
          <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </div>
        {error && (
          <div className="text-xs text-red-600 border border-red-200 bg-red-50 px-2 py-1 rounded">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <div>
            <label className="block text-xs mb-1">{t("quickAddClient.name")} *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border px-2 py-1 w-full input-field"
              placeholder={t("quickAddClient.namePlaceholder")}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs mb-1">{t("quickAddClient.phone")}</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="border px-2 py-1 w-full input-field"
              placeholder={t("quickAddClient.phonePlaceholder")}
            />
          </div>
          <div>
            <label className="block text-xs mb-1">{t("quickAddClient.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border px-2 py-1 w-full input-field"
              placeholder={t("quickAddClient.emailPlaceholder")}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 border bg-white hover:bg-slate-50 text-xs input-field"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1 bg-sky-600 text-white text-xs hover:bg-sky-700 disabled:opacity-60 input-field"
            >
              {saving ? t("quickAddClient.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
