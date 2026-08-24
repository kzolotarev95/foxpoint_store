import Link from "next/link";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getApiBaseUrl } from "../../lib/api";
import { getAdminCookieName, readAdminSession } from "../../lib/admin-auth";
import type { AdminOverview } from "../../lib/portal-types";
import { getExpiredSessionCookieOptions } from "../../lib/session-cookie";

type AdminSettingRecord = {
  defaultValue: string;
  description: string;
  group: string;
  input: "boolean" | "number" | "password" | "text" | "url";
  key: string;
  label: string;
  public: boolean;
  value: string;
};

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;
type AdminUserRecord = AdminOverview["users"][number];

function encodeMessage(message: string): string {
  return encodeURIComponent(message);
}

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) ? value[0] ?? null : null;
}

function appendMessageToPath(path: string, key: "error" | "success", message: string): string {
  const target = new URL(path.startsWith("/") ? path : "/admin", "http://localhost");
  target.searchParams.set(key, message);
  return `${target.pathname}${target.search}${target.hash}`;
}

function getAdminUserName(user: Pick<AdminUserRecord, "name">): string {
  return user.name?.trim() || "Без имени";
}

function getAdminUserEmail(user: Pick<AdminUserRecord, "email">): string {
  return user.email?.trim() || "Нет email";
}

function getAdminUserTelegramLabel(user: Pick<AdminUserRecord, "telegram" | "hasTelegramIdentity">): string {
  if (user.telegram) {
    return user.telegram;
  }

  return user.hasTelegramIdentity ? "Привязан без username" : "Не привязан";
}

function getFieldInputMode(input: AdminSettingRecord["input"]) {
  if (input === "number") {
    return "decimal";
  }

  if (input === "url") {
    return "url";
  }

  return "text";
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateTimeInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const normalized = new Date(date.getTime() - offset * 60_000);
  return normalized.toISOString().slice(0, 16);
}

function AdminNavIcon({ children }: { children: ReactNode }) {
  return (
    <span className="adminSideNavIcon" aria-hidden="true">
      {children}
    </span>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3.8v5m6-5v5M8 8.8h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M7 9.2v2.2a5 5 0 0 0 10 0V9.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 14.5v3.3M14 14.5v3.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.8 19a5.2 5.2 0 0 1 10.4 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="17" cy="10" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14.6 19a4.4 4.4 0 0 1 7.2 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function RouterRackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="5" y="14" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 7.5h.01M8 16.5h.01M11 7.5h4M11 16.5h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 3.8v4M17 3.8v4M4 10h16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
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

function PaymentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h16M8 14h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 18 4 20V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 10h6M9 14h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
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

function AuditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5.5h9l3 3V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 11h6M9 15h4M15 5.5V9h3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
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

function getGroupNavIcon(groupName: string) {
  switch (true) {
    case /коммуника/i.test(groupName):
      return <MessageIcon />;
    case /платеж/i.test(groupName):
      return <PaymentIcon />;
    case /продаж/i.test(groupName):
      return <CartIcon />;
    case /подпис/i.test(groupName):
      return <CalendarIcon />;
    case /пробн/i.test(groupName):
      return <ClockIcon />;
    case /реферал/i.test(groupName):
      return <GiftIcon />;
    default:
      return <SettingsIcon />;
  }
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l2.7 1.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function getAdminUserStatusLabel(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "Активен";
    case "BLOCKED":
      return "Заблокирован";
    case "PENDING":
      return "Ожидает";
    default:
      return status;
  }
}

function getAdminRouterStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Черновик";
    case "ACTIVE":
      return "Активен";
    case "SUSPENDED":
      return "Приостановлен";
    case "DISABLED":
      return "Отключён";
    default:
      return status;
  }
}

function getAdminConfigurationTypeLabel(configurationType: string): string {
  switch (configurationType) {
    case "BASIC":
      return "Базовая";
    case "EXTENDED":
      return "Расширенная";
    default:
      return configurationType;
  }
}

function getAdminSubscriptionStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Черновик";
    case "ACTIVE":
      return "Активна";
    case "EXPIRED":
      return "Истекла";
    case "PENDING_ACTIVATION":
      return "Ожидает активации";
    case "PAUSED":
      return "На паузе";
    case "CANCELLED":
      return "Отменена";
    default:
      return status;
  }
}

function getAdminOrderStatusLabel(status: string): string {
  switch (status) {
    case "CREATED":
      return "Создан";
    case "WAITING_PAYMENT":
      return "Ожидает оплаты";
    case "PAID":
      return "Оплачен";
    case "CONFIGURING":
      return "Настраивается";
    case "READY_TO_SHIP":
      return "Готов к отправке";
    case "SHIPPED":
      return "Отправлен";
    case "RECEIVED":
      return "Получен";
    case "CANCELED":
      return "Отменён";
    case "REFUND":
      return "Возврат";
    default:
      return status;
  }
}

function getAdminTicketStatusLabel(status: string): string {
  switch (status) {
    case "OPEN":
      return "Новая";
    case "IN_PROGRESS":
      return "В работе";
    case "WAITING_CLIENT":
      return "Ждём клиента";
    case "RESOLVED":
      return "Решена";
    case "CLOSED":
      return "Закрыта";
    default:
      return status;
  }
}

function getAdminRewardStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "В ожидании";
    case "AVAILABLE":
      return "Доступно";
    case "CANCELED":
      return "Отменено";
    default:
      return status;
  }
}

async function getAdminRequestHeadersOrRedirect(): Promise<Headers> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getAdminCookieName())?.value;

  if (!readAdminSession(token)) {
    redirect("/admin/login");
  }

  const requestHeaders = new Headers({
    Accept: "application/json",
    cookie: cookieStore.toString()
  });

  if (token) {
    requestHeaders.set("x-admin-session", token);
  }

  return requestHeaders;
}

async function parseAdminError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

async function fetchAdminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(Object.fromEntries((await getAdminRequestHeadersOrRedirect()).entries()) ?? {}),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    redirect("/admin/login?error=Сессия%20истекла.%20Войдите%20снова.");
  }

  if (!response.ok) {
    throw new Error(await parseAdminError(response, `Failed to load admin data: ${response.status}`));
  }

  return (await response.json()) as T;
}

async function submitAdminMutation(input: {
  body: Record<string, boolean | string | undefined>;
  fallbackError: string;
  path: string;
  redirectTo?: string;
  successMessage: string;
}) {
  const response = await fetch(`${getApiBaseUrl()}${input.path}`, {
    method: "POST",
    headers: {
      ...(Object.fromEntries((await getAdminRequestHeadersOrRedirect()).entries()) ?? {}),
      "content-type": "application/json"
    },
    body: JSON.stringify(input.body),
    cache: "no-store"
  });

  if (response.status === 401) {
    redirect("/admin/login?error=Сессия%20истекла.%20Войдите%20снова.");
  }

  if (!response.ok) {
    const errorMessage = await parseAdminError(response, input.fallbackError);
    redirect(appendMessageToPath(input.redirectTo ?? "/admin", "error", errorMessage));
  }

  revalidatePath("/admin");
  revalidatePath("/cabinet");
  revalidatePath("/cabinet/profile");
  revalidatePath("/cabinet/support");
  redirect(appendMessageToPath(input.redirectTo ?? "/admin", "success", input.successMessage));
}

async function saveSettingsAction(formData: FormData) {
  "use server";

  const settings = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : ""])
  );
  const response = await fetch(`${getApiBaseUrl()}/api/admin/settings`, {
    method: "PUT",
    headers: {
      ...(Object.fromEntries((await getAdminRequestHeadersOrRedirect()).entries()) ?? {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({ settings }),
    cache: "no-store"
  });

  if (response.status === 401) {
    redirect("/admin/login?error=Сессия%20истекла.%20Войдите%20снова.");
  }

  if (!response.ok) {
    const errorMessage = await parseAdminError(response, "Не удалось сохранить настройки.");
    redirect(`/admin?error=${encodeMessage(errorMessage)}`);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/login");
  revalidatePath("/cabinet");
  revalidatePath("/cabinet/payments");
  revalidatePath("/cabinet/routers");
  redirect("/admin?success=Настройки%20сохранены.");
}

async function createRouterAction(formData: FormData) {
  "use server";

  await submitAdminMutation({
    path: "/api/admin/routers",
    fallbackError: "Не удалось привязать роутер.",
    successMessage: "Роутер успешно привязан.",
    body: {
      userId: String(formData.get("userId") ?? "").trim(),
      displayName: String(formData.get("displayName") ?? "").trim(),
      model: String(formData.get("model") ?? "").trim() || undefined,
      serialNumber: String(formData.get("serialNumber") ?? "").trim() || undefined,
      configurationType: String(formData.get("configurationType") ?? "BASIC"),
      accessEnabled: formData.get("accessEnabled") === "on",
      supportType: String(formData.get("supportType") ?? "NONE"),
      startTrial: formData.get("startTrial") === "on",
      adminNote: String(formData.get("adminNote") ?? "").trim() || undefined
    }
  });
}

async function updateTicketAction(formData: FormData) {
  "use server";

  const ticketId = String(formData.get("ticketId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/tickets/${ticketId}`,
    fallbackError: "Не удалось обновить обращение.",
    successMessage: "Обращение обновлено.",
    redirectTo: `/admin#ticket-${ticketId}`,
    body: {
      status: String(formData.get("status") ?? "OPEN"),
      assigneeId: String(formData.get("assigneeId") ?? "").trim() || undefined,
      adminComment: String(formData.get("adminComment") ?? "").trim() || undefined
    }
  });
}

async function deleteTicketAction(formData: FormData) {
  "use server";

  const ticketId = String(formData.get("ticketId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/tickets/${ticketId}/delete`,
    fallbackError: "Не удалось удалить обращение.",
    successMessage: "Обращение удалено.",
    redirectTo: "/admin#tickets",
    body: {}
  });
}

function getTicketAnchorId(ticketId: string): string {
  return `ticket-${ticketId}`;
}

function getAdminTicketBadgeCount(overview: AdminOverview): number {
  return overview.tickets.filter((ticket) => ticket.status === "OPEN").length;
}

function getLatestNewTicketHref(overview: AdminOverview): string {
  const latestNewTicket = overview.tickets.find((ticket) => ticket.status === "OPEN");
  return latestNewTicket ? `#${getTicketAnchorId(latestNewTicket.id)}` : "#tickets";
}

function getAdminTicketCommentMeta(ticket: AdminOverview["tickets"][number]): string | null {
  if (!ticket.adminComment) {
    return null;
  }

  return ticket.adminCommentUpdatedAt
    ? `Комментарий админа от ${formatDateTime(ticket.adminCommentUpdatedAt)}`
    : "Комментарий админа";
}

function getAdminTicketDeleteLabel(ticket: AdminOverview["tickets"][number]): string {
  return `Удалить обращение ${ticket.customerName} · ${ticket.category}`;
}

function renderAdminNavLabel(item: { badge?: string | null; label: string }) {
  return (
    <span className="adminSideNavLabel">
      <span>{item.label}</span>
      {item.badge ? <span className="adminSideNavBadge">{item.badge}</span> : null}
    </span>
  );
}

function getAdminTicketCommentPreview(ticket: AdminOverview["tickets"][number]) {
  if (!ticket.adminComment) {
    return null;
  }

  return {
    text: ticket.adminComment,
    title: getAdminTicketCommentMeta(ticket) ?? "Комментарий админа"
  };
}

function getAdminTicketStatusHint(status: string): string {
  switch (status) {
    case "WAITING_CLIENT":
      return "Клиенту отправлен ответ и ожидается обратная связь.";
    case "IN_PROGRESS":
      return "Обращение уже взято в работу.";
    case "RESOLVED":
      return "Проблема решена, клиент может это увидеть.";
    case "CLOSED":
      return "Обращение закрыто и больше не требует действий.";
    default:
      return "Новое обращение ожидает вашего первого ответа.";
  }
}

async function updateOrderAction(formData: FormData) {
  "use server";

  const orderId = String(formData.get("orderId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/orders/${orderId}`,
    fallbackError: "Не удалось обновить заказ.",
    successMessage: "Заказ обновлен.",
    body: {
      status: String(formData.get("status") ?? "CREATED"),
      trackingNumber: String(formData.get("trackingNumber") ?? "").trim() || undefined
    }
  });
}

async function updateRouterAction(formData: FormData) {
  "use server";

  const routerId = String(formData.get("routerId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/routers/${routerId}`,
    fallbackError: "Не удалось обновить роутер.",
    successMessage: "Роутер обновлен.",
    body: {
      ownerUserId: String(formData.get("ownerUserId") ?? "").trim(),
      configurationType: String(formData.get("configurationType") ?? "BASIC"),
      status: String(formData.get("status") ?? "ACTIVE"),
      adminNote: String(formData.get("adminNote") ?? "").trim() || undefined
    }
  });
}

async function updateSubscriptionAction(formData: FormData) {
  "use server";

  const subscriptionId = String(formData.get("subscriptionId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/subscriptions/${subscriptionId}`,
    fallbackError: "Не удалось обновить подписку.",
    successMessage: "Подписка обновлена.",
    body: {
      status: String(formData.get("status") ?? "DRAFT"),
      startAt: String(formData.get("startAt") ?? "").trim() || undefined,
      endAt: String(formData.get("endAt") ?? "").trim() || undefined,
      pendingActivation: formData.get("pendingActivation") === "on"
    }
  });
}

async function updateRewardAction(formData: FormData) {
  "use server";

  const rewardId = String(formData.get("rewardId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/rewards/${rewardId}`,
    fallbackError: "Не удалось обновить начисление.",
    successMessage: "Начисление обновлено.",
    body: {
      status: String(formData.get("status") ?? "PENDING")
    }
  });
}

async function updateUserAction(formData: FormData) {
  "use server";

  const userId = String(formData.get("userId") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "/admin#clients").trim() || "/admin#clients";
  await submitAdminMutation({
    path: `/api/admin/users/${userId}`,
    fallbackError: "Не удалось обновить клиента.",
    successMessage: "Данные клиента обновлены.",
    redirectTo: returnTo,
    body: {
      name: String(formData.get("name") ?? "").trim() || undefined,
      email: String(formData.get("email") ?? "").trim(),
      telegramUsername: String(formData.get("telegramUsername") ?? "").trim(),
      status: String(formData.get("status") ?? "ACTIVE")
    }
  });
}

async function logoutAction() {
  "use server";

  const cookieStore = await cookies();
  cookieStore.set({
    name: getAdminCookieName(),
    ...(await getExpiredSessionCookieOptions())
  });
  redirect("/admin/login?signedOut=1");
}

export default async function AdminPage(props: { searchParams: PageSearchParams }) {
  const searchParams = await props.searchParams;
  const clientQuery = getSingleParam(searchParams.q)?.trim() ?? "";
  const [settingsPayload, overview] = await Promise.all([
    fetchAdminApi<{ settings: AdminSettingRecord[] }>("/api/admin/settings"),
    fetchAdminApi<AdminOverview>(`/api/admin/overview${clientQuery ? `?q=${encodeURIComponent(clientQuery)}` : ""}`)
  ]);

  const settingsByGroup = settingsPayload.settings.reduce<Record<string, AdminSettingRecord[]>>((groups, setting) => {
    groups[setting.group] ??= [];
    groups[setting.group].push(setting);
    return groups;
  }, {});

  const groupNames = Object.keys(settingsByGroup);
  const communicationSettings = settingsByGroup["Коммуникации"] ?? [];
  const appUrlSetting = communicationSettings.find((setting) => setting.key === "app_url") ?? null;
  const appLoginUrl = appUrlSetting ? `${appUrlSetting.value.replace(/\/+$/, "")}/login` : null;
  const successMessage = getSingleParam(searchParams.success);
  const errorMessage = getSingleParam(searchParams.error);
  const clientReturnTo = overview.clientQuery ? `/admin?q=${encodeURIComponent(overview.clientQuery)}#clients` : "/admin#clients";
  const newTicketCount = getAdminTicketBadgeCount(overview);
  const latestNewTicketHref = getLatestNewTicketHref(overview);
  const adminNavItems = [
    { href: "#overview", label: "Сводка", icon: <DashboardIcon /> },
    { href: "#assign", label: "Привязать роутер", icon: <PlugIcon /> },
    { href: "#clients", label: "Клиенты", icon: <UsersIcon /> },
    { href: "#routers", label: "Роутеры", icon: <RouterRackIcon /> },
    { href: "#subscriptions", label: "Подписки", icon: <CalendarIcon /> },
    { href: "#orders", label: "Заказы", icon: <CartIcon /> },
    { href: latestNewTicketHref, label: "Обращения", icon: <MessageIcon />, badge: newTicketCount ? `+${newTicketCount}` : null },
    { href: "#rewards", label: "Рефералки", icon: <GiftIcon /> },
    { href: "#audit", label: "Аудит", icon: <AuditIcon /> }
  ];

  return (
    <main className="shell dashboardShell adminDashboardShell">
      <aside className="panel sideNav" aria-label="Навигация по админке">
        <span className="pill">Навигация</span>
        <ul>
          {adminNavItems.map((item) => (
            <li key={item.href}>
              <a className="adminSideNavLink" href={item.href}>
                <AdminNavIcon>{item.icon}</AdminNavIcon>
                {renderAdminNavLabel(item)}
              </a>
            </li>
          ))}
          {groupNames.map((groupName) => (
            <li key={groupName}>
              <a className="adminSideNavLink" href={`#${groupName}`}>
                <AdminNavIcon>{getGroupNavIcon(groupName)}</AdminNavIcon>
                {renderAdminNavLabel({ label: groupName })}
              </a>
            </li>
          ))}
        </ul>
        <div className="contentStack adminSidebarActions">
          <Link className="secondaryButton" href="/">
            На главную
          </Link>
          <form action={logoutAction}>
            <button className="secondaryButton fullWidthButton" type="submit">
              Выйти
            </button>
          </form>
        </div>
      </aside>

      <section className="contentStack adminContentStack">
        <article id="overview" className="panel hero adminHero">
          <div className="adminHeroHeader">
            <div className="adminHeroCopy">
              <span className="pill">Админ-панель</span>
              <h1>Управление сервисом</h1>
              <p>Клиенты, роутеры, тикеты, оплаты и настройки собраны в одной ровной панели с понятной иерархией.</p>
            </div>
            <div className="ctaRow adminHeroActions">
              <Link className="secondaryButton" href="#assign">
                Привязать роутер
              </Link>
              <Link className="secondaryButton" href={latestNewTicketHref}>
                Открыть тикеты
              </Link>
            </div>
          </div>
          <div className="miniGrid adminOverviewGrid">
            <article className="metricCard">
              <div className="muted">Клиентов</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.stats.users}
              </div>
            </article>
            <article className="metricCard">
              <div className="muted">Роутеров</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.stats.routers}
              </div>
            </article>
            <article className="metricCard">
              <div className="muted">Активных подписок</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.stats.activeSubscriptions}
              </div>
            </article>
            <article className="metricCard">
              <div className="muted">Открытых тикетов</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.stats.openTickets}
              </div>
            </article>
          </div>
        </article>

        {successMessage ? <div className="banner successBanner">{successMessage}</div> : null}
        {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

        <section id="assign" className="panel sectionPanel adminSectionPanel">
          <span className="pill">Ручная привязка</span>
          <h2 className="adminSectionTitle">Создать роутер вручную</h2>
          <form action={createRouterAction} className="contentStack">
            <div className="settingsGrid">
              <label className="fieldStack">
                <span className="fieldLabel">Клиент</span>
                <select className="textInput" name="userId" required>
                  <option value="">Выберите клиента</option>
                  {overview.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {getAdminUserName(user)} · {getAdminUserEmail(user)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Название роутера</span>
                <input className="textInput" name="displayName" placeholder="Роутер дома" required type="text" />
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Модель</span>
                <input className="textInput" name="model" placeholder="Netis NX31" type="text" />
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Серийный номер</span>
                <input className="textInput" name="serialNumber" placeholder="SN-001" type="text" />
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Конфигурация</span>
                <select className="textInput" defaultValue="BASIC" name="configurationType">
                  <option value="BASIC">BASIC</option>
                  <option value="EXTENDED">EXTENDED</option>
                </select>
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Сопровождение</span>
                <select className="textInput" defaultValue="NONE" name="supportType">
                  <option value="NONE">Без сопровождения</option>
                  <option value="BASIC">Базовое</option>
                  <option value="EXTENDED">Расширенное</option>
                </select>
              </label>
            </div>

            <label className="checkboxRow">
              <input name="accessEnabled" type="checkbox" />
              <span>Сразу включить расширенный доступ</span>
            </label>

            <label className="checkboxRow">
              <input name="startTrial" type="checkbox" />
              <span>Активировать бесплатный тест при создании</span>
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Заметка администратора</span>
              <textarea className="textAreaInput" name="adminNote" placeholder="Комментарий по привязке, доставке или конфигурации." />
            </label>

            <div className="ctaRow">
              <button className="primaryButton" type="submit">
                Привязать роутер
              </button>
            </div>
          </form>
        </section>

        <form action={saveSettingsAction} className="contentStack">
          {groupNames.map((groupName) => (
            <section key={groupName} id={groupName} className="panel settingsSection adminSettingsSection">
              <div className="sectionHeader">
                <div>
                  <h2 className="adminSectionTitle">{groupName}</h2>
                  {groupName === "Коммуникации" ? (
                    <>
                      <p className="sectionLead" style={{ marginTop: "10px" }}>
                        Эти значения уже можно показывать на публичной части сайта.
                      </p>
                      <div className="panel adminInfoCard">
                        <div className="settingsGrid">
                          <div className="fieldStack">
                            <span className="fieldLabel">Текущий домен сайта</span>
                            <strong>{appUrlSetting?.value ?? "Не задан"}</strong>
                          </div>
                          <div className="fieldStack">
                            <span className="fieldLabel">Ссылка входа</span>
                            <strong>{appLoginUrl ?? "Не задана"}</strong>
                          </div>
                        </div>
                        <p className="helperText" style={{ marginTop: "12px" }}>
                          Меняйте `NEXT_PUBLIC_APP_URL` здесь, чтобы управлять публичным доменом для ссылок и видеть текущий адрес сайта прямо в админке.
                        </p>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="settingsGrid">
                {settingsByGroup[groupName].map((setting) => (
                  <label key={setting.key} className="fieldStack">
                    <span className="fieldLabel">{setting.label}</span>
                    {setting.input === "boolean" ? (
                      <>
                        <input name={setting.key} type="hidden" value="false" />
                        <label className="checkboxRow">
                          <input defaultChecked={setting.value === "true"} name={setting.key} type="checkbox" value="true" />
                          <span>{setting.value === "true" ? "Включено" : "Выключено"}</span>
                        </label>
                      </>
                    ) : (
                      <input
                        className="textInput"
                        defaultValue={setting.value}
                        inputMode={getFieldInputMode(setting.input)}
                        name={setting.key}
                        type={
                          setting.input === "number"
                            ? "number"
                            : setting.input === "url"
                              ? "url"
                              : setting.input === "password"
                                ? "password"
                                : "text"
                        }
                      />
                    )}
                    <span className="helperText">
                      {setting.description}
                      {setting.public ? " Это значение используется на публичных страницах." : ""}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}

          <div className="stickyActions">
            <button className="primaryButton" type="submit">
              Сохранить настройки
            </button>
          </div>
        </form>

        <section id="clients" className="panel sectionPanel adminSectionPanel">
          <span className="pill">Клиенты</span>
          <div className="sectionHeader">
            <div>
              <h2 className="adminSectionTitle">База клиентов и поиск</h2>
              <p className="helperText">
                Ищите по имени, email, Telegram или ID клиента и редактируйте контакты прямо отсюда.
              </p>
            </div>
            <form action="/admin" className="adminClientSearchForm">
              <input className="textInput" defaultValue={overview.clientQuery} name="q" placeholder="Поиск по базе клиентов" type="search" />
              <div className="ctaRow">
                <button className="primaryButton" type="submit">
                  Найти
                </button>
                {overview.clientQuery ? (
                  <Link className="secondaryButton" href="/admin#clients">
                    Сбросить
                  </Link>
                ) : null}
              </div>
            </form>
          </div>
          <p className="helperText adminClientSearchMeta">
            {overview.clientQuery
              ? `Найдено клиентов: ${overview.clientCount}. Показаны первые ${overview.clients.length}.`
              : `Показаны последние ${overview.clients.length} клиентов из ${overview.clientCount}.`}
          </p>
          <div className="contentStack">
            {overview.clients.length ? (
              overview.clients.map((user) => (
              <form key={user.id} action={updateUserAction} className="panel adminRecordCard adminClientRecord">
                <input name="userId" type="hidden" value={user.id} />
                <input name="returnTo" type="hidden" value={clientReturnTo} />
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle">
                      {getAdminUserName(user)} · {getAdminUserEmail(user)}
                    </h3>
                    <p className="helperText">
                      ID: {user.id} · Код: {user.referralCode} · Регистрация: {formatDate(user.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="settingsGrid">
                  <label className="fieldStack">
                    <span className="fieldLabel">Имя</span>
                    <input className="textInput" defaultValue={user.name ?? ""} name="name" placeholder="Имя клиента" type="text" />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Email</span>
                    <input className="textInput" defaultValue={user.email ?? ""} name="email" placeholder="client@example.com" type="email" />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Telegram username</span>
                    <input
                      className="textInput"
                      defaultValue={user.telegramUsername ?? ""}
                      name="telegramUsername"
                      placeholder={user.hasTelegramIdentity ? "username" : "Только для уже привязанного Telegram"}
                      type="text"
                    />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Статус</span>
                    <select className="textInput" defaultValue={user.status} name="status">
                      <option value="ACTIVE">Активен</option>
                      <option value="BLOCKED">Заблокирован</option>
                      <option value="PENDING">Ожидает</option>
                    </select>
                  </label>
                </div>
                <div className="settingsGrid adminClientStatsGrid">
                  <div className="fieldStack">
                    <span className="fieldLabel">Telegram</span>
                    <strong>{getAdminUserTelegramLabel(user)}</strong>
                  </div>
                  <div className="fieldStack">
                    <span className="fieldLabel">Роутеров</span>
                    <strong>{user.routerCount}</strong>
                  </div>
                  <div className="fieldStack">
                    <span className="fieldLabel">Баланс</span>
                    <strong>{user.balanceLabel}</strong>
                  </div>
                  <div className="fieldStack">
                    <span className="fieldLabel">Последняя активность</span>
                    <strong>{formatDateTime(user.lastActivityAt)}</strong>
                  </div>
                </div>
                <p className="helperText">
                  Telegram можно менять только у уже привязанного аккаунта. Пустой email не удаляет текущую email-привязку.
                </p>
                <div className="ctaRow">
                  <button className="primaryButton" type="submit">
                    Сохранить клиента
                  </button>
                </div>
              </form>
            ))
            ) : (
              <div className="panel adminInfoCard">
                <strong>Совпадений не найдено.</strong>
                <p className="helperText">Попробуй поиск по имени, email, Telegram username или ID клиента.</p>
              </div>
            )}
          </div>
        </section>

        <section id="routers" className="panel sectionPanel adminSectionPanel">
          <span className="pill">Роутеры</span>
          <h2 className="adminSectionTitle">Управление назначениями</h2>
          <div className="contentStack">
            {overview.routers.map((router) => (
              <form key={router.id} action={updateRouterAction} className="panel adminRecordCard">
                <input name="routerId" type="hidden" value={router.id} />
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle">{router.displayName}</h3>
                    <p className="helperText">
                      {router.ownerName} · {router.model ?? "Без модели"} · {router.serialNumber ?? "Без серийника"}
                    </p>
                  </div>
                </div>
                <div className="settingsGrid">
                  <label className="fieldStack">
                    <span className="fieldLabel">Владелец</span>
                    <select className="textInput" defaultValue={router.ownerId} name="ownerUserId">
                      {overview.users.map((user) => (
                      <option key={user.id} value={user.id}>
                          {getAdminUserName(user)} · {getAdminUserEmail(user)}
                      </option>
                    ))}
                    </select>
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Статус</span>
                    <select className="textInput" defaultValue={router.status} name="status">
                      <option value="DRAFT">Черновик</option>
                      <option value="ACTIVE">Активен</option>
                      <option value="SUSPENDED">Приостановлен</option>
                      <option value="DISABLED">Отключён</option>
                    </select>
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Конфигурация</span>
                    <select className="textInput" defaultValue={router.configurationType} name="configurationType">
                      <option value="BASIC">Базовая</option>
                      <option value="EXTENDED">Расширенная</option>
                    </select>
                  </label>
                  <div className="fieldStack">
                    <span className="fieldLabel">Текущий шаблон</span>
                    <strong>{router.savedTemplate}</strong>
                  </div>
                </div>
                <label className="fieldStack" style={{ marginTop: "16px" }}>
                  <span className="fieldLabel">Заметка администратора</span>
                  <textarea className="textAreaInput" defaultValue={router.adminNote ?? ""} name="adminNote" />
                </label>
                <div className="ctaRow" style={{ marginTop: "16px" }}>
                  <button className="primaryButton" type="submit">
                    Сохранить роутер
                  </button>
                </div>
              </form>
            ))}
          </div>
        </section>

        <section id="subscriptions" className="panel sectionPanel adminSectionPanel">
          <span className="pill">Подписки</span>
          <h2 className="adminSectionTitle">Продления и активации</h2>
          <div className="contentStack">
            {overview.subscriptions.map((subscription) => (
              <form key={subscription.id} action={updateSubscriptionAction} className="panel adminRecordCard">
                <input name="subscriptionId" type="hidden" value={subscription.id} />
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle">{subscription.routerName}</h3>
                    <p className="helperText">
                      {subscription.bundleLabel} · {subscription.priceLabel}
                    </p>
                  </div>
                </div>
                <div className="settingsGrid">
                  <label className="fieldStack">
                    <span className="fieldLabel">Статус</span>
                    <select className="textInput" defaultValue={subscription.status} name="status">
                      <option value="DRAFT">Черновик</option>
                      <option value="ACTIVE">Активна</option>
                      <option value="EXPIRED">Истекла</option>
                      <option value="PENDING_ACTIVATION">Ожидает активации</option>
                      <option value="PAUSED">На паузе</option>
                      <option value="CANCELLED">Отменена</option>
                    </select>
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Начало</span>
                    <input
                      className="textInput"
                      defaultValue={formatDateTimeInputValue(subscription.startAt)}
                      name="startAt"
                      type="datetime-local"
                    />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Окончание</span>
                    <input
                      className="textInput"
                      defaultValue={formatDateTimeInputValue(subscription.endAt)}
                      name="endAt"
                      type="datetime-local"
                    />
                  </label>
                  <div className="fieldStack">
                    <span className="fieldLabel">Пакет</span>
                    <strong>
                      {subscription.accessEnabled ? "Доступ включен" : "Доступ выключен"} ·{" "}
                      {subscription.supportType === "NONE"
                        ? "Без сопровождения"
                        : subscription.supportType === "BASIC"
                          ? "Базовое"
                          : subscription.supportType === "EXTENDED"
                            ? "Расширенное"
                            : subscription.supportType}
                    </strong>
                  </div>
                </div>
                <label className="checkboxRow" style={{ marginTop: "16px" }}>
                  <input defaultChecked={subscription.pendingActivation} name="pendingActivation" type="checkbox" />
                  <span>Оставить в очереди на активацию</span>
                </label>
                <div className="ctaRow" style={{ marginTop: "16px" }}>
                  <button className="primaryButton" type="submit">
                    Сохранить подписку
                  </button>
                </div>
              </form>
            ))}
          </div>
        </section>

        <section id="orders" className="panel sectionPanel adminSectionPanel">
          <span className="pill">Заказы</span>
          <h2 className="adminSectionTitle">Магазин и доставка</h2>
          <div className="contentStack">
            {overview.orders.map((order) => (
              <form key={order.id} action={updateOrderAction} className="panel adminRecordCard">
                <input name="orderId" type="hidden" value={order.id} />
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle">{order.customerName}</h3>
                    <p className="helperText">
                      {order.totalPriceLabel} · создан {formatDateTime(order.createdAt)} · получен {formatDateTime(order.receivedAt)}
                    </p>
                  </div>
                </div>
                <div className="settingsGrid">
                  <label className="fieldStack">
                    <span className="fieldLabel">Статус</span>
                    <select className="textInput" defaultValue={order.status} name="status">
                      <option value="CREATED">Создан</option>
                      <option value="WAITING_PAYMENT">Ожидает оплаты</option>
                      <option value="PAID">Оплачен</option>
                      <option value="CONFIGURING">Настраивается</option>
                      <option value="READY_TO_SHIP">Готов к отправке</option>
                      <option value="SHIPPED">Отправлен</option>
                      <option value="RECEIVED">Получен</option>
                      <option value="CANCELED">Отменён</option>
                      <option value="REFUND">Возврат</option>
                    </select>
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Трек-номер</span>
                    <input
                      className="textInput"
                      defaultValue={order.trackingNumber ?? ""}
                      name="trackingNumber"
                      placeholder="TRACK-001"
                      type="text"
                    />
                  </label>
                  <div className="fieldStack">
                    <span className="fieldLabel">ID клиента</span>
                    <strong>{order.userId}</strong>
                  </div>
                </div>
                <div className="ctaRow" style={{ marginTop: "16px" }}>
                  <button className="primaryButton" type="submit">
                    Сохранить заказ
                  </button>
                </div>
              </form>
            ))}
          </div>
        </section>

        <section id="tickets" className="panel sectionPanel adminSectionPanel">
          <span className="pill">Поддержка</span>
          <h2 className="adminSectionTitle">Обращения клиентов</h2>
          <div className="contentStack">
            {overview.tickets.map((ticket) => {
              const commentPreview = getAdminTicketCommentPreview(ticket);

              return (
                <form key={ticket.id} id={getTicketAnchorId(ticket.id)} action={updateTicketAction} className="panel adminRecordCard adminTicketCard">
                <input name="ticketId" type="hidden" value={ticket.id} />
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle adminTicketTitleRow">
                      {ticket.customerName} · {ticket.category}
                      {ticket.status === "OPEN" ? <span className="adminTicketNewBadge">Новое</span> : null}
                    </h3>
                    <p className="helperText">
                      Создано {formatDateTime(ticket.createdAt)} · обновлено {formatDateTime(ticket.updatedAt)} · роутер {ticket.routerName}
                    </p>
                  </div>
                </div>
                <p className="helperText" style={{ marginBottom: "16px" }}>
                  {ticket.description}
                </p>
                {commentPreview ? (
                  <div className="adminTicketCommentPreview">
                    <strong>{commentPreview.title}</strong>
                    <p>{commentPreview.text}</p>
                  </div>
                ) : null}
                <div className="settingsGrid">
                  <label className="fieldStack">
                    <span className="fieldLabel">Статус</span>
                    <select className="textInput" defaultValue={ticket.status} name="status">
                      <option value="OPEN">Новая</option>
                      <option value="IN_PROGRESS">В работе</option>
                      <option value="WAITING_CLIENT">Ждём клиента</option>
                      <option value="RESOLVED">Решена</option>
                      <option value="CLOSED">Закрыта</option>
                    </select>
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Исполнитель</span>
                    <input
                      className="textInput"
                      defaultValue={ticket.assigneeId ?? ""}
                      name="assigneeId"
                      placeholder="admin_1"
                      type="text"
                    />
                  </label>
                  <div className="fieldStack">
                    <span className="fieldLabel">ID клиента</span>
                    <strong>{ticket.userId}</strong>
                  </div>
                </div>
                <label className="fieldStack">
                  <span className="fieldLabel">Комментарий для клиента</span>
                  <textarea
                    className="textInput adminTicketCommentInput"
                    defaultValue={ticket.adminComment ?? ""}
                    name="adminComment"
                    placeholder="Например: проверили линию, перезапустите роутер и сообщите результат."
                    rows={4}
                  />
                  <span className="helperText">{getAdminTicketStatusHint(ticket.status)}</span>
                </label>
                <div className="ctaRow" style={{ marginTop: "16px" }}>
                  <button className="primaryButton" type="submit">
                    Сохранить обращение
                  </button>
                  <button
                    aria-label={getAdminTicketDeleteLabel(ticket)}
                    className="secondaryButton adminDangerButton"
                    formAction={deleteTicketAction}
                    type="submit"
                  >
                    Удалить
                  </button>
                </div>
                </form>
              );
            })}
          </div>
        </section>

        <section id="rewards" className="panel sectionPanel adminSectionPanel">
          <span className="pill">Рефералки</span>
          <h2 className="adminSectionTitle">Начисления по приглашениям</h2>
          <div className="contentStack">
            {overview.rewards.map((reward) => (
              <form key={reward.id} action={updateRewardAction} className="panel adminRecordCard">
                <input name="rewardId" type="hidden" value={reward.id} />
                <div className="settingsGrid">
                  <div className="fieldStack">
                    <span className="fieldLabel">Источник</span>
                    <strong>{reward.sourceType}</strong>
                  </div>
                  <div className="fieldStack">
                    <span className="fieldLabel">Сумма</span>
                    <strong>{reward.amountLabel}</strong>
                  </div>
                  <div className="fieldStack">
                    <span className="fieldLabel">Создано</span>
                    <strong>{formatDateTime(reward.createdAt)}</strong>
                  </div>
                  <label className="fieldStack">
                    <span className="fieldLabel">Статус</span>
                    <select className="textInput" defaultValue={reward.status} name="status">
                      <option value="PENDING">В ожидании</option>
                      <option value="AVAILABLE">Доступно</option>
                      <option value="CANCELED">Отменено</option>
                    </select>
                  </label>
                </div>
                <div className="ctaRow" style={{ marginTop: "16px" }}>
                  <button className="primaryButton" type="submit">
                    Сохранить начисление
                  </button>
                </div>
              </form>
            ))}
          </div>
        </section>

        <section id="audit" className="panel sectionPanel adminSectionPanel">
          <span className="pill">Аудит</span>
          <h2 className="adminSectionTitle">Последние действия</h2>
          <ul className="list adminList">
            {overview.logs.length ? (
              overview.logs.map((log) => (
                <li key={log.id}>
                  {log.action} · {log.entityType} · {log.entityId.slice(0, 8)} · {formatDateTime(log.createdAt)}
                </li>
              ))
            ) : (
              <li>Пока нет записей аудита.</li>
            )}
          </ul>
        </section>
      </section>
    </main>
  );
}
