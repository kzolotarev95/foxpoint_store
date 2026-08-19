import Link from "next/link";
import { dashboardSections, getEntryLinks } from "../components/site-data";

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
  const entryLinks = await getEntryLinks();

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
          Стартовый каркас уже учитывает главное из ТЗ: единый backend, общую БД, личный кабинет
          клиента, админскую зону и дальнейшую связку с Telegram.
        </p>
        <div className="ctaRow">
          <Link className="primaryButton" href={entryLinks.telegramBot} target="_blank">
            Открыть в Telegram
          </Link>
          <Link className="secondaryButton" href="/login">
            Войти на сайте
          </Link>
          <Link className="secondaryButton" href={entryLinks.telegramChannel} target="_blank">
            Telegram-канал
          </Link>
        </div>
      </section>

      <section className="gridTwo heroGrid">
        <article className="panel entryCard">
          <span className="statusTag">Быстрый вход</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
            Telegram остаётся главным входом для текущих клиентов.
          </h2>
          <p>
            В MVP закладываем приоритет на Telegram-авторизацию и резервный сценарий входа по email
            через одноразовый код.
          </p>
          <div className="ctaRow" style={{ marginTop: "auto" }}>
            <Link className="primaryButton" href={entryLinks.telegramBot} target="_blank">
              Перейти в бота
            </Link>
          </div>
        </article>

        <article className="panel entryCard">
          <span className="statusTag">Личный кабинет</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
            Сайт показывает сервис простыми словами, без внутренней технички.
          </h2>
          <p>
            Пользователь видит роутеры, сроки, оплаты, поддержку и реферальную программу, а
            технологические детали остаются внутри админской части.
          </p>
          <div className="ctaRow" style={{ marginTop: "auto" }}>
            <Link className="primaryButton" href="/cabinet">
              Открыть каркас ЛК
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
            Что уже учтено в архитектуре
          </h2>
          <p className="sectionLead">
            Основа под развёртывание на VPS сделана с прицелом на последовательность разработки из
            ТЗ, а не как временная демо-страница.
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
            Каркас разделов личного кабинета
          </h2>
          <p className="sectionLead">
            Список уже совпадает с ядром ТЗ и поможет дальше развивать интерфейс без переезда между
            структурами.
          </p>
        </div>
        <ul className="list">
          {dashboardSections.map((section) => (
            <li key={section}>{section}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
