"use client";

import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Curse", match: (p: string) => p === "/" || p.startsWith("/run") || p.startsWith("/invoice") },
  { href: "/report/", label: "Raport perioadă", match: (p: string) => p.startsWith("/report") },
  { href: "/catalog/", label: "Catalog produse", match: (p: string) => p.startsWith("/catalog") },
];

export function Nav() {
  const pathname = usePathname() || "/";
  return (
    <header
      className="px-6 py-3 flex flex-wrap gap-2 items-center justify-between"
      style={{ background: "linear-gradient(90deg, #5c4acb 0%, #8b7cf6 40%, #b69cf6 100%)", color: "#fffdf9" }}
    >
      <a href="/" className="font-semibold text-lg tracking-tight" style={{ color: "#fffdf9" }}>
        Vetora Livrări
      </a>
      <nav className="flex flex-wrap items-center gap-1 px-1 py-1 rounded-full text-sm" style={{ backgroundColor: "rgba(255, 253, 249, 0.15)" }}>
        {ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={
              item.match(pathname)
                ? "px-3 py-1 rounded-full bg-white text-xs font-semibold text-[#5c4acb]"
                : "px-3 py-1 rounded-full text-xs text-[#f5ede3] hover:bg-white/15"
            }
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
