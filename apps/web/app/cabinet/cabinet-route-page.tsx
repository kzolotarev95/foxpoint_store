import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PortalHeader } from "../../components/portal-header";
import {
  attachProfileEmailAction,
  createRouterOrderAction,
  createSupportTicketAction,
  logoutClientAction,
  requestAccountDeletionAction,
  requestTwoFactorSetupAction,
  renewRouterAction,
  saveProfileCredentialsAction,
  saveRouterTemplateAction
} from "../../lib/client-actions";
import { fetchClientApi } from "../../lib/client-auth";
import type { ClientOverview } from "../../lib/portal-types";

export type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;
export type CabinetTab = "overview" | "routers" | "support" | "payments" | "profile";

type RouterOverviewItem = ClientOverview["routers"][number];
type SupportTicketItem = ClientOverview["tickets"][number];

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

function formatRelativeDateTime(value: string | null | undefined): string {
  if (!value) {
    return "нет данных";
  }

  const target = new Date(value);
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

function formatSupportTicketCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getSupportTicketDisplayCode(id: string): string {
  const hash = Array.from(id).reduce((accumulator, symbol, index) => {
    return accumulator + symbol.charCodeAt(0) * (index + 3);
  }, 0);

  return String((hash % 900) + 100);
}

function getSupportTicketTitle(ticket: SupportTicketItem): string {
  const description = ticket.description.trim();
  const category = ticket.category.trim();

  if (description && description.length <= 42) {
    return description;
  }

  if (category) {
    return category;
  }

  return description.slice(0, 42) || "Обращение в поддержку";
}

function getSupportTicketStatusMeta(status: string): { label: string; tone: "open" | "progress" | "resolved" | "waiting" } {
  const normalized = status.toUpperCase();

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

function getProfileLastActivity(overview: ClientOverview): string | null {
  const dates = [
    overview.notifications[0]?.createdAt,
    overview.payments[0]?.createdAt,
    overview.tickets[0]?.updatedAt,
    overview.profile.createdAt
  ].filter((item): item is string => Boolean(item));

  if (!dates.length) {
    return null;
  }

  return dates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
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
      imageSrc: "/images/router-ax3000t.svg",
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
      imageSrc: "/images/router-wbr3000uax.svg",
      modelLabel: "WBR3000UAX",
      variant
    };
  }

  if (variant === "keenetic") {
    return {
      antennaCount: 2,
      brandLabel: "KEENETIC",
      modelLabel: router.model ?? "Keenetic",
      variant
    };
  }

  if (variant === "cudy") {
    return {
      antennaCount: 6,
      brandLabel: "CUDY",
      modelLabel: router.model ?? "Cudy",
      variant
    };
  }

  return {
    antennaCount: 4,
    brandLabel: "NETIS",
    modelLabel: router.model ?? "Netis",
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

  if (router.currentSubscription?.pendingActivation) {
    return "Ожидает активации";
  }

  if (router.currentSubscription?.status) {
    return statusLabels[router.currentSubscription.status] ?? router.currentSubscription.status;
  }

  if (router.trial?.endAt) {
    return "Тестовый режим";
  }

  return statusLabels[router.status] ?? router.status;
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

function IconShell({ children }: { children: ReactNode }) {
  return <span className="routerIconShell">{children}</span>;
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="8" width="10" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5M10 14 19 5M19 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
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
        <>
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
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

export async function CabinetRoutePage(props: { activeTab: CabinetTab; searchParams: PageSearchParams }) {
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
  const nearestDeadline = getNearestSubscriptionEnd(overview.routers);
  const userInitials = buildUserInitials(overview.profile.name);
  const supportTickets = overview.tickets;
  const isOverviewTab = props.activeTab === "overview";
  const isRoutersTab = props.activeTab === "routers";
  const isSupportTab = props.activeTab === "support";
  const isPaymentsTab = props.activeTab === "payments";
  const isProfileTab = props.activeTab === "profile";
  const telegramHandle = formatTelegramHandle(overview.profile.telegram);
  const latestProfileActivity = overview.profile.lastActivityAt ?? getProfileLastActivity(overview);
  const hasTelegram = Boolean(overview.profile.telegram);
  const profileSessions = [
    {
      id: "cabinet",
      deviceLabel: "Web / Личный кабинет",
      isCurrent: true,
      location: "FOX POINT кабинет",
      timeLabel: "Сейчас",
      icon: <MonitorIcon />
    },
    {
      id: hasTelegram ? "telegram" : "notifications",
      deviceLabel: hasTelegram ? "Telegram / Бот поддержки" : "Email / Уведомления",
      isCurrent: false,
      location: hasTelegram ? telegramHandle : overview.profile.email ?? "Email не привязан",
      timeLabel: hasTelegram ? `с ${formatLongDate(overview.profile.createdAt)}` : formatRelativeDateTime(latestProfileActivity),
      icon: hasTelegram ? <DevicePhoneIcon /> : <MailIcon />
    }
  ];

  return (
    <main className="shell portalPage clientDashboardPage clientRoutersExperience">
      <PortalHeader
        navItems={[
          { href: getCabinetTabHref("overview"), label: "Кабинет", icon: <HomeIcon />, active: isOverviewTab },
          { href: getCabinetTabHref("routers"), label: "Мои роутеры", icon: <RouterIcon />, active: isRoutersTab },
          { href: getCabinetTabHref("support"), label: "Поддержка", icon: <SupportIcon />, active: isSupportTab },
          { href: getCabinetTabHref("payments"), label: "Платежи", icon: <PaymentIcon />, active: isPaymentsTab },
          { href: getCabinetTabHref("profile"), label: "Профиль", icon: <ProfileIcon />, active: isProfileTab }
        ]}
        rightSlot={
          <>
            <Link className="primaryButton portalActionButton portalOrderButton" href="/cabinet#order">
              Заказать роутер
              <CartIcon />
            </Link>
            <span
              className={overview.stats.unreadNotificationCount ? "portalBellButton hasAlert" : "portalBellButton"}
              aria-hidden="true"
            >
              <BellIcon />
            </span>
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
                            <p>{getRouterStatusLabel(router)}</p>
                          </div>
                        </div>

                        <div className="clientRouterFacts">
                          <div className="clientRouterFact">
                            <span className="clientRouterFactLabel">
                              <MonitorIcon />
                              {routerIdentity.label}
                            </span>
                            <strong>{routerIdentity.value}</strong>
                          </div>
                          <div className="clientRouterFact">
                            <span className="clientRouterFactLabel">
                              <ShieldIcon />
                              Поддержка до
                            </span>
                            <strong>{formatDate(router.currentSubscription?.endAt ?? router.trial?.endAt)}</strong>
                          </div>
                          <div className="clientRouterFact">
                            <span className="clientRouterFactLabel">
                              <ServerIcon />
                              Работа сервера до
                            </span>
                            <strong>{formatDate(router.currentSubscription?.endAt ?? router.trial?.endAt)}</strong>
                          </div>
                          <div className="clientRouterFact">
                            <span className="clientRouterFactLabel">
                              <ClockIcon />
                              Последняя проверка
                            </span>
                            <strong>{formatRelativeDateTime(getRouterLastActivity(router))}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="clientRouterActions">
                        <Link className="clientRouterActionButton isGhost" href={`#router-controls-${router.id}`}>
                          <span className="clientRouterActionIcon clientRouterActionIconPlaceholder" aria-hidden="true" />
                          <span className="clientRouterActionLabel">Подробнее</span>
                          <ChevronIcon />
                        </Link>

                        <form action={renewRouterAction}>
                          <input name="routerId" type="hidden" value={router.id} />
                          <input name="returnTo" type="hidden" value="/cabinet/routers" />
                          <button className="clientRouterActionButton isAccent" type="submit">
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

      {isRoutersTab && !!overview.routers.length ? (
        <section className="clientRouterControlsGrid">
          {overview.routers.map((router) => (
            <article key={router.id} className="panel clientRouterControlCard" id={`router-controls-${router.id}`}>
              <div className="clientRouterControlHeader">
                <div>
                  <span className="pill">Управление роутером</span>
                  <h3>{router.displayName}</h3>
                </div>
                <div className="clientRouterControlPrice">{router.savedTemplate.nextPriceLabel}</div>
              </div>

              <div className="clientRouterControlLayout">
                <form action={saveRouterTemplateAction} className="clientRouterSettingsForm">
                  <input name="routerId" type="hidden" value={router.id} />
                  <input name="returnTo" type="hidden" value="/cabinet/routers" />
                  <label className="checkboxRow">
                    <input defaultChecked={router.savedTemplate.accessEnabled} name="accessEnabled" type="checkbox" />
                    <span>Расширенный доступ за {overview.catalog.extendedAccessPrice} ₽</span>
                  </label>

                  <label className="fieldStack">
                    <span className="fieldLabel">Сопровождение</span>
                    <select className="textInput" defaultValue={router.savedTemplate.supportType} name="supportType">
                      <option value="NONE">Без сопровождения</option>
                      <option value="BASIC">Базовое сопровождение</option>
                      <option value="EXTENDED">Расширенное сопровождение</option>
                    </select>
                  </label>

                  <button className="secondaryButton portalGhostButton" type="submit">
                    Сохранить пакет
                  </button>
                </form>

                <div className="clientRouterControlMeta">
                  <div className="clientRouterMiniStat">
                    <span>Текущий пакет</span>
                    <strong>{router.currentPackage}</strong>
                  </div>
                  <div className="clientRouterMiniStat">
                    <span>Следующее продление</span>
                    <strong>{router.savedTemplate.label}</strong>
                  </div>
                  <div className="clientRouterMiniStat">
                    <span>Статус</span>
                    <strong>{getRouterStatusLabel(router)}</strong>
                  </div>
                </div>
              </div>
            </article>
          ))}
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
            <Link className="clientSupportHeroButton isPrimary" href="#support-form">
              <TicketCreateIcon />
              Создать обращение
            </Link>
            <Link className="clientSupportHeroButton isSecondary" href={overview.links.support} target="_blank">
              <TelegramIcon />
              Открыть Telegram
            </Link>
          </div>
        </article>

        <div className="clientSupportGrid">
          <article className="panel clientSupportTicketsCard">
            <h2>Мои обращения</h2>

            {supportTickets.length ? (
              <>
                <div className="clientSupportTicketList">
                  {supportTickets.map((ticket) => {
                    const statusMeta = getSupportTicketStatusMeta(ticket.status);

                    return (
                      <article key={ticket.id} className="clientSupportTicketRow">
                        <span className="clientSupportTicketIcon">
                          <SupportIcon />
                        </span>
                        <div className="clientSupportTicketBody">
                          <h3>
                            #{getSupportTicketDisplayCode(ticket.id)} — {getSupportTicketTitle(ticket)}
                          </h3>
                          <p>Создано {formatSupportTicketCreatedAt(ticket.createdAt)}</p>
                        </div>
                        <span className={`clientSupportStatusBadge is-${statusMeta.tone}`}>
                          {statusMeta.tone === "resolved" ? (
                            <CheckCircleIcon />
                          ) : statusMeta.tone === "waiting" ? (
                            <ClockIcon />
                          ) : (
                            <SupportIcon />
                          )}
                          {statusMeta.label}
                        </span>
                        <span className="clientSupportTicketChevron" aria-hidden="true">
                          <ChevronIcon />
                        </span>
                      </article>
                    );
                  })}
                </div>

                <Link className="clientSupportAllLink" href="#support-form">
                  Создать новое обращение
                </Link>
              </>
            ) : (
              <div className="clientSupportEmptyState">
                <p>Обращений пока нет. Первый запрос можно создать через форму ниже или сразу открыть Telegram.</p>
              </div>
            )}
          </article>

          <article className="panel clientSupportInfoCard">
            <h2>Как мы помогаем</h2>
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
              <div className="profileInlineActions">
                <span className={hasTelegram ? "profileState profileStateLinked" : "profileState"}>
                  {hasTelegram ? "Привязан" : "Не подключен"}
                </span>
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
          <div className="profileSectionHeader">
            <span className="profileSectionIcon">
              <MonitorIcon />
            </span>
            <h2>Активные сессии</h2>
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
                </div>
                <div className="profileSessionMeta">
                  <span>
                    <LocationIcon />
                    {session.location}
                  </span>
                  <span>
                    <ClockIcon />
                    {session.timeLabel}
                  </span>
                </div>
                {session.isCurrent ? (
                  <form action={logoutClientAction}>
                    <button className="secondaryButton portalGhostButton profileMiniButton" type="submit">
                      Завершить
                    </button>
                  </form>
                ) : (
                  <button className="secondaryButton portalGhostButton profileMiniButton" disabled type="button">
                    Завершить
                  </button>
                )}
              </div>
            ))}
          </div>
        </article>

        <article className="panel profileReferralPanel">
          <div className="profileSectionHeader">
            <span className="profileSectionIcon">
              <GiftIcon />
            </span>
            <h2>Реферальная программа</h2>
          </div>

          <div className="profileReferralGrid">
            <div className="profileReferralCodeBlock">
              <span className="profileCardLabel">Ваш реферальный код</span>
              <div className="profileReferralCodeRow">
                <strong>{overview.profile.referralCode}</strong>
                <button className="profileIconButton" title="Копирование добавим следующим шагом" type="button">
                  <CopyIcon />
                </button>
              </div>
            </div>

            <div className="profileReferralMetric">
              <span className="profileCardLabel">Приглашено клиентов</span>
              <strong>{overview.referrals.invitedCount}</strong>
            </div>

            <div className="profileReferralMetric">
              <span className="profileCardLabel">Начислено</span>
              <strong className="isWarm">{overview.referrals.availableRewardsLabel}</strong>
            </div>

            <a className="secondaryButton portalGhostButton profileReferralAction" href={overview.profile.referralLink} target="_blank">
              Открыть реферальную ссылку
              <ExternalLinkIcon />
            </a>
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
      </section>
      ) : null}

      {isOverviewTab || isSupportTab || isPaymentsTab ? (
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
            <input name="returnTo" type="hidden" value="/cabinet" />
            <button className="primaryButton portalActionButton" type="submit">
              Создать заказ
            </button>
          </form>
        </article>
        ) : null}

        {isSupportTab ? (
        <article id="support-form" className="panel sectionPanel clientUtilityCard clientSupportFormCard">
          <span className="pill">Поддержка</span>
          <h2 className="sectionTitle">Создать обращение</h2>
          <form action={createSupportTicketAction} className="contentStack">
            <input name="returnTo" type="hidden" value="/cabinet/support" />
            <label className="fieldStack">
              <span className="fieldLabel">Категория</span>
              <input
                className="textInput"
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
        </article>
        ) : null}

        {isOverviewTab || isPaymentsTab ? (
        <article id="payments" className="panel sectionPanel clientUtilityCard">
          <span className="pill">Платежи</span>
          <h2 className="sectionTitle">Последние оплаты</h2>
          <ul className="list">
            {overview.payments.length ? (
              overview.payments.map((payment) => (
                <li key={payment.id}>
                  {payment.amountLabel} · {payment.status} · {payment.routerName ?? "Заказ роутера"} ·{" "}
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
