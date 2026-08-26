"use client";

import { useEffect, useRef, useState } from "react";

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 9.75A2.25 2.25 0 0 1 11.25 7.5h6A2.25 2.25 0 0 1 19.5 9.75v8.5a2.25 2.25 0 0 1-2.25 2.25h-6A2.25 2.25 0 0 1 9 18.25v-8.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M15 7.5v-.75A2.25 2.25 0 0 0 12.75 4.5h-6A2.25 2.25 0 0 0 4.5 6.75v8.5a2.25 2.25 0 0 0 2.25 2.25H9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function RouterTrackingNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);

      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }

      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <strong className="clientEmptyRoutersTrackingNumber">
      <span className="clientEmptyRoutersTrackingValue">{value}</span>
      <button
        className={copied ? "clientEmptyRoutersTrackingCopyButton isCopied" : "clientEmptyRoutersTrackingCopyButton"}
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Трек-номер скопирован" : "Скопировать трек-номер"}
        title={copied ? "Скопировано" : "Скопировать"}
      >
        <CopyIcon />
      </button>
    </strong>
  );
}
