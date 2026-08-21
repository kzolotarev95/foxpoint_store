"use client";

import Link from "next/link";
import { type MouseEvent, useEffect, useState } from "react";

type TelegramBotLoginProps = {
  botUrl: string;
  botUsername: string | null;
  className?: string;
  fallbackLabel: string;
  hint?: string;
};

function buildTelegramAppUrl(botUsername: string, botUrl: string): string {
  try {
    const start = new URL(botUrl).searchParams.get("start") ?? "";
    const telegramUrl = new URL("tg://resolve");
    telegramUrl.searchParams.set("domain", botUsername);
    if (start) {
      telegramUrl.searchParams.set("start", start);
    }
    return telegramUrl.toString();
  } catch {
    return botUrl;
  }
}

function isLikelyMobileDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function TelegramBotLogin({ botUrl, botUsername, className, fallbackLabel, hint }: TelegramBotLoginProps) {
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  useEffect(() => {
    setIsMobileDevice(isLikelyMobileDevice());
  }, []);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!botUsername || !isMobileDevice) {
      return;
    }

    event.preventDefault();
    window.location.href = buildTelegramAppUrl(botUsername, botUrl);
  }

  return (
    <div className={className}>
      <Link
        className="secondaryButton fullWidthButton portalGhostButton"
        href={botUrl}
        onClick={handleClick}
        rel="noreferrer"
        target="_blank"
      >
        {fallbackLabel}
      </Link>
      {hint ? <p className="telegramWidgetHint">{hint}</p> : null}
      <noscript>
        <Link className="secondaryButton fullWidthButton portalGhostButton" href={botUrl} rel="noreferrer" target="_blank">
          {fallbackLabel}
        </Link>
      </noscript>
    </div>
  );
}
