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
  const brandSubtitle = subtitle ?? "Интернет должен просто работать.";

  return (
    <header className="portalTopBar panel">
      <Link className="brandMark" href="/">
        <Image alt="" aria-hidden="true" height={40} src="/images/foxpoint-logo.png" width={40} />
        <span className="brandWordmark">
          <strong>FOX POINT</strong>
          <span>{brandSubtitle}</span>
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
