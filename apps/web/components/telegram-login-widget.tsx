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

export function TelegramLoginWidget({
  authUrl,
  botUrl,
  botUsername,
  className,
  fallbackLabel,
  hint
}: TelegramLoginWidgetProps) {
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const [hasRenderedWidget, setHasRenderedWidget] = useState(false);

  useEffect(() => {
    if (!botUsername || !widgetRef.current) {
      setHasRenderedWidget(false);
      return;
    }

    const widgetNode = widgetRef.current;
    widgetNode.innerHTML = "";
    setHasRenderedWidget(false);

    const observer = new MutationObserver(() => {
      const hasWidgetContent = Array.from(widgetNode.children).some((child) => child.tagName !== "SCRIPT");
      if (hasWidgetContent) {
        setHasRenderedWidget(true);
      }
    });

    observer.observe(widgetNode, {
      childList: true,
      subtree: true
    });

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    widgetNode.appendChild(script);

    return () => {
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
        {!hasRenderedWidget ? (
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
