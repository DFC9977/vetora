import "./globals.css";
import type { ReactNode } from "react";
import { Nav } from "../components/Nav";

export const metadata = {
  title: "Vetora Livrări",
  description: "Încărcare centralizată a mărfii din facturi și evidența livrărilor",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro">
      <body className="min-h-screen">
        <div className="flex flex-col min-h-screen">
          <Nav />
          <main className="flex-1 px-4 py-4">{children}</main>
        </div>
      </body>
    </html>
  );
}
