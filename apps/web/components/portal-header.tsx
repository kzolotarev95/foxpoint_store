import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

type PortalNavItem = {
  active?: boolean;
  href: string;
  label: string;
};

type PortalHeaderProps = {
  navItems?: PortalNavItem[];
  rightSlot?: ReactNode;
  subtitle?: string;
};

export function PortalHeader({ navItems = [], rightSlot, subtitle }: PortalHeaderProps) {
  return (
    <header className="portalTopBar panel">
      <Link className="brandMark" href="/">
        <Image alt="" aria-hidden="true" height={34} src="/apple-touch-icon.png" width={34} />
        <span className="brandWordmark">
          <strong>FOX POINT</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </span>
      </Link>

      {navItems.length ? (
        <nav aria-label="Основная навигация" className="portalNav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={item.active ? "portalNavLink isActive" : "portalNavLink"}
              href={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {rightSlot ? <div className="portalActions">{rightSlot}</div> : null}
    </header>
  );
}
