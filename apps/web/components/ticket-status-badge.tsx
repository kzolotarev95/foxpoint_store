"use client";

import { useEffect, useRef, useState } from "react";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CLIENT" | "RESOLVED" | "CLOSED";

type TicketStatusBadgeProps = {
  initialStatus: TicketStatus | string;
  refreshUrl: string;
};

function getStatusMeta(status: string): { label: string; tone: "open" | "progress" | "resolved" | "waiting" } {
  const normalized = String(status ?? "").toUpperCase();

  if (normalized === "RESOLVED" || normalized === "CLOSED") {
    return {
      label: normalized === "CLOSED" ? "Закрыто" : "Решено",
      tone: "resolved"
    };
  }

  if (normalized === "IN_PROGRESS") {
    return {
      label: "В работе",
      tone: "progress"
    };
  }

  if (normalized === "WAITING_CLIENT") {
    return {
      label: "Ожидает ответа",
      tone: "waiting"
    };
  }

  return {
    label: "Новый запрос",
    tone: "open"
  };
}

export function TicketStatusBadge({ initialStatus, refreshUrl }: TicketStatusBadgeProps) {
  const [status, setStatus] = useState(initialStatus);
  const syncInFlight = useRef(false);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    let active = true;

    const syncStatus = async () => {
      if (syncInFlight.current) {
        return;
      }

      syncInFlight.current = true;

      try {
        const response = await fetch(refreshUrl, {
          headers: {
            Accept: "application/json"
          },
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as { status?: string } | null;
        if (!active || !payload?.status) {
          return;
        }

        setStatus(payload.status);
      } catch {
        // Ignore transient sync issues.
      } finally {
        syncInFlight.current = false;
      }
    };

    void syncStatus();
    const interval = window.setInterval(() => {
      void syncStatus();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshUrl]);

  const meta = getStatusMeta(status);

  return <span className={`clientSupportStatusBadge is-${meta.tone}`}>{meta.label}</span>;
}
