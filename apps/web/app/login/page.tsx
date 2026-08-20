import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSiteSnapshot, isTelegramBotConfigured } from "../../components/site-data";
import { TelegramLoginWidget } from "../../components/telegram-login-widget";
import { authenticateClientAction } from "../../lib/client-actions";
import { getApiBaseUrl } from "../../lib/api";
import { getClientRequestHeaders, getClientSessionToken } from "../../lib/client-auth";
import { buildTelegramCallbackUrl, getTelegramBotUsername } from "../../lib/telegram-auth";

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
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/me/overview`, {
        headers: Object.fromEntries((await getClientRequestHeaders()).entries()),
        cache: "no-store"
      });

      if (response.ok) {
        redirect("/cabinet");
      }
    } catch {
      // If the API is temporarily unavailable or the cookie is stale, fall back to a fresh login.
    }
  }

  const searchParams = await props.searchParams;
  const site = await getSiteSnapshot();
  const errorMessage = getSingleParam(searchParams.error);
  const signedOutMessage = getSingleParam(searchParams.signedOut) ? "Сессия завершена." : null;
  const mode = getSingleParam(searchParams.mode) === "register" ? "register" : "login";
  const savedLogin = getSingleParam(searchParams.login) ?? "";
  const referralCode = getSingleParam(searchParams.ref) ?? "";
  const botIsConfigured = isTelegramBotConfigured(site.links.telegramBot);
  const telegramBotUsername = botIsConfigured ? getTelegramBotUsername(site.links.telegramBot) : null;
  const telegramChannelLink = site.links.telegramChannel;
  const loginTabHref = `/login?mode=login${referralCode ? `&ref=${encodeURIComponent(referralCode)}` : ""}`;
  const registerTabHref = `/login?mode=register${referralCode ? `&ref=${encodeURIComponent(referralCode)}` : ""}`;
  const telegramLoginUrl = buildTelegramCallbackUrl("login", {
    referralCode
  });

  return (
    <main className="shell authExperience authLoginExperience">
      <section className="authStage authLoginStage">
        <div className="panel authStageCard authLoginCard">
          {signedOutMessage ? <div className="banner successBanner">{signedOutMessage}</div> : null}
          {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

          <div className="authBrandMark authLoginMark">
            <Image alt="" aria-hidden height={60} src="/images/foxpoint-logo.png" width={60} />
          </div>

          <div className="authBrandTitle" aria-label="Fox Point">
            <span className="authBrandFox">Fox</span>
            <span className="authBrandPoint">Point</span>
          </div>

          <h1>
            <span>Свободный</span>
            <span>интернет</span>
          </h1>
          <p>Вход по логину и паролю, либо через Telegram и бота.</p>

          <div className="clientAuthActions authLoginActions">
            <TelegramLoginWidget
              authUrl={telegramLoginUrl}
              botUrl={botIsConfigured ? site.links.telegramBot : site.links.support}
              botUsername={telegramBotUsername}
              className="telegramAuthStack"
              fallbackLabel={botIsConfigured ? "Открыть Telegram-бота" : "Открыть поддержку"}
              hint={
                botIsConfigured
                  ? "Telegram сам вернет вас на сайт и завершит вход."
                  : "Пока бот не настроен, вход доступен через логин и пароль."
              }
            />
            <Link
              className="secondaryButton fullWidthButton portalGhostButton authLoginChannelButton"
              href={telegramChannelLink}
              target="_blank"
            >
              Telegram канал
            </Link>
          </div>

          <div className="authTabs">
            <Link className={`authTab ${mode === "login" ? "isActive" : ""}`} href={loginTabHref}>
              Вход
            </Link>
            <Link className={`authTab ${mode === "register" ? "isActive" : ""}`} href={registerTabHref}>
              Регистрация
            </Link>
          </div>

          <form action={authenticateClientAction} className="authForm clientAuthForm">
            <input name="mode" type="hidden" value={mode} />
            <label className="fieldStack">
              <span className="fieldLabel">Логин</span>
              <input
                autoComplete="username"
                className="textInput"
                defaultValue={savedLogin}
                name="login"
                placeholder="Введите логин"
                required
                type="text"
              />
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Пароль</span>
              <input
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                className="textInput"
                name="password"
                placeholder="Введите пароль"
                required
                type="password"
              />
            </label>

            {mode === "register" ? (
              <label className="fieldStack">
                <span className="fieldLabel">Реферальный код</span>
                <input
                  autoComplete="off"
                  className="textInput"
                  defaultValue={referralCode}
                  name="referralCode"
                  placeholder="Если пришли по ссылке, код уже будет здесь"
                  type="text"
                />
              </label>
            ) : null}

            <button className="primaryButton fullWidthButton portalActionButton authLoginSubmitButton" type="submit">
              {mode === "register" ? "Зарегистрироваться" : "Войти"}
            </button>

            <p className="authHint">
              {mode === "register"
                ? "Рефкод подтянется автоматически из ссылки ?ref=."
                : "Если пароль забыли, используйте Telegram-бота для восстановления доступа."}
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
