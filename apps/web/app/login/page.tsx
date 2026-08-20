import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
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
    <main className="shell authShell">
      <section className="panel authPanel clientAuthPanel">
        <div className="clientAuthHero">
          <Image
            alt="FoxPoint приветствие"
            className="clientAuthImage"
            height={720}
            src="/images/foxpoint-hero-welcome.jpg"
            width={1280}
          />
        </div>

        <div className="clientAuthBody">
          {signedOutMessage ? <div className="banner successBanner">{signedOutMessage}</div> : null}
          {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

          <div className="clientAuthActions">
            <Link className="primaryButton fullWidthButton" href={primaryClientLink} target="_blank">
              {hasTelegramBot ? "Войти через Telegram" : "Открыть поддержку"}
            </Link>
            <Link className="secondaryButton fullWidthButton" href={site.links.telegramChannel} target="_blank">
              Telegram-канал
            </Link>
          </div>

          <div className="divider" />

          <form action={loginWithEmailAction} className="authForm clientAuthForm">
            <label className="fieldStack">
              <span className="fieldLabel">Имя</span>
              <input className="textInput" name="name" placeholder="Иван" type="text" />
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Email</span>
              <input
                autoComplete="email"
                className="textInput"
                name="email"
                placeholder="client@example.com"
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

            <div className="stackedActions clientAuthActions">
              <button className="primaryButton fullWidthButton" type="submit">
                Войти в кабинет
              </button>
              <Link className="secondaryButton fullWidthButton" href="/">
                На главную
              </Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
