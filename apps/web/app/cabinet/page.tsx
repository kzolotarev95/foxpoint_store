import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PortalHeader } from "../../components/portal-header";
import {
  createRouterOrderAction,
  createSupportTicketAction,
  logoutClientAction,
  renewRouterAction,
  saveRouterTemplateAction
} from "../../lib/client-actions";
import { fetchClientApi } from "../../lib/client-auth";
import type { ClientOverview } from "../../lib/portal-types";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

type RouterOverviewItem = ClientOverview["routers"][number];

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
  const nearestDeadline = getNearestSubscriptionEnd(overview.routers);
  const userInitials = buildUserInitials(overview.profile.name);

  return (
    <main className="shell portalPage clientDashboardPage clientRoutersExperience">
      <PortalHeader
        navItems={[
          { href: "#overview", label: "Кабинет", icon: <HomeIcon /> },
          { href: "#routers", label: "Мои роутеры", icon: <RouterIcon />, active: true },
          { href: "#support", label: "Поддержка", icon: <SupportIcon /> },
          { href: "#payments", label: "Платежи", icon: <PaymentIcon /> },
          { href: "#profile", label: "Профиль", icon: <ProfileIcon /> }
        ]}
        rightSlot={
          <>
            <Link className="primaryButton portalActionButton portalOrderButton" href="#order">
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

      <section id="overview" className="clientRoutersHero">
        <div className="clientRoutersLead">
          <h1>Все ваши роутеры в одном месте.</h1>
          <p>
            Смотрите оборудование, сроки обслуживания и работу серверов без лишней
            путаницы.
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
                    <button className="primaryButton portalActionButton" type="submit">
                      Заказать роутер
                    </button>
                  </form>
                  <Link className="secondaryButton portalGhostButton" href={overview.links.support} target="_blank">
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
                          <button className="clientRouterActionButton isAccent" type="submit">
                            <span className="clientRouterActionIcon">
                              <ServerIcon />
                            </span>
                            <span className="clientRouterActionLabel">Продлить</span>
                            <ChevronIcon />
                          </button>
                        </form>

                        <Link className="clientRouterActionButton isGhost" href={overview.links.support} target="_blank">
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

          <aside className="clientRoutersMascot">
            <Image
              alt="Лис FOX POINT"
              className="clientRoutersMascotImage"
              height={1280}
              priority
              src="/images/foxpoint-cabinet-fox.png"
              width={1280}
            />
          </aside>
        </div>
      </section>

      {!!overview.routers.length ? (
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

      <section className="clientDashboardLowerGrid">
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
            <button className="primaryButton portalActionButton" type="submit">
              Создать заказ
            </button>
          </form>
        </article>

        <article id="support" className="panel sectionPanel clientUtilityCard">
          <span className="pill">Поддержка</span>
          <h2 className="sectionTitle">Создать обращение</h2>
          <form action={createSupportTicketAction} className="contentStack">
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
              <strong>{overview.profile.telegram ?? "Еще не привязан"}</strong>
            </div>
            <div className="clientRouterMiniStat">
              <span>Реферальный код</span>
              <strong>{overview.profile.referralCode}</strong>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
