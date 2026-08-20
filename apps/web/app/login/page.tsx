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

  return (
    <main className="shell siteShell">
      <section className="panel authPagePanel">
        <div className="authPageIntro">
          <div className="authPreviewFrame">
            <div className="authPreviewMedia">
              <Image
                alt="FoxPoint приветствие"
                className="authPreviewShot"
                height={720}
                src="/images/foxpoint-hero-welcome.jpg"
                width={1280}
              />
            </div>
            <div className="authPreviewBody">
              <span className="pill">Вход клиента</span>
              <h1>Личный кабинет в едином стиле FoxPoint</h1>
              <p>
                Вход, Telegram и поддержка собраны в одном месте. Клиенту не нужно разбираться в
                настройках: сервис ведет к следующему шагу сам.
              </p>
            </div>
          </div>

          <div className="heroMetaGrid compactGrid">
            <div className="metricCard">
              <div className="muted">Рекомендованный пакет</div>
              <div className="metricValue">{site.subscriptionOffer.recommendedPriceLabel}</div>
              <p>{site.subscriptionOffer.recommendedPackage}</p>
            </div>
            <div className="metricCard">
              <div className="muted">Роутер под ключ</div>
              <div className="metricValue">{site.orderOffer.totalPriceLabel}</div>
              <p>Готовый роутер, настройка и старт без ручной конфигурации.</p>
            </div>
          </div>
        </div>

        <div className="authPageCard">
          {signedOutMessage ? <div className="banner successBanner">{signedOutMessage}</div> : null}
          {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

          <div className="contentStack">
            <div>
              <span className="statusTag">Telegram</span>
              <h2 style={{ marginBottom: "10px" }}>Основной маршрут для действующих клиентов</h2>
              <p className="sectionLead">
                Если бот уже настроен, вход откроется сразу. Если нет, клиент попадет прямо в
                поддержку без лишних шагов.
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
              <h2 style={{ marginBottom: "10px" }}>Быстрый вход на сайте</h2>
              <p className="sectionLead">
                Для MVP достаточно email: создаем или находим профиль, а затем сразу открываем
                кабинет с заказами, продлениями и поддержкой.
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
              <span className="helperText">Если пришли по приглашению, код можно оставить уже подставленным.</span>
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
