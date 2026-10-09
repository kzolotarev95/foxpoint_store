import { z } from "zod";
import type { SupportType } from "@prisma/client";

export const businessPlanNames = ["Сервер", "Техничка", "Полный", "Самостоятельно", "Индивидуальный"] as const;
export const businessPlanSchema = z.enum(businessPlanNames);
export type BusinessPlan = z.infer<typeof businessPlanSchema>;
export function businessPlan(input: { plan: BusinessPlan; price: number; periodDays?: number; accessEnabled?: boolean; supportType?: SupportType }) {
  const self = input.plan === "Самостоятельно";
  const individual = input.plan === "Индивидуальный";
  const periodDays = individual ? input.periodDays : 30;
  const accessEnabled = individual ? !!input.accessEnabled : ["Сервер", "Полный"].includes(input.plan);
  const supportType: SupportType = individual ? input.supportType ?? "NONE" : ["Техничка", "Полный"].includes(input.plan) ? "BASIC" : "NONE";
  if (!self && (!Number.isFinite(input.price) || input.price <= 0 || input.price > 1000000)) throw new Error("Укажите согласованную цену плана от 0,01 до 1 000 000 ₽.");
  if (!Number.isInteger(periodDays) || !periodDays || periodDays < 1 || periodDays > 3650) throw new Error("Укажите срок индивидуального периода от 1 до 3650 дней.");
  if (individual && !accessEnabled && supportType === "NONE") throw new Error("Укажите состав индивидуального плана.");
  return { accessEnabled: self ? false : accessEnabled, supportType: self ? "NONE" as SupportType : supportType, periodDays, currentPrice: self ? 0 : input.price, priceOverride: self ? 0 : input.price };
}
export function moscowDate(value?: string) {
  if (!value) return new Date();
  const result = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+03:00` : value);
  if (!Number.isFinite(result.getTime()) || result.getTime() > Date.now() + 60000) throw new Error("Дата полученной оплаты должна быть корректной и не находиться в будущем (МСК).");
  return result;
}
