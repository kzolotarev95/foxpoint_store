import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminCookieName } from "../lib/admin-auth";

async function logout() {
  "use server";
  (await cookies()).delete(getAdminCookieName());
  redirect("/admin/login");
}

const items = [
  ["/admin#overview", "Сводка"],
  ["/admin?view=database&tab=clients", "База данных"],
  ["/admin/backups", "Бэкап"],
  ["/admin#assign", "Привязать роутер"],
  ["/admin#orders", "Заказы"],
  ["/admin#tickets", "Обращения"],
  ["/admin#rewards", "Рефералки"],
  ["/admin#audit", "Аудит"],
  ["/admin#Платежи", "Настройки"]
];

export function AdminNavigation({ active }: { active: string }) {
  return <aside className="panel sideNav" aria-label="Навигация по админке">
    <span className="pill">Навигация</span>
    <ul>{items.map(([href, label]) => <li key={href}><Link className="adminSideNavLink" aria-current={label === active ? "page" : undefined} href={href}>
      <span className="adminSideNavIcon" aria-hidden="true">{label === "Бэкап" ? <svg viewBox="0 0 24 24"><path d="M5 3h12l3 3v15H4V3h1Zm2 0v7h10V3M7 21v-7h10v7" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg> : <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>}</span>
      <span className="adminSideNavLabel">{label}</span>
    </Link></li>)}</ul>
    <div className="contentStack"><Link className="secondaryButton fullWidthButton" href="/">На главную</Link><form action={logout}><button className="secondaryButton fullWidthButton" type="submit">Выйти</button></form></div>
  </aside>;
}
