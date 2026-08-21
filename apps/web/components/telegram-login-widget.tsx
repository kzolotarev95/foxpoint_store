"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type TelegramLoginWidgetProps = {
  authUrl: string;
  botUrl: string;
  botUsername?: string | null;
  className?: string;
  fallbackLabel: string;
  hint?: string;
};

function isLikelyMobileDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent || "";
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

export function TelegramLoginWidget({
  authUrl,
  botUrl,
  botUsername,
  className,
  fallbackLabel,
  hint
}: TelegramLoginWidgetProps) {
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const [widgetStatus, setWidgetStatus] = useState<"idle" | "loading" | "ready" | "error">(botUsername ? "loading" : "idle");

  useEffect(() => {
    if (!botUsername || !widgetRef.current) {
      setWidgetStatus("idle");
      return;
    }

    const widgetNode = widgetRef.current;
    let isActive = true;
    widgetNode.innerHTML = "";
    setWidgetStatus("loading");

    const observer = new MutationObserver(() => {
      const hasWidgetContent = Array.from(widgetNode.children).some((child) => child.tagName !== "SCRIPT");
      if (hasWidgetContent && isActive) {
        setWidgetStatus("ready");
      }
    });

    observer.observe(widgetNode, {
      childList: true,
      subtree: true
    });

    const timeoutId = window.setTimeout(() => {
      if (isActive) {
        const hasWidgetContent = Array.from(widgetNode.children).some((child) => child.tagName !== "SCRIPT");
        setWidgetStatus(hasWidgetContent ? "ready" : "error");
      }
    }, 3000);

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    script.onerror = () => {
      if (isActive) {
        window.clearTimeout(timeoutId);
        setWidgetStatus("error");
      }
    };
    widgetNode.appendChild(script);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
      observer.disconnect();
      widgetNode.innerHTML = "";
    };
  }, [authUrl, botUsername]);

  if (!botUsername) {
    return (
      <div className={className}>
        <Link className="primaryButton fullWidthButton portalActionButton" href={botUrl} target="_blank">
          {fallbackLabel}
        </Link>
        {hint ? <p className="telegramWidgetHint">{hint}</p> : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="telegramWidgetShell">
        <div ref={widgetRef} className="telegramWidgetMount" />
        {widgetStatus === "loading" ? <div className="telegramWidgetLoading">Подключаем Telegram...</div> : null}
        {widgetStatus === "error" ? (
          <Link className="primaryButton fullWidthButton portalActionButton telegramWidgetFallbackButton" href={botUrl} target="_blank">
            {fallbackLabel}
          </Link>
        ) : null}
      </div>
      {hint ? <p className="telegramWidgetHint">{hint}</p> : null}
      <noscript>
        <Link className="secondaryButton fullWidthButton portalGhostButton" href={botUrl} target="_blank">
          {fallbackLabel}
        </Link>
      </noscript>
    </div>
  );
}
