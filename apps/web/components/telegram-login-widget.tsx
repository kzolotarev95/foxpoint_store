import Link from "next/link";

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
        <script
          async
          data-auth-url={authUrl}
          data-radius="12"
          data-request-access="write"
          data-size="large"
          data-telegram-login={botUsername}
          src="https://telegram.org/js/telegram-widget.js?22"
        />
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
