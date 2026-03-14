"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/program");
  }, [router]);
  return (
    <div className="text-sm text-slate-500">
      Redirecting to Program…
    </div>
  );
}
