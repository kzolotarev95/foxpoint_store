import Link from "next/link";
import authPreviewImage from "./assets/auth-login-bg.jpg";
import type { PublicLinks } from "./site-data";

type AuthWindowProps = {
  entryLinks: PublicLinks;
  hasTelegramBot: boolean;
  mode: "home" | "login";
};

const contentByMode = {
  home: {
    eyebrow: "FoxPoint Access",
    title: "Интернет, как раньше.",
    copy: "",
    cardTitle: "Вход для клиентов",
    cardCopy:
      "Основной клиентский маршрут идет через Telegram. Если бот еще не подключен, вход сразу ведет в поддержку.",
    primaryButtonLabel: "Вход для клиентов",
    primaryButtonHref: "/login",
    showAdminButton: false,
    showMetaLinks: false
  },
  login: {
    eyebrow: "Client Login",
    title: "Вход в FoxPoint",
    copy: "",
    cardTitle: "Вход для клиентов",
    cardCopy:
      "Нажми кнопку ниже, чтобы зайти через Telegram. Если бот еще не подключен, переход пойдет сразу в поддержку.",
    primaryButtonLabel: "Войти через Telegram",
    primaryButtonHref: "client-entry",
    showAdminButton: false,
    showMetaLinks: false
  }
} as const;

export function AuthWindow({ entryLinks, hasTelegramBot, mode }: AuthWindowProps) {
  const content = contentByMode[mode];
  const primaryClientLink = hasTelegramBot ? entryLinks.telegramBot : entryLinks.support;
  const primaryButtonLabel =
    content.primaryButtonHref === "client-entry"
      ? hasTelegramBot
        ? content.primaryButtonLabel
        : "Написать в поддержку"
      : content.primaryButtonLabel;
  const primaryButtonHref =
    content.primaryButtonHref === "client-entry" ? primaryClientLink : content.primaryButtonHref;
  const supportButtonLabel = hasTelegramBot ? "Поддержка" : "Telegram-канал";
  const supportButtonHref = hasTelegramBot ? entryLinks.support : entryLinks.telegramChannel;
  const buttonBaseStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "46px",
    width: "100%",
    padding: "0 18px",
    borderRadius: "14px",
    fontWeight: 700,
    textDecoration: "none"
  } as const;

  return (
    <section
      className="authWindow panel"
      style={{
        display: "flex",
        flexWrap: "wrap",
        overflow: "hidden",
        width: "min(820px, 100%)",
        margin: "0 auto",
        borderRadius: "32px",
        background: "linear-gradient(135deg, rgba(255, 252, 247, 0.92) 0%, rgba(255, 249, 240, 0.88) 100%)",
        border: "1px solid rgba(28, 34, 48, 0.12)",
        boxShadow: "0 20px 50px rgba(28, 34, 48, 0.12)"
      }}
    >
      <div
        className="authShowcase"
        style={{
          flex: "1 1 420px",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "18px",
          background: "#120d14"
        }}
      >
        <img
          className="authPreviewImage"
          src={authPreviewImage.src}
          alt="FoxPoint"
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            borderRadius: "22px",
            objectFit: "contain"
          }}
        />
      </div>

      <div
        className="authCard"
        style={{
          flex: "0 1 320px",
          minWidth: "280px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "14px",
          padding: "22px 18px",
          background: "radial-gradient(circle at top right, rgba(196, 90, 35, 0.08), transparent 26%), rgba(255, 252, 247, 0.92)"
        }}
      >
        <span
          className="statusTag"
          style={{
            display: "inline-flex",
            alignItems: "center",
            width: "fit-content",
            padding: "8px 12px",
            borderRadius: "999px",
            background: "rgba(31, 111, 120, 0.12)",
            color: "#1f6f78",
            fontWeight: 700,
            fontSize: "13px"
          }}
        >
          Авторизация
        </span>
        <h2
          className="authCardTitle"
          style={{
            margin: 0,
            fontSize: "clamp(24px, 2.6vw, 30px)",
            lineHeight: 1,
            letterSpacing: "-0.04em"
          }}
        >
          {content.cardTitle}
        </h2>
        <p
          className="authCardCopy"
          style={{
            margin: 0,
            color: "#6b7280",
            lineHeight: 1.5,
            fontSize: "14px"
          }}
        >
          {content.cardCopy}
        </p>

        <div
          className="authActionStack"
          style={{
            display: "grid",
            gap: "10px",
            marginTop: "6px"
          }}
        >
          <Link
            className="primaryButton fullWidthButton authActionButton"
            href={primaryButtonHref}
            target={primaryButtonHref.startsWith("http") ? "_blank" : undefined}
            style={{
              ...buttonBaseStyle,
              color: "#fff7f0",
              background: "linear-gradient(135deg, #c45a23 0%, #7a2f0b 100%)",
              boxShadow: "0 16px 32px rgba(122, 47, 11, 0.24)"
            }}
          >
            {primaryButtonLabel}
          </Link>
          <Link
            className="secondaryButton fullWidthButton authActionButton"
            href={supportButtonHref}
            target={supportButtonHref.startsWith("http") ? "_blank" : undefined}
            style={{
              ...buttonBaseStyle,
              color: "#1c2230",
              border: "1px solid rgba(28, 34, 48, 0.12)",
              background: "rgba(255, 255, 255, 0.6)"
            }}
          >
            {supportButtonLabel}
          </Link>
          {mode === "login" ? (
            <Link
              className="secondaryButton fullWidthButton authActionButton"
              href={entryLinks.telegramChannel}
              target="_blank"
              style={{
                ...buttonBaseStyle,
                color: "#1c2230",
                border: "1px solid rgba(28, 34, 48, 0.12)",
                background: "rgba(255, 255, 255, 0.6)"
              }}
            >
              Открыть Telegram-канал
            </Link>
          ) : null}
        </div>

        {content.showMetaLinks ? <div className="authMeta" /> : null}
      </div>
    </section>
  );
}
