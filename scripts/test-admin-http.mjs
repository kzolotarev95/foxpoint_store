import assert from "node:assert/strict";
import { createAdminSessionToken } from "../apps/api/dist/admin-auth.js";
const api = process.env.ADMIN_HTTP_API ?? "http://127.0.0.1:4000";
const web = process.env.ADMIN_HTTP_WEB ?? "http://127.0.0.1:3000";
for (const value of [api, web]) if (new URL(value).hostname !== "127.0.0.1") throw new Error("This smoke test is local-only.");
for (const path of ["/api/admin/overview", "/api/admin/database/export","/api/admin/payments","/api/admin/routers/missing/label"]) {
  assert.equal((await fetch(api + path)).status, 401);
  assert.equal((await fetch(api + path, { headers: { "x-admin-session": "forged" } })).status, 401);
}
for (const path of ["/admin/database/export", "/admin/database/action"]) assert.equal((await fetch(web + path, path.endsWith("action") ? { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" } : {})).status, 401);
const token = createAdminSessionToken(process.env.ADMIN_USERNAME ?? "admin");
const headers = { "x-admin-session": token };
const overviewResponse = await fetch(api + "/api/admin/overview?pageSize=25", { headers });
assert.equal(overviewResponse.status, 200);
const overview = await overviewResponse.json();
assert(overview.clients.length <= 25); assert(overview.clientCount >= overview.clients.length);
if(overview.routers.length){
  const device=overview.routers[0];
  const label=await fetch(api+`/api/admin/routers/${device.id}/label`,{headers});assert.equal(label.status,200);assert.equal((await label.json()).router.routerCode,device.routerCode);
  const first=await fetch(web+`/admin/routers/${device.id}/label`,{headers:{cookie:`foxpoint_admin_session=${token}`}});assert.equal(first.status,200);const html=await first.text();assert(html.includes(device.routerCode));assert.equal((html.match(/<img[^>]+src="data:image\/png;base64/g)??[]).length,1);
  const second=await fetch(web+`/admin/routers/${device.id}/label`,{headers:{cookie:`foxpoint_admin_session=${token}`}});assert.equal((await second.text()).match(/data:image\/png;base64[^" ]+/)?.[0],html.match(/data:image\/png;base64[^" ]+/)?.[0]);
}
const payments=await fetch(api+"/api/admin/payments",{headers});assert.equal(payments.status,200);
const output = await fetch(web + "/admin/database/export?pageSize=25", { headers: { cookie: `foxpoint_admin_session=${token}` } });
assert.equal(output.status, 200); assert.match(output.headers.get("content-type"), /spreadsheetml/);
assert.equal(Buffer.from(await output.arrayBuffer()).subarray(0, 2).toString(), "PK");
const deniedOrigin = await fetch(web + "/admin/database/action", { method: "POST", headers: { cookie: `foxpoint_admin_session=${token}`, origin: "http://example.invalid", "Content-Type": "application/json" }, body: "{}" });
assert.equal(deniedOrigin.status, 403);
console.log("PASS: admin API requires a real session, forged/anonymous access denied, authenticated overview and XLSX export work, cross-origin mutation denied.");
