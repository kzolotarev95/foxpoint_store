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

function TelegramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M21 4.8 3.8 11.4c-1 .4-1 1.8.1 2.1l4.4 1.4 1.8 4.6c.3.8 1.4 1 1.9.3l2.4-2.6 4.8 3.5c.7.5 1.7.1 2-.8l2.7-13.3c.2-1.1-.8-2-1.9-1.7Zm-7.8 8.7-3.1 2.8-.8-3.8 7.7-6.1-3.8 7.1Z"
        fill="currentColor"
      />
    </svg>
  );
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
  const [shouldLoadWidget] = useState(Boolean(botUsername));
  const [widgetStatus, setWidgetStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!botUsername || !widgetRef.current || !shouldLoadWidget) {
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
  }, [authUrl, botUsername, shouldLoadWidget]);

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
      <div className={`telegramWidgetShell ${widgetStatus === "error" ? "isError" : ""}`}>
        <div ref={widgetRef} className="telegramWidgetMount" />
        {widgetStatus === "loading" ? (
          <div className="telegramWidgetLoading">
            <span className="telegramWidgetIconShell">
              <TelegramIcon />
            </span>
            <span>Подключаем Telegram...</span>
          </div>
        ) : null}
        {widgetStatus === "error" ? (
          <div className="telegramWidgetError" role="alert">
            <strong>
              <span className="telegramWidgetIconShell">
                <TelegramIcon />
              </span>
              <span>Включите VPN для входа через Telegram</span>
            </strong>
            <span>Сам сайт работает без VPN. VPN нужен только если Telegram-кнопка не загружается.</span>
          </div>
        ) : null}
      </div>
      {hint ? <p className={`telegramWidgetHint ${widgetStatus === "error" ? "isError" : ""}`}>{hint}</p> : null}
      <noscript>
        <Link className="secondaryButton fullWidthButton portalGhostButton" href={botUrl} target="_blank">
          {fallbackLabel}
        </Link>
      </noscript>
    </div>
  );
}
