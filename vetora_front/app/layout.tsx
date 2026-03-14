import "./globals.css";
import type { ReactNode } from "react";
import { I18nProvider } from "../components/I18nProvider";
import { AppShell } from "../components/AppShell";

export const metadata = {
  title: "Vetora Clinic",
  description: "Vetora veterinary clinic frontend over Odoo",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <I18nProvider>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}

