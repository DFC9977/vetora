"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "./I18nProvider";

type Props = {
  children: ReactNode;
};

const NAV_ITEMS = [
  { href: "/calendar", key: "nav.calendar" },
  { href: "/patients", key: "nav.patients" },
  { href: "/clients", key: "nav.clients" },
  { href: "/settings", key: "nav.settings" },
];

export function AppShell({ children }: Props) {
  const { lang, setLang, t } = useI18n();
  const pathname = usePathname();

  return (
    <div className="flex flex-col min-h-screen">
      <header
        className="px-6 py-3 flex items-center justify-between"
        style={{
          background:
            "linear-gradient(90deg, #5c4acb 0%, #8b7cf6 40%, #b69cf6 100%)",
          color: "#fffdf9",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="font-semibold text-lg tracking-tight">
            {t("appTitle")}
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full border border-[#e4ddd2] bg-[#f8f1e7] text-[#4b3f35]">
            MVP
          </span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <div
            className="flex items-center gap-1 px-1 py-1 rounded-full"
            style={{ backgroundColor: "rgba(255, 253, 249, 0.15)" }}
          >
            {NAV_ITEMS.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={
                    active
                      ? "px-3 py-1 rounded-full bg-white text-xs font-semibold text-[#5c4acb]"
                      : "px-3 py-1 rounded-full text-xs text-[#f5ede3] hover:bg-white/15"
                  }
                >
                  {t(item.key)}
                </a>
              );
            })}
          </div>
          <div className="border-l h-5 mx-2 border-[#e4ddd2]/60" />
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setLang("ro")}
              className={
                lang === "ro"
                  ? "px-2 py-1 bg-white text-[#5c4acb]"
                  : "px-2 py-1 bg-transparent text-[#f5ede3]"
              }
            >
              {t("language.ro")}
            </button>
            <button
              type="button"
              onClick={() => setLang("hu")}
              className={
                lang === "hu"
                  ? "px-2 py-1 bg-white text-[#5c4acb]"
                  : "px-2 py-1 bg-transparent text-[#f5ede3]"
              }
            >
              {t("language.hu")}
            </button>
          </div>
        </nav>
      </header>
      <main className="flex-1 px-4 py-4">{children}</main>
    </div>
  );
}

