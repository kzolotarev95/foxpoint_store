import Link from "next/link";
import { getSiteSnapshot, getSystemHealth, isTelegramBotConfigured } from "../components/site-data";

export default async function HomePage() {
  const [site, health] = await Promise.all([getSiteSnapshot(), getSystemHealth()]);
  const hasTelegramBot = isTelegramBotConfigured(site.links.telegramBot);

  return (
    <main className="shell siteShell">
      <header className="topBar">
        <div>
          <span className="pill">FoxPoint MVP</span>
        </div>
        <div className="ctaRow">
          <Link className="secondaryButton" href={site.links.telegramChannel} target="_blank">
            Telegram-канал
          </Link>
          <Link className="primaryButton" href="/login">
            Войти на сайте
          </Link>
        </div>
      </header>

      <section className="panel hero heroWide">
        <span className="statusTag">Сайт + кабинет + backend</span>
        <h1 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>{site.product}</h1>
        <p>{site.tagline}</p>

        <div className="heroMetaGrid">
          <div className="metricCard">
            <div className="muted">Рекомендуемый пакет</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {site.subscriptionOffer.recommendedPriceLabel}
            </div>
            <p>{site.subscriptionOffer.recommendedPackage}</p>
          </div>
          <div className="metricCard">
            <div className="muted">Готовый роутер</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {site.orderOffer.totalPriceLabel}
            </div>
            <p>
              Роутер {site.orderOffer.routerPriceLabel} + подготовка {site.orderOffer.setupPriceLabel}
            </p>
          </div>
          <div className="metricCard">
            <div className="muted">Статус API</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {health.ok ? "UP" : "DOWN"}
            </div>
            <p>База: {health.database.toUpperCase()}</p>
          </div>
        </div>

        <div className="gridTwo heroGrid">
          <article className="entryCard panel">
            <span className="pill">Основной вход</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Открыть в Telegram</h2>
            <p>
              Для клиентов, которые уже ведут диалог с ботом. Все сроки, роутеры и оплаты должны
              быть синхронизированы с сайтом.
            </p>
            <div className="stackedActions">
              <Link
                className="primaryButton"
                href={hasTelegramBot ? site.links.telegramBot : site.links.support}
                target="_blank"
              >
                {hasTelegramBot ? "Открыть Telegram-бота" : "Перейти в поддержку"}
              </Link>
              <Link className="secondaryButton" href={site.links.support} target="_blank">
                Написать в поддержку
              </Link>
            </div>
          </article>

          <article className="entryCard panel">
            <span className="pill">Сайт</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Войти в личный кабинет</h2>
            <p>
              На сайте уже можно войти, увидеть привязанные роутеры, заказать устройство, отправить
              заявку в поддержку и сохранить пакет для продления.
            </p>
            <div className="stackedActions">
              <Link className="primaryButton" href="/login">
                Перейти ко входу
              </Link>
              <Link className="secondaryButton" href="/admin/login">
                Админ-панель
              </Link>
            </div>
          </article>
        </div>
      </section>

      <section className="contentStack">
        <div className="sectionBlock">
          <span className="pill">Как устроено</span>
          <h2 className="sectionTitle" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
            Это уже не одностраничная витрина, а каркас рабочего клиентского сервиса.
          </h2>
        </div>

        <div className="miniGrid">
          {site.corePrinciples.map((principle) => (
            <article key={principle} className="featureCard panel">
              <h3 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>{principle}</h3>
              <p>
                Клиентский интерфейс объясняет результат и ведет к нужному действию без
                технических терминов во фронте.
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel sectionPanel">
        <div className="sectionBlock">
          <span className="pill">Сценарии</span>
          <h2 className="sectionTitle" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
            Путь клиента от первого входа до продления.
          </h2>
        </div>

        <div className="timelineGrid">
          {site.journey.map((step, index) => (
            <article key={step} className="timelineCard">
              <div className="timelineIndex">{index + 1}</div>
              <p>{step}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="gridTwo sectionSplit">
        <article className="panel sectionPanel">
          <span className="pill">Подписки</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Продление и сопровождение</h2>
          <ul className="list">
            <li>
              Расширенный доступ: {site.subscriptionOffer.extendedAccessPrice} ₽ /{" "}
              {site.subscriptionOffer.periodDays} дней
            </li>
            <li>
              Базовое сопровождение: {site.subscriptionOffer.basicSupportPrice} ₽ /{" "}
              {site.subscriptionOffer.periodDays} дней
            </li>
            <li>
              Расширенное сопровождение: {site.subscriptionOffer.extendedSupportPrice} ₽ /{" "}
              {site.subscriptionOffer.periodDays} дней
            </li>
            <li>
              Быстрый комплект: {site.subscriptionOffer.recommendedPackage} за{" "}
              {site.subscriptionOffer.recommendedPriceLabel}
            </li>
          </ul>
        </article>

        <article className="panel sectionPanel">
          <span className="pill">Рефералы и старт</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Стартовый оффер MVP</h2>
          <ul className="list">
            <li>
              Бесплатный пробный период: {site.trialPeriodDays} дней после ручной активации админом
            </li>
            <li>Бонус за подтвержденный заказ: {site.referralOffer.signupBonusLabel} обеим сторонам</li>
            <li>Процент с утвержденных подписок: {site.referralOffer.subscriptionPercent}%</li>
            <li>Готовый комплект роутера: {site.orderOffer.totalPriceLabel}</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
