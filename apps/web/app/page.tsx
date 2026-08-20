import Image from "next/image";
import Link from "next/link";
import { getSiteSnapshot, getSystemHealth } from "../components/site-data";

export default async function HomePage() {
  const [site, health] = await Promise.all([getSiteSnapshot(), getSystemHealth()]);

  return (
    <main className="shell siteShell">
      <header className="topBar">
        <div className="brandLockup">
          <span className="pill">
            FoxPoint
            <span aria-hidden="true" className="statusIndicator" />
          </span>
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
            height={640}
            src="/images/foxpoint-hero-welcome.jpg"
            width={482}
          />
        </div>
      </section>
    </main>
  );
}
