import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const database=process.env.ADMIN_TEST_DATABASE_URL;
if(!database||new URL(database).hostname!=="127.0.0.1"||!new URL(database).pathname.includes("admin_test"))throw new Error("Disposable local admin_test database required.");
process.env.DATABASE_URL=database;
const {prisma}=await import("../apps/api/dist/prisma.js");
const before=await import(pathToFileURL(resolve(".codex-temp/working-register-before/apps/api/dist/portal.js")));
const after=await import("../apps/api/dist/portal.js");
const prefix=`measure-${randomUUID()}`;
const customers=Array.from({length:1000},(_,i)=>({id:`${prefix}-${i}`,clientCode:`CLI-MEASURE-${i}`,name:prefix,isTest:true}));
try{
 await prisma.user.createMany({data:customers});
 await prisma.router.createMany({data:customers.map((u,i)=>({id:`router-${u.id}`,ownerUserId:u.id,displayName:`MEASURE-${i}`,routerCode:u.clientCode,serviceTariff:"Самостоятельно"}))});
 const query={q:prefix,tab:"routers",pageSize:25};
 const results={fixtureClients:1000,fixtureRouters:1000,pageSize:25,samples:3};
 for(const [name,implementation] of [["before",before],["after",after]]){
  await implementation.buildAdminOverview(query);
  const times=[];let payload;
  for(let i=0;i<3;i++){const start=performance.now();payload=await implementation.buildAdminOverview(query);times.push(Math.round(performance.now()-start));}
  results[name]={milliseconds:times,medianMs:times.sort((a,b)=>a-b)[1],bytes:Buffer.byteLength(JSON.stringify(payload)),returnedRouters:payload.routers.length};
 }
 results.qr={beforeInitialImages:0,afterInitialImages:0,reason:"Both versions create QR only on the label route. The new list adds a common tools switch and bounded URL cache; no QR speed gain is claimed."};
 await writeFile(resolve(".codex-temp/admin-register-performance.json"),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await prisma.user.deleteMany({where:{id:{in:customers.map(u=>u.id)}}});await prisma.$disconnect();}
