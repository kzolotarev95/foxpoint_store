"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type CabinetNotificationItem = {
  createdAt: string;
  id: string;
  readAt: string | null;
  type: string;
};

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a4 4 0 0 0-4 4v2.4c0 .8-.2 1.7-.7 2.4L6 15h12l-1.3-2.2a4.8 4.8 0 0 1-.7-2.4V8a4 4 0 0 0-4-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function getCabinetNotificationMeta(type: string): { detail: string; href: string; title: string } {
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

export function CabinetNotificationsBell({ notifications }: { notifications: CabinetNotificationItem[] }) {
  const pathname = usePathname();
  const notificationFeed = [...notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  const notificationFeedCount = notificationFeed.length;
  const unreadNotificationCount = notificationFeed.filter((notification) => !notification.readAt).length;
  const notificationBellBadge = unreadNotificationCount > 99 ? "+99" : `+${unreadNotificationCount}`;
  const notificationHeaderCount = unreadNotificationCount > 0 ? unreadNotificationCount : notificationFeedCount;
  const returnTo = pathname.startsWith("/cabinet") ? pathname : "/cabinet/profile";

  return (
    <details className="portalNotifications">
      <summary
        className={unreadNotificationCount ? "portalBellButton hasAlert" : "portalBellButton"}
        aria-label="Открыть уведомления"
      >
        <BellIcon />
        {unreadNotificationCount ? <span className="portalBellBadge">{notificationBellBadge}</span> : null}
      </summary>
      <div className="portalNotificationPopover">
        <div className="portalNotificationHeader">
          <div className="portalNotificationHeading">
            <strong>Уведомления и входы</strong>
            <span>Последние события по аккаунту, платежам, поддержке и сессиям.</span>
          </div>
          <span className="portalNotificationCount">{notificationHeaderCount}</span>
        </div>
        <div className="portalNotificationList">
          {notificationFeed.length ? (
            notificationFeed.map((notification) => {
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
            })
          ) : (
            <div className="portalNotificationEmpty">Последние события по аккаунту будут появляться здесь.</div>
          )}
        </div>
        <div className="portalNotificationFooter">
          {unreadNotificationCount || notificationFeedCount ? (
            <div className="portalNotificationFooterActions">
              {unreadNotificationCount ? (
                <form action="/cabinet/notifications/read" method="post">
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <button className="secondaryButton portalGhostButton portalNotificationRead" type="submit">
                    Прочитать оповещения
                  </button>
                </form>
              ) : null}
              {notificationFeedCount ? (
                <form action="/cabinet/notifications/clear" method="post">
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <button className="secondaryButton portalGhostButton portalNotificationClear" type="submit">
                    Очистить список
                  </button>
                </form>
              ) : null}
            </div>
          ) : (
            <span className="portalNotificationFooterNote">
              Новых уведомлений нет. Когда появятся новые события, они будут показаны здесь.
            </span>
          )}
        </div>
      </div>
    </details>
  );
}
