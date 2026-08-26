import Link from "next/link";
import type { ReactNode } from "react";
import { createRouterOrderAction, logoutClientAction } from "../../lib/client-actions";
import { fetchClientApi } from "../../lib/client-auth";
import type { ClientOverview } from "../../lib/portal-types";
import { PortalHeader } from "../../components/portal-header";

type CabinetNotificationMeta = {
  detail: string;
  href: string;
  title: string;
};

function buildUserInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "FP";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a4 4 0 0 0-4 4v2.4c0 .8-.2 1.7-.7 2.4L6 15h12l-1.3-2.2a4.8 4.8 0 0 1-.7-2.4V8a4 4 0 0 0-4-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function getCabinetNotificationMeta(type: string): CabinetNotificationMeta {
  const normalized = String(type ?? "").trim().toUpperCase();

  if (normalized.includes("PAYMENT")) {
    return {
      detail: "Есть обновление по оплате.",
      href: "/cabinet/payments",
      title: "Платежи"
    };
  }

  if (normalized.includes("TICKET") || normalized.includes("SUPPORT")) {
    return {
      detail: "Обновился статус обращения в поддержку.",
      href: "/cabinet/support",
      title: "Поддержка"
    };
  }

  if (normalized.includes("SESSION") || normalized.includes("LOGIN") || normalized.includes("AUTH")) {
    return {
      detail: "Есть событие по безопасности аккаунта.",
      href: "/cabinet/profile",
      title: "Безопасность"
    };
  }

  if (normalized.includes("ORDER") || normalized.includes("ROUTER")) {
    return {
      detail: "Обновление по заказу роутера.",
      href: "/cabinet/routers",
      title: "Заказ роутера"
    };
  }

  if (normalized.includes("REFERRAL") || normalized.includes("REWARD")) {
    return {
      detail: "Обновилась реферальная статистика.",
      href: "/cabinet/profile",
      title: "Рефералы"
    };
  }

  return {
    detail: "Новое уведомление по вашему аккаунту.",
    href: "/cabinet/profile",
    title: "Уведомление"
  };
}

function formatNotificationDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }).format(new Date(value));
}

export default async function CabinetLayout({ children }: { children: ReactNode }) {
  let overview: ClientOverview | null = null;

  try {
    overview = await fetchClientApi<ClientOverview>("/api/me/overview");
  } catch {
    overview = null;
  }

  const userName = overview?.profile.name ?? "Клиент FoxPoint";
  const userInitials = buildUserInitials(userName);
  const notifications = overview ? [...overview.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5) : [];
  const unreadNotificationCount = notifications.filter((notification) => !notification.readAt).length;
  const notificationBadgeCount = unreadNotificationCount > 0 ? unreadNotificationCount : notifications.length;

  return (
    <>
      <div className="shell portalPage clientDashboardPage clientRoutersExperience">
        <PortalHeader
          brandHref="/cabinet/routers"
          navItems={[
            { href: "/cabinet/routers", label: "Мои роутеры" },
            { href: "/cabinet/support", label: "Поддержка" },
            { href: "/cabinet/payments", label: "Платежи" },
            { href: "/cabinet/profile", label: "Профиль" }
          ]}
          rightSlot={
            <>
              <form action={createRouterOrderAction}>
                <button className="primaryButton portalActionButton portalOrderButton" type="submit">
                  Заказать роутер
                </button>
              </form>
              {overview ? (
                <details className="portalNotifications">
                  <summary
                    className={notificationBadgeCount > 0 ? "portalBellButton hasAlert" : "portalBellButton"}
                    aria-label={`Уведомления${notificationBadgeCount ? `: ${notificationBadgeCount}` : ""}`}
                  >
                    <BellIcon />
                    {notificationBadgeCount > 0 ? <span className="portalBellBadge">{notificationBadgeCount > 99 ? "+99" : `+${notificationBadgeCount}`}</span> : null}
                  </summary>
                  <div className="portalNotificationPopover">
                    <div className="portalNotificationHeader">
                      <div className="portalNotificationHeading">
                        <strong>Уведомления</strong>
                        <span>{notifications.length ? `Показано ${notifications.length}` : "Пока нет уведомлений"}</span>
                      </div>
                      <span className="portalNotificationCount">{notificationBadgeCount}</span>
                    </div>

                    {notifications.length ? (
                      <div className="portalNotificationList">
                        {notifications.map((notification) => {
                          const meta = getCabinetNotificationMeta(notification.type);

                          return (
                            <Link
                              key={notification.id}
                              className={notification.readAt ? "portalNotificationItem" : "portalNotificationItem isUnread"}
                              href={meta.href}
                              prefetch
                              scroll={false}
                            >
                              <span className="portalNotificationIcon" aria-hidden="true">
                                <BellIcon />
                              </span>
                              <span className="portalNotificationBody">
                                <strong>{meta.title}</strong>
                                <span>{meta.detail}</span>
                                <span className="portalNotificationMeta">{formatNotificationDate(notification.createdAt)}</span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="portalNotificationEmpty">Новых уведомлений нет.</div>
                    )}

                    <div className="portalNotificationFooter">
                      <Link className="secondaryButton portalGhostButton" href="/cabinet/profile" prefetch scroll={false}>
                        Открыть профиль
                      </Link>
                    </div>
                  </div>
                </details>
              ) : null}
              <span className="portalUserChip portalUserChipRich">
                <span className="portalUserAvatar">{userInitials}</span>
                {userName}
              </span>
              <form action={logoutClientAction}>
                <button className="portalGhostButton secondaryButton portalLogoutButton" type="submit">
                  Выйти
                </button>
              </form>
            </>
          }
        />
      </div>
      {children}
    </>
  );
}
