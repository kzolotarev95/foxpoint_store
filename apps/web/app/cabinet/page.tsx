import Link from "next/link";
import { PortalHeader } from "../../components/portal-header";
import { fetchClientApi } from "../../lib/client-auth";
import type { ClientOverview } from "../../lib/portal-types";
import { createRouterOrderAction, logoutClientAction } from "../../lib/client-actions";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) ? value[0] ?? null : null;
}

export default async function CabinetPage(props: { searchParams: PageSearchParams }) {
  const [overview, searchParams] = await Promise.all([
    fetchClientApi<ClientOverview>("/api/me/overview"),
    props.searchParams
  ]);

  const successMessage = getSingleParam(searchParams.success);
  const errorMessage = getSingleParam(searchParams.error);
  const paymentUrl = getSingleParam(searchParams.payment);
  const welcomeMessage = getSingleParam(searchParams.welcome)
    ? "Профиль создан. Теперь кабинет готов к работе."
    : null;

  return (
    <main className="shell portalPage clientDashboardPage">
      <PortalHeader
        navItems={[
          { href: "#overview", label: "Кабинет", active: true },
          { href: "#routers", label: "Мои роутеры" },
          { href: "#support", label: "Поддержка" },
          { href: "#payments", label: "Платежи" },
          { href: "#profile", label: "Профиль" }
        ]}
        rightSlot={
          <>
            <form action={createRouterOrderAction}>
              <button className="primaryButton portalActionButton" type="submit">
                Заказать роутер
              </button>
            </form>
            <span className="portalBellButton" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="presentation">
                <path d="M12 22a2.2 2.2 0 0 0 2.18-2h-4.36A2.2 2.2 0 0 0 12 22Zm8-5.6c-1.4-1.1-2.2-2.7-2.2-5V9a5.8 5.8 0 0 0-4.7-5.7V2.7a1.1 1.1 0 0 0-2.2 0v.6A5.8 5.8 0 0 0 6.2 9v2.4c0 2.3-.8 3.9-2.2 5V18h16v-1.6Z" />
              </svg>
            </span>
            <span className="portalUserChip">
              <span className="portalUserAvatar" aria-hidden="true">
                {overview.profile.name.slice(0, 1).toUpperCase()}
              </span>
              <span>{overview.profile.name}</span>
            </span>
            <form action={logoutClientAction}>
              <button className="portalGhostButton secondaryButton" type="submit">
                Выйти
              </button>
            </form>
          </>
        }
      /> 

      <section id="profile" className="profileIntro">
        <h1>Профиль и безопасность</h1>
        <p>Управляйте доступом, роутерами и поддержкой в одном месте.</p>
      </section>

      {welcomeMessage ? <div className="banner successBanner">{welcomeMessage}</div> : null}
      {successMessage ? <div className="banner successBanner">{successMessage}</div> : null}
      {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}
      {paymentUrl ? (
        <div className="banner successBanner">
          Ссылка на оплату готова.{" "}
          <a className="authInlineLink" href={paymentUrl} target="_blank">
            Открыть
          </a>
        </div>
      ) : null}

      <section className="miniGrid profileSummaryGrid">
        <article className="metricCard panel">
          <div className="profileStatTop">
            <span className="profileStatGlyph">👤</span>
            <div className="muted">Имя</div>
          </div>
          <div className="metricValue">{overview.profile.name}</div>
          <p>Ваш профиль в системе FOX POINT.</p>
        </article>
        <article className="metricCard panel">
          <div className="profileStatTop">
            <span className="profileStatGlyph">✉</span>
            <div className="muted">Email</div>
          </div>
          <div className="metricValue">{overview.profile.email ?? "example@mail.com"}</div>
          <p>Используется для входа и уведомлений.</p>
        </article>
        <article className="metricCard panel">
          <div className="profileStatTop">
            <span className="profileStatGlyph">✈</span>
            <div className="muted">Telegram</div>
          </div>
          <div className="metricValue">{overview.profile.telegram ?? "@MrFoxClient"}</div>
          <p>Привязка для быстрого входа и поддержки.</p>
        </article>
      </section>

      <section id="routers" className="panel profileSecurityPanel">
        <div className="sectionHeader profileSectionHeader">
          <h2>Вход и безопасность</h2>
        </div>

        <div className="profileSecurityList">
          <div className="profileSecurityRow">
            <div className="profileSecurityIcon">🔒</div>
            <div className="profileSecurityText">
              <strong>Пароль</strong>
              <span>Используется для входа в личный кабинет</span>
            </div>
            <button className="secondaryButton profileMiniButton" type="button">
              Сменить пароль
            </button>
          </div>
          <div className="profileSecurityRow">
            <div className="profileSecurityIcon">✈</div>
            <div className="profileSecurityText">
              <strong>Telegram привязан</strong>
              <span>Аккаунт Telegram привязан к вашему профилю</span>
            </div>
            <span className="profileState profileStateLinked">{overview.profile.telegram ? "Привязан" : "Не привязан"}</span>
          </div>
          <div className="profileSecurityRow">
            <div className="profileSecurityIcon">🔐</div>
            <div className="profileSecurityText">
              <strong>Двухфакторная защита</strong>
              <span>Дополнительный уровень безопасности для вашего аккаунта</span>
            </div>
            <div className="profileInlineActions">
              <span className="profileState profileStateEnabled">Включена</span>
              <button className="secondaryButton profileMiniButton" type="button">
                Управлять 2FA
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel profileSessionsPanel">
        <div className="sectionHeader profileSectionHeader">
          <h2>Активные сессии</h2>
        </div>

        <div className="profileSessionList">
          <div className="profileSessionRow">
            <div className="profileSecurityIcon">🪟</div>
            <div className="profileSessionText">
              <strong>Windows 11 / Firefox</strong>
              <span>Россия · Москва · 24.08.2025, 12:45</span>
            </div>
            <span className="profileState profileStateCurrent">это устройство</span>
            <button className="secondaryButton profileMiniButton" type="button">
              Завершить
            </button>
          </div>
          <div className="profileSessionRow">
            <div className="profileSecurityIcon">📱</div>
            <div className="profileSessionText">
              <strong>iPhone / Safari</strong>
              <span>Россия · Санкт-Петербург · 23.08.2025, 21:12</span>
            </div>
            <span className="profileState"> </span>
            <button className="secondaryButton profileMiniButton" type="button">
              Завершить
            </button>
          </div>
        </div>
      </section>

      <section className="panel profileReferralPanel">
        <div className="sectionHeader profileSectionHeader">
          <h2>Реферальная программа</h2>
        </div>
        <div className="profileReferralGrid">
          <div className="profileReferralCodeBlock">
            <span className="fieldLabel">Ваш реферальный код</span>
            <strong>{overview.profile.referralCode}</strong>
          </div>
          <div className="profileReferralMetric">
            <span className="fieldLabel">Приглашено клиентов</span>
            <strong>{overview.referrals.invitedCount}</strong>
          </div>
          <div className="profileReferralMetric">
            <span className="fieldLabel">Начислено</span>
            <strong>{overview.referrals.availableRewardsLabel}</strong>
          </div>
          <div className="profileReferralAction">
            <Link className="secondaryButton portalGhostButton" href={overview.profile.referralLink}>
              Открыть реферальную ссылку
            </Link>
          </div>
        </div>
      </section>

      <section className="panel profileDeletePanel">
        <div className="sectionHeader profileSectionHeader">
          <h2>Удаление аккаунта</h2>
          <button className="secondaryButton portalGhostButton dangerButton" type="button">
            Удалить аккаунт
          </button>
        </div>
        <p className="sectionLead">Удаление аккаунта невозможно отменить. Будут удалены все ваши данные и настройки.</p>
      </section>
    </main>
  );
}
