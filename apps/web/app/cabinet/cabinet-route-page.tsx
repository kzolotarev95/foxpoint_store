import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { PortalHeader } from "../../components/portal-header";
import { TicketConversation } from "../../components/ticket-conversation";
import { TicketStatusBadge } from "../../components/ticket-status-badge";
import { TelegramLoginWidget } from "../../components/telegram-login-widget";
import {
  attachProfileEmailAction,
  createRouterOrderAction,
  logoutClientAction,
  revokeAllClientSessionsAction,
  revokeClientSessionAction,
  requestAccountDeletionAction,
  requestTwoFactorSetupAction,
  renewRouterAction,
  saveProfileCredentialsAction,
  saveRouterTemplateAction
} from "../../lib/client-actions";
import { fetchClientApi, getClientSessionToken } from "../../lib/client-auth";
import type { ClientOverview } from "../../lib/portal-types";
import { buildTelegramCallbackUrlForRequest, getTelegramBotUsername } from "../../lib/telegram-auth";
import { buildTelegramBotUrl } from "../../lib/telegram-bot";

export type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;
export type CabinetTab = "overview" | "routers" | "support" | "payments" | "profile";

type RouterOverviewItem = ClientOverview["routers"][number];
type ClientSessionItem = ClientOverview["sessions"][number];
type SupportTicketItem = ClientOverview["tickets"][number];
type ProfileSessionViewItem = ClientSessionItem & Awaited<ReturnType<typeof getProfileSessionMeta>>;
type NotificationFeedItem = {
  createdAt: string;
  detail: string;
  href: string;
  icon: ReactNode;
  id: string;
  isUnread: boolean;
  meta: string;
  title: string;
};

const SESSION_GEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SESSION_GEO_REQUEST_TIMEOUT_MS = 800;
const sessionGeoCache = new Map<string, { expiresAt: number; value: string }>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCabinetTabHref(tab: CabinetTab): string {
  const hrefs: Record<CabinetTab, string> = {
    overview: "/cabinet",
    routers: "/cabinet/routers",
    support: "/cabinet/support",
    payments: "/cabinet/payments",
    profile: "/cabinet/profile"
  };

  return hrefs[tab];
}

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) ? value[0] ?? null : null;
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null | undefined): string {
  const parsed = parseDateValue(value);

  if (!parsed) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parsed);
}

function formatRelativeDateTime(value: string | null | undefined): string {
  const target = parseDateValue(value);

  if (!target) {
    return "нет данных";
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const timeLabel = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(target);

  if (targetDay.getTime() === today.getTime()) {
    return `сегодня, ${timeLabel}`;
  }

  if (targetDay.getTime() === yesterday.getTime()) {
    return `вчера, ${timeLabel}`;
  }

  return `${formatDate(value)}, ${timeLabel}`;
}

function isPastDateTime(value: string | null | undefined): boolean {
  const parsed = parseDateValue(value);
  return Boolean(parsed && parsed.getTime() <= Date.now());
}

function formatSupportMessageTime(value: string | null | undefined): string {
  const parsed = parseDateValue(value);

  if (!parsed) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(parsed);
}

function getRouterLastActivity(router: RouterOverviewItem): string | null {
  const dates = [
    router.recentPayments[0]?.createdAt,
    router.recentTickets[0]?.updatedAt,
    router.currentSubscription?.startAt,
    router.trial?.startAt
  ].filter((item): item is string => Boolean(item));

  if (!dates.length) {
    return null;
  }

  return dates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

function getNearestSubscriptionEnd(routers: RouterOverviewItem[]): string | null {
  const dates = routers
    .map((router) => router.currentSubscription?.endAt ?? router.trial?.endAt ?? null)
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());

  return dates[0] ?? null;
}

function getPrimaryPaymentRouter(routers: RouterOverviewItem[]): RouterOverviewItem | null {
  const sorted = [...routers].sort((left, right) => {
    const leftDate = left.currentSubscription?.endAt ?? left.trial?.endAt ?? "9999-12-31T00:00:00.000Z";
    const rightDate = right.currentSubscription?.endAt ?? right.trial?.endAt ?? "9999-12-31T00:00:00.000Z";
    return new Date(leftDate).getTime() - new Date(rightDate).getTime();
  });

  return sorted[0] ?? null;
}

function formatRemainingDays(days: number | null | undefined): string {
  if (days == null) {
    return "Срок не определен";
  }

  if (days <= 0) {
    return "Требуется продление";
  }

  if (days === 1) {
    return "Остался 1 день";
  }

  const lastDigit = days % 10;
  const lastTwoDigits = days % 100;
  const suffix =
    lastDigit === 1 && lastTwoDigits !== 11
      ? "день"
      : lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
        ? "дня"
        : "дней";

  return `Осталось ${days} ${suffix}`;
}

function getPaymentStatusMeta(status: string): { label: string; tone: "paid" | "pending" | "failed" } {
  const normalized = status.toUpperCase();

  if (normalized === "PAID") {
    return {
      label: "Оплачено",
      tone: "paid"
    };
  }

  if (normalized === "PENDING" || normalized === "CREATED") {
    return {
      label: "Ожидает оплаты",
      tone: "pending"
    };
  }

  return {
    label: normalized === "REFUNDED" ? "Возврат" : normalized === "CANCELED" ? "Отменено" : "Ошибка",
    tone: "failed"
  };
}

function getPaymentMethodMonogram(label: string): string {
  const normalized = String(label ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  if (!normalized) {
    return "FP";
  }

  const parts = normalized.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
  }

  return parts[0].slice(0, 2).toUpperCase();
}

function formatSupportTicketCreatedAt(value: string): string {
  const parsed = parseDateValue(value);

  if (!parsed) {
    return "дата уточняется";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function getSupportTicketDisplayCode(ticketNumber: number): string {
  return String(ticketNumber);
}

function getSupportTicketTitle(ticket: SupportTicketItem): string {
  const description = String(ticket.description ?? "").trim();
  const category = String(ticket.category ?? "").trim();

  if (description && description.length <= 42) {
    return description;
  }

  if (category) {
    return category;
  }

  return description.slice(0, 42) || "Обращение в поддержку";
}

function getSupportTicketStatusMeta(status: string): { label: string; tone: "open" | "progress" | "resolved" | "waiting" } {
  const normalized = String(status ?? "").toUpperCase();

  if (normalized === "RESOLVED" || normalized === "CLOSED") {
    return {
      label: normalized === "CLOSED" ? "Закрыто" : "Решено",
      tone: "resolved"
    };
  }

  if (normalized === "IN_PROGRESS") {
    return {
      label: "В работе",
      tone: "progress"
    };
  }

  if (normalized === "WAITING_CLIENT") {
    return {
      label: "Ожидает ответа",
      tone: "waiting"
    };
  }

  return {
    label: "Новый запрос",
    tone: "open"
  };
}

function getSupportTicketMessageAuthorLabel(authorRole: string): string {
  return authorRole === "ADMIN" ? "Поддержка" : "Вы";
}

function renderSupportTicketThread(ticket: SupportTicketItem, openTicketId: string | null) {
  return (
    <details
      key={ticket.id}
      className="clientSupportThreadCard"
      id={`ticket-${ticket.id}`}
      open={ticket.status === "OPEN" || ticket.id === openTicketId}
    >
      <summary className="clientSupportThreadSummary">
        <div className="clientSupportThreadSummaryBody">
          <span className="clientSupportThreadIcon">
            <SupportIcon />
          </span>
          <div>
            <h3>
              #{getSupportTicketDisplayCode(ticket.number)} — {getSupportTicketTitle(ticket)}
            </h3>
            <p>Открыт {formatSupportTicketCreatedAt(ticket.createdAt)}</p>
          </div>
        </div>
        <TicketStatusBadge initialStatus={ticket.status} refreshUrl={`/cabinet/support/${ticket.id}`} />
        <span className="clientSupportTicketChevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </summary>

      <div className="clientSupportThreadBody">
        <TicketConversation
          adminLabel="Поддержка"
          closedLabel="Чат закрыт. Новые сообщения отправить нельзя."
          clientLabel="Вы"
          messages={ticket.messages}
          replyActionUrl="/cabinet/support/reply"
          replyButtonLabel="Отправить"
          replyPlaceholder="Напишите сообщение..."
          refreshUrl={`/cabinet/support/${ticket.id}`}
          status={ticket.status}
          ticketId={ticket.id}
        />
      </div>
    </details>
  );
}

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

function formatLongDate(value: string | null | undefined): string {
  if (!value) {
    return "нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(value));
}

function formatTelegramHandle(value: string | null | undefined): string {
  if (!value) {
    return "@не_привязан";
  }

  return value.startsWith("@") ? value : `@${value}`;
}

function isPrivateIpAddress(ipAddress: string): boolean {
  if (ipAddress === "127.0.0.1") {
    return true;
  }

  if (ipAddress.startsWith("10.") || ipAddress.startsWith("192.168.") || ipAddress.startsWith("169.254.")) {
    return true;
  }

  const secondOctet = Number(ipAddress.split(".")[1] ?? "");
  return ipAddress.startsWith("172.") && secondOctet >= 16 && secondOctet <= 31;
}

async function resolveSessionGeoLabel(ipAddress: string | null | undefined): Promise<string> {
  const normalizedIp = extractIpAddress(ipAddress);

  if (!normalizedIp) {
    return "Локация не определена";
  }

  if (isPrivateIpAddress(normalizedIp)) {
    return "Частная сеть";
  }

  const cached = sessionGeoCache.get(normalizedIp);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(normalizedIp)}`, {
      next: {
        revalidate: 21600
      },
      signal: AbortSignal.timeout(SESSION_GEO_REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error("Geo lookup failed");
    }

    const payload = (await response.json()) as {
      city?: string;
      country?: string;
      region?: string;
      success?: boolean;
    };

    if (payload.success === false) {
      throw new Error("Geo lookup failed");
    }

    const geoLabel = [payload.city, payload.region, payload.country].filter(Boolean).join(", ");
    const resolvedLabel = geoLabel || payload.country || "Геоданные недоступны";
    sessionGeoCache.set(normalizedIp, {
      expiresAt: Date.now() + SESSION_GEO_CACHE_TTL_MS,
      value: resolvedLabel
    });
    return resolvedLabel;
  } catch {
    return cached?.value ?? "Геоданные недоступны";
  }
}

function getSessionPlatformLabel(userAgent: string): string {
  if (/iphone/.test(userAgent)) {
    return "iPhone";
  }

  if (/ipad/.test(userAgent)) {
    return "iPad";
  }

  if (/android/.test(userAgent)) {
    return "Android";
  }

  if (/windows/.test(userAgent)) {
    return "Windows";
  }

  if (/mac os x|macintosh/.test(userAgent)) {
    return "macOS";
  }

  if (/linux/.test(userAgent)) {
    return "Linux";
  }

  if (/telegram/.test(userAgent)) {
    return "Telegram";
  }

  return "Устройство";
}

function getSessionBrowserLabel(userAgent: string): string {
  if (/telegram/.test(userAgent)) {
    return "Telegram";
  }

  if (/edg\//.test(userAgent)) {
    return "Edge";
  }

  if (/opr\//.test(userAgent) || /opera/.test(userAgent)) {
    return "Opera";
  }

  if (/firefox\//.test(userAgent)) {
    return "Firefox";
  }

  if (/crios\//.test(userAgent)) {
    return "Chrome iOS";
  }

  if (/chrome\//.test(userAgent)) {
    return "Chrome";
  }

  if (/safari\//.test(userAgent)) {
    return "Safari";
  }

  return "Браузер";
}

function getSessionBaseMeta(session: ClientSessionItem) {
  const userAgent = (session.userAgent ?? "").toLowerCase();
  const isPhoneSession = /android|iphone|ipad|mobile/.test(userAgent);
  const isTelegramSession = /telegram/.test(userAgent);
  const platformLabel = getSessionPlatformLabel(userAgent);
  const browserLabel = getSessionBrowserLabel(userAgent);
  const ipLabel = extractIpAddress(session.ipAddress) ?? "IP не определен";
  const activityLabel = formatRelativeDateTime(session.lastSeenAt);
  const loginLabel = formatRelativeDateTime(session.createdAt);
  const deviceLabel =
    browserLabel === platformLabel || browserLabel === "Telegram"
      ? platformLabel
      : `${platformLabel} / ${browserLabel}`;

  return {
    activityLabel,
    browserLabel,
    deviceLabel: isTelegramSession ? "Telegram / Встроенный браузер" : deviceLabel,
    icon: isPhoneSession || isTelegramSession ? <DevicePhoneIcon /> : <MonitorIcon />,
    ipLabel,
    loginLabel,
    platformLabel
  };
}

async function getProfileSessionMeta(session: ClientSessionItem) {
  return {
    ...getSessionBaseMeta(session),
    geoLabel: await resolveSessionGeoLabel(session.ipAddress)
  };
}

function getOrderStatusLabel(status: string): string {
  const normalized = String(status ?? "").toUpperCase();

  if (normalized === "PAID" || normalized === "COMPLETED" || normalized === "DELIVERED") {
    return "Оплачен";
  }

  if (normalized === "WAITING_PAYMENT" || normalized === "CREATED") {
    return "Ожидает оплаты";
  }

  if (normalized === "SHIPPED") {
    return "Отправлен";
  }

  if (normalized === "CANCELED") {
    return "Отменен";
  }

  return "Обновлен";
}

function getNotificationTypeMeta(type: string): Pick<NotificationFeedItem, "detail" | "href" | "icon" | "title"> {
  const normalized = String(type ?? "").trim().toUpperCase();

  if (normalized.includes("PAYMENT")) {
    return {
      detail: normalized.includes("PAID") ? "Оплата подтверждена и учтена в кабинете." : "Есть обновление по оплате.",
      href: "/cabinet/payments",
      icon: <PaymentIcon />,
      title: "Платежи"
    };
  }

  if (normalized.includes("TICKET") || normalized.includes("SUPPORT")) {
    return {
      detail: "Обновился статус обращения в поддержку.",
      href: "/cabinet/support",
      icon: <SupportIcon />,
      title: "Поддержка"
    };
  }

  if (normalized.includes("SESSION") || normalized.includes("LOGIN") || normalized.includes("AUTH")) {
    return {
      detail: "Зафиксирован вход или изменение по сессии аккаунта.",
      href: "/cabinet/profile",
      icon: <BellIcon />,
      title: "Безопасность"
    };
  }

  if (normalized.includes("ORDER") || normalized.includes("ROUTER")) {
    return {
      detail: "Есть обновление по заказу роутера.",
      href: "/cabinet/routers",
      icon: <CartIcon />,
      title: "Заказ роутера"
    };
  }

  if (normalized.includes("REFERRAL") || normalized.includes("REWARD")) {
    return {
      detail: "Обновилась реферальная статистика или награда.",
      href: "/cabinet/profile",
      icon: <GiftIcon />,
      title: "Реферальная программа"
    };
  }

  return {
    detail: "Новое событие по вашему аккаунту.",
    href: "/cabinet/profile",
    icon: <BellIcon />,
    title: "Уведомление"
  };
}

function buildNotificationFeed(
  overview: ClientOverview,
  sessions: ClientSessionItem[],
  clearedAt: string | null,
  seenAt: string | null
): NotificationFeedItem[] {
  const clearedAtDate = parseDateValue(clearedAt);
  const seenAtDate = parseDateValue(seenAt);
  const seenThreshold = seenAtDate && clearedAtDate
    ? new Date(Math.max(seenAtDate.getTime(), clearedAtDate.getTime()))
    : seenAtDate ?? clearedAtDate;
  const systemNotifications = overview.notifications.map((notification) => {
    const meta = getNotificationTypeMeta(notification.type);
    const createdAt = parseDateValue(notification.createdAt);

    return {
      createdAt: notification.createdAt,
      detail: meta.detail,
      href: meta.href,
      icon: meta.icon,
      id: `notification-${notification.id}`,
      isUnread: createdAt ? (seenThreshold ? createdAt.getTime() > seenThreshold.getTime() : true) : false,
      meta: formatRelativeDateTime(notification.createdAt),
      title: meta.title
    };
  });

  const sessionNotifications = sessions.slice(0, 6).map((session) => {
    const sessionMeta = getSessionBaseMeta(session);
    const createdAt = parseDateValue(session.lastSeenAt);

    return {
      createdAt: session.lastSeenAt,
      detail: `${sessionMeta.deviceLabel} · ${sessionMeta.ipLabel}`,
      href: "/cabinet/profile",
      icon: sessionMeta.icon,
      id: `session-${session.id}`,
      isUnread: createdAt ? (seenThreshold ? createdAt.getTime() > seenThreshold.getTime() : true) : false,
      meta: `Активность ${sessionMeta.activityLabel}`,
      title: session.isCurrent ? "Текущее устройство в сети" : "Вход в кабинет"
    };
  });

  const paymentNotifications = overview.payments.slice(0, 4).map((payment) => {
    const paymentMeta = getPaymentStatusMeta(payment.status);
    const paymentDate = payment.paidAt ?? payment.createdAt;
    const createdAt = parseDateValue(paymentDate);

    return {
      createdAt: paymentDate,
      detail: `${payment.amountLabel} · ${payment.providerLabel}${payment.routerName ? ` · ${payment.routerName}` : ""}`,
      href: "/cabinet/payments",
      icon: <PaymentIcon />,
      id: `payment-${payment.id}`,
      isUnread: createdAt ? (seenThreshold ? createdAt.getTime() > seenThreshold.getTime() : true) : false,
      meta: formatRelativeDateTime(paymentDate),
      title: `Платеж: ${paymentMeta.label}`
    };
  });

  const supportNotifications = overview.tickets.slice(0, 4).map((ticket) => {
    const ticketMeta = getSupportTicketStatusMeta(ticket.status);
    const createdAt = parseDateValue(ticket.updatedAt);

    return {
      createdAt: ticket.updatedAt,
      detail: `${getSupportTicketTitle(ticket)} · ${ticketMeta.label}`,
      href: "/cabinet/support",
      icon: <SupportIcon />,
      id: `ticket-${ticket.id}`,
      isUnread: createdAt ? (seenThreshold ? createdAt.getTime() > seenThreshold.getTime() : true) : false,
      meta: formatRelativeDateTime(ticket.updatedAt),
      title: `Поддержка #${getSupportTicketDisplayCode(ticket.number)}`
    };
  });

  const orderNotifications = overview.orders.slice(0, 3).map((order) => {
    const orderDate = order.receivedAt ?? order.createdAt;
    const createdAt = parseDateValue(orderDate);

    return {
      createdAt: orderDate,
      detail: `${order.totalPriceLabel} · ${getOrderStatusLabel(order.status)}`,
      href: "/cabinet/routers",
      icon: <CartIcon />,
      id: `order-${order.id}`,
      isUnread: createdAt ? (seenThreshold ? createdAt.getTime() > seenThreshold.getTime() : true) : false,
      meta: formatRelativeDateTime(orderDate),
      title: "Заказ роутера"
    };
  });

  return [...systemNotifications, ...sessionNotifications, ...paymentNotifications, ...supportNotifications, ...orderNotifications]
    .filter((item) => {
      const createdAt = parseDateValue(item.createdAt);

      if (!createdAt) {
        return false;
      }

      return clearedAtDate ? createdAt.getTime() > clearedAtDate.getTime() : true;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 10);
}

function renderCabinetUnavailablePage(activeTab: CabinetTab) {
  const retryHref = `${getCabinetTabHref(activeTab)}?retry=${Date.now()}`;

  return (
    <main className="shell portalPage clientDashboardPage clientRoutersExperience">
      <PortalHeader
        brandHref={getCabinetTabHref(activeTab)}
        navItems={[
          { href: getCabinetTabHref("routers"), label: "Мои роутеры", icon: <RouterIcon />, active: activeTab === "routers" },
          { href: getCabinetTabHref("support"), label: "Поддержка", icon: <SupportIcon />, active: activeTab === "support" },
          { href: getCabinetTabHref("payments"), label: "Платежи", icon: <PaymentIcon />, active: activeTab === "payments" },
          { href: getCabinetTabHref("profile"), label: "Профиль", icon: <ProfileIcon />, active: activeTab === "profile" }
        ]}
        reloadBrandOnClick
      />

      <section className="panel clientSupportHeroCard" style={{ marginTop: "1rem" }}>
        <div className="clientSupportHeroOrb">
          <SupportIcon />
        </div>
        <div className="clientSupportHeroCopy">
          <h2>Кабинет временно недоступен</h2>
          <p>Мы уже пытаемся восстановить данные. Попробуйте обновить страницу или войти заново.</p>
        </div>
        <div className="clientSupportHeroActions">
          <Link className="clientSupportHeroButton isPrimary" href={retryHref}>
            Обновить
          </Link>
          <Link className="clientSupportHeroButton isSecondary" href="/login">
            Войти снова
          </Link>
        </div>
      </section>
    </main>
  );
}

type RouterDeviceVariant = "netis" | "keenetic" | "cudy" | "xiaomi-ax3000t" | "cudy-wbr3000uax";

type RouterDeviceSkin = {
  antennaCount: number;
  brandLabel: string;
  imageAlt?: string;
  imageClassName?: string;
  imageSrc?: string;
  modelLabel: string;
  variant: RouterDeviceVariant;
};

function getRouterDeviceVariant(model: string | null, index: number): RouterDeviceVariant {
  const normalized = (model ?? "").toLowerCase();
  if (normalized.includes("ax3000t")) {
    return "xiaomi-ax3000t";
  }

  if (normalized.includes("wbr3000uax")) {
    return "cudy-wbr3000uax";
  }

  if (normalized.includes("keenetic")) {
    return "keenetic";
  }

  if (normalized.includes("cudy")) {
    return "cudy";
  }

  if (normalized.includes("netis")) {
    return "netis";
  }

  return index % 3 === 1 ? "keenetic" : index % 3 === 2 ? "cudy" : "netis";
}

function getRouterDeviceSkin(router: RouterOverviewItem, index: number): RouterDeviceSkin {
  const variant = getRouterDeviceVariant(router.model, index);

  if (variant === "xiaomi-ax3000t") {
    return {
      antennaCount: 4,
      brandLabel: "XIAOMI",
      imageAlt: "Xiaomi Router AX3000T",
      imageClassName: "isXiaomi",
      imageSrc: "/images/router-ax3000t.png",
      modelLabel: "AX3000T",
      variant
    };
  }

  if (variant === "cudy-wbr3000uax") {
    return {
      antennaCount: 4,
      brandLabel: "CUDY",
      imageAlt: "Cudy WBR3000UAX",
      imageClassName: "isCudyWbr",
      imageSrc: "/images/router-wbr3000uax.png",
      modelLabel: "WBR3000UAX",
      variant
    };
  }

  if (variant === "keenetic") {
    return {
      antennaCount: 4,
      brandLabel: "KEENETIC",
      imageAlt: router.model ? `Keenetic ${router.model}` : "Keenetic router",
      imageClassName: "isKeenetic",
      imageSrc: "/images/router-keenetic-hopper.png",
      modelLabel: router.model ?? "Hopper",
      variant
    };
  }

  if (variant === "cudy") {
    return {
      antennaCount: 6,
      brandLabel: "CUDY",
      imageAlt: router.model ? `Cudy ${router.model}` : "Cudy router",
      imageClassName: "isCudy",
      imageSrc: "/images/router-cudy-wr3000.png",
      modelLabel: router.model ?? "WR3000",
      variant
    };
  }

  return {
    antennaCount: 4,
    brandLabel: "NETIS",
    imageAlt: router.model ? `Netis ${router.model}` : "Netis router",
    imageClassName: "isNetis",
    imageSrc: "/images/router-netis-nx31.png",
    modelLabel: router.model ?? "NX31",
    variant
  };
}

function getRouterStatusLabel(router: RouterOverviewItem): string {
  const statusLabels: Record<string, string> = {
    ACTIVE: "Активен",
    PENDING_ACTIVATION: "Ожидает активации",
    DRAFT: "Черновик",
    EXPIRED: "Истекла",
    READY: "Готов",
    INACTIVE: "Неактивен"
  };

  if (router.currentSubscription?.endAt && isPastDateTime(router.currentSubscription.endAt)) {
    return "Истекла";
  }

  if (router.currentSubscription?.pendingActivation) {
    return "Ожидает активации";
  }

  if (router.currentSubscription?.status) {
    return statusLabels[router.currentSubscription.status] ?? router.currentSubscription.status;
  }

  if (router.trial?.endAt) {
    if (isPastDateTime(router.trial.endAt)) {
      return "Истекла";
    }

    return "Тестовый режим";
  }

  return statusLabels[router.status] ?? router.status;
}

function getRouterStatusTone(router: RouterOverviewItem): "active" | "pending" | "default" {
  const label = getRouterStatusLabel(router);

  if (label === "Активен" || label === "Тестовый режим") {
    return "active";
  }

  if (label === "Ожидает активации") {
    return "pending";
  }

  return "default";
}

function extractIpAddress(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  return match?.[0] ?? null;
}

function getRouterIdentity(router: RouterOverviewItem): { label: string; value: string } {
  const ipAddress = extractIpAddress(router.adminNote);

  if (ipAddress) {
    return {
      label: "IP-адрес",
      value: ipAddress
    };
  }

  return {
    label: "ID устройства",
    value: router.serialNumber ?? router.id.slice(0, 8).toUpperCase()
  };
}

function getRouterFactTone(input: { daysRemaining: number | null | undefined; enabled: boolean; endAt?: string | null }): "ok" | "warning" {
  if (!input.enabled || !input.endAt) {
    return "warning";
  }

  if (input.daysRemaining == null) {
    return "warning";
  }

  return input.daysRemaining > 5 ? "ok" : "warning";
}

function IconShell({ children }: { children: ReactNode }) {
  return <span className="routerIconShell">{children}</span>;
}

function RouterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 15.5h14a2 2 0 0 1 2 2V19H3v-1.5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 6.5v9m8-9v9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M8 8.5c.8-.9 1.9-1.4 4-1.4s3.2.5 4 1.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M9.5 15.5h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <circle cx="15.8" cy="17.2" r=".55" fill="currentColor" />
      <circle cx="17.6" cy="17.2" r=".55" fill="currentColor" />
      <circle cx="19.4" cy="17.2" r=".55" fill="currentColor" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4 6 6.5v5.7c0 3.7 2.4 6.8 6 7.8 3.6-1 6-4.1 6-7.8V6.5z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m9.5 12 1.7 1.7L15 10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="5" y="14" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 7.5h.01M8 16.5h.01M11 7.5h4M11 16.5h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 19h4M12 16v3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function SupportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 18 4 20V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 10h6M9 14h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function PaymentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h16M8 14h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 19a7 7 0 0 1 14 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m6 8 6 5 6-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="11" width="12" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="12" cy="15.5" r=".8" fill="currentColor" />
    </svg>
  );
}

function DevicePhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="3.5" width="10" height="17" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 6h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="12" cy="17.2" r=".75" fill="currentColor" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s6-5.4 6-10.4A6 6 0 1 0 6 10.6C6 15.6 12 21 12 21Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10.5" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 10v12M4 14h16M4 10V7.8A1.8 1.8 0 0 1 5.8 6h12.4A1.8 1.8 0 0 1 20 7.8V10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 10H9.3a2.15 2.15 0 1 1 0-4.3c2.1 0 2.7 2.4 2.7 4.3Zm0 0h2.7a2.15 2.15 0 1 0 0-4.3C12.6 5.7 12 8.1 12 10Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.8 20 19a1.2 1.2 0 0 1-1 1.8H5a1.2 1.2 0 0 1-1-1.8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M12 9v4.8M12 17.6h.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h2l2 10h9l3-7H8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="10" cy="19" r="1.5" fill="currentColor" />
      <circle cx="17" cy="19" r="1.5" fill="currentColor" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a4 4 0 0 0-4 4v2.4c0 .8-.2 1.7-.7 2.4L6 15h12l-1.3-2.2a4.8 4.8 0 0 1-.7-2.4V8a4 4 0 0 0-4-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l2.7 1.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function FactStatusCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6.5 12.4 3.5 3.5L17.5 8.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}

function FactStatusAlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6v7.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
      <circle cx="12" cy="17.8" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8.8 12.1 2.2 2.2 4.4-4.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function TicketCreateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4.8h5.7L18 9.1V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M13.7 4.8v4.1H18M12 11v6M9 14h6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m20 5-3.2 14.2c-.2.9-.9 1.1-1.7.7l-4.6-3.4-2.2 2.2c-.3.3-.5.5-1 .5l.4-4.8L16.4 7c.4-.3-.1-.5-.6-.2L5 13.6l-4.6-1.5c-1-.3-1-.9.2-1.4L18.4 4c.8-.3 1.6.2 1.6 1Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function RemoteCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 19h4M12 15v4M7.5 10.5h3l1.2-2.2 2.1 4 1.1-1.8h1.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 4 1 .5 1.1 2.3 2.5.7 1.8-.8 1.5 1.5-.8 1.8.7 2.5L20 13l-.5 1-2.3 1.1-.7 2.5.8 1.8-1.5 1.5-1.8-.8-2.5.7L12 20l-1-.5-1.1-2.3-2.5-.7-1.8.8-1.5-1.5.8-1.8-.7-2.5L4 12l.5-1 2.3-1.1.7-2.5-.8-1.8 1.5-1.5 1.8.8 2.5-.7Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IdeaIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 18h6M9.5 21h5M8.3 14.7A6.5 6.5 0 1 1 15.7 14.7c-.9.8-1.5 1.8-1.7 2.8h-4c-.2-1-.8-2-1.7-2.8Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M12 3.5v1.7M5.7 6.2 7 7.4M18.3 6.2 17 7.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m14 8 4 4-4 4M9 12h9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function DevicePreview({ router, index }: { router: RouterOverviewItem; index: number }) {
  const skin = getRouterDeviceSkin(router, index);
  const antennaIndices = Array.from({ length: skin.antennaCount }, (_, item) => item);
  const hasDistinctModelLabel = skin.modelLabel.trim().toUpperCase() !== skin.brandLabel.trim().toUpperCase();
  const modelBadgeClassName = hasDistinctModelLabel
    ? "routerDeviceModelBadge"
    : "routerDeviceModelBadge isSingleLine";
  const modelBadge = (
    <div className="routerDeviceBadgeFrame">
      <div className={modelBadgeClassName}>
        {hasDistinctModelLabel ? <span>{skin.brandLabel}</span> : null}
        <strong>{skin.modelLabel}</strong>
      </div>
    </div>
  );

  return (
    <div className={`routerDeviceStage is-${skin.variant}`}>
      {skin.imageSrc ? (
        <div className="routerDevicePreviewStack">
          <div className="routerDeviceImageWrap">
            <Image
              alt={skin.imageAlt ?? skin.modelLabel}
              className={skin.imageClassName ? `routerDeviceImage ${skin.imageClassName}` : "routerDeviceImage"}
              height={220}
              priority={false}
              src={skin.imageSrc}
              width={300}
            />
          </div>
          {modelBadge}
        </div>
      ) : (
        <div className="routerDevicePreviewStack">
          <div className={`routerDevice is-${skin.variant}`}>
            <div className="routerDeviceAntennaRow">
              {antennaIndices.map((item) => (
                <span key={item} className="routerAntenna" />
              ))}
            </div>
            <div className="routerDeviceBody">
              <span className="routerDeviceBrand">{skin.brandLabel}</span>
              <div className="routerDeviceLights">
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
          {modelBadge}
        </div>
      )}
    </div>
  );
}

export async function CabinetRoutePage(props: { activeTab: CabinetTab; searchParams: PageSearchParams }) {
  const searchParams = await props.searchParams;
  const sessionToken = await getClientSessionToken();

  if (!sessionToken) {
    redirect("/login");
  }

  let overview: ClientOverview | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      overview = await fetchClientApi<ClientOverview>("/api/me/overview");
      break;
    } catch (error) {
      if (isRedirectError(error)) {
        throw error;
      }

      lastError = error;
      await sleep(300 * (attempt + 1));
      void error;
    }
  }

  if (!overview) {
    void lastError;
    return renderCabinetUnavailablePage(props.activeTab);
  }

  const successMessage = getSingleParam(searchParams.success);
  const errorMessage = getSingleParam(searchParams.error);
  const paymentUrl = getSingleParam(searchParams.payment);
  const welcomeMessage = getSingleParam(searchParams.welcome)
    ? "Профиль создан. Теперь кабинет готов к работе."
    : null;
  const nearestDeadline = getNearestSubscriptionEnd(overview.routers);
  const userInitials = buildUserInitials(overview.profile.name);
  const supportTickets = overview.tickets;
  const defaultOpenSupportTicketId = successMessage === "Обращение создано." ? supportTickets[0]?.id ?? null : null;
  const isOverviewTab = props.activeTab === "overview";
  const isRoutersTab = props.activeTab === "routers";
  const isSupportTab = props.activeTab === "support";
  const isPaymentsTab = props.activeTab === "payments";
  const isProfileTab = props.activeTab === "profile";
  const telegramHandle = formatTelegramHandle(overview.profile.telegram);
  const hasTelegram = Boolean(overview.profile.telegram);
  const telegramBotUsername = getTelegramBotUsername(overview.links.telegramBot);
  const telegramBotUrl = telegramBotUsername
    ? buildTelegramBotUrl(overview.links.telegramBot, "link")
    : overview.links.support;
  const telegramLinkAuthUrl = telegramBotUsername ? await buildTelegramCallbackUrlForRequest("link") : "";
  const profileSessions =
    props.activeTab === "profile"
      ? await Promise.all(
          overview.sessions.map(async (session) => ({
            ...session,
            ...(await getProfileSessionMeta(session))
          }))
        )
      : [];
  const notificationFeed = buildNotificationFeed(
    overview,
    overview.sessions,
    overview.profile.notificationFeedClearedAt,
    overview.profile.notificationFeedSeenAt
  );
  const notificationFeedCount = notificationFeed.length;
  const newNotificationFeedCount = notificationFeed.filter((item) => item.isUnread).length;
  const notificationBellBadge = newNotificationFeedCount > 99 ? "+99" : `+${newNotificationFeedCount}`;
  const notificationHeaderCount = newNotificationFeedCount > 0 ? newNotificationFeedCount : notificationFeedCount;
  const primaryPaymentRouter = getPrimaryPaymentRouter(overview.routers);
  const paymentDeadline = primaryPaymentRouter?.currentSubscription?.endAt ?? primaryPaymentRouter?.trial?.endAt ?? null;
  const paymentDaysRemaining =
    primaryPaymentRouter?.currentSubscription?.daysRemaining ?? primaryPaymentRouter?.trial?.daysRemaining ?? null;
  const paymentCurrentPriceLabel =
    primaryPaymentRouter?.currentSubscription?.priceLabel ??
    primaryPaymentRouter?.savedTemplate.nextPriceLabel ??
    overview.catalog.recommendedPriceLabel;
  const enabledPaymentMethods = overview.paymentMethods.filter((method) => method.enabled);

  return (
    <main className="shell portalPage clientDashboardPage clientRoutersExperience">
      <PortalHeader
        brandHref={getCabinetTabHref(props.activeTab)}
        navItems={[
          { href: getCabinetTabHref("routers"), label: "Мои роутеры", icon: <RouterIcon />, active: isRoutersTab },
          { href: getCabinetTabHref("support"), label: "Поддержка", icon: <SupportIcon />, active: isSupportTab },
          { href: getCabinetTabHref("payments"), label: "Платежи", icon: <PaymentIcon />, active: isPaymentsTab },
          { href: getCabinetTabHref("profile"), label: "Профиль", icon: <ProfileIcon />, active: isProfileTab }
        ]}
        reloadBrandOnClick
        rightSlot={
          <>
            <Link className="primaryButton portalActionButton portalOrderButton" href="/cabinet/routers">
              Заказать роутер
              <CartIcon />
            </Link>
            <details className="portalNotifications">
              <summary
                className={newNotificationFeedCount ? "portalBellButton hasAlert" : "portalBellButton"}
                aria-label="Открыть уведомления"
              >
                <BellIcon />
                {newNotificationFeedCount ? <span className="portalBellBadge">{notificationBellBadge}</span> : null}
              </summary>
              <div className="portalNotificationPopover">
                <div className="portalNotificationHeader">
                  <div className="portalNotificationHeading">
                    <strong>Уведомления и входы</strong>
                    <span>Новые уведомления и последние события по аккаунту.</span>
                  </div>
                  <span className="portalNotificationCount">{notificationHeaderCount}</span>
                </div>
                <div className="portalNotificationList">
                  {notificationFeed.length ? (
                    notificationFeed.map((item) => (
                      <Link
                        key={item.id}
                        className={item.isUnread ? "portalNotificationItem isUnread" : "portalNotificationItem"}
                        href={item.href}
                      >
                        <span className="portalNotificationIcon">{item.icon}</span>
                        <span className="portalNotificationBody">
                          <strong>{item.title}</strong>
                          <span>{item.detail}</span>
                          <span className="portalNotificationMeta">{item.meta}</span>
                        </span>
                      </Link>
                    ))
                  ) : (
                    <div className="portalNotificationEmpty">
                      Список очищен. Новые события по аккаунту будут появляться здесь.
                    </div>
                  )}
                </div>
                <div className="portalNotificationFooter">
                  {newNotificationFeedCount || notificationFeedCount ? (
                    <div className="portalNotificationFooterActions">
                      {newNotificationFeedCount ? (
                        <form action="/cabinet/notifications/read" method="post">
                          <input name="returnTo" type="hidden" value={getCabinetTabHref(props.activeTab)} />
                          <button className="secondaryButton portalGhostButton portalNotificationRead" type="submit">
                            Прочитать оповещения
                          </button>
                        </form>
                      ) : null}
                      {notificationFeedCount ? (
                        <form action="/cabinet/notifications/clear" method="post">
                          <input name="returnTo" type="hidden" value={getCabinetTabHref(props.activeTab)} />
                          <button className="secondaryButton portalGhostButton portalNotificationClear" type="submit">
                            Очистить список
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : (
                    <span className="portalNotificationFooterNote">Новых уведомлений нет. Когда появятся новые события, они будут показаны здесь.</span>
                  )}
                </div>
              </div>
            </details>
            <span className="portalUserChip portalUserChipRich">
              <span className="portalUserAvatar">{userInitials}</span>
              {overview.profile.name}
              <span className="portalChipChevron">
                <ChevronIcon />
              </span>
            </span>
            <form action={logoutClientAction}>
              <button className="portalGhostButton secondaryButton portalLogoutButton" type="submit">
                <LogoutIcon />
                Выйти
              </button>
            </form>
          </>
        }
      />

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

      {isOverviewTab || isRoutersTab ? (
        <section id="overview" className="clientRoutersHero">
        <div className="clientRoutersLead">
          <h1>Все ваши роутеры в одном месте.</h1>
          <p>
            Смотрите оборудование, сроки обслуживания
            <br />
            и работу серверов без лишней путаницы.
          </p>
        </div>

        <div className="clientRoutersSummary">
          <article className="clientSummaryCard">
            <IconShell>
              <RouterIcon />
            </IconShell>
            <div className="clientSummaryCopy">
              <span>Роутеров</span>
              <strong>{overview.stats.routerCount}</strong>
            </div>
          </article>

          <article className="clientSummaryCard">
            <IconShell>
              <ShieldIcon />
            </IconShell>
            <div className="clientSummaryCopy">
              <span>Поддержка активна</span>
              <strong>{nearestDeadline ? `до ${formatDate(nearestDeadline)}` : "нет подписки"}</strong>
            </div>
          </article>

          <article className="clientSummaryCard">
            <IconShell>
              <ServerIcon />
            </IconShell>
            <div className="clientSummaryCopy">
              <span>Работа серверов</span>
              <strong>{nearestDeadline ? `до ${formatDate(nearestDeadline)}` : "нет данных"}</strong>
            </div>
          </article>
        </div>

        {isRoutersTab ? (
          <div className="clientRoutersStage">
          <div id="routers" className="clientRoutersColumn">
            {!overview.routers.length ? (
              <section className="clientEmptyRouters panel">
                <span className="pill">Пустой кабинет</span>
                <h2>К вашему аккаунту пока не добавлены роутеры.</h2>
                <p>
                  Если устройство уже у вас, напишите в поддержку и мы проверим привязку. Если
                  роутеров пока нет, можно сразу оформить заказ.
                </p>
                <div className="ctaRow">
                  <form action={createRouterOrderAction}>
                    <input name="returnTo" type="hidden" value="/cabinet/routers" />
                    <button className="primaryButton portalActionButton" type="submit">
                      Заказать роутер
                    </button>
                  </form>
                  <Link className="secondaryButton portalGhostButton" href={getCabinetTabHref("support")}>
                    Написать в поддержку
                  </Link>
                </div>
              </section>
            ) : (
              <div className="clientRouterDeck">
                {overview.routers.map((router, index) => {
                  const routerIdentity = getRouterIdentity(router);
                  const routerStatusLabel = getRouterStatusLabel(router);
                  const routerStatusTone = getRouterStatusTone(router);
                  const supportTone = getRouterFactTone({
                    daysRemaining: router.currentSubscription?.daysRemaining ?? router.trial?.daysRemaining,
                    enabled: (router.currentSubscription?.supportType ?? "NONE") !== "NONE" || Boolean(router.trial?.endAt),
                    endAt: router.currentSubscription?.endAt ?? router.trial?.endAt
                  });
                  const serverTone = getRouterFactTone({
                    daysRemaining: router.currentSubscription?.daysRemaining ?? router.trial?.daysRemaining,
                    enabled: router.currentSubscription?.accessEnabled ?? Boolean(router.trial?.endAt),
                    endAt: router.currentSubscription?.endAt ?? router.trial?.endAt
                  });

                  return (
                    <article key={router.id} className="clientRouterRow" id={`router-${router.id}`}>
                      <div className="clientRouterPreview">
                        <DevicePreview router={router} index={index} />
                      </div>

                      <div className="clientRouterContent">
                        <div className="clientRouterHeading">
                          <div className="clientRouterTitleStack">
                            <h2>
                              {router.displayName} {router.model ? `— ${router.model}` : ""}
                            </h2>
                            <p className={`is-${routerStatusTone}`}>{routerStatusLabel}</p>
                          </div>
                        </div>

                        <div className="clientRouterFacts">
                          <div className="clientRouterFact">
                            <div className="clientRouterFactTop">
                              <span className="clientRouterFactLabel">
                                <ServerIcon />
                                Работа сервера до
                              </span>
                              <span className={`clientRouterFactStatus is-${serverTone}`} aria-hidden="true">
                                {serverTone === "ok" ? <FactStatusCheckIcon /> : <FactStatusAlertIcon />}
                              </span>
                            </div>
                            <strong>{formatDate(router.currentSubscription?.endAt ?? router.trial?.endAt)}</strong>
                          </div>
                          <div className="clientRouterFact">
                            <div className="clientRouterFactTop">
                              <span className="clientRouterFactLabel">
                                <ShieldIcon />
                                Поддержка до
                              </span>
                              <span className={`clientRouterFactStatus is-${supportTone}`} aria-hidden="true">
                                {supportTone === "ok" ? <FactStatusCheckIcon /> : <FactStatusAlertIcon />}
                              </span>
                            </div>
                            <strong>{formatDate(router.currentSubscription?.endAt ?? router.trial?.endAt)}</strong>
                          </div>
                          <div className="clientRouterFact">
                            <span className="clientRouterFactLabel">
                              <MonitorIcon />
                              {routerIdentity.label}
                            </span>
                            <strong>{routerIdentity.value}</strong>
                          </div>
                          <div className="clientRouterFact">
                            <span className="clientRouterFactLabel">
                              <ClockIcon />
                              Последняя проверка
                            </span>
                            <strong>{formatRelativeDateTime(getRouterLastActivity(router))}</strong>
                          </div>
                          <form action={renewRouterAction} className="clientRouterFactActionForm">
                          <input name="routerId" type="hidden" value={router.id} />
                          <input name="returnTo" type="hidden" value="/cabinet/routers" />
                          <button className="clientRouterActionButton" type="submit">
                            <span className="clientRouterActionIcon">
                              <ServerIcon />
                            </span>
                            <span className="clientRouterActionLabel">Продлить</span>
                            <ChevronIcon />
                          </button>
                        </form>

                        <Link className="clientRouterActionButton isGhost" href={getCabinetTabHref("support")}>
                          <span className="clientRouterActionIcon">
                            <SupportIcon />
                          </span>
                          <span className="clientRouterActionLabel">Поддержка</span>
                          <ChevronIcon />
                        </Link>
                        </div>

                        <details className="clientRouterControlDisclosure" id={`router-controls-${router.id}`}>
                          <summary className="clientRouterActionButton isGhost clientRouterControlDisclosureSummary">
                            <span className="clientRouterActionIcon clientRouterActionIconPlaceholder" aria-hidden="true" />
                            <span className="clientRouterActionLabel">Настройки</span>
                            <span className="clientRouterControlDisclosureState clientRouterControlDisclosureStateClosed">Показать</span>
                            <span className="clientRouterControlDisclosureState clientRouterControlDisclosureStateOpen">Скрыть</span>
                            <ChevronIcon />
                          </summary>
                          <article className="panel clientRouterControlCard">
                            <div className="clientRouterControlHeader">
                              <div className="clientRouterControlTitle">
                                <span className="pill">Роутер</span>
                                <h3>{router.displayName}</h3>
                                <p className="clientRouterControlLead">Пакет на следующее продление.</p>
                              </div>
                              <p className={`clientRouterControlState is-${getRouterStatusTone(router)}`}>{getRouterStatusLabel(router)}</p>
                            </div>

                            <div className="clientRouterFacts clientRouterControlFacts">
                              <div className="clientRouterFact">
                                <span className="clientRouterFactLabel">Текущий пакет</span>
                                <strong>{router.currentPackage}</strong>
                              </div>
                              <div className="clientRouterFact">
                                <span className="clientRouterFactLabel">Следующее продление</span>
                                <strong>{router.savedTemplate.label}</strong>
                              </div>
                              <div className="clientRouterFact">
                                <span className="clientRouterFactLabel">Стоимость</span>
                                <strong>{router.savedTemplate.nextPriceLabel}</strong>
                              </div>
                              <div className="clientRouterFact">
                                <span className="clientRouterFactLabel">Статус</span>
                                <strong className={`clientRouterStatusValue is-${getRouterStatusTone(router)}`}>{getRouterStatusLabel(router)}</strong>
                              </div>
                            </div>

                            <form action={saveRouterTemplateAction} className="clientRouterSettingsForm">
                              <input name="routerId" type="hidden" value={router.id} />
                              <input name="returnTo" type="hidden" value="/cabinet/routers" />

                              <div className="clientRouterControlOptions">
                                <label className="clientRouterControlOptionCard clientRouterControlOptionCardInline">
                                  <span className="clientRouterControlOptionCopy">
                                    <span className="clientRouterControlOptionTitle">Расширенный доступ</span>
                                    <span className="clientRouterControlOptionHint">
                                      Добавит удалённый доступ к роутеру за {overview.catalog.extendedAccessPrice}{"\u00A0₽."}
                                    </span>
                                  </span>
                                  <span className="clientRouterControlCheck">
                                    <input defaultChecked={router.savedTemplate.accessEnabled} name="accessEnabled" type="checkbox" />
                                    <span>Включить</span>
                                  </span>
                                </label>

                                <label className="clientRouterControlOptionCard fieldStack">
                                  <span className="fieldLabel">Сопровождение</span>
                                  <select className="textInput" defaultValue={router.savedTemplate.supportType} name="supportType">
                                    <option value="NONE">Без сопровождения</option>
                                    <option value="BASIC">Базовое сопровождение</option>
                                    <option value="EXTENDED">Расширенное сопровождение</option>
                                  </select>
                                </label>
                              </div>

                              <button className="secondaryButton portalGhostButton clientRouterControlSubmit" type="submit">
                                Сохранить пакет
                              </button>
                            </form>
                          </article>
                        </details>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="clientRoutersMascot" aria-hidden="true">
            <div className="clientRoutersMascotShell">
              <div className="clientRoutersMascotGlow" />
              <div className="clientRoutersMascotCard">
                <Image
                  alt=""
                  className="clientRoutersMascotImage"
                  height={1254}
                  priority
                  src="/images/foxpoint-cabinet-fox-poster.png"
                  width={1254}
                />
              </div>
            </div>
          </aside>
        </div>
        ) : null}
      </section>
      ) : null}

      {isSupportTab ? (
      <section id="support" className="clientSupportSection">
        <article className="panel clientSupportHeroCard">
          <div className="clientSupportHeroOrb">
            <SupportIcon />
          </div>
          <div className="clientSupportHeroCopy">
            <h2>Нужна помощь?</h2>
            <p>
              Опишите проблему, и мы проверим роутер удалённо.
              <br />
              Если удобнее, можно сразу открыть поддержку в Telegram.
            </p>
          </div>
          <div className="clientSupportHeroActions">
            <a className="clientSupportHeroButton isPrimary" href="#support-form">
              <TicketCreateIcon />
              Создать обращение
            </a>
            <Link className="clientSupportHeroButton isSecondary" href={overview.links.support} target="_blank">
              <TelegramIcon />
              Открыть Telegram
            </Link>
          </div>
        </article>

        <div className="clientSupportGrid">
          <article className="panel clientSupportTicketsCard">
            <div className="clientSupportCardHeader">
              <span className="pill">История</span>
              <h2>Мои обращения</h2>
              <p>Следите за статусом заявок и при необходимости создавайте новые обращения без переписки.</p>
            </div>

            {supportTickets.length ? (
              <div className="clientSupportThreadList">
                {supportTickets.map((ticket) => renderSupportTicketThread(ticket, defaultOpenSupportTicketId))}
              </div>
            ) : (
              <div className="clientSupportEmptyState">
                <p>Обращений пока нет. Первый запрос можно создать через форму или сразу написать в Telegram.</p>
              </div>
            )}
          </article>

          <article className="panel clientSupportInfoCard">
            <div className="clientSupportCardHeader">
              <span className="pill">Поддержка</span>
              <h2>Как мы помогаем</h2>
              <p>Большинство вопросов закрываем удалённо: быстро, без долгих созвонов и лишних действий с вашей стороны.</p>
            </div>
            <div className="clientSupportInfoList">
              <div className="clientSupportInfoItem">
                <span className="clientSupportInfoIcon">
                  <RemoteCheckIcon />
                </span>
                <div>
                  <h3>Проверяем роутер</h3>
                  <p>Диагностируем соединение и настройки вашего роутера удалённо.</p>
                </div>
              </div>

              <div className="clientSupportInfoItem">
                <span className="clientSupportInfoIcon">
                  <SettingsIcon />
                </span>
                <div>
                  <h3>Исправляем удалённо</h3>
                  <p>Устраняем большинство проблем без вашего участия.</p>
                </div>
              </div>

              <div className="clientSupportInfoItem">
                <span className="clientSupportInfoIcon">
                  <IdeaIcon />
                </span>
                <div>
                  <h3>Подсказываем следующий шаг</h3>
                  <p>Если нужно ваше действие, подскажем простой и понятный шаг.</p>
                </div>
              </div>
            </div>
          </article>
        </div>

        <article id="support-form" className="clientSupportModal" aria-labelledby="support-modal-title">
          <a className="clientSupportModalBackdrop" href="#support" aria-label="Закрыть окно" />
          <div className="panel sectionPanel clientUtilityCard clientSupportFormCard clientSupportModalCard">
            <div className="clientSupportModalHeader">
              <span className="clientSupportModalSpacer" aria-hidden="true" />
              <div>
                <span className="pill">Поддержка</span>
                <h2 id="support-modal-title" className="sectionTitle">Создать обращение</h2>
              </div>
              <a className="clientSupportModalClose" href="#support" aria-label="Закрыть окно">
                ×
              </a>
            </div>
            <p className="sectionLead clientSupportFormLead">
              Укажите тему и кратко опишите проблему. Если обращение связано с конкретным роутером, выберите его в списке.
            </p>
            <form action="/cabinet/support/create" className="contentStack clientSupportFormStack" method="post">
              <input name="returnTo" type="hidden" value="/cabinet/support#support-form" />
              <label className="fieldStack">
                <span className="fieldLabel">Категория</span>
                <input
                  className="textInput"
                  maxLength={120}
                  minLength={2}
                  name="category"
                  placeholder="Продление, настройка, доставка"
                  required
                  type="text"
                />
              </label>
              <label className="fieldStack">
                <span className="fieldLabel">Роутер</span>
                <select className="textInput" name="routerId">
                  <option value="">Без привязки к роутеру</option>
                  {overview.routers.map((router) => (
                    <option key={router.id} value={router.id}>
                      {router.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fieldStack">
                <span className="fieldLabel">Описание</span>
                <textarea
                  className="textAreaInput"
                  maxLength={3000}
                  minLength={10}
                  name="description"
                  placeholder="Опишите ситуацию и что именно нужно сделать."
                  required
                />
              </label>
              <div className="ctaRow">
                <button className="primaryButton portalActionButton" type="submit">
                  Отправить обращение
                </button>
                <Link className="secondaryButton portalGhostButton" href={overview.links.support} target="_blank">
                  Открыть поддержку
                </Link>
              </div>
            </form>
          </div>
        </article>
      </section>
      ) : null}

      {isProfileTab ? (
      <section id="profile" className="profileCabinetPage">
        <div className="profileIntro">
          <h1>Профиль и безопасность</h1>
          <p>Управляйте своими данными, входом в кабинет и реферальной программой в одном месте.</p>
        </div>

        <div className="miniGrid profileSummaryGrid">
          <article className="metricCard profileSummaryCard">
            <div className="profileStatTop">
              <span className="profileStatGlyph">
                <ProfileIcon />
              </span>
              <div>
                <span className="profileCardLabel">Имя</span>
                <strong className="profileInfoValue">{overview.profile.name}</strong>
              </div>
            </div>
          </article>

          <article className="metricCard profileSummaryCard">
            <div className="profileStatTop">
              <span className="profileStatGlyph">
                <MailIcon />
              </span>
              <div>
                <span className="profileCardLabel">Email</span>
                <strong className="profileInfoValue">{overview.profile.email ?? "Не привязан"}</strong>
              </div>
            </div>
          </article>

          <article className="metricCard profileSummaryCard">
            <div className="profileStatTop">
              <span className="profileStatGlyph">
                <TelegramIcon />
              </span>
              <div>
                <span className="profileCardLabel">Telegram</span>
                <strong className="profileInfoValue">{hasTelegram ? telegramHandle : "Еще не привязан"}</strong>
              </div>
            </div>
          </article>
        </div>

        <article className="panel profileSecurityPanel">
          <div className="profileSectionHeader">
            <span className="profileSectionIcon">
              <ShieldIcon />
            </span>
            <h2>Вход и безопасность</h2>
          </div>

          <div className="profileSecurityList">
            <div className="profileSecurityRow">
              <span className="profileSecurityIcon">
                <LockIcon />
              </span>
              <div className="profileSecurityText">
                <strong>Пароль</strong>
                <span>
                  {overview.profile.localLogin
                    ? `Логин ${overview.profile.localLogin} используется для входа в кабинет FOX POINT.`
                    : "Создайте логин и пароль для быстрого входа в кабинет."}
                </span>
              </div>
              <div className="profileInlineActions">
                <form action={saveProfileCredentialsAction} className="profileInlineForm">
                  <input name="returnTo" type="hidden" value="/cabinet/profile" />
                  <input
                    className="textInput profileInlineInput"
                    defaultValue={overview.profile.localLogin ?? ""}
                    name="login"
                    placeholder="Логин"
                    required
                    type="text"
                  />
                  <input
                    className="textInput profileInlineInput"
                    minLength={6}
                    name="password"
                    placeholder={overview.profile.localLogin ? "Новый пароль" : "Пароль"}
                    required
                    type="password"
                  />
                  <button className="secondaryButton portalGhostButton profileMiniButton" type="submit">
                    {overview.profile.localLogin ? "Сменить пароль" : "Сохранить вход"}
                  </button>
                </form>
              </div>
            </div>

            <div className="profileSecurityRow">
              <span className="profileSecurityIcon">
                <TelegramIcon />
              </span>
              <div className="profileSecurityText">
                <strong>Telegram</strong>
                <span>{hasTelegram ? `Аккаунт ${telegramHandle} уже привязан к кабинету.` : "Привяжите Telegram для быстрых уведомлений и входа."}</span>
              </div>
              <div className="profileInlineActions profileInlineActionsWide">
                <span className={hasTelegram ? "profileState profileStateLinked" : "profileState"}>
                  {hasTelegram ? "Привязан" : "Не подключен"}
                </span>
                {!hasTelegram ? (
                  <TelegramLoginWidget
                    authUrl={telegramLinkAuthUrl}
                    botUrl={telegramBotUrl}
                    botUsername={telegramBotUsername}
                    className="telegramAuthStack telegramAuthStackCompact profileTelegramWidget"
                    fallbackLabel={telegramBotUsername ? "Привязать Telegram" : "Открыть поддержку"}
                    hint={
                      telegramBotUsername
                        ? "После подтверждения Telegram сразу привяжется к текущему кабинету."
                        : "Пока бот не настроен, запрос на привязку можно отправить через поддержку."
                    }
                  />
                ) : null}
                {!overview.profile.email ? (
                  <form action={attachProfileEmailAction} className="profileInlineForm">
                    <input name="returnTo" type="hidden" value="/cabinet/profile" />
                    <input className="textInput profileInlineInput" name="email" placeholder="Email для уведомлений" required type="email" />
                    <button className="secondaryButton portalGhostButton profileMiniButton" type="submit">
                      Привязать email
                    </button>
                  </form>
                ) : null}
              </div>
            </div>

            <div className="profileSecurityRow">
              <span className="profileSecurityIcon">
                <ShieldIcon />
              </span>
              <div className="profileSecurityText">
                <strong>Двухфакторная защита</strong>
                <span>
                  {overview.profile.hasOpenTwoFactorRequest
                    ? "Запрос на подключение 2FA уже отправлен и виден администратору."
                    : hasTelegram
                      ? "Можно отправить запрос на настройку второго фактора через Telegram."
                      : "Можно отправить запрос на подключение 2FA, а мы поможем завершить настройку."}
                </span>
              </div>
              <div className="profileInlineActions">
                <span className={overview.profile.hasOpenTwoFactorRequest ? "profileState profileStateEnabled" : hasTelegram ? "profileState profileStateEnabled" : "profileState"}>
                  {overview.profile.hasOpenTwoFactorRequest ? "Запрос открыт" : hasTelegram ? "Доступна" : "По запросу"}
                </span>
                <form action={requestTwoFactorSetupAction}>
                  <input name="returnTo" type="hidden" value="/cabinet/profile" />
                  <button
                    className="secondaryButton portalGhostButton profileMiniButton"
                    disabled={overview.profile.hasOpenTwoFactorRequest}
                    type="submit"
                  >
                    Управлять 2FA
                  </button>
                </form>
              </div>
            </div>
          </div>
        </article>

        <article className="panel profileSessionsPanel">
          <div className="profileSectionHeader profileSectionHeaderWide">
            <span className="profileSectionIcon">
              <MonitorIcon />
            </span>
            <h2>Активные сессии</h2>
            <form action={revokeAllClientSessionsAction} className="profileSectionHeaderAction">
              <input name="returnTo" type="hidden" value="/cabinet/profile" />
              <input name="currentSessionId" type="hidden" value={profileSessions.find((session) => session.isCurrent)?.id ?? ""} />
              {profileSessions.map((session) => (
                <input key={session.id} name="sessionId" type="hidden" value={session.id} />
              ))}
              <button className="secondaryButton portalGhostButton profileMiniButton" type="submit">
                Завершить все сессии
              </button>
            </form>
          </div>

          <div className="profileSessionList">
            {profileSessions.map((session) => (
              <div key={session.id} className="profileSessionRow">
                <span className="profileSecurityIcon profileSessionDeviceIcon">{session.icon}</span>
                <div className="profileSessionText">
                  <div className="profileSessionTitleLine">
                    <strong>{session.deviceLabel}</strong>
                    {session.isCurrent ? <span className="profileSessionPill">это устройство</span> : null}
                  </div>
                  <span className="profileSessionSubline">
                    Вход: {session.loginLabel} · Последняя активность: {session.activityLabel}
                  </span>
                </div>
                <div className="profileSessionMeta">
                  <span>
                    <LocationIcon />
                    {session.geoLabel}
                  </span>
                  <span>
                    <RemoteCheckIcon />
                    {session.ipLabel}
                  </span>
                  <span>
                    <ClockIcon />
                    {session.browserLabel}
                  </span>
                </div>
                {session.isCurrent ? (
                  <form action={logoutClientAction}>
                    <button className="secondaryButton portalGhostButton profileMiniButton" type="submit">
                      Завершить
                    </button>
                  </form>
                ) : (
                  <form action={revokeClientSessionAction}>
                    <input name="returnTo" type="hidden" value="/cabinet/profile" />
                    <input name="sessionId" type="hidden" value={session.id} />
                    <button className="secondaryButton portalGhostButton profileMiniButton" type="submit">
                      Завершить
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </article>

        <div className="profileActionGrid">
          <article className="panel profileReferralPanel">
            <div className="profileReferralCopy">
              <div className="profileSectionHeader">
                <span className="profileSectionIcon">
                  <GiftIcon />
                </span>
                <h2>Реферальная программа</h2>
              </div>
              <div className="profileReferralSummary">
                <span className="profileReferralChip">
                  <span className="profileCardLabel">Код</span>
                  <strong>{overview.profile.referralCode}</strong>
                </span>
                <span className="profileReferralChip">
                  <span className="profileCardLabel">Клиентов</span>
                  <strong>{overview.referrals.invitedCount}</strong>
                </span>
                <span className="profileReferralChip">
                  <span className="profileCardLabel">Начислено</span>
                  <strong className="isWarm">{overview.referrals.availableRewardsLabel}</strong>
                </span>
              </div>
              <div className="profileReferralLinkRow">
                <span className="profileCardLabel">Реферальная ссылка</span>
                <a className="profileReferralLink" href={overview.profile.referralLink} rel="noreferrer" target="_blank">
                  {overview.profile.referralLink}
                </a>
              </div>
            </div>
          </article>

          <article className="panel profileDeletePanel">
            <div className="profileDeleteCopy">
              <div className="profileSectionHeader">
                <span className="profileSectionIcon isDanger">
                  <AlertTriangleIcon />
                </span>
                <h2>Удаление аккаунта</h2>
              </div>
              <p>После удаления аккаунта все данные будут безвозвратно удалены.</p>
            </div>

            <form action={requestAccountDeletionAction}>
              <input name="returnTo" type="hidden" value="/cabinet/profile" />
              <button
                className="secondaryButton dangerButton profileDeleteButton"
                disabled={overview.profile.hasOpenDeletionRequest}
                type="submit"
              >
                {overview.profile.hasOpenDeletionRequest ? "Запрос уже отправлен" : "Удалить аккаунт"}
              </button>
            </form>
          </article>
        </div>
      </section>
      ) : null}

      {isPaymentsTab ? (
      <section id="payments" className="clientPaymentsPage">
        <div className="clientPaymentsIntro">
          <h1>Платежи и продление</h1>
          <p>Следите за сроком обслуживания и выбирайте удобный способ оплаты без переписки и ручных реквизитов.</p>
        </div>

        <div className="clientPaymentsHeroGrid">
          <article className="panel clientPaymentsServiceCard">
            <div className="clientPaymentsServiceHeader">
              <div className="clientPaymentsServiceBadge">
                <ShieldIcon />
              </div>
              <div className="clientPaymentsServiceBody">
                <span className="pill">Текущее обслуживание</span>
                <h2>
                  {primaryPaymentRouter
                    ? `${primaryPaymentRouter.displayName}${primaryPaymentRouter.model ? ` - ${primaryPaymentRouter.model}` : ""}`
                    : "Роутер еще не подключен"}
                </h2>
                <p className="clientPaymentsStatusLine">
                  {paymentDeadline ? `Активно до ${formatDate(paymentDeadline)}` : "Платный пакет пока не активирован"}
                </p>
                <p className="clientPaymentsMuted">{formatRemainingDays(paymentDaysRemaining)}</p>
              </div>
            </div>

            <div className="clientPaymentsServiceHighlights">
              <div className="clientPaymentsServiceHighlight">
                <span>Срок обслуживания</span>
                <strong>{paymentDeadline ? formatDate(paymentDeadline) : "Не активирован"}</strong>
              </div>
              <div className="clientPaymentsServiceHighlight">
                <span>Состояние</span>
                <strong>{paymentDaysRemaining === null ? "Новый заказ" : formatRemainingDays(paymentDaysRemaining)}</strong>
              </div>
            </div>

            <div className="clientPaymentsMethodGrid">
              {enabledPaymentMethods.length ? (
                enabledPaymentMethods.map((method, index) =>
                  primaryPaymentRouter ? (
                    <form key={method.id} action={renewRouterAction}>
                      <input name="provider" type="hidden" value={method.id} />
                      <input name="returnTo" type="hidden" value="/cabinet/payments" />
                      <input name="routerId" type="hidden" value={primaryPaymentRouter.id} />
                      <button
                        className={index === 0 ? "clientPaymentsMethodButton isPrimary" : "clientPaymentsMethodButton isSecondary"}
                        type="submit"
                      >
                        <span className="clientPaymentsMethodLogo" aria-hidden="true">
                          {getPaymentMethodMonogram(method.label)}
                        </span>
                        <span className="clientPaymentsMethodText">Продлить через {method.label}</span>
                      </button>
                    </form>
                  ) : (
                    <form key={method.id} action={createRouterOrderAction}>
                      <input name="provider" type="hidden" value={method.id} />
                      <input name="returnTo" type="hidden" value="/cabinet/payments" />
                      <button
                        className={index === 0 ? "clientPaymentsMethodButton isPrimary" : "clientPaymentsMethodButton isSecondary"}
                        type="submit"
                      >
                        <span className="clientPaymentsMethodLogo" aria-hidden="true">
                          {getPaymentMethodMonogram(method.label)}
                        </span>
                        <span className="clientPaymentsMethodText">Заказать роутер через {method.label}</span>
                      </button>
                    </form>
                  )
                )
              ) : (
                <Link className="clientPaymentsMethodButton isSecondary" href={overview.links.support} target="_blank">
                  <span className="clientPaymentsMethodText">Написать в поддержку</span>
                </Link>
              )}
            </div>
          </article>

          <article className="panel clientPaymentsTariffCard">
            <div className="clientPaymentsTariffIcon">
              <PaymentIcon />
            </div>
            <span className="clientPaymentsLabel">Тариф обслуживания</span>
            <strong>{paymentCurrentPriceLabel}</strong>
            <span className="clientPaymentsTariffPeriod">за {overview.catalog.periodDays} дней</span>
            <div className="clientPaymentsTariffDivider" />
            <div className="clientPaymentsTariffFeature">
              <CheckCircleIcon />
              <div>
                <b>{primaryPaymentRouter?.currentPackage ?? overview.catalog.recommendedPackage}</b>
                <p>
                  {primaryPaymentRouter
                    ? "Продление привязано к выбранному роутеру и обновляет его текущий пакет."
                    : "После заказа роутера оплата и продление будут доступны здесь автоматически."}
                </p>
              </div>
            </div>
          </article>
        </div>

        <div className="clientPaymentsContentGrid">
          <article className="panel clientPaymentsHistoryCard">
            <div className="clientPaymentsCardHeader">
              <div className="clientPaymentsCardHeading">
                <div className="clientPaymentsCardIcon">
                  <PaymentIcon />
                </div>
                <span className="pill">История платежей</span>
                <h2>Последние оплаты</h2>
              </div>
            </div>

            {overview.payments.length ? (
              <div className="clientPaymentsHistoryTable">
                <div className="clientPaymentsHistoryHead">
                  <span>Дата</span>
                  <span>Описание</span>
                  <span>Способ</span>
                  <span>Сумма</span>
                  <span>Статус</span>
                </div>
                {overview.payments.map((payment) => {
                  const statusMeta = getPaymentStatusMeta(payment.status);

                  return (
                    <div key={payment.id} className="clientPaymentsHistoryRow">
                      <span>{formatDate(payment.paidAt ?? payment.createdAt)}</span>
                      <span>{payment.routerName ?? "Заказ роутера"}</span>
                      <span>{payment.providerLabel}</span>
                      <strong>{payment.amountLabel}</strong>
                      <span className={`clientPaymentsStatusBadge is-${statusMeta.tone}`}>{statusMeta.label}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="clientPaymentsEmptyState">
                Оплат пока нет. Как только вы оплатите продление или заказ, история появится здесь.
              </div>
            )}
          </article>

          <article className="panel clientPaymentsSupportCard">
            <div className="clientPaymentsCardIcon">
              <SupportIcon />
            </div>
            <span className="pill">Другой способ</span>
            <h2>Нужен другой способ оплаты?</h2>
            <p>Если нужен корпоративный счет, нестандартная сумма или помощь с оплатой, напишите нам в поддержку.</p>

            <div className="clientPaymentsSupportList">
              {enabledPaymentMethods.map((method) => (
                <div key={method.id} className="clientPaymentsSupportItem">
                  <div className="clientPaymentsSupportLogo" aria-hidden="true">
                    {getPaymentMethodMonogram(method.label)}
                  </div>
                  <div className="clientPaymentsSupportCopy">
                    <strong>{method.label}</strong>
                    <span>{method.description}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="clientPaymentsSupportActions">
              <Link className="clientPaymentsMethodButton isSecondary" href={overview.links.support} target="_blank">
                Написать в поддержку
              </Link>
              <Link className="clientPaymentsMethodButton isGhost" href={getCabinetTabHref("routers")}>
                Открыть мои роутеры
              </Link>
            </div>
          </article>
        </div>
      </section>
      ) : null}

      {isOverviewTab || isSupportTab ? (
      <section className="clientDashboardLowerGrid">
        {isOverviewTab ? (
        <article id="order" className="panel sectionPanel clientUtilityCard">
          <span className="pill">Заказать роутер</span>
          <h2 className="sectionTitle">Готовый роутер под ключ</h2>
          <p className="sectionLead">
            Получаете уже настроенное устройство, подключаете дома и не тратите время на ручную
            настройку техники.
          </p>
          <div className="clientUtilityStats">
            <div className="clientRouterMiniStat">
              <span>Роутер</span>
              <strong>{overview.orderOffer.routerPriceLabel}</strong>
            </div>
            <div className="clientRouterMiniStat">
              <span>Прошивка и настройка</span>
              <strong>{overview.orderOffer.setupPriceLabel}</strong>
            </div>
            <div className="clientRouterMiniStat">
              <span>Итого</span>
              <strong>{overview.orderOffer.totalPriceLabel}</strong>
            </div>
          </div>
          <form action={createRouterOrderAction}>
            <input name="returnTo" type="hidden" value="/cabinet/routers" />
            <button className="primaryButton portalActionButton" type="submit">
              Создать заказ
            </button>
          </form>
        </article>
        ) : null}

        {isOverviewTab ? (
        <article id="payments" className="panel sectionPanel clientUtilityCard">
          <span className="pill">Платежи</span>
          <h2 className="sectionTitle">Последние оплаты</h2>
          <ul className="list">
            {overview.payments.length ? (
              overview.payments.map((payment) => (
                <li key={payment.id}>
                  {payment.amountLabel} · {payment.providerLabel} · {payment.status} · {payment.routerName ?? "Заказ роутера"} ·{" "}
                  {formatDate(payment.createdAt)}
                </li>
              ))
            ) : (
              <li>Пока нет платежей.</li>
            )}
          </ul>
        </article>
        ) : null}

        {isOverviewTab ? (
        <article id="profile" className="panel sectionPanel clientUtilityCard">
          <span className="pill">Профиль</span>
          <h2 className="sectionTitle">Данные клиента</h2>
          <div className="clientUtilityStats">
            <div className="clientRouterMiniStat">
              <span>Имя</span>
              <strong>{overview.profile.name}</strong>
            </div>
            <div className="clientRouterMiniStat">
              <span>Email</span>
              <strong>{overview.profile.email ?? "Не привязан"}</strong>
            </div>
            <div className="clientRouterMiniStat">
              <span>Telegram</span>
              <strong>{hasTelegram ? telegramHandle : "Еще не привязан"}</strong>
            </div>
            <div className="clientRouterMiniStat">
              <span>Реферальный код</span>
              <strong>{overview.profile.referralCode}</strong>
            </div>
          </div>
        </article>
        ) : null}
      </section>
      ) : null}
    </main>
  );
}
