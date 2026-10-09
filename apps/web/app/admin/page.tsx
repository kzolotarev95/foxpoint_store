import Link from "next/link";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getApiBaseUrl } from "../../lib/api";
import { getAdminCookieName, readAdminSession } from "../../lib/admin-auth";
import type { AdminOverview } from "../../lib/portal-types";
import { getExpiredSessionCookieOptions } from "../../lib/session-cookie";
import { TicketConversation } from "../../components/ticket-conversation";
import { AdminServerMetrics } from "../../components/admin-server-metrics";
import { AdminSingleDisclosure } from "../../components/admin-single-disclosure";
import { AdminFormGuard } from "../../components/admin-form-guard";
import { AdminRegisterNavigation, AdminQueryFilters, AdminPagination, AdminQrToggle, AdminQrTools, AdminStickySearch } from "../../components/admin-register-controls";
import { AdminCopyContact } from "../../components/admin-copy-contact";
import { AdminPlanChange, AdminPaymentForm } from "../../components/admin-plan-change";
import { AdminAssignment, AdminCreateClient } from "../../components/admin-assignment";
import { AdminAuditCard } from "../../components/admin-audit-card";
import { AdminNavigation } from "../../components/admin-navigation";
import { adminStatus, adminMoney } from "../../lib/admin-display";
import { AdminPayments, type AdminPaymentList } from "../../components/admin-payments";

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
type DatabaseTab = "clients" | "routers" | "subscriptions";

function getDatabaseHref(tab: DatabaseTab = "clients", query = "", extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams({ view: "database", tab });
  if (query) params.set("q", query);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return `/admin?${params.toString()}`;
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

function getAdminPlanClass(plan: string | null | undefined): string {
  return `adminPlanBadge adminPlan${(plan || "").replace(/[^a-zA-Zа-яА-Я0-9]+/g, "") || "Unknown"}`;
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

const paymentSettingsBlocks = [
  {
    title: "Общие",
    description: "Публичный адрес API для checkout и callback URL.",
    keys: ["api_public_url"]
  },
  {
    title: "Platega",
    description: "Настройки подключения Platega для оплаты и продлений.",
    keys: ["platega_enabled", "platega_api_base_url", "platega_merchant_id", "platega_secret"]
  },
  {
    title: "ЮMoney",
    description: "Настройки кошелька, типа оплаты и уведомлений ЮMoney.",
    keys: ["yoomoney_enabled", "yoomoney_receiver", "yoomoney_payment_type", "yoomoney_notification_secret"]
  },
  {
    title: "ЮKassa",
    description: "Настройки магазина и секретного ключа ЮKassa.",
    keys: ["yookassa_enabled", "yookassa_shop_id", "yookassa_secret_key"]
  }
] as const;

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
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
    timeZone: "Europe/Moscow",
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
  const normalized = new Date(date.getTime() + 3 * 60 * 60 * 1000);
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

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" fill="none" stroke="currentColor" strokeWidth="1.8" />
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
  revalidatePath("/cabinet/payments");
  revalidatePath("/cabinet/profile");
  revalidatePath("/cabinet/routers");
  revalidatePath("/cabinet/support");
  redirect(appendMessageToPath(input.redirectTo ?? "/admin", "success", input.successMessage));
}

async function createRouterAction(formData: FormData) {
  "use server";

  await submitAdminMutation({
    path: "/api/admin/routers",
    fallbackError: "Не удалось привязать роутер.",
    successMessage: "Роутер успешно привязан.",
    redirectTo: getDatabaseHref("routers"),
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
    redirectTo: `/admin?view=tickets#ticket-${ticketId}`,
    body: {
      status: String(formData.get("status") ?? "OPEN"),
      assigneeId: String(formData.get("assigneeId") ?? "").trim() || undefined
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
    redirectTo: "/admin?view=tickets",
    body: {}
  });
}

async function clearAuditAction() {
  "use server";

  await submitAdminMutation({
    path: "/api/admin/audit/clear",
    fallbackError: "Не удалось очистить аудит.",
    successMessage: "Аудит очищен.",
    redirectTo: "/admin?view=audit",
    body: {}
  });
}

function getTicketAnchorId(ticketId: string): string {
  return `ticket-${ticketId}`;
}

function getTicketLatestMessageAuthorRole(ticket: AdminOverview["tickets"][number]): string | null {
  return ticket.messages[ticket.messages.length - 1]?.authorRole ?? null;
}

function hasAutoOperatorWaitingMessage(ticket: AdminOverview["tickets"][number]): boolean {
  return (
    ticket.status === "IN_PROGRESS" &&
    ticket.messages.length === 2 &&
    ticket.messages[0]?.authorRole === "CLIENT" &&
    ticket.messages[1]?.authorRole === "ADMIN" &&
    ticket.messages[1]?.body === "Ожидайте оператора."
  );
}

function isTicketAwaitingAdminReply(ticket: AdminOverview["tickets"][number]): boolean {
  if (ticket.status === "CLOSED") {
    return false;
  }

  const latestMessageAuthorRole = getTicketLatestMessageAuthorRole(ticket);
  return (
    latestMessageAuthorRole === "CLIENT" ||
    hasAutoOperatorWaitingMessage(ticket) ||
    (!latestMessageAuthorRole && ticket.status === "OPEN")
  );
}

function getAdminTicketBadgeCount(overview: AdminOverview): number {
  return overview.tickets.filter((ticket) => isTicketAwaitingAdminReply(ticket)).length;
}

function getLatestNewTicketHref(overview: AdminOverview): string {
  const latestNewTicket = overview.tickets.find((ticket) => isTicketAwaitingAdminReply(ticket));
  return latestNewTicket ? `#${getTicketAnchorId(latestNewTicket.id)}` : "#tickets";
}

function isOrderAwaitingAdminAction(order: AdminOverview["orders"][number]): boolean {
  return order.status === "PAID";
}

function getAdminOrderBadgeCount(overview: AdminOverview): number {
  return overview.orders.filter((order) => isOrderAwaitingAdminAction(order)).length;
}

function getLatestNewOrderHref(overview: AdminOverview): string {
  const latestNewOrder = overview.orders.find((order) => isOrderAwaitingAdminAction(order));
  return latestNewOrder ? `#order-${latestNewOrder.id}` : "#orders";
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

function getAdminOrderDeleteLabel(order: AdminOverview["orders"][number]): string {
  return `Удалить заказ ${order.customerName} · ${order.totalPriceLabel}`;
}

function getAdminRouterDeleteLabel(router: AdminOverview["routers"][number]): string {
  return `Удалить роутер ${router.displayName} · ${router.ownerName}`;
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

function getAdminTicketMessageAuthorLabel(
  message: AdminOverview["tickets"][number]["messages"][number],
  ticket: AdminOverview["tickets"][number]
): string {
  return message.authorRole === "ADMIN" ? "Поддержка" : ticket.customerName;
}

function getAdminTicketMessageClass(message: AdminOverview["tickets"][number]["messages"][number]): string {
  return message.authorRole === "ADMIN" ? "clientSupportMessage isAdmin" : "clientSupportMessage isClient";
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
    redirectTo: "/admin?view=orders",
    body: {
      status: String(formData.get("status") ?? "CREATED"),
      trackingNumber: String(formData.get("trackingNumber") ?? "").trim() || undefined
    }
  });
}

async function deleteOrderAction(formData: FormData) {
  "use server";

  const orderId = String(formData.get("orderId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/orders/${orderId}/delete`,
    fallbackError: "Не удалось удалить заказ.",
    successMessage: "Заказ удален.",
    redirectTo: "/admin?view=orders",
    body: {}
  });
}

async function updateRouterAction(formData: FormData) {
  "use server";

  const routerId = String(formData.get("routerId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/routers/${routerId}`,
    fallbackError: "Не удалось обновить роутер.",
    successMessage: "Роутер обновлен.",
    redirectTo: `${getDatabaseHref("routers")}#router-${routerId}`,
    body: {
      displayName: String(formData.get("displayName") ?? "").trim(),
      model: String(formData.get("model") ?? "").trim() || undefined,
      serialNumber: String(formData.get("serialNumber") ?? "").trim() || undefined,
      ownerUserId: String(formData.get("ownerUserId") ?? "").trim(),
      configurationType: String(formData.get("configurationType") ?? "BASIC"),
      status: String(formData.get("status") ?? "ACTIVE"),
      adminNote: String(formData.get("adminNote") ?? "").trim() || undefined,
      archived: formData.get("archived") === "on", reason: String(formData.get("reason") ?? "").trim(),
      ...(formData.get("applyPlan") === "on" ? { serviceTariff: String(formData.get("serviceTariff")), planPrice: String(formData.get("planPrice")), planPeriodDays: String(formData.get("planPeriodDays")), planAccessEnabled: formData.get("planAccessEnabled") === "on", planSupportType: String(formData.get("planSupportType")) } : {})
    }
  });
}

async function deleteRouterAction(formData: FormData) {
  "use server";

  const routerId = String(formData.get("routerId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/routers/${routerId}/delete`,
    fallbackError: "Не удалось удалить роутер.",
    successMessage: "Роутер перенесён в архив. Подписки, платежи и QR сохранены.",
    redirectTo: getDatabaseHref("routers"),
    body: {}
  });
}

async function updateSubscriptionAction(formData: FormData) {
  "use server";

  const subscriptionId = String(formData.get("subscriptionId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/subscriptions/${subscriptionId}`,
    fallbackError: "Не удалось обновить подписку.",
    successMessage: "Подписка обновлена.",
    redirectTo: `${getDatabaseHref("subscriptions")}#subscription-${subscriptionId}`,
    body: {
      status: String(formData.get("status") ?? "DRAFT"),
      startAt: String(formData.get("startAt") ?? "").trim() || undefined,
      endAt: String(formData.get("endAt") ?? "").trim() || undefined,
      pendingActivation: formData.get("pendingActivation") === "on"
      ,reason: String(formData.get("reason") ?? "").trim()
    }
  });
}

async function addSubscriptionPaymentAction(formData: FormData) {
  "use server";
  const subscriptionId = String(formData.get("subscriptionId") ?? "").trim();
  await submitAdminMutation({
    path: `/api/admin/subscriptions/${subscriptionId}/payments`,
    fallbackError: "Не удалось записать пополнение.",
    successMessage: "Пополнение записано, дни добавлены к оставшемуся периоду.",
    redirectTo: `${getDatabaseHref("subscriptions")}#subscription-${subscriptionId}`,
    body: {
      amount: String(formData.get("amount") ?? ""),
      days: String(formData.get("days") ?? "30"),
      requestKey: String(formData.get("requestKey") ?? "")
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
    redirectTo: "/admin?view=rewards",
    body: {
      status: String(formData.get("status") ?? "PENDING")
    }
  });
}

async function updateUserAction(formData: FormData) {
  "use server";

  const userId = String(formData.get("userId") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "").trim() || getDatabaseHref();
  await submitAdminMutation({
    path: `/api/admin/users/${userId}`,
    fallbackError: "Не удалось обновить клиента.",
    successMessage: "Данные клиента обновлены.",
    redirectTo: returnTo,
    body: {
      name: String(formData.get("name") ?? "").trim() || undefined,
      publicName: String(formData.get("publicName") ?? "").trim(), reason: String(formData.get("reason") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      city: String(formData.get("city") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      telegramUsername: String(formData.get("telegramUsername") ?? "").trim(),
      status: String(formData.get("status") ?? "ACTIVE")
      ,archived: formData.get("archived") === "on", isTest: formData.get("isTest") === "on"
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

async function setClientCredentialsAction(formData: FormData) {
  "use server";
  const userId = String(formData.get("userId") ?? "");
  await submitAdminMutation({
    path: `/api/admin/users/${userId}/credentials`,
    fallbackError: "Не удалось сохранить доступ клиента.", successMessage: "Доступ в кабинет сохранён.",
    redirectTo: String(formData.get("returnTo") ?? "").trim() || getDatabaseHref(),
    body: { login: String(formData.get("login") ?? ""), password: String(formData.get("password") ?? "") }
  });
}

export default async function AdminPage(props: { searchParams: PageSearchParams }) {
  const searchParams = await props.searchParams;
  const requestedView = getSingleParam(searchParams.view) ?? "overview";
  const adminView = ["database", "assign", "orders", "tickets", "rewards", "audit", "settings", "payments"].includes(requestedView) ? requestedView : "overview";
  const isDatabaseView = adminView === "database";
  const requestedTab = getSingleParam(searchParams.tab);
  const databaseTab: DatabaseTab = requestedTab === "routers" || requestedTab === "subscriptions" ? requestedTab : "clients";
  const clientQuery = getSingleParam(searchParams.q)?.trim() ?? "";
  const clientPage = Number(getSingleParam(searchParams.page) ?? "1") || 1;
  const clientPageSize = Number(getSingleParam(searchParams.pageSize) ?? "25") || 25;
  const clientPlan = getSingleParam(searchParams.plan)?.trim() ?? "";
  const clientStatus = getSingleParam(searchParams.status)?.trim() ?? "";
  const clientCity = getSingleParam(searchParams.city)?.trim() ?? "";
  const clientSort = ["name", "code", "end"].includes(getSingleParam(searchParams.sort) ?? "") ? getSingleParam(searchParams.sort) as "name" | "code" | "end" : "created";
  const clientExpiry = getSingleParam(searchParams.expiry)?.trim() ?? "";
  const metric = getSingleParam(searchParams.metric) ?? "";
  const dashboardMonth = getSingleParam(searchParams.month) ?? "";
  const overviewParams = new URLSearchParams();
  overviewParams.set("tab", databaseTab);
  for(const key of ["recordStatus","ticketStatus","orderStatus","rewardStatus","logAction","logAdmin","from","to"]) { const value=getSingleParam(searchParams[key]); if(value)overviewParams.set(key,value); }
  if (clientQuery) overviewParams.set("q", clientQuery);
  if (clientPage > 1) overviewParams.set("page", String(clientPage));
  if ([25, 50, 100].includes(clientPageSize) && clientPageSize !== 25) overviewParams.set("pageSize", String(clientPageSize));
  if (clientPlan) overviewParams.set("plan", clientPlan);
  if (clientStatus) overviewParams.set("status", clientStatus);
  if (clientCity) overviewParams.set("city", clientCity);
  if (clientSort !== "created") overviewParams.set("sort", clientSort);
  if (clientExpiry) overviewParams.set("expiry", clientExpiry);
  if (metric) overviewParams.set("metric", metric);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(dashboardMonth)) overviewParams.set("month", dashboardMonth);
  const [settingsPayload, overview] = await Promise.all([
    fetchAdminApi<{ settings: AdminSettingRecord[] }>("/api/admin/settings"),
    fetchAdminApi<AdminOverview>(`/api/admin/overview${overviewParams.toString() ? `?${overviewParams.toString()}` : ""}`)
  ]);

  const settingsByGroup = settingsPayload.settings.reduce<Record<string, AdminSettingRecord[]>>((groups, setting) => {
    groups[setting.group] ??= [];
    groups[setting.group].push(setting);
    return groups;
  }, {});

  const groupNames = Object.keys(settingsByGroup);
  const paymentSettings = settingsByGroup["Платежи"] ?? [];
  const paymentSettingsByKey = new Map(paymentSettings.map((setting) => [setting.key, setting]));
  const communicationSettings = settingsByGroup["Коммуникации"] ?? [];
  const appUrlSetting = communicationSettings.find((setting) => setting.key === "app_url") ?? null;
  const appLoginUrl = appUrlSetting ? `${appUrlSetting.value.replace(/\/+$/, "")}/login` : null;
  const successMessage = getSingleParam(searchParams.success);
  const errorMessage = getSingleParam(searchParams.error);
  const clientReturnTo = getDatabaseHref("clients", overview.clientQuery, {
    page: overview.clientPage > 1 ? overview.clientPage : undefined,
    pageSize: overview.clientPageSize !== 25 ? overview.clientPageSize : undefined,
    plan: overview.clientPlan,
    status: overview.clientStatus,
    city: overview.clientCity,
    sort: overview.clientSort,
    expiry: overview.clientExpiry,
    month: overview.dashboard.month
  });
  const newTicketCount = getAdminTicketBadgeCount(overview);
  const latestNewTicketHref = getLatestNewTicketHref(overview);
  const newOrderCount = getAdminOrderBadgeCount(overview);
  const latestNewOrderHref = getLatestNewOrderHref(overview);
  const dashboardCards = [
    {
      description: "Открыть базу клиентов",
      href: getDatabaseHref(),
      label: "Клиентов",
      value: overview.stats.users
    },
    {
      description: "Перейти к роутерам",
      href: getDatabaseHref("routers"),
      label: "Роутеров",
      value: overview.stats.routers
    },
    {
      description: "Открыть подписки",
      href: getDatabaseHref("subscriptions","",{recordStatus:"active_paid"}),
      label: "Активных платных подписок",
      value: overview.dashboard.paidSubscriptions
    },
    {
      description: "Новые, в работе и ожидающие ответа",
      href: "/admin?view=tickets&ticketStatus=open",
      label: "Открытых обращений",
      value: overview.stats.openTickets
    }
  ] as const;
  const adminNavItems = [
    { href: "/admin", label: "Сводка", icon: <DashboardIcon />, active: adminView === "overview" },
    { href: getDatabaseHref(), label: "База данных", icon: <DatabaseIcon />, active: isDatabaseView },
    { href: "/admin/backups", label: "Бэкап", icon: <DatabaseIcon /> },
    { href: "/admin?view=assign", label: "Привязать роутер", icon: <PlugIcon />, active: adminView === "assign" },
    { href: `/admin?view=orders${latestNewOrderHref}`, label: "Заказы", icon: <CartIcon />, active: adminView === "orders", badge: newOrderCount ? `+${newOrderCount}` : null },
    { href: `/admin?view=tickets${latestNewTicketHref}`, label: "Обращения", icon: <MessageIcon />, active: adminView === "tickets", badge: newTicketCount ? `+${newTicketCount}` : null },
    { href: "/admin?view=rewards", label: "Рефералки", icon: <GiftIcon />, active: adminView === "rewards" },
    { href: "/admin?view=audit", label: "Аудит", icon: <AuditIcon />, active: adminView === "audit" },
    { href: "/admin?view=settings", label: "Настройки", icon: <SettingsIcon />, active: adminView === "settings" }
  ];
  const databaseTabs = [
    { key: "clients", label: "Клиенты", icon: <UsersIcon />, count: overview.stats.users },
    { key: "routers", label: "Роутеры", icon: <RouterRackIcon />, count: overview.stats.routers },
    { key: "subscriptions", label: "Подписки", icon: <CalendarIcon />, count: overview.registerMeta.subscriptions.total }
  ] satisfies Array<{ key: DatabaseTab; label: string; icon: ReactNode; count: number }>;
  const routersByOwner = new Map<string, AdminOverview["routers"]>();
  for (const router of overview.routers) {
    const ownerRouters = routersByOwner.get(router.ownerId) ?? [];
    ownerRouters.push(router);
    routersByOwner.set(router.ownerId, ownerRouters);
  }
  const subscriptionsByRouter = new Map(overview.subscriptions.map((subscription) => [subscription.routerId, subscription]));
  const clientListHref = (extra: Record<string, string | number | undefined> = {}) => getDatabaseHref("clients", overview.clientQuery, {
    page: extra.page ?? (overview.clientPage > 1 ? overview.clientPage : undefined),
    pageSize: extra.pageSize ?? (overview.clientPageSize !== 25 ? overview.clientPageSize : undefined),
    plan: extra.plan ?? overview.clientPlan,
    status: extra.status ?? overview.clientStatus,
    city: extra.city ?? overview.clientCity,
    sort: extra.sort ?? (overview.clientSort !== "created" ? overview.clientSort : undefined),
    expiry: extra.expiry ?? overview.clientExpiry,
    month: overview.dashboard.month,
    metric: extra.metric ?? metric
  });
  const pageCount = Math.max(1, Math.ceil(overview.clientCount / overview.clientPageSize));
  const exportParams = new URLSearchParams({ q: overview.clientQuery, plan: overview.clientPlan, status: overview.clientStatus, city: overview.clientCity, sort: overview.clientSort, expiry: overview.clientExpiry, month: overview.dashboard.month, metric });
  const exportHref = `/admin/database/export?${exportParams.toString()}`;
  const paymentList=adminView==="payments"?await fetchAdminApi<AdminPaymentList>(`/api/admin/payments?${overviewParams}`):null;

  return (
    <AdminRegisterNavigation><main className={`shell dashboardShell adminDashboardShell${isDatabaseView ? " adminDatabaseDashboard" : ""}`}>
      <AdminFormGuard />
      <AdminNavigation active={isDatabaseView?"База данных":adminView === "overview"?"Сводка":({assign:"Привязать роутер",orders:"Заказы",tickets:"Обращения",rewards:"Рефералки",audit:"Аудит",settings:"Настройки",payments:"Журнал оплат"} as Record<string,string>)[adminView]} />

      <section className="contentStack adminContentStack">
        {paymentList?<AdminPayments data={paymentList}/>:null}
        {isDatabaseView ? (
          <header className="panel adminDatabaseHeader">
            <div className="sectionHeader">
              <div className="adminHeroCopy">
                <span className="pill">Админ-панель</span>
                <h1>База данных</h1>
                <p>Клиенты, роутеры, подписки и история пополнений.</p>
              </div>
              <div className="ctaRow"><AdminQrToggle /><Link className="secondaryButton" href={exportHref}>Экспорт XLSX</Link><Link className="secondaryButton" href={`${exportHref}&format=csv`}>CSV</Link><Link className="secondaryButton" href="/admin?view=assign">Привязать роутер</Link></div>
            </div>
            <nav className="adminDatabaseTabs" aria-label="Разделы базы данных">
              {databaseTabs.map((item) => (
                <a key={item.key} className="adminDatabaseTab" data-admin-query-link href={getDatabaseHref(item.key, clientQuery, {month:overview.dashboard.month,plan:clientPlan,city:clientCity,sort:clientSort,pageSize:clientPageSize,expiry:clientExpiry,status:clientStatus,recordStatus:getSingleParam(searchParams.recordStatus)??undefined})} aria-current={databaseTab === item.key ? "page" : undefined}>
                  <AdminNavIcon>{item.icon}</AdminNavIcon>
                  <span>{item.label}</span>
                  <span className="adminDatabaseTabCount">{item.count}</span>
                </a>
              ))}
            </nav>
            <section className="adminDatabaseDashboard" aria-label="Финансовая сводка базы">
              <div className="adminDatabaseDashboardHeader">
                <div>
                  <span className="pill">Вся база · ₽ · {overview.dashboard.month}</span>
                  <p className="helperText">Обновлено {formatDateTime(overview.dashboard.asOf)} МСК. Оплачено — подтверждённые поступления по дате получения за календарный месяц Москвы; импорт и бесплатные тесты исключены, возвраты отдельно. Прогноз — ожидаемые 30-дневные продления по оплаченной дате и сохранённой цене, без авансово оплаченных сроков; это не полученные деньги.</p>
                </div>
                <form className="adminMonthForm" data-admin-query action="/admin">
                  <input type="hidden" name="view" value="database" />
                  <input type="hidden" name="tab" value={databaseTab} />
                  {Array.from(overviewParams).filter(([key])=>!["tab","month","page"].includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value}/>)}
                  <input className="textInput" type="month" name="month" defaultValue={overview.dashboard.month} aria-label="Месяц сводки" />
                  <button className="secondaryButton" type="submit">Показать</button>
                </form>
              </div>
              <div className="adminFinanceGrid">
                <Link className="adminFinanceCard" href={getDatabaseHref("clients", "", { month: overview.dashboard.month, metric: "clients" })}><span>Рабочих клиентов</span><strong>{overview.dashboard.totalClients}</strong><small>рабочая база</small></Link>
                <Link className="adminFinanceCard" href={getDatabaseHref("clients", "", { month: overview.dashboard.month, metric: "active" })}><span>Активные клиенты</span><strong>{overview.dashboard.activeClients}</strong><small>действующая платная услуга</small></Link>
                <Link className="adminFinanceCard" href={clientListHref({ metric: "payments" })}><span>Оплачено за месяц</span><strong>{overview.dashboard.confirmedPaymentsLabel}</strong><small>реальные поступления · раскрыть</small></Link>
                <Link className="adminFinanceCard" href={clientListHref({ metric: "forecast" })}><span>Прогноз продлений</span><strong>{overview.dashboard.nextMonthForecastLabel}</strong><small>{overview.dashboard.nextMonthOrders} заказов · {overview.dashboard.nextMonth}</small></Link>
              </div>
              <div className="adminFinanceMeta">
                <span>Активные устройства: <strong>{overview.dashboard.activeDevices}</strong></span>
                <span>Самостоятельно: <strong>{overview.dashboard.selfServiceClients}</strong></span>
                <span>Бесплатные тесты: <strong>{overview.dashboard.freeTests}</strong></span>
                <Link href={clientListHref({ metric: "refunds" })}>Возвраты: <strong>{overview.dashboard.refundsLabel}</strong></Link>
                <span>Действующих подписок: <strong>{overview.dashboard.activeSubscriptions}</strong> · платных: <strong>{overview.dashboard.paidSubscriptions}</strong></span><span>Архив: <strong>{overview.dashboard.archivedClients}</strong> · тестовые: <strong>{overview.dashboard.testClients}</strong></span>
                <Link href={getDatabaseHref("clients", "", { expiry: "expired" })}>Просрочены / требуют решения: {overview.dashboard.overdue}</Link>
              </div>
            </section>
          </header>
        ) : (
        <article id="overview" hidden={adminView !== "overview"} className="panel hero adminHero">
          <div className="adminHeroHeader">
            <div className="adminHeroMain">
              <div className="adminHeroCopy">
                <span className="pill">Админ-панель</span>
                <h1>Управление сервисом</h1>
                <p>Управляйте сервисом и настройками. Клиенты, роутеры и подписки доступны в разделе «База данных».</p>
              </div>
              <div className="ctaRow adminHeroActions">
                <Link className="primaryButton" href={getDatabaseHref()}>Открыть базу данных</Link>
                <Link className="secondaryButton" href="/admin?view=assign">
                  Привязать роутер
                </Link>
                <Link className="secondaryButton" href={`/admin?view=tickets${latestNewTicketHref}`}>
                  Открыть обращения
                </Link>
              </div>
            </div>
            <AdminServerMetrics />
          </div>
          <section className="adminDailySummary"><h2>Финансы и задачи администратора</h2><div className="adminFinanceGrid">
            <Link className="adminFinanceCard" href={`/admin?view=database&tab=clients&metric=payments&month=${overview.dashboard.month}`}><span>Получено за {overview.dashboard.month}</span><strong>{overview.dashboard.confirmedPaymentsLabel}</strong><small>Подтверждённые поступления, без импорта</small></Link>
            <Link className="adminFinanceCard" href={getDatabaseHref("clients","",{metric:"forecast",month:overview.dashboard.month})}><span>Прогноз · {overview.dashboard.nextMonth}</span><strong>{overview.dashboard.nextMonthForecastLabel}</strong><small>{overview.dashboard.nextMonthOrders} ожидаемых заказов</small></Link>
            <Link className="adminFinanceCard" href={getDatabaseHref("subscriptions","",{expiry:"soon"})}><span>До окончания ≤ 5 дней</span><strong>{overview.dashboard.expiringSubscriptions}</strong><small>Перейти к соответствующим услугам</small></Link>
            <Link className="adminFinanceCard" href="/admin?view=tickets&ticketStatus=OPEN"><span>Новые обращения</span><strong>{overview.dashboard.newTickets}</strong><small>Открыть новые обращения</small></Link>
          </div><p className="helperText">Всего клиентов {overview.stats.users}; рабочая база {overview.dashboard.totalClients} исключает архив ({overview.dashboard.archivedClients}) и тестовые записи ({overview.dashboard.testClients}). Платящих клиентов {overview.dashboard.activeClients}, платных услуг {overview.dashboard.paidSubscriptions}; бесплатные тесты {overview.dashboard.freeTests} считаются отдельно.</p></section>
          <div className="miniGrid adminOverviewGrid">
            {dashboardCards.map((card) => (
              <Link key={card.label} className="metricCard adminDashboardMetricCard" href={card.href}>
                <div className="muted">{card.label}</div>
                <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                  {card.value}
                </div>
                <span className="helperText adminDashboardMetricHint">{card.description}</span>
              </Link>
            ))}
          </div>
        </article>
        )}

        {successMessage ? <div className="banner successBanner">{successMessage}</div> : null}
        {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}
        {isDatabaseView ? <details className="panel adminReconciliation"><summary>Сверка исходного импорта · {overview.reconciliation.length} записей</summary><p className="helperText">Предпросмотр из прежних документов. Применение заблокировано до сверки актуального файла Google Диска. Последующие оплаты сохраняются. Суммы переноса не являются выручкой.</p>
          <p className="helperText">Сводка использует текущие сохранённые данные. Перед применением сверяйте источник: значения трёх записей нового PDF отличаются от прежнего локального Excel. Корректировка переноса сохраняет исходные значения и не создаёт денежное поступление.</p>
          <div className="contentStack">{overview.reconciliation.map(record => <section key={record.routerId} className="adminImportReview"><strong>{record.code} · {record.object}</strong><p>{record.currentPlan} / {record.currentPrice} ₽ → {record.expectedPlan} / {record.expectedPrice} ₽ · сумма переноса {record.importedAmount} → {record.expectedAmount} ₽</p><p className="helperText">Срок {formatDateTime(record.currentEnd)} → {formatDateTime(record.expectedEnd)} МСК · {record.source}</p><p className="helperText">{record.state}</p>
            {!record.completed ? <form data-admin-path={`/api/admin/routers/${record.routerId}/reconcile`}><label className="fieldStack"><span className="fieldLabel">Причина исторической корректировки</span><input className="textInput" name="reason" minLength={8} maxLength={1000} required placeholder="Сверка с ТЗ от 08.10.2026" /></label><button className="secondaryButton" type="submit" disabled={!record.eligible} data-confirm={`Исправить исходный импорт ${record.code} · ${record.object}? Новая оплата создана не будет. Исходные значения сохранятся в аудите.`}>Применить корректировку</button></form> : null}
          </section>)}</div>
        </details> : null}

        {isDatabaseView && ["payments", "forecast", "refunds"].includes(metric) ? <section className="panel sectionPanel">
          <div className="sectionHeader"><h2 className="adminSectionTitle">{metric === "forecast" ? `Ожидаемые заказы · ${overview.dashboard.nextMonth}` : metric === "refunds" ? `Возвраты · ${overview.dashboard.month}` : `Подтверждённые поступления · ${overview.dashboard.month}`}</h2><Link className="secondaryButton" href={clientListHref({ metric: "" })}>Закрыть детализацию</Link></div>
          <p className="helperText">Вся база. Импорт и бесплатные тесты в поступления не входят. Прогноз рассчитан по оплаченному окончанию и сохранённой цене продления.</p>
          <ul className="list adminList">{(metric === "forecast" ? overview.dashboard.forecastDetails : metric === "refunds" ? overview.dashboard.refundDetails : overview.dashboard.paymentDetails).map(item => <li key={item.id}><Link href={getDatabaseHref("clients", item.clientCode ?? item.userId)}>{item.clientCode} · {item.name}</Link> · {item.routerCode} · {item.plan ?? item.provider} · {formatDateTime(item.at)} МСК · <strong>{item.amount.toLocaleString("ru-RU")} ₽</strong></li>)}</ul>
          {!(metric === "forecast" ? overview.dashboard.forecastDetails : metric === "refunds" ? overview.dashboard.refundDetails : overview.dashboard.paymentDetails).length ? <p className="helperText">Записей за этот период нет.</p> : null}
        </section> : null}

        {!isDatabaseView ? <>
        <section id="assign" hidden={adminView !== "assign"} className="panel sectionPanel adminSectionPanel">
          <span className="pill">Ручная привязка</span>
          <h2 className="adminSectionTitle">Создать роутер вручную</h2>
          <AdminAssignment users={overview.users} /><AdminCreateClient />
        </section>

        <div hidden={adminView !== "settings"} className="contentStack">
          {groupNames.map((groupName) => (
            <form key={groupName} id={groupName} data-admin-path="/api/admin/settings" className="panel settingsSection adminSettingsSection" autoComplete="off"><input name="group" type="hidden" value={groupName}/><input name="returnTo" type="hidden" value={`/admin?view=settings#${groupName}`}/>
              <div className="sectionHeader">
                <div>
                  <h2 className="adminSectionTitle">{groupName}</h2>
                  {groupName === "Платежи" ? (<div className="adminPaymentReadiness"><p className="helperText">Включённый провайдер и проверенное подключение — разные состояния. Проверка ниже оценивает заполненность конфигурации без списаний.</p>{overview.integrations?.map(provider=><p key={provider.id}>{provider.label}: {provider.enabled?"включён":"выключен"} · {provider.ready?"обязательные поля заполнены":"не хватает обязательных полей"} · соединение с провайдером не проверялось</p>)}<Link className="secondaryButton" href="/admin?view=payments">Журнал поступлений</Link></div>) : null}
                  {groupName === "Подписки" ? <p className="helperText">Пять бизнес-планов: Сервер — доступ; Техничка — сопровождение; Полный — доступ и сопровождение; Самостоятельно — без подписки и списаний; Индивидуальный — явно заданные состав, цена и срок. Ниже цены технических компонентов. Изменение влияет на новые заказы; исторические суммы сохраняются. Стандартный период: ровно 30 суток.</p> : null}
                  {groupName === "Продажи" ? <p className="helperText">Цены указаны в ₽. Новый заказ: роутер {settingsByGroup[groupName].find(s=>s.key==="router_price")?.value} + подготовка {settingsByGroup[groupName].find(s=>s.key==="setup_price")?.value} ₽. Цены 1 ₽ требуют проверки владельцем; автоматически не заменяются. Доставка и выезд отдельно не добавляются, поскольку не входят в текущую модель.</p> : null}
                  {groupName === "Пробный период" ? <p className="helperText">Тест 14 дней после получения роутера проекта и ручной активации. Сервер и выбранное сопровождение — в карточке устройства. Полученные заказы и использованные тесты проверяются backend. Завершение теста не создаёт списание.</p> : null}
                  {groupName === "Рефералы" ? <p className="helperText">Импорт, бесплатные тесты и самостоятельный план не являются основанием начисления. Пример процента: подтверждённые 1000 ₽ × {settingsByGroup[groupName].find(s=>s.key==="referral_subscription_percent")?.value}% / 100 = {1000*Number(settingsByGroup[groupName].find(s=>s.key==="referral_subscription_percent")?.value??0)/100} ₽. Доступность после проверки: {settingsByGroup[groupName].find(s=>s.key==="referral_review_days")?.value} дней. Автоматическое начисление и правила возврата требуют согласованной модели; текущие начисления проверяются вручную, повтор платежа не создаёт награду автоматически.</p> : null}
                  {groupName === "Коммуникации" ? <p className="helperText">Рабочая ссылка бота должна быть подтверждена владельцем. example_bot считается заглушкой; восстановление доступа ведёт в поддержку, без обещания несуществующей функции бота. Проверка доставки и входа требует подключённого тестового аккаунта.</p> : null}
                  {groupName === "Платежи" ? (
                    <>
                      <div className="adminSettingsBlocks">
                        {paymentSettingsBlocks.map((block) => (
                          <section key={block.title} className="panel adminSettingsBlock">
                            <div className="adminSettingsBlockHeader">
                              <h3 className="adminSettingsBlockTitle">{block.title}</h3>
                              <p className="helperText">{block.description}</p>
                            </div>
                            <div className="settingsGrid adminSettingsBlockGrid">
                              {block.keys.map((key) => {
                                const setting = paymentSettingsByKey.get(key);
                                if (!setting) {
                                  return null;
                                }

                                return (
                                  <label key={setting.key} className="fieldStack">
                                    <span className="fieldLabel">{setting.label}</span>
                                    {setting.input === "boolean" ? (
                                      <>
                                        <input name={setting.key} type="hidden" value="false" />
                                        <label className="checkboxRow">
                                          <input
                                            defaultChecked={setting.value === "true"}
                                            name={setting.key}
                                            type="checkbox"
                                            value="true"
                                          />
                                          <span>{setting.value === "true" ? "Включено" : "Выключено"}</span>
                                        </label>
                                      </>
                                    ) : (
                                      setting.key === "yoomoney_payment_type" ? <select className="textInput" name={setting.key} defaultValue={setting.value || "AC"}><option value="AC">Банковская карта</option><option value="PC">Кошелёк ЮMoney</option></select> :                                       <input
                                        readOnly={["subscription_period_days","trial_period_days"].includes(setting.key)}
                          min={setting.input === "number" ? 0 : undefined} max={setting.input === "number" ? setting.key === "referral_subscription_percent" ? 100 : 1000000 : undefined} step={setting.input === "number" ? "0.01" : undefined}
                                        autoComplete={setting.input === "password" ? "new-password" : "off"}
                                        className="textInput"
                                        data-form-type="other"
                                        data-lpignore="true"
                                        defaultValue={setting.input === "password" ? "" : setting.value}
                                        inputMode={setting.key === "api_public_url" ? "url" : getFieldInputMode(setting.input)}
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
                                      {setting.input === "password" ? "Секрет сохранён на сервере. Пустое поле сохраняет текущий; новый секрет вводится явно." : setting.description}
                                      {setting.public ? " Это значение используется на публичных страницах." : ""}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    </>
                  ) : groupName === "Коммуникации" ? (
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
                          Публичный адрес сайта задаёт адрес входа и ссылок поддержки. После изменения проверяйте новые ссылки.
                        </p>
                        <details><summary>Техническое имя параметра</summary><code>NEXT_PUBLIC_APP_URL</code></details>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              {groupName === "Платежи" ? null : (
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
                          readOnly={["subscription_period_days","trial_period_days"].includes(setting.key)}
                          min={setting.input === "number" ? 0 : undefined} max={setting.input === "number" ? setting.key === "referral_subscription_percent" ? 100 : 1000000 : undefined} step={setting.input === "number" ? "0.01" : undefined}
                          autoComplete={setting.input === "password" ? "new-password" : "off"}
                          className="textInput"
                          data-form-type="other"
                          data-lpignore="true"
                          defaultValue={setting.input === "password" ? "" : setting.value}
                          inputMode={setting.key === "api_public_url" ? "url" : getFieldInputMode(setting.input)}
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
              )}
              <div className="ctaRow"><button className="primaryButton" type="submit">Сохранить {groupName === "Платежи" ? "настройки оплаты" : groupName.toLowerCase()}</button></div></form>
          ))}

        </div>
        </> : null}

        {isDatabaseView && databaseTab === "clients" ? (
        <section id="clients" data-admin-results className="panel sectionPanel adminSectionPanel">
          <span className="pill">Клиенты</span>
          <AdminStickySearch><div className="sectionHeader">
            <div>
              <h2 className="adminSectionTitle">База клиентов и поиск</h2>
              <p className="helperText">
                Ищите по коду клиента или роутера, имени, телефону, городу, email и Telegram.
              </p>
            </div>
            <form action="/admin" data-admin-query className="adminClientSearchForm">
              <input name="view" type="hidden" value="database" />
              <input name="tab" type="hidden" value="clients" />
              <input name="plan" type="hidden" value={overview.clientPlan} /><input name="status" type="hidden" value={overview.clientStatus} /><input name="city" type="hidden" value={overview.clientCity} /><input name="expiry" type="hidden" value={overview.clientExpiry} /><input name="sort" type="hidden" value={overview.clientSort} /><input name="pageSize" type="hidden" value={overview.clientPageSize} /><input name="month" type="hidden" value={overview.dashboard.month} />
              <input key={overview.clientQuery} className="textInput" defaultValue={overview.clientQuery} name="q" placeholder="Поиск по базе клиентов" type="search" />
              <div className="ctaRow">
                <button className="primaryButton" type="submit">
                  Найти
                </button>
                {overview.clientQuery ? (
                  <Link data-admin-query-link scroll={false} className="secondaryButton" href={getDatabaseHref()}>
                    Сбросить
                  </Link>
                ) : null}
              </div>
            </form>
          </div>
          <details className="adminFilterDisclosure"><summary>Фильтры и сортировка</summary><form key={clientReturnTo} className="adminClientFilters" data-admin-query action="/admin"><input type="hidden" name="month" value={overview.dashboard.month} />
            <input type="hidden" name="view" value="database" /><input type="hidden" name="tab" value="clients" />
            {overview.clientQuery ? <input type="hidden" name="q" value={overview.clientQuery} /> : null}
            <label><span className="fieldLabel">Тариф</span><select className="textInput" name="plan" defaultValue={overview.clientPlan}><option value="">Все тарифы</option><option>Сервер</option><option>Техничка</option><option>Полный</option><option>Самостоятельно</option><option>Индивидуальный</option></select></label>
            <label><span className="fieldLabel">Статус аккаунта</span><select className="textInput" name="status" defaultValue={overview.clientStatus}><option value="">Все статусы</option><option value="ACTIVE">Активен</option><option value="BLOCKED">Заблокирован</option><option value="PENDING">Ожидает</option><option value="ARCHIVED">Архив</option><option value="TEST">Тестовые записи</option></select></label>
            <label><span className="fieldLabel">Город</span><input className="textInput" name="city" defaultValue={overview.clientCity} placeholder="Любой город" /></label>
            <label><span className="fieldLabel">Срок</span><select className="textInput" name="expiry" defaultValue={overview.clientExpiry}><option value="">Любой срок</option><option value="active">Действуют</option><option value="soon">≤ 5 дней</option><option value="expired">Истекли</option><option value="pending">Ждут активации</option><option value="none">Без подписки</option></select></label>
            <label><span className="fieldLabel">Сортировка</span><select className="textInput" name="sort" defaultValue={overview.clientSort}><option value="created">Новые сначала</option><option value="name">По имени</option><option value="code">По CLI-ID</option><option value="end">По окончанию</option></select></label>
            <label><span className="fieldLabel">На странице</span><select className="textInput" name="pageSize" defaultValue={overview.clientPageSize}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
            <button className="secondaryButton" type="submit">Применить</button><Link data-admin-query-link scroll={false} className="secondaryButton" href={getDatabaseHref("clients","",{month:overview.dashboard.month})}>Сбросить фильтры</Link>
          </form></details></AdminStickySearch>
          <p className="helperText adminClientSearchMeta">{overview.clientQuery ? `Найдено клиентов: ${overview.clientCount}.` : `Клиентов в выборке: ${overview.clientCount}.`} Показано {overview.clients.length}. В выборке: {overview.selection.routers} роутеров · назначенные пакеты на {overview.selection.periodPrice.toLocaleString("ru-RU")} ₽ за период (включая черновики; это не выручка) · получено оплат {overview.selection.payments.toLocaleString("ru-RU")} ₽.</p>
          <div className="adminClientTableHeader" aria-hidden="true"><span>Клиент</span><span>Роутеры / CLI</span><span>Тариф и срок</span><span>Статус</span><span>Действие</span></div>
          <div className="contentStack">
            {overview.clients.length ? (
              overview.clients.map((user) => {
                const ownerRouters = user.devices;
                const ownerSubscriptions = ownerRouters.flatMap(router => router.subscriptions);
                const plans = [...new Set(ownerRouters.map(router => router.plan))];
                const primaryPlan = plans.length > 1 ? "Несколько планов" : plans[0] ?? "Не выбран";
                const ends = [...new Set(ownerSubscriptions.map(s => s.endAt).filter(Boolean))];
                const primaryEnd = ends.length === 1 ? ends[0] : null;
                const remaining = ownerSubscriptions.find(s => s.endAt === primaryEnd)?.daysRemaining;
                const expiryClass = ownerSubscriptions.some(s => s.status === "EXPIRED") ? "adminExpiryExpired" : ownerSubscriptions.some(s => s.status === "ACTIVE" && (s.daysRemaining ?? 999) <= 5) ? "adminExpirySoon" : "";
                const totalPrice = ownerRouters.reduce((sum, r) => sum + r.price, 0);
                return <AdminSingleDisclosure key={user.id} summary={<div className="adminClientRow">
                  <span className="adminClientRowMain"><strong>{getAdminUserName(user)}</strong><small>{user.clientCode ?? user.id} · {user.city ?? "Город не указан"}</small></span>
                  <span className="adminClientRowRouters">{ownerRouters.length === 1 ? <small>{ownerRouters[0].routerCode} · {ownerRouters[0].displayName}</small> : <small>{ownerRouters.length ? `${ownerRouters.length} роутера` : "Нет роутеров"}</small>}</span>
                  <span className="adminClientRowPlan"><span className="adminClientPlanLine"><span className={getAdminPlanClass(primaryPlan)}>{primaryPlan}</span><small>{totalPrice.toLocaleString("ru-RU")} ₽</small></span><small className={expiryClass}>{ends.length > 1 ? "См. роутеры — разные сроки" : primaryEnd ? `до ${formatDate(primaryEnd)} · ${remaining ?? 0} дн.` : primaryPlan === "Самостоятельно" ? "Без подписки" : "Срок не начат"}</small></span>
                  <span className={`adminStatusBadge adminStatus${user.status}`}><span aria-hidden="true" />{user.serviceState ?? (user.status === "ACTIVE" ? "Аккаунт активен" : user.status === "BLOCKED" ? "Аккаунт заблокирован" : "Аккаунт ожидает")}<small>· {user.status === "ACTIVE" ? "аккаунт активен" : user.status === "BLOCKED" ? "аккаунт заблокирован" : "аккаунт ожидает"}</small></span>
                  <span className="adminClientRowAction">Открыть <span aria-hidden="true">⌄</span></span>
                </div>}>
              <div className="panel adminRecordCard adminClientRecord">
              <div className="adminClientDetailSummary"><strong>{getAdminUserName(user)} · {user.clientCode}</strong><p className="helperText">{user.phone ?? "Телефон не указан"} · {user.email ?? "Email не указан"} · {getAdminUserTelegramLabel(user)} · {user.city ?? "Город не указан"}</p></div>
              <div className="adminClientDevices">{ownerRouters.map(router => <section key={router.id} className="adminClientDevice panel">
                <div className="sectionHeader"><div><strong>{router.routerCode} · {router.displayName}</strong><p className="helperText">{router.archivedAt ? "В архиве · " : ""}{router.model ?? "Модель не указана"} · SN: {router.serialNumber ?? "Не указано"} · конфигурация {adminStatus(router.configurationType)} · состояние устройства: {adminStatus(router.status)}</p></div><span className={getAdminPlanClass(router.plan)}>{router.plan} · {router.priceLabel}</span></div>
                {router.plan === "Самостоятельно" ? <p className="helperText">Без подписки и регулярных списаний.</p> : <ul className="list">{router.subscriptions.map(s => <li key={s.id}>{s.accessEnabled ? "Сервер" : ""}{s.accessEnabled && s.supportType !== "NONE" ? " + " : ""}{s.supportType !== "NONE" ? "Поддержка" : ""} · {adminStatus(s.status)} · {s.pendingActivation ? `Ждёт активации, оплачено ${s.pendingDays} дней` : `до ${formatDateTime(s.endAt)} МСК · ${s.daysRemaining ?? 0} дн.`} · <Link href={`${getDatabaseHref("subscriptions")}#subscription-${s.id}`}>Запись подписки</Link></li>)}</ul>}
                {router.adminNote ? <p className="helperText">Внутренняя заметка: {router.adminNote}</p> : null}
                <div className="ctaRow"><Link className="secondaryButton" href={getDatabaseHref("routers",router.routerCode ?? router.id)}>Редактировать / изменить план</Link><AdminQrTools id={router.id} code={router.routerCode} name={router.displayName}/></div>
                <details><summary>История оплат и переноса ({router.payments.length})</summary><ul className="list">{router.payments.map(p => <li key={p.id}>{formatDateTime(p.paidAt)} МСК · {p.amountLabel} · {p.allocationNeeded ? "Требует распределения — дни не начислены" : `${p.daysAdded ?? "—"} дней`} · {p.imported ? "Перенос из Excel — не денежное поступление" : p.provider} · {adminStatus(p.status)}</li>)}</ul></details>
              </section>)}</div>
              <details className="adminClientEdit"><summary>Редактировать клиента</summary>
              <form action={updateUserAction} data-admin-path={`/api/admin/users/${user.id}`}>
                <input name="userId" type="hidden" value={user.id} />
                <input name="returnTo" type="hidden" value={clientReturnTo} />
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle">
                      {getAdminUserName(user)} · {getAdminUserEmail(user)}
                    </h3>
                    <p className="helperText">
                      {user.clientCode ?? user.id} · Реферальный код: {user.referralCode} · Регистрация: {formatDate(user.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="settingsGrid">
                  <label className="fieldStack">
                    <span className="fieldLabel">Имя</span>
                    <input className="textInput" defaultValue={user.name ?? ""} name="name" placeholder="Имя клиента" type="text" />
                  </label>
                  <label className="fieldStack"><span className="fieldLabel">Имя в личном кабинете</span><input className="textInput" name="publicName" defaultValue={user.publicName ?? ""} placeholder={user.clientCode ?? "Имя для клиента"} /></label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Email</span>
                    <input className="textInput" defaultValue={user.email ?? ""} name="email" placeholder="client@example.com" type="email" />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Телефон / контакт</span>
                    <input className="textInput" defaultValue={user.phone ?? ""} name="phone" type="text" />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Город</span>
                    <input className="textInput" defaultValue={user.city ?? ""} name="city" type="text" />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Telegram username</span>
                    <input
                      className="textInput"
                      defaultValue={user.telegramUsername ?? ""}
                      name="telegramUsername"
                      placeholder="username"
                      type="text"
                    />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Статус</span>
                    <select className="textInput" defaultValue={adminStatus(user.status)} name="status">
                      <option value="ACTIVE">Активен</option>
                      <option value="BLOCKED">Заблокирован</option>
                      <option value="PENDING">Ожидает</option>
                    </select>
                  </label>
                </div>
                <div className="settingsGrid adminClientStatsGrid">
                  <label className="checkboxRow"><input type="checkbox" name="archived" defaultChecked={!!user.archivedAt} /> В архив — история сохраняется</label><label className="checkboxRow"><input type="checkbox" name="isTest" defaultChecked={user.isTest} /> Тестовая запись</label>
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
                  Telegram из Excel сохраняется как контакт. Привязка для входа выполняется отдельно. Пустой email сохраняет текущую привязку.
                </p>
                <div className="ctaRow">
                  <button className="primaryButton" type="submit">
                    Сохранить клиента
                  </button>
                </div>
                <label className="fieldStack"><span className="fieldLabel">Причина изменения</span><input className="textInput" name="reason" maxLength={1000} placeholder="Что изменили и почему" /></label>
              </form>
              </details>
              <p className="helperText">Аккаунт: {adminStatus(user.status)} · {user.archivedAt ? "В архиве" : "Рабочая запись"}{user.isTest ? " · Тестовая запись" : ""}</p>
              <details style={{ marginTop: "20px" }}>
                <summary>Доступ клиента в кабинет</summary>
                <form action={setClientCredentialsAction} data-admin-path={`/api/admin/users/${user.id}/credentials`} className="contentStack" style={{ marginTop: "16px" }}>
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="returnTo" value={clientReturnTo} />
                  <label className="fieldStack"><span className="fieldLabel">Логин</span>
                    <input className="textInput" name="login" defaultValue={user.localLogin ?? user.clientCode?.toLowerCase() ?? ""} minLength={3} maxLength={32} pattern="[a-zA-Z0-9._-]+" required />
                  </label>
                  <label className="fieldStack"><span className="fieldLabel">Новый пароль</span>
                    <input className="textInput" name="password" type="password" autoComplete="new-password" minLength={6} maxLength={128} />
                  </label>
                  <p className="helperText">Пустой пароль сохраняет действующий доступ. Для первого входа задайте пароль.</p>
                  <button className="secondaryButton" type="submit">Сохранить доступ</button>
                </form>
              </details>
              </div>
                </AdminSingleDisclosure>;
              })
            ) : (
              <div className="panel adminInfoCard">
                <strong>Совпадений не найдено.</strong>
                <p className="helperText">Попробуй поиск по имени, email, Telegram username или ID клиента.</p>
              </div>
            )}
          </div>
          {overview.clients.length ? <nav className="adminPagination" aria-label="Страницы клиентов">
            <span className="helperText">Страница {overview.clientPage} из {pageCount}</span>
            <div className="ctaRow">
              {overview.clientPage > 1 ? <Link data-admin-query-link scroll={false} className="secondaryButton" href={clientListHref({ page: overview.clientPage - 1 })}>Назад</Link> : null}
              {overview.clientPage < pageCount ? <Link data-admin-query-link scroll={false} className="secondaryButton" href={clientListHref({ page: overview.clientPage + 1 })}>Далее</Link> : null}
            </div>
          </nav> : null}
        </section>
        ) : null}

        {isDatabaseView && databaseTab === "routers" ? (
        <section id="routers" data-admin-results className="panel sectionPanel adminSectionPanel">
          <span className="pill">Роутеры</span>
          <h2 className="adminSectionTitle">Управление назначениями</h2><AdminQueryFilters tab="routers" statuses={[["ACTIVE","Активные устройства"],["DRAFT","Черновики"],["SUSPENDED","Приостановлены"],["DISABLED","Отключены"],["ARCHIVED","Архив"]]}/><div className="adminRegisterColumnHeader"><span>Клиент / роутер</span><span>План / цена</span><span>Срок услуги</span><span>Устройство</span></div>
          <div className="contentStack">
            {overview.routers.map((router) => (
              <div key={router.id} id={`router-${router.id}`}><AdminSingleDisclosure summary={<div className="adminRegisterRow"><span><strong>{router.routerCode} · {router.displayName}</strong><small>{router.clientCode} · {router.ownerName}</small></span><span className={getAdminPlanClass(router.plan)}>{router.plan} · {adminMoney(router.planPrice)}</span><span>{router.plan==="Самостоятельно"?"Без подписки":router.pendingActivation?"Ожидает активации":formatDateTime(router.endAt)+" МСК"}</span><span>{router.archivedAt?"Архив":adminStatus(router.status)}</span></div>}>
              <AdminPlanChange router={router} subscriptions={router.services} />
              <AdminQrTools id={router.id} code={router.routerCode} name={router.displayName}/>
              <details className="adminClientEdit"><summary>Редактировать данные роутера</summary><form key={router.id} action={updateRouterAction} data-admin-path={`/api/admin/routers/${router.id}`} className="panel adminRecordCard">
                <input name="routerId" type="hidden" value={router.id} />
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle">{router.routerCode} · {router.displayName}</h3>
                    <p className="helperText">
                      {router.clientCode} · {router.ownerName} · {router.serviceTariff ?? router.savedTemplate}
                    </p>
                  </div>
                </div>
                <div className="settingsGrid">
                  <label className="fieldStack">
                    <span className="fieldLabel">Клиент</span>
                    <select className="textInput" defaultValue={router.ownerId} name="ownerUserId">
                      {overview.users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.clientCode} · {getAdminUserName(user)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Название роутера</span>
                    <input className="textInput" defaultValue={router.displayName} name="displayName" required type="text" />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Модель</span>
                    <input className="textInput" defaultValue={router.model ?? ""} name="model" type="text" />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Серийный номер</span>
                    <input className="textInput" defaultValue={router.serialNumber ?? ""} name="serialNumber" type="text" />
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
                  <label className="checkboxRow"><input type="checkbox" name="archived" defaultChecked={!!router.archivedAt} /> Роутер в архиве</label>
                  <div className="fieldStack">
                    <span className="fieldLabel">Назначенный план продления</span>
                    <strong>{router.serviceTariff ?? router.savedTemplate}</strong>
                  </div>
                </div>

                <label className="fieldStack" style={{ marginTop: "16px" }}>
                  <span className="fieldLabel">Внутренняя заметка администратора</span>
                  <textarea
                    className="textAreaInput"
                    defaultValue={router.adminNote ?? ""}
                    name="adminNote"
                    placeholder="Свободная заметка. IP и порт для проверки задаются отдельно."
                  />
                </label>
                <div className="ctaRow" style={{ marginTop: "16px" }}>
                  <button className="primaryButton" type="submit">
                    Сохранить роутер
                  </button>
                  <button
                    aria-label={getAdminRouterDeleteLabel(router)}
                    data-admin-path={`/api/admin/routers/${router.id}/delete`}
                    data-confirm={`Перенести в архив ${router.routerCode} · ${router.displayName}? История оплат, сроки и QR сохранятся.`}
                    className="secondaryButton adminDangerButton"
                    formAction={deleteRouterAction}
                    formNoValidate
                    type="submit"
                  >
                    В архив
                  </button>
                </div>
                <label className="fieldStack"><span className="fieldLabel">Причина изменения</span><input className="textInput" name="reason" maxLength={1000} placeholder="Что изменили и почему" /></label>
              </form></details></AdminSingleDisclosure></div>
            ))}
          </div>
          <AdminPagination {...overview.registerMeta.routers} />
        </section>
        ) : null}

        {isDatabaseView && databaseTab === "subscriptions" ? (
        <section id="subscriptions" data-admin-results className="panel sectionPanel adminSectionPanel">
          <span className="pill">Подписки</span>
          <h2 className="adminSectionTitle">Продления и активации</h2><AdminQueryFilters tab="subscriptions" statuses={[["active_paid","Активные платные"],["trial","Бесплатный тест"],["DRAFT","Черновики"],["PENDING_ACTIVATION","Ожидают активации"],["EXPIRED","Истекли"],["PAUSED","На паузе"],["CANCELLED","Отменены"]]}/><div className="adminRegisterColumnHeader"><span>Клиент / роутер</span><span>Услуга / цена</span><span>Оплачено до</span><span>Состояние</span></div>
          <div className="contentStack">
            {overview.subscriptions.map((subscription) => (
              <div key={subscription.id} id={`subscription-${subscription.id}`}><AdminSingleDisclosure summary={<div className="adminRegisterRow"><span><strong>{subscription.routerCode} · {subscription.routerName}</strong><small>{subscription.clientCode} · {subscription.customerName}</small></span><span>{subscription.bundleLabel} · {subscription.priceLabel}</span><span>{subscription.pendingActivation?`Удерживается ${subscription.pendingDays} дней`:formatDateTime(subscription.endAt)+" МСК"}</span><span>{subscription.isTrial?"Бесплатный тест":adminStatus(subscription.status)}</span></div>}>
              <details className="adminClientEdit"><summary>Редактировать срок / активировать</summary>
              <form action={updateSubscriptionAction} data-admin-path={`/api/admin/subscriptions/${subscription.id}`}>
                <input name="subscriptionId" type="hidden" value={subscription.id} />
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle">{subscription.routerCode} · {subscription.routerName}</h3>
                    <p className="helperText">
                      {subscription.bundleLabel} · {subscription.priceLabel} · {subscription.pendingActivation ? `ждёт активации, оплачено ${subscription.pendingDays} дней` : `осталось ${subscription.daysRemaining ?? 0} дней`}
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
                    <span className="fieldLabel">Начало · МСК</span>
                    <input
                      className="textInput"
                      defaultValue={formatDateTimeInputValue(subscription.startAt)}
                      name="startAt"
                      type="datetime-local"
                    />
                  </label>
                  <label className="fieldStack">
                    <span className="fieldLabel">Окончание · МСК</span>
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
                      {subscription.accessEnabled ? "Сервер предусмотрен пакетом" : "Сервер не предусмотрен пакетом"} ·{" "}
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
                <label className="fieldStack"><span className="fieldLabel">Причина изменения срока / статуса</span><input className="textInput" name="reason" maxLength={1000} placeholder="Активация, исправление срока или другое основание" /></label>
              </form>
              </details><AdminPaymentForm subscription={subscription} price={subscription.nextPrice}/>
              <details style={{ marginTop: "20px" }}>
                <summary>История операций ({subscription.payments.length})</summary>
                <ul className="list">
                  {subscription.payments.length ? subscription.payments.map((payment) => <li key={payment.id}>
                    {formatDateTime(payment.paidAt)} МСК · {payment.amountLabel} · +{payment.daysAdded ?? "—"} дней
                    {payment.provider === "client_register_import" ? " · импорт из Excel" : ""}
                  </li>) : <li>Пополнений пока нет.</li>}
                </ul>
              </details>
              </AdminSingleDisclosure></div>
            ))}
          </div>
          <AdminPagination {...overview.registerMeta.subscriptions} />
        </section>
        ) : null}

        {!isDatabaseView ? <>
        <section id="orders" data-admin-results hidden={adminView !== "orders"} className="panel sectionPanel adminSectionPanel">
          <span className="pill">
            Заказы
            {newOrderCount ? <span className="adminTicketNewBadge">+{newOrderCount}</span> : null}
          </span>
          <h2 className="adminSectionTitle">Магазин и доставка</h2><AdminQueryFilters view="orders" statuses={[["CREATED","Созданы"],["WAITING_PAYMENT","Ожидают оплаты"],["PAID","Оплачены"],["CONFIGURING","Подготовка"],["READY_TO_SHIP","Готовы к отправке"],["SHIPPED","Отправлены"],["RECEIVED","Получены"],["CANCELED","Отменены"],["REFUND","Возврат"]]} statusKey="orderStatus"/>
          <div className="contentStack">
            {overview.orders.map((order) => (
              <div key={order.id} id={`order-${order.id}`}><AdminSingleDisclosure summary={<div className="adminRegisterRow"><span><strong>{order.clientCode} · {order.customerName}</strong><small>Заказ {order.id}</small></span><span>{order.totalPriceLabel}</span><span>{formatDateTime(order.createdAt)} МСК</span><span>{adminStatus(order.status)}</span></div>}><form action={updateOrderAction} data-admin-path={`/api/admin/orders/${order.id}`} className="panel adminRecordCard">
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
                  <button
                    aria-label={getAdminOrderDeleteLabel(order)}
                    data-admin-path={`/api/admin/orders/${order.id}/delete`} data-confirm="Удалить заказ? История платежей сохраняется, сам заказ останется в аудите."
                    className="secondaryButton adminDangerButton"
                    formAction={deleteOrderAction}
                    type="submit"
                  >
                    Удалить
                  </button>
                </div>
              </form></AdminSingleDisclosure></div>
            ))}
          </div>
          {!overview.orders.length?<p className="helperText">Заказов пока нет или нет совпадений с фильтрами.</p>:null}<AdminPagination {...overview.registerMeta.orders} />
        </section>

        <section id="tickets" data-admin-results hidden={adminView !== "tickets"} className="panel sectionPanel adminSectionPanel">
          <span className="pill">Поддержка</span>
          <h2 className="adminSectionTitle">Обращения клиентов</h2><AdminQueryFilters view="tickets" statuses={[["open","Все открытые"],["OPEN","Новые"],["IN_PROGRESS","В работе"],["WAITING_CLIENT","Ждём клиента"],["RESOLVED","Решены"],["CLOSED","Закрыты"],["ARCHIVED","Архив"]]} statusKey="ticketStatus"/>
          <div className="contentStack">
            {overview.tickets.map((ticket) => {
              return (
                <div key={ticket.id} id={getTicketAnchorId(ticket.id)}><AdminSingleDisclosure summary={<div className="adminRegisterRow"><span><strong>#{ticket.number} · {ticket.customerName}</strong><small>{ticket.clientCode} · {ticket.routerCode} · {ticket.routerName}</small></span><span>{adminStatus(ticket.status)} · {ticket.assigneeId?overview.administrators.find(a=>a.id===ticket.assigneeId)?.name??"Администратор":"Не назначен"}</span><span>{formatDateTime(ticket.updatedAt)} МСК</span><span>{ticket.messages.at(-1)?.body.slice(0,80)??ticket.description.slice(0,80)}</span></div>}>
                <div className="sectionHeader">
                  <div>
                    <h3 className="adminSectionTitle adminTicketTitleRow">
                      #{ticket.number} · {ticket.customerName} · {ticket.category}
                      {isTicketAwaitingAdminReply(ticket) ? <span className="adminTicketNewBadge">+1</span> : null}
                    </h3>
                    <p className="helperText">
                      {ticket.clientCode} · роутер {ticket.routerCode} · {ticket.routerName} · создано {formatDateTime(ticket.createdAt)} МСК
                    </p>
                  </div>
                </div>
                <p className="helperText" style={{ marginBottom: "16px" }}>
                  {ticket.description}
                </p>
                {ticket.contact ? <p className="helperText">{ticket.guestContact?"Обращение без регистрации. ":""}Контакт для ответа: <strong>{ticket.contact}</strong> <AdminCopyContact value={ticket.contact}/></p> : null}
                <TicketConversation
                  adminLabel="Поддержка"
                  closedLabel="Чат закрыт. Новые сообщения отправить нельзя."
                  clientLabel={ticket.customerName}
                  messages={ticket.messages}
                  replyActionUrl={`/admin/tickets/${ticket.id}/message`}
                  replyButtonLabel="Отправить"
                  replyPlaceholder="Напишите сообщение..."
                  refreshUrl={`/admin/tickets/${ticket.id}/message`}
                  status={ticket.status}
                  ticketId={ticket.id}
                />
                <div className="ctaRow"><Link className="secondaryButton" href={getDatabaseHref("clients",ticket.clientCode??ticket.userId)}>Карточка клиента</Link>{ticket.routerId?<Link className="secondaryButton" href={getDatabaseHref("routers",ticket.routerCode??ticket.routerId)}>Карточка роутера</Link>:null}</div><form action={updateTicketAction} data-admin-path={`/api/admin/tickets/${ticket.id}`}>
                  <label className="checkboxRow"><input name="archived" type="checkbox" defaultChecked={!!ticket.archivedAt}/> В архиве · снимите отметку для восстановления</label>
                  <input name="ticketId" type="hidden" value={ticket.id} />
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
                      <select className="textInput" defaultValue={ticket.assigneeId??""} name="assigneeId"><option value="">Не назначен</option><option value={overview.currentAdmin}>Взять себе</option>{overview.administrators.filter(a=>a.id!==overview.currentAdmin).map(a=><option key={a.id} value={a.id}>{a.name??a.id}</option>)}</select>
                    </label>
                    <div className="fieldStack">
                      <span className="fieldLabel">ID клиента</span>
                      <strong>{ticket.clientCode ?? ticket.userId}</strong>
                    </div>
                  </div>
                  <span className="helperText">{getAdminTicketStatusHint(ticket.status)}</span>
                  <div className="ctaRow" style={{ marginTop: "16px" }}>
                    <button className="primaryButton" type="submit">
                      Сохранить обращение
                    </button>
                    <button
                      aria-label={getAdminTicketDeleteLabel(ticket)}
                      className="secondaryButton adminDangerButton"
                      data-admin-path={`/api/admin/tickets/${ticket.id}/delete`} data-confirm={`Перенести обращение №${ticket.number} в архив? История сообщений сохраняется.`}
                      formAction={deleteTicketAction}
                      type="submit"
                    >
                      В архив
                    </button>
                  </div>
                </form>
                </AdminSingleDisclosure></div>
              );
            })}
          </div>
          {!overview.tickets.length?<p className="helperText">Обращений по выбранным условиям нет.</p>:null}<AdminPagination {...overview.registerMeta.tickets} />
        </section>

        <section id="rewards" data-admin-results hidden={adminView !== "rewards"} className="panel sectionPanel adminSectionPanel">
          <span className="pill">Рефералки</span>
          <h2 className="adminSectionTitle">Начисления по приглашениям</h2><p className="helperText">Вся база начислений: на проверке {adminMoney(overview.rewardTotals.pending)} · доступны {adminMoney(overview.rewardTotals.available)} · отменены {adminMoney(overview.rewardTotals.canceled)}. Статус «доступно» не подтверждает фактическую выплату.</p><AdminQueryFilters view="rewards" statuses={[["PENDING","Проверка"],["AVAILABLE","Доступны"],["CANCELED","Отменены"]]} statusKey="rewardStatus"/>
          <div className="contentStack">
            {overview.rewards.map((reward) => (
              <form key={reward.id} action={updateRewardAction} data-admin-path={`/api/admin/rewards/${reward.id}`} className="panel adminRecordCard">
                <input name="rewardId" type="hidden" value={reward.id} />
                <div className="settingsGrid">
                  <div className="fieldStack">
                    <span className="fieldLabel">Источник</span>
                    <strong>{reward.referrerCode??"Пригласивший не указан"} · {reward.referrerName} → {reward.referredCode} · {reward.referredName}</strong><span className="helperText">Получатель начисления: {reward.beneficiaryCode} · {reward.beneficiaryName}. {reward.sourceType} · основание {reward.sourceId} · доступно с {formatDateTime(reward.availableAt)} МСК</span>
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
          {!overview.rewards.length?<p className="helperText">Начислений пока нет или нет совпадений с фильтрами.</p>:null}<AdminPagination {...overview.registerMeta.rewards} />
        </section>

        <section id="audit" data-admin-results hidden={adminView !== "audit"} className="panel sectionPanel adminSectionPanel">
          <span className="pill">Аудит</span>
          <h2 className="adminSectionTitle">Журнал действий</h2>
          <AdminQueryFilters view="audit" extra/><div className="contentStack">{overview.logs.map(log=><AdminAuditCard key={log.id} log={log}/>)}{!overview.logs.length?<p>Записей по выбранным условиям нет.</p>:null}</div><AdminPagination {...overview.registerMeta.logs}/>
        </section>
        </> : null}
      </section>
    </main></AdminRegisterNavigation>
  );
}
