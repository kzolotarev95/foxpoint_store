import Link from "next/link";
import type { ReactNode } from "react";
import { createRouterOrderAction, logoutClientAction } from "../../lib/client-actions";
import { fetchClientApi } from "../../lib/client-auth";
import type { ClientOverview } from "../../lib/portal-types";
import { PortalHeader } from "../../components/portal-header";
import { CabinetNotificationsBell } from "../../components/cabinet-notifications-bell";

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

export default async function CabinetLayout({ children }: { children: ReactNode }) {
  let overview: ClientOverview | null = null;

  try {
    overview = await fetchClientApi<ClientOverview>("/api/me/overview");
  } catch {
    overview = null;
  }

  const userName = overview?.profile.name ?? "Клиент FoxPoint";
  const userInitials = buildUserInitials(userName);

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
              {overview ? <CabinetNotificationsBell notifications={overview.notifications} /> : null}
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
