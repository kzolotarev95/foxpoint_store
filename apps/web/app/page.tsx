import Image from "next/image";
import Link from "next/link";
import { getSiteSnapshot, getSystemHealth, isTelegramBotConfigured } from "../components/site-data";

export default async function HomePage() {
  const [site, health] = await Promise.all([getSiteSnapshot(), getSystemHealth()]);
  const hasTelegramBot = isTelegramBotConfigured(site.links.telegramBot);

  return (
    <main className="shell siteShell">
      <header className="topBar">
        <div className="brandLockup">
          <span className="pill">FoxPoint</span>
        </div>
        <div className="ctaRow">
          <Link className="secondaryButton" href={site.links.telegramChannel} target="_blank">
            Telegram-канал
          </Link>
          <Link className="primaryButton" href="/login">
            Войти в кабинет
          </Link>
        </div>
      </header>

      <section className="panel heroStage">
        <div className="heroContent">
          <span className="statusTag">Главный экран</span>
          <h1>Интернет должен просто работать.</h1>
          <p>
            FoxPoint берет на себя настройку, сопровождение и продление. Клиент сразу видит
            понятный маршрут: открыть Telegram, зайти в кабинет, заказать роутер или получить
            помощь без лишней технической нагрузки.
          </p>

          <div className="ctaRow">
            <Link className="primaryButton" href="/login">
              Открыть личный кабинет
            </Link>
            <Link
              className="secondaryButton"
              href={hasTelegramBot ? site.links.telegramBot : site.links.support}
              target="_blank"
            >
              {hasTelegramBot ? "Войти через Telegram" : "Связаться с поддержкой"}
            </Link>
          </div>

          <div className="heroTrustGrid">
            <article className="metricCard">
              <div className="muted">Пробный старт</div>
              <div className="metricValue">{site.trialPeriodDays} дней</div>
              <p>Достаточно, чтобы спокойно проверить связку роутера, подписки и кабинета.</p>
            </article>

            <article className="metricCard">
              <div className="muted">Готовый комплект</div>
              <div className="metricValue">{site.orderOffer.totalPriceLabel}</div>
              <p>
                Роутер {site.orderOffer.routerPriceLabel} и настройка {site.orderOffer.setupPriceLabel}.
              </p>
            </article>

            <article className="metricCard">
              <div className="muted">Статус платформы</div>
              <div className="metricValue">{health.ok ? "ON" : "CHECK"}</div>
              <p>API {health.ok ? "доступен" : "нуждается в проверке"}, база {health.database}.</p>
            </article>
          </div>
        </div>

        <div className="heroVisual">
          <Image
            priority
            alt="FoxPoint приветственный экран"
            className="heroImage"
            height={720}
            src="/images/foxpoint-hero-welcome.jpg"
            width={1280}
          />
          <div className="heroVisualShade" />
          <div className="heroOverlay">
            <span className="pill heroPill">Приветствие FoxPoint</span>
            <h2>Настройку и поддержку берем на себя</h2>
            <p>
              Главный экран теперь строится вокруг приветственного изображения и сразу задает
              нужное настроение сервиса.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
