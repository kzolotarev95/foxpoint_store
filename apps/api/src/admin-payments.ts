import type { AdminDatabaseQuery } from "./admin-database.js";
import { prisma } from "./prisma.js";
import { registerPage } from "./admin-register.js";
const purposes:Record<string,string>={router_order:"Покупка и подготовка роутера",subscription_renewal:"Продление услуги",plan_change:"Смена плана роутера"};
export async function adminPayments(input:AdminDatabaseQuery) {
  const payments=await prisma.payment.findMany({include:{user:true,router:true},orderBy:{createdAt:"desc"}});
  const mapped=payments.map(p=>({id:p.id,clientCode:p.user.clientCode,customerName:p.user.name,routerCode:p.router?.routerCode??null,routerName:p.router?.displayName??null,
    amount:Number(p.amount),status:p.status,provider:p.provider,paidAt:p.paidAt?.toISOString()??null,refundedAt:p.refundedAt?.toISOString()??null,createdAt:p.createdAt.toISOString(),
    days:p.daysAdded,purpose:purposes[(p.payloadSnapshot as {type?:string}|null)?.type??""]??"Назначение требует уточнения",
    method:(p.payloadSnapshot as {method?:string}|null)?.method??p.provider,reason:(p.payloadSnapshot as {reason?:string}|null)?.reason??null,
    imported:p.provider==="client_register_import",searchText:[p.id,p.user.name,p.user.clientCode,p.router?.routerCode,p.router?.displayName,p.user.phone].join(" ")}));
  const page=registerPage(mapped,{...input,plan:"",city:"",expiry:""});
  return {payments:page.rows,total:page.total,page:page.page,pageSize:page.pageSize,sum:page.all.filter(p=>p.status==="PAID"&&!p.imported).reduce((sum,p)=>sum+p.amount,0)};
}
