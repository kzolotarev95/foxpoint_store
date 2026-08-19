import Link from "next/link";
import { getEntryLinks, isTelegramBotConfigured } from "../../components/site-data";

export default async function LoginPage() {
  const entryLinks = await getEntryLinks();
  const hasTelegramBot = isTelegramBotConfigured(entryLinks.telegramBot);
  const primaryClientLink = hasTelegramBot ? entryLinks.telegramBot : entryLinks.support;
  const primaryClientLabel = hasTelegramBot ? "Открыть Telegram-бота" : "Написать в поддержку";

  return (
    <main className="shell" style={{ padding: "24px 0 56px" }}>
      <section className="panel" style={{ padding: "28px" }}>
        <span className="pill">Авторизация</span>
        <h1 className="sectionTitle" style={{ fontFamily: "var(--font-heading, sans-serif)", marginTop: "14px" }}>
          Клиентский вход FoxPoint
        </h1>
        <p className="sectionLead">
          Рабочий клиентский сценарий сейчас идёт через Telegram. Сайт не отправляет в фальшивый
          кабинет: если бот ещё не подключён, вход перенаправляется на поддержку.
        </p>
        <div className="ctaRow" style={{ marginTop: "20px" }}>
          <Link className="primaryButton" href={primaryClientLink} target="_blank">
            {primaryClientLabel}
          </Link>
          <Link className="secondaryButton" href={entryLinks.telegramChannel} target="_blank">
            Telegram-канал
          </Link>
          <Link className="secondaryButton" href="/admin/login">
            Админ-вход
          </Link>
        </div>
      </section>

      <section className="gridTwo" style={{ marginTop: "24px" }}>
        <article className="panel entryCard">
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "30px" }}>
            Telegram для клиентов
          </h2>
          <p>
            Основной маршрут для действующих клиентов. Здесь удобно подтверждать доступ, получать
            инструкции и дальше связывать сайт с конкретным пользователем.
          </p>
          <div className="ctaRow" style={{ marginTop: "auto" }}>
            <Link className="primaryButton" href={primaryClientLink} target="_blank">
              {primaryClientLabel}
            </Link>
          </div>
        </article>

        <article className="panel entryCard">
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "30px" }}>
            Что уже есть на сайте
          </h2>
          <p>
            Публичная часть и админка уже рабочие. Персональный кабинет клиента будет включён после
            подключения настоящей Telegram-идентификации на backend.
          </p>
          <div className="ctaRow" style={{ marginTop: "auto" }}>
            <Link className="primaryButton" href="/cabinet">
              Открыть статус клиента
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
