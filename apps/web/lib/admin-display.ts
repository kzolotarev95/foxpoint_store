export const adminStatusNames: Record<string, string> = {
  ACTIVE: "Активен", BLOCKED: "Заблокирован", PENDING: "Ожидает", DRAFT: "Черновик", EXPIRED: "Истекла", PENDING_ACTIVATION: "Ожидает активации", PAUSED: "На паузе", CANCELLED: "Отменена", CANCELED: "Отменено", SUSPENDED: "Приостановлен", DISABLED: "Отключён", BASIC: "Базовая", EXTENDED: "Расширенная", NONE: "Нет", OPEN: "Новое", IN_PROGRESS: "В работе", WAITING_CLIENT: "Ждём клиента", RESOLVED: "Решено", CLOSED: "Закрыто", CREATED: "Создано", WAITING_PAYMENT: "Ожидает оплаты", PAID: "Оплачено", CONFIGURING: "Подготовка", READY_TO_SHIP: "Готов к отправке", SHIPPED: "Отправлен", RECEIVED: "Получен", REFUND: "Возврат", REFUNDED: "Возвращено", FAILED: "Ошибка", AVAILABLE: "Доступно"
};
export const adminStatus = (value: string) => adminStatusNames[value] ?? value;
export const adminDate = (value: string | null | undefined) => value && Number.isFinite(new Date(value).getTime()) ? `${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))} МСК` : "—";
export const adminMoney = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;
export const adminInputDate = (value: string | null | undefined) => value ? new Date(new Date(value).getTime() + 3 * 3600000).toISOString().slice(0,16) : "";
