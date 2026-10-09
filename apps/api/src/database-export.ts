import { makeXlsx } from "./xlsx.js";
type ExportDatabase = {
  clientCount: number;
  selection: { routers: number; periodPrice: number; payments: number };
  clients: Array<{
    clientCode: string | null;
    name: string | null;
    phone: string | null;
    city: string | null;
    status: string;
    serviceState: string;
    devices: Array<{
      routerCode: string | null;
      displayName: string;
      plan: string;
      price: number;
      status: string;
      subscriptions: Array<{ endAt: string | null; daysRemaining: number | null; status: string }>;
    }>;
  }>;
  dashboard: { month: string; confirmedPaymentsLabel: string; nextMonthForecastLabel: string };
};

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function exportDatabase(data: ExportDatabase, format: "csv" | "xlsx") {
  const rows: unknown[][] = [
    ["FOX POINT — база клиентов", `Сводка за ${data.dashboard.month}`, `Оплачено: ${data.dashboard.confirmedPaymentsLabel}`, `Прогноз: ${data.dashboard.nextMonthForecastLabel}`],
    [],
    ["CLI-ID", "Имя", "Телефон", "Город", "Роутер / объект", "Код роутера", "План", "Цена периода", "Статус роутера", "Подписки до (МСК)", "Остаток дней", "Состояние услуги", "Состояние клиента"]
  ];
  for (const client of data.clients) {
    for (const router of client.devices.length ? client.devices : [{ routerCode: "", displayName: "", plan: "", price: 0, status: "", subscriptions: [] }]) {
      rows.push([client.clientCode, client.name, client.phone, client.city, router.displayName, router.routerCode, router.plan,
        router.price, router.status, router.subscriptions.map(s => s.endAt ? new Date(s.endAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : s.status).join("; "), router.subscriptions.map(s => s.daysRemaining ?? "—").join("; "), client.serviceState, client.status]);
    }
  }
  rows.push([], ["ИТОГО клиентов", data.clientCount, "Роутеров", data.selection.routers, "Цена периодов, ₽", data.selection.periodPrice, "Оплаты месяца, ₽", data.selection.payments]);
  if (format === "xlsx") return { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: makeXlsx(rows) };
  const body = "\uFEFF" + rows.map(row => row.map(value => csvCell(typeof value === "string" && /^[=+@-]/.test(value) ? "'" + value : value)).join(";")).join("\r\n") + "\r\n";
  return { contentType: "text/csv; charset=utf-8", body };
}
