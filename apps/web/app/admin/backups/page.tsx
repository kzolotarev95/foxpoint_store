import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminCookieName, readAdminSession } from "../../../lib/admin-auth";
import { getApiBaseUrl } from "../../../lib/api";
import { AdminNavigation } from "../../../components/admin-navigation";
import { AdminBackups } from "../../../components/admin-backups";

export default async function AdminBackupsPage() {
  const token = (await cookies()).get(getAdminCookieName())?.value;
  if (!readAdminSession(token)) redirect("/admin/login");
  const response = await fetch(`${getApiBaseUrl()}/api/admin/backups`, { cache: "no-store", headers: { "x-admin-session": token! } });
  const initial = response.ok ? await response.json() : { jobs: [], busy: false, restoreAvailable: false, error: "Не удалось загрузить список бэкапов." };
  return <main className="shell dashboardShell adminDashboardShell adminDatabaseDashboard">
    <AdminNavigation active="Бэкап" />
    <section className="contentStack adminContentStack">
      <header className="panel adminDatabaseHeader"><span className="pill">Админ-панель</span><h1>Бэкап всей панели</h1><p>Полная копия приложения, базы данных, файлов и настроек для восстановления или переноса на другой сервер.</p></header>
      <AdminBackups initial={initial} />
    </section>
  </main>;
}
