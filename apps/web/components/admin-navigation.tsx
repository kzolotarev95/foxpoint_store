import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminCookieName } from "../lib/admin-auth";

async function logout() {
  "use server";
  (await cookies()).delete(getAdminCookieName());
  redirect("/admin/login");
}

const items = [
  ["/admin", "Сводка"],
  ["/admin?view=database&tab=clients", "База данных"],
  ["/admin/backups", "Бэкап"],
  ["/admin?view=assign", "Привязать роутер"],
  ["/admin?view=orders", "Заказы"],
  ["/admin?view=tickets", "Обращения"],
  ["/admin?view=rewards", "Рефералки"],
  ["/admin?view=audit", "Аудит"],
  ["/admin?view=payments", "Журнал оплат"]
];

function AdminNavIcon({ label }: { label: string }) {
  const paths: Record<string, ReactNode> = {
    "Сводка": <path d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-3H4v3Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />,
    "База данных": <path d="M5 6.2C5 4.99 8.13 4 12 4s7 .99 7 2.2v11.6c0 1.21-3.13 2.2-7 2.2s-7-.99-7-2.2V6.2Zm0 0c0 1.21 3.13 2.2 7 2.2s7-.99 7-2.2M5 12c0 1.21 3.13 2.2 7 2.2s7-.99 7-2.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
    "Бэкап": <path d="M5 3h12l3 3v15H4V3h1Zm2 0v7h10V3M7 21v-7h10v7" fill="none" stroke="currentColor" strokeWidth="1.8" />,
    "Привязать роутер": <path d="m9.2 14.8 5.6-5.6m-7.1 8.2-1.1 1.1a3.2 3.2 0 1 1-4.5-4.5l3-3a3.2 3.2 0 0 1 4.5 0m2.6-3.7 1.1-1.1a3.2 3.2 0 0 1 4.5 4.5l-3 3a3.2 3.2 0 0 1-4.5 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
    "Заказы": <path d="M4 5h2l1.2 9.2a2 2 0 0 0 2 1.8h7.3a2 2 0 0 0 1.9-1.4L20 8H7m4 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
    "Обращения": <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4.2a2.5 2.5 0 0 1-2.5-2.5v-6.8Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />,
    "Рефералки": <path d="M8.2 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7.6 1.3a2.5 2.5 0 1 0 0-5m-11 11.2c0-2.4 1.5-4.2 3.4-4.2h3.9c1.9 0 3.4 1.8 3.4 4.2M15 14.2h2.3c1.7 0 3 1.4 3 3.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
    "Аудит": <path d="M12 3 19 6v5.1c0 4.2-2.8 7.8-7 9.9-4.2-2.1-7-5.7-7-9.9V6l7-3Zm0 4v4m0 4v.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
    "Журнал оплат": <path d="M4 7h16v11H4V7Zm3-3h10v3H7V4Zm1 7h8m-8 3h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[label] ?? <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" />}</svg>;
}

export function AdminNavigation({ active }: { active: string }) {
  return <aside className="panel sideNav" aria-label="Навигация по админке">
    <Link className="adminBrandLockup" href="/admin" aria-label="FOX POINT — админская панель">
      <Image src="/images/foxpoint-logo.png" alt="" width={44} height={44} priority />
      <span><strong>FOX <em>POINT</em></strong><small>Панель управления</small></span>
    </Link>
    <span className="pill adminNavCaption">Навигация</span>
    <ul>{items.map(([href, label]) => <li key={href}><Link className="adminSideNavLink" aria-current={label === active ? "page" : undefined} href={href}>
      <span className="adminSideNavIcon"><AdminNavIcon label={label} /></span>
      <span className="adminSideNavLabel">{label}</span>
    </Link></li>)}</ul>
    <details className="adminNavSettings" open={active === "Настройки"}><summary>Настройки</summary><ul>{["Платежи","Продажи","Подписки","Пробный период","Рефералы","Коммуникации"].map(group=><li key={group}><Link className="adminSideNavLink" href={`/admin?view=settings#${encodeURIComponent(group)}`}>{group==="Платежи"?"Настройки оплаты":group}</Link></li>)}</ul></details>
    <div className="contentStack"><Link className="secondaryButton fullWidthButton" href="/login">Вход в клиентский кабинет</Link><form action={logout}><button className="secondaryButton fullWidthButton" type="submit">Выйти</button></form></div>
  </aside>;
}
