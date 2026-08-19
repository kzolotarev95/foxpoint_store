import Link from "next/link";
import {
  dashboardSections,
  getEntryLinks,
  getSiteOverview,
  getSystemHealth,
  isTelegramBotConfigured
} from "../../components/site-data";

function getHealthLabel(database: string): string {
  if (database === "up") {
    return "Backend и база доступны";
  }

  if (database === "down") {
    return "Есть проблема с базой данных";
  }

  return "Статус базы уточняется";
}

export default async function CabinetPage() {
  const [entryLinks, overview, health] = await Promise.all([
    getEntryLinks(),
    getSiteOverview(),
    getSystemHealth()
  ]);

  const hasTelegramBot = isTelegramBotConfigured(entryLinks.telegramBot);

  return (
    <main className="shell dashboardShell">
      <aside className="panel sideNav">
        <span className="pill">Клиентский раздел</span>
        <p className="navMeta">
          Здесь только живые точки входа и реальный статус системы. Выдуманные роутеры, балансы и
          оплаты убраны, пока не подключена персональная Telegram-идентификация.
        </p>
        <ul>
          {dashboardSections.map((section) => (
            <li key={section}>
              <a href={`#${section}`}>{section}</a>
            </li>
          ))}
        </ul>
      </aside>

      <section className="contentStack">
        <article className="panel hero">
          <span className="statusTag">Честный контур клиента</span>
          <h1 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "54px", lineHeight: 1 }}>
            Сайт показывает только то, что уже реально работает сегодня.
          </h1>
          <p>
            Сейчас клиентский доступ ведёт через Telegram, поддержка доступна по прямой ссылке, а
            backend и админка уже работают на VPS. Персональные роутеры и подписки подключаем
            следующим этапом.
          </p>
          <div className="ctaRow">
            <Link
              className="primaryButton"
              href={hasTelegramBot ? entryLinks.telegramBot : entryLinks.support}
              target="_blank"
            >
              {hasTelegramBot ? "Открыть Telegram-бота" : "Связаться с поддержкой"}
            </Link>
            <Link className="secondaryButton" href={entryLinks.telegramChannel} target="_blank">
              Telegram-канал
            </Link>
            <Link className="secondaryButton" href="/admin/login">
              Админ-вход
            </Link>
          </div>
        </article>

        <section id="Текущий доступ" className="miniGrid">
          <article className="panel metricCard">
            <div className="muted">Клиентский вход</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {hasTelegramBot ? "Telegram-бот" : "Поддержка"}
            </div>
            <div className="muted">
              {hasTelegramBot
                ? "Основной сценарий входа уже направляет клиента в рабочий Telegram-канал доступа."
                : "Пока бот не настроен, вход клиента обслуживается через поддержку."}
            </div>
          </article>

          <article className="panel metricCard">
            <div className="muted">Среда</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {health.environment}
            </div>
            <div className="muted">{health.service}</div>
          </article>

          <article className="panel metricCard">
            <div className="muted">База данных</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {health.database === "up" ? "UP" : health.database.toUpperCase()}
            </div>
            <div className="muted">{getHealthLabel(health.database)}</div>
          </article>
        </section>

        <section id="Ссылки и каналы" className="gridTwo">
          <article className="panel featureCard">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "28px" }}>
              Поддержка
            </h3>
            <p>Рабочая ссылка для клиентов, если нужно подключение, помощь или ручная проверка доступа.</p>
            <div className="ctaRow" style={{ marginTop: "18px" }}>
              <Link className="primaryButton" href={entryLinks.support} target="_blank">
                Открыть поддержку
              </Link>
            </div>
          </article>

          <article className="panel featureCard">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "28px" }}>
              Telegram-канал
            </h3>
            <p>Публичный канал проекта для обновлений, уведомлений и дальнейших ссылок на бот и сайт.</p>
            <div className="ctaRow" style={{ marginTop: "18px" }}>
              <Link className="primaryButton" href={entryLinks.telegramChannel} target="_blank">
                Открыть канал
              </Link>
            </div>
          </article>
        </section>

        <section id="Статус системы" className="contentStack">
          <article className="panel" style={{ padding: "24px" }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
              Статус системы
            </h2>
            <p className="sectionLead" style={{ marginTop: "12px" }}>
              Эта страница опирается на текущий backend, а не на демонстрационные данные.
            </p>
            <ul className="list" style={{ marginTop: "16px" }}>
              <li>API: {health.ok ? "доступно" : "недоступно"}</li>
              <li>База данных: {health.database}</li>
              <li>Последняя проверка: {new Date(health.timestamp).toLocaleString("ru-RU")}</li>
              <li>Контур развёртывания: {overview.deploymentTarget}</li>
            </ul>
          </article>
        </section>

        <section id="Что уже работает" className="contentStack">
          <article className="panel" style={{ padding: "24px" }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
              Что уже работает
            </h2>
            <ul className="list" style={{ marginTop: "16px" }}>
              {overview.currentScope.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </section>

        <section id="Что подключаем дальше" className="contentStack">
          <article className="panel" style={{ padding: "24px" }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
              Что подключаем дальше
            </h2>
            <ul className="list" style={{ marginTop: "16px" }}>
              {overview.nextMilestones.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}

