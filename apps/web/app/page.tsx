import Link from "next/link";
import { getEntryLinks, getSiteOverview, isTelegramBotConfigured } from "../components/site-data";

const features = [
  {
    title: "Единый аккаунт",
    text: "Сайт и Telegram будут опираться на один backend и одну БД, чтобы роутеры, сроки и платежи не расходились."
  },
  {
    title: "Покупка и продление",
    text: "Подписки, быстрые продления и заказ готового роутера закладываются сразу в архитектуру MVP."
  },
  {
    title: "Ручные процессы под контролем",
    text: "Админка остаётся обязательной частью MVP: привязка роутеров, активации, заказы, поддержка и аудит."
  }
];

export default async function HomePage() {
  const [entryLinks, overview] = await Promise.all([getEntryLinks(), getSiteOverview()]);
  const hasTelegramBot = isTelegramBotConfigured(entryLinks.telegramBot);

  return (
    <main className="shell" style={{ padding: "24px 0 56px" }}>
      <section className="panel hero">
        <span className="pill">FoxPoint MVP • VPS-ready start</span>
        <h1 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
          Интернет, как раньше.
          <br />
          Без путаницы между сайтом, кабинетом и ботом.
        </h1>
        <p>
          Публичная часть, админка и Telegram-ссылки уже работают как единый контур. Дальше
          развиваем персональный кабинет и Telegram-идентификацию без фальшивых сценариев на сайте.
        </p>
        <div className="ctaRow">
          <Link
            className="primaryButton"
            href={hasTelegramBot ? entryLinks.telegramBot : entryLinks.telegramChannel}
            target="_blank"
          >
            {hasTelegramBot ? "Открыть Telegram-бота" : "Открыть Telegram-канал"}
          </Link>
          <Link className="secondaryButton" href="/login">
            Клиентский вход
          </Link>
          <Link className="secondaryButton" href={entryLinks.support} target="_blank">
            Поддержка
          </Link>
        </div>
      </section>

      <section className="gridTwo heroGrid">
        <article className="panel entryCard">
          <span className="statusTag">Рабочий вход</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
            Telegram остаётся главным входом для текущих клиентов.
          </h2>
          <p>
            Клиентский путь уже ведёт в реальные каналы связи. Если Telegram-бот ещё не подключён,
            сайт отправит в канал и поддержку, а не в пустую заглушку.
          </p>
          <div className="ctaRow" style={{ marginTop: "auto" }}>
            <Link
              className="primaryButton"
              href={hasTelegramBot ? entryLinks.telegramBot : entryLinks.support}
              target="_blank"
            >
              {hasTelegramBot ? "Перейти в бота" : "Написать в поддержку"}
            </Link>
            <Link className="secondaryButton" href={entryLinks.telegramChannel} target="_blank">
              Канал проекта
            </Link>
          </div>
        </article>

        <article className="panel entryCard">
          <span className="statusTag">Текущий статус</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
            Сайт больше не маскирует незавершённые части под готовый личный кабинет.
          </h2>
          <p>
            Вместо фиктивных кнопок и выдуманных данных здесь теперь только реальные рабочие
            страницы: клиентский вход, публичные ссылки, админка и API-основа.
          </p>
          <div className="ctaRow" style={{ marginTop: "auto" }}>
            <Link className="primaryButton" href="/cabinet">
              Открыть клиентский раздел
            </Link>
            <Link className="secondaryButton" href="/admin">
              Открыть админку
            </Link>
          </div>
        </article>
      </section>

      <section style={{ marginTop: "28px" }}>
        <div style={{ marginBottom: "18px" }}>
          <h2 className="sectionTitle" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
            Что уже работает
          </h2>
          <p className="sectionLead">
            Данные ниже приходят из текущего контура проекта и отражают реальное состояние системы,
            а не декоративный текст для демо.
          </p>
        </div>
        <div className="miniGrid">
          {features.map((feature) => (
            <article key={feature.title} className="panel featureCard">
              <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "24px" }}>
                {feature.title}
              </h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel" style={{ marginTop: "28px", padding: "28px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h2 className="sectionTitle" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
            Активный контур проекта
          </h2>
          <p className="sectionLead">
            Основа уже разложена по понятным зонам, а следующий этап развития виден прямо из API.
          </p>
        </div>
        <ul className="list">
          {overview.currentScope.map((section) => (
            <li key={section}>{section}</li>
          ))}
        </ul>
      </section>

      <section className="panel" style={{ marginTop: "28px", padding: "28px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h2 className="sectionTitle" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
            Что подключаем дальше
          </h2>
          <p className="sectionLead">
            Эти этапы уже заложены в backend и структуру проекта, но ещё не выдаются за готовый функционал.
          </p>
        </div>
        <ul className="list">
          {overview.nextMilestones.map((section) => (
            <li key={section}>{section}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
