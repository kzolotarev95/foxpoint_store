import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PortalHeader } from "../../components/portal-header";
import { getSiteSnapshot, isTelegramBotConfigured } from "../../components/site-data";
import { loginWithEmailAction } from "../../lib/client-actions";
import { getClientSessionToken } from "../../lib/client-auth";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) ? value[0] ?? null : null;
}

export default async function LoginPage(props: { searchParams: PageSearchParams }) {
  const existingToken = await getClientSessionToken();
  if (existingToken) {
    redirect("/cabinet");
  }

  const searchParams = await props.searchParams;
  const site = await getSiteSnapshot();
  const hasTelegramBot = isTelegramBotConfigured(site.links.telegramBot);
  const errorMessage = getSingleParam(searchParams.error);
  const signedOutMessage = getSingleParam(searchParams.signedOut) ? "Сессия завершена." : null;
  const referralCode = getSingleParam(searchParams.ref) ?? "";
  const primaryClientLink = hasTelegramBot ? site.links.telegramBot : site.links.support;

  return (
    <main className="shell authExperience">
      <PortalHeader
        rightSlot={
          <>
            <Link className="secondaryButton portalGhostButton" href={site.links.telegramChannel} target="_blank">
              Telegram-канал
            </Link>
            <Link className="primaryButton portalActionButton" href={primaryClientLink} target="_blank">
              {hasTelegramBot ? "Войти в кабинет" : "Открыть поддержку"}
            </Link>
          </>
        }
        subtitle="Свободный интернет"
      />

      <section className="authStage panel">
        <div className="authStageBackdrop">
          <Image
            alt=""
            aria-hidden
            className="authStageImage"
            fill
            priority
            sizes="100vw"
            src="/images/foxpoint-hero-welcome.jpg"
          />
        </div>

        <div className="authStageOverlay" />

        <div className="panel authStageCard">
          {signedOutMessage ? <div className="banner successBanner">{signedOutMessage}</div> : null}
          {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

          <div className="authBrandMark">
            <Image alt="" aria-hidden height={56} src="/apple-touch-icon.png" width={56} />
          </div>

          <span className="statusTag">Авторизация</span>
          <h1>Свободный интернет</h1>
          <p>Личный кабинет для управления роутерами и технической поддержкой.</p>

          <div className="clientAuthActions">
            <Link className="primaryButton fullWidthButton portalActionButton" href={primaryClientLink} target="_blank">
              {hasTelegramBot ? "Войти через Telegram" : "Открыть поддержку"}
            </Link>
            <Link className="secondaryButton fullWidthButton portalGhostButton" href={site.links.telegramChannel} target="_blank">
              Telegram-канал
            </Link>
          </div>

          <div className="divider" />

          <div className="authTabs">
            <button className="authTab isActive" type="button">
              Вход
            </button>
            <button className="authTab" type="button">
              Регистрация
            </button>
          </div>

          <form action={loginWithEmailAction} className="authForm clientAuthForm">
            <label className="fieldStack">
              <span className="fieldLabel">Имя</span>
              <input className="textInput" name="name" placeholder="Владислав" type="text" />
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Email</span>
              <input
                autoComplete="email"
                className="textInput"
                name="email"
                placeholder="example@mail.com"
                required
                type="email"
              />
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Реферальный код</span>
              <input
                className="textInput"
                defaultValue={referralCode}
                name="referralCode"
                placeholder="FOX-ABCD1234"
                type="text"
              />
            </label>

            <button className="primaryButton fullWidthButton portalActionButton" type="submit">
              Войти
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
