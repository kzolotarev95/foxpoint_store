import assert from "node:assert/strict";
import Fastify from "fastify";
import { setTimeout as delay } from "node:timers/promises";
import { cpuUsage, linuxMemoryUsage, resourceUsage, createMetricsCollector, collectServerMetrics } from "../apps/api/dist/server-metrics.js";
import { registerServerMetricsRoutes } from "../apps/api/dist/server-metrics-routes.js";
import { createAdminSessionToken, getAdminCookieName } from "../apps/api/dist/admin-auth.js";
import { config } from "../apps/api/dist/config.js";

const core = (user, idle) => ({ model: "Test CPU", speed: 1000, times: { user, nice: 0, sys: 0, irq: 0, idle } });
assert.equal(cpuUsage([core(100, 900), core(200, 800)], [core(125, 975), core(275, 825)]), 50);
assert.equal(cpuUsage([core(10, 90)], [core(10, 190)]), 0);
assert.equal(cpuUsage([core(10, 90)], [core(110, 90)]), 100);
assert.equal(cpuUsage([], []), null);
assert.equal(cpuUsage([core(10, 90)], [core(10, 90)]), null);
assert.equal(cpuUsage([core(10, 90)], [core(0, 0)]), null);
assert.equal(cpuUsage([core(10, 90)], [core(10, 90), core(10, 90)]), null);
const memory = linuxMemoryUsage("MemTotal: 8000 kB\nMemFree: 100 kB\nMemAvailable: 6000 kB\nCached: 5000 kB\n");
assert.equal(memory.usagePercent, 25, "Reclaimable Linux cache must not appear as exhausted RAM");
assert.equal(memory.availableBytes, 6000 * 1024);
assert.equal(linuxMemoryUsage("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 100 kB\nCached: 500 kB\nSReclaimable: 100 kB\nShmem: 50 kB\n").usagePercent, 25);
assert.throws(() => linuxMemoryUsage("MemFree: 100 kB\n"));
assert.throws(() => linuxMemoryUsage("MemTotal: 1000 kB\n"));
assert.equal(resourceUsage(1000, 2000).usagePercent, 0);
assert.equal(resourceUsage(1000, -10).usagePercent, 100);
assert.throws(() => resourceUsage(0, 0));
assert.throws(() => resourceUsage(1000, NaN));

let now = 10000;
let reads = 0;
const collector = createMetricsCollector({
  cpu: async () => { reads++; await delay(15); return { usagePercent: 50, cores: 2, sampleMs: 500 }; },
  memory: async () => memory,
  disk: async () => resourceUsage(10000, 6000)
}, () => now);
const concurrent = await Promise.all(Array.from({ length: 12 }, () => collector()));
assert.equal(reads, 1, "Concurrent admin tabs must share one CPU sample");
assert(concurrent.every(sample => sample === concurrent[0]));
now += 1999; await collector(); assert.equal(reads, 1);
now++; const fresh = await collector(); assert.equal(reads, 2); assert.notEqual(fresh.sampledAt, concurrent[0].sampledAt);
const partial = await createMetricsCollector({ cpu: async () => { throw new Error("CPU unavailable"); }, memory: async () => memory, disk: async () => { throw new Error("Disk unavailable"); } })();
assert.equal(partial.cpu, null); assert.equal(partial.disk, null); assert.deepEqual(partial.memory, memory);

let authorizedReads = 0;
const app = Fastify();
await registerServerMetricsRoutes(app, async () => { authorizedReads++; return fresh; });
try {
  for (const request of [{ remoteAddress: "127.0.0.1" }, { headers: { "x-admin-session": "forged.session" } }, { headers: { cookie: `${getAdminCookieName()}=forged.session` } }]) {
    const response = await app.inject({ url: "/api/admin/server-metrics", ...request });
    assert.equal(response.statusCode, 401); assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal(authorizedReads, 0);
  const token = createAdminSessionToken(config.ADMIN_USERNAME);
  for (const headers of [{ "x-admin-session": token }, { cookie: `${getAdminCookieName()}=${token}` }]) {
    const response = await app.inject({ url: "/api/admin/server-metrics", headers });
    assert.equal(response.statusCode, 200); assert.equal(response.headers["cache-control"], "no-store"); assert.deepEqual(response.json(), fresh);
  }
} finally { await app.close(); }

const actual = await collectServerMetrics();
assert(actual.cpu && actual.memory && actual.disk, "Local OS must provide actual resource readings");
assert(actual.cpu.sampleMs >= 450);
assert(actual.cpu.cores > 0);
for (const resource of [actual.cpu, actual.memory, actual.disk]) assert(resource.usagePercent >= 0 && resource.usagePercent <= 100);
for (const resource of [actual.memory, actual.disk]) {
  assert(resource.totalBytes > 0); assert(resource.availableBytes >= 0); assert.equal(resource.usedBytes + resource.availableBytes, resource.totalBytes);
}
console.log("PASS: CPU interval/idle/full-load calculations, Linux available RAM, disk bounds, concurrent sampling/cache expiry, partial failures, signed sessions and real OS readings.");
