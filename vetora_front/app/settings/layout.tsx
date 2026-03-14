"use client";

import type { ReactNode } from "react";
import { useI18n } from "../../components/I18nProvider";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="border-b pb-3">
        <h1 className="text-lg font-semibold text-slate-800">{t("settings.title")}</h1>
        <nav className="mt-2 flex flex-wrap gap-2 text-sm">
          <a
            href="/settings/program"
            className="rounded border bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            {t("settings.program")}
          </a>
          <a
            href="/settings/doctors"
            className="rounded border bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            {t("settings.doctors")}
          </a>
          <a
            href="/settings/services"
            className="rounded border bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            {t("settings.services")}
          </a>
          <a
            href="/settings/blocks"
            className="rounded border bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            {t("settings.blocks")}
          </a>
        </nav>
      </div>
      {children}
    </div>
  );
}
