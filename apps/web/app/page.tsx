import Image from "next/image";
import Link from "next/link";
import { PortalHeader } from "../components/portal-header";
import { getSiteSnapshot, getSystemHealth } from "../components/site-data";

export default async function HomePage() {
  const [site, health] = await Promise.all([getSiteSnapshot(), getSystemHealth()]);

  return (
    <main className="shell portalPage">
      <PortalHeader
        navItems={[
          { href: "/cabinet", label: "Кабинет", active: true },
          { href: "/cabinet#routers", label: "Мои роутеры" },
          { href: "/cabinet#support", label: "Поддержка" },
          { href: "/cabinet#payments", label: "Платежи" },
          { href: "/cabinet#profile", label: "Профиль" }
        ]}
        rightSlot={
          <>
            <Link className="portalGhostButton secondaryButton" href={site.links.telegramChannel} target="_blank">
              Telegram-канал
            </Link>
            <Link className="primaryButton portalActionButton" href="/login">
              Войти в кабинет
            </Link>
          </>
        }
        subtitle="Интернет должен просто работать."
      />

      <section className="portalHero">
        <div className="heroCopy">
          <span className="statusTag">FOX POINT</span>
          <h1>Интернет должен просто работать.</h1>
          <p>{site.tagline}</p>

          <div className="ctaRow">
            <Link className="primaryButton portalActionButton" href="/login">
              Войти в кабинет
            </Link>
            <Link className="secondaryButton portalGhostButton" href={site.links.telegramChannel} target="_blank">
              Telegram-канал
            </Link>
          </div>
        </div>

        <div className="heroVisual panel">
          <Image
            priority
            alt="FoxPoint приветственный экран"
            className="heroImage"
            height={720}
            src="/images/foxpoint-hero-welcome.jpg"
            width={960}
          />
        </div>
      </section>

      <section className="miniGrid featureGrid">
        <article className="metricCard panel">
          <div className="muted">Пробный старт</div>
          <div className="metricValue">{site.trialPeriodDays} дней</div>
          <p>Достаточно, чтобы проверить роутер, кабинет и поддержку.</p>
        </article>
        <article className="metricCard panel">
          <div className="muted">Готовый комплект</div>
          <div className="metricValue">{site.orderOffer.totalPriceLabel}</div>
          <p>Роутер, настройка и подключение без лишней переписки.</p>
        </article>
        <article className="metricCard panel">
          <div className="muted">Статус платформы</div>
          <div className="metricValue">{health.ok ? "ON" : "CHECK"}</div>
          <p>API {health.ok ? "доступен" : "нуждается в проверке"} и база {health.database}.</p>
        </article>
      </section>

      <section className="panel promoCard">
        <div className="promoCopy">
          <span className="pill">Заказать новый роутер</span>
          <h2>Нужен новый роутер или расширение сети?</h2>
          <p>Подберем устройство, настроим подключение и оставим все под контролем.</p>
        </div>

        <div className="ctaRow">
          <Link className="primaryButton portalActionButton" href="/login">
            Создать заказ
          </Link>
          <Link className="secondaryButton portalGhostButton" href={site.links.telegramChannel} target="_blank">
            Узнать подробнее
          </Link>
        </div>
      </section>

      <footer className="siteFooter">FOX POINT © 2026. Интернет должен просто работать.</footer>
    </main>
  );
}
