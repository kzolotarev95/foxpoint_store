import type { AdminDatabaseQuery } from "./admin-database.js";
import { prisma } from "./prisma.js";

type Row = Record<string, unknown>;
export function registerPage<T extends Row>(rows: T[], input: AdminDatabaseQuery, statusKey?: keyof AdminDatabaseQuery) {
  const normalized = (value: unknown) => String(value ?? "").toLocaleLowerCase("ru-RU").replace(/[\s()+@-]/g, "");
  const needle = normalized(input.q);
  const filtered = rows.filter(row => {
    if (needle && !normalized(row.searchText ?? JSON.stringify(row)).includes(needle)) return false;
    const status = statusKey ? String(input[statusKey] ?? "") : input.recordStatus;
    if (status === "ARCHIVED" ? !row.archivedAt : status && (row.archivedAt || (status === "active_paid" ? !row.paidActive : status === "trial" ? !row.isTrial : status === "open" ? ["CLOSED", "RESOLVED"].includes(String(row.status)) : row.status !== status))) return false;
    if (input.plan && row.plan !== input.plan) return false;
    if (input.city && !normalized(row.city).includes(normalized(input.city))) return false;
    if (input.expiry === "active" && !row.paidActive) return false;
    if (input.expiry === "soon" && !(row.status === "ACTIVE" && !row.archivedAt && !row.pendingActivation && Number(row.daysRemaining ?? 999) > 0 && Number(row.daysRemaining ?? 999) <= 5)) return false;
    if (input.expiry === "expired" && row.status !== "EXPIRED") return false;
    if (input.expiry === "pending" && !row.pendingActivation) return false;
    if (input.expiry === "none" && row.plan !== "Самостоятельно") return false;
    if (input.logAction && !normalized(row.action).includes(normalized(input.logAction))) return false;
    if (input.logAdmin && !normalized(row.admin).includes(normalized(input.logAdmin))) return false;
    if (input.from && String(row.createdAt) < new Date(`${input.from}T00:00:00+03:00`).toISOString()) return false;
    if (input.to && String(row.createdAt) >= new Date(new Date(`${input.to}T00:00:00+03:00`).getTime()+86400000).toISOString()) return false;
    return true;
  });
  filtered.sort((a,b) => input.sort === "name" ? String(a.name ?? a.customerName ?? a.ownerName).localeCompare(String(b.name ?? b.customerName ?? b.ownerName),"ru") : input.sort === "code" ? String(a.routerCode ?? a.clientCode ?? a.number ?? a.id).localeCompare(String(b.routerCode ?? b.clientCode ?? b.number ?? b.id),"ru") : input.sort === "end" ? String(a.endAt ?? "9999").localeCompare(String(b.endAt ?? "9999")) : String(b.createdAt ?? b.updatedAt).localeCompare(String(a.createdAt ?? a.updatedAt)));
  const pageSize = input.pageSize ?? 25, page = Math.min(input.page ?? 1,Math.max(1,Math.ceil(filtered.length/pageSize)));
  return { rows: filtered.slice((page-1)*pageSize,page*pageSize), all: filtered, total: filtered.length, page, pageSize };
}
const hidden = /password|secret|token|authorization|cookie|session|hash/i;
export function safeAudit(value: unknown): unknown {
  if(Array.isArray(value))return value.map(safeAudit);
  if(value && typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,hidden.test(key)?"Скрыто":safeAudit(item)]));
  return value;
}
export async function adminAuditObjects(logs: Array<{entityType:string;entityId:string;beforeData:unknown;afterData:unknown}>) {
  const byType=(type:string)=>logs.filter(l=>l.entityType===type).map(l=>l.entityId);
  const [users,routers,subscriptions,payments,tickets,orders,rewards]=await Promise.all([
    prisma.user.findMany({where:{id:{in:byType("User")}},select:{id:true,name:true,clientCode:true}}),
    prisma.router.findMany({where:{id:{in:byType("Router")}},select:{id:true,routerCode:true,displayName:true}}),
    prisma.subscription.findMany({where:{id:{in:byType("Subscription")}},include:{router:true}}),
    prisma.payment.findMany({where:{id:{in:byType("Payment")}},include:{user:true,router:true}}),
    prisma.supportTicket.findMany({where:{id:{in:byType("SupportTicket")}},select:{id:true,number:true}}),
    prisma.routerOrder.findMany({where:{id:{in:byType("RouterOrder")}},include:{user:true}}),
    prisma.referralReward.findMany({where:{id:{in:byType("ReferralReward")}},include:{beneficiary:true}})
  ]);
  const map=new Map<string,{href:string;label:string}>();
  for(const u of users)map.set(`User:${u.id}`,{href:`/admin?view=database&tab=clients&q=${u.clientCode??u.id}`,label:`${u.clientCode} · ${u.name??"Клиент"}`});
  for(const r of routers)map.set(`Router:${r.id}`,{href:`/admin?view=database&tab=routers&q=${encodeURIComponent(r.routerCode??r.id)}#router-${r.id}`,label:`${r.routerCode} · ${r.displayName}`});
  for(const s of subscriptions)map.set(`Subscription:${s.id}`,{href:`/admin?view=database&tab=subscriptions&q=${s.id}#subscription-${s.id}`,label:`${s.router.routerCode} · ${s.router.displayName}`});
  for(const p of payments)map.set(`Payment:${p.id}`,{href:`/admin?view=payments&q=${p.id}`,label:`${p.user.clientCode} · ${p.router?.routerCode??"Заказ"} · ${Number(p.amount)} ₽`});
  for(const t of tickets)map.set(`SupportTicket:${t.id}`,{href:`/admin?view=tickets&q=${t.id}#ticket-${t.id}`,label:`Обращение №${t.number}`});
  for(const o of orders)map.set(`RouterOrder:${o.id}`,{href:`/admin?view=orders&q=${o.id}#order-${o.id}`,label:`Заказ · ${o.user.clientCode}`});
  for(const r of rewards)map.set(`ReferralReward:${r.id}`,{href:`/admin?view=rewards&q=${r.id}`,label:`Начисление · ${r.beneficiary.clientCode}`});
  return logs.map(l=>map.get(`${l.entityType}:${l.entityId}`)??{href:null,label:`Исторический объект · ${l.entityId}`});
}
