export const SUBSCRIPTION_MONTH_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function extendSubscriptionEnd(endAt: Date | null, days: number, paidAt = new Date()): Date {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Укажите от 1 до 3650 дней.");
  return new Date(Math.max(endAt?.getTime() ?? 0, paidAt.getTime()) + days * DAY_MS);
}
