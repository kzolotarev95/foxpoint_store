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

  return (
    <main className="shell siteShell">
      <section className="panel authPagePanel">
        <div className="authPageIntro">
          <span className="pill">Вход клиента</span>
          <h1 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Личный кабинет FoxPoint</h1>
          <p>
            На Wednesday, August 19, 2026 сайт уже умеет принимать вход, создавать клиентскую
            сессию, открывать кабинет, заказы и поддержку поверх общего backend.
          </p>
          <div className="heroMetaGrid compactGrid">
            <div className="metricCard">
              <div className="muted">Комплект</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {site.subscriptionOffer.recommendedPriceLabel}
              </div>
              <p>{site.subscriptionOffer.recommendedPackage}</p>
            </div>
            <div className="metricCard">
              <div className="muted">Роутер с доставкой</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {site.orderOffer.totalPriceLabel}
              </div>
              <p>Готовое решение под ключ.</p>
            </div>
          </div>
        </div>

        <div className="authPageCard">
          {signedOutMessage ? <div className="banner successBanner">{signedOutMessage}</div> : null}
          {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

          <div className="contentStack">
            <div>
              <span className="statusTag">Telegram</span>
              <h2 style={{ marginBottom: "10px", fontFamily: "var(--font-heading, sans-serif)" }}>
                Основной маршрут для действующих клиентов
              </h2>
              <p className="sectionLead" style={{ fontSize: "16px" }}>
                Если бот уже настроен, можно открыть его сразу. Если нет, клиент попадет в поддержку.
              </p>
            </div>

            <div className="stackedActions">
              <Link
                className="primaryButton"
                href={hasTelegramBot ? site.links.telegramBot : site.links.support}
                target="_blank"
              >
                {hasTelegramBot ? "Войти через Telegram" : "Открыть поддержку"}
              </Link>
              <Link className="secondaryButton" href={site.links.telegramChannel} target="_blank">
                Telegram-канал
              </Link>
            </div>
          </div>

          <div className="divider" />

          <form action={loginWithEmailAction} className="authForm">
            <div>
              <span className="statusTag">Email MVP</span>
              <h2 style={{ marginBottom: "10px", fontFamily: "var(--font-heading, sans-serif)" }}>
                Быстрый вход на сайте
              </h2>
              <p className="sectionLead" style={{ fontSize: "16px" }}>
                Для MVP создаем или находим клиента по email и сразу заводим сессию на сайте.
              </p>
            </div>

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
              <span className="helperText">Если пришли по ссылке, код уже подставится автоматически.</span>
            </label>

            <div className="ctaRow">
              <button className="primaryButton" type="submit">
                Войти в кабинет
              </button>
              <Link className="secondaryButton" href="/">
                На главную
              </Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
