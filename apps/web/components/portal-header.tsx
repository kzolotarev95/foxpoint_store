"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

type PortalNavItem = {
  active?: boolean;
  href: string;
  icon?: ReactNode;
  label: string;
};

type PortalHeaderProps = {
  brandHref?: string;
  navItems?: PortalNavItem[];
  rightSlot?: ReactNode;
};

export function PortalHeader({
  brandHref = "/",
  navItems = [],
  rightSlot
}: PortalHeaderProps) {
  const pathname = usePathname();
  const brandContent = (
    <>
      <Image alt="" aria-hidden="true" height={40} src="/images/foxpoint-logo.png" width={40} />
      <span className="brandWordmark">
        <strong>FOX POINT</strong>
      </span>
    </>
  );

  return (
    <header className="portalTopBar panel">
      <Link className="brandMark" href={brandHref} prefetch scroll={false}>
        {brandContent}
      </Link>

      {navItems.length ? (
        <nav aria-label="Основная навигация" className="portalNav">
          {navItems.map((item) => {
            const isActive = item.active ?? (pathname === item.href || pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.href}
                className={isActive ? "portalNavLink isActive" : "portalNavLink"}
                href={item.href}
                prefetch
                scroll={false}
              >
                {item.icon ? <span className="portalNavIcon">{item.icon}</span> : null}
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {rightSlot ? <div className="portalActions">{rightSlot}</div> : null}
    </header>
  );
}
