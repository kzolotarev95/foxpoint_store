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
    <main className="shell authExperience authLoginExperience">
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
      />

      <section className="authStage panel authLoginStage">
        <div className="panel authStageCard">
          {signedOutMessage ? <div className="banner successBanner">{signedOutMessage}</div> : null}
          {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

          <div className="authBrandMark authLoginMark">
            <Image alt="" aria-hidden height={72} src="/images/foxpoint-logo.png" width={72} />
          </div>

          <h1>Свободный интернет</h1>
          <p>Личный кабинет для управления роутерами и технической поддержкой.</p>

          <div className="clientAuthActions authLoginActions">
            <Link className="primaryButton fullWidthButton portalActionButton" href={primaryClientLink} target="_blank">
              {hasTelegramBot ? "Войти через Telegram" : "Открыть поддержку"}
            </Link>
            <Link className="secondaryButton fullWidthButton portalGhostButton" href={primaryClientLink} target="_blank">
              {hasTelegramBot ? "Войти через бота" : "Открыть поддержку"}
            </Link>
          </div>

          <div className="authDivider">
            <span>или</span>
          </div>

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
              <span className="fieldLabel">Email или логин</span>
              <input
                autoComplete="email"
                className="textInput"
                name="email"
                placeholder="Введите email или логин"
                required
                type="email"
              />
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Пароль</span>
              <input className="textInput" name="password" placeholder="Введите пароль" type="password" />
            </label>

            {referralCode ? <input name="referralCode" type="hidden" value={referralCode} /> : null}

            <button className="primaryButton fullWidthButton portalActionButton" type="submit">
              Войти
            </button>

            <p className="authHint">Если забыли пароль, войдите через Telegram и восстановите доступ в профиле.</p>
          </form>

          <Link className="authInlineLink authFooterLink" href={site.links.telegramChannel} target="_blank">
            Как работает сервис
          </Link>
        </div>
      </section>
    </main>
  );
}
