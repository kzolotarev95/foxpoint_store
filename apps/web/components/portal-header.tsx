import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

type PortalNavItem = {
  active?: boolean;
  href: string;
  icon?: ReactNode;
  label: string;
};

type PortalHeaderProps = {
  brandHref?: string;
  navItems?: PortalNavItem[];
  reloadBrandOnClick?: boolean;
  rightSlot?: ReactNode;
};

export function PortalHeader({
  brandHref = "/",
  navItems = [],
  reloadBrandOnClick = false,
  rightSlot
}: PortalHeaderProps) {
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
      {reloadBrandOnClick ? (
        <a className="brandMark" href={brandHref}>
          {brandContent}
        </a>
      ) : (
        <Link className="brandMark" href={brandHref}>
          {brandContent}
        </Link>
      )}

      {navItems.length ? (
        <nav aria-label="Основная навигация" className="portalNav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={item.active ? "portalNavLink isActive" : "portalNavLink"}
              href={item.href}
            >
              {item.icon ? <span className="portalNavIcon">{item.icon}</span> : null}
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {rightSlot ? <div className="portalActions">{rightSlot}</div> : null}
    </header>
  );
}
