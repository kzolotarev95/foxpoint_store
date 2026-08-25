"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function CabinetAutoRefresh(props: { intervalMs?: number }) {
  const { intervalMs = 60_000 } = props;
  const router = useRouter();

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [intervalMs, router]);

  return null;
}
