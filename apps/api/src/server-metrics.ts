import { cpus, freemem, totalmem, type CpuInfo } from "node:os";
import { readFile, statfs } from "node:fs/promises";
import { parse, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type ResourceUsage = { totalBytes: number; usedBytes: number; availableBytes: number; usagePercent: number };
export type ServerMetrics = {
  sampledAt: string;
  environment: "vps" | "local";
  cpu: { usagePercent: number; cores: number; sampleMs: number } | null;
  memory: ResourceUsage | null;
  disk: ResourceUsage | null;
};

const clamp = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value));
const percent = (value: number) => Math.round(clamp(value, 100) * 10) / 10;

export function cpuUsage(before: CpuInfo[], after: CpuInfo[]): number | null {
  if (!before.length || before.length !== after.length) return null;
  let total = 0;
  let idle = 0;
  for (let index = 0; index < before.length; index++) {
    const elapsed = Object.values(after[index].times).reduce((sum, value) => sum + value, 0) - Object.values(before[index].times).reduce((sum, value) => sum + value, 0);
    const inactive = after[index].times.idle - before[index].times.idle;
    if (elapsed < 0 || inactive < 0 || inactive > elapsed) return null;
    total += elapsed; idle += inactive;
  }
  return total > 0 ? percent((total - idle) / total * 100) : null;
}

export function resourceUsage(totalBytes: number, availableBytes: number): ResourceUsage {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(availableBytes)) throw new Error("Resource counters unavailable");
  availableBytes = clamp(availableBytes, totalBytes);
  const usedBytes = totalBytes - availableBytes;
  return { totalBytes, usedBytes, availableBytes, usagePercent: percent(usedBytes / totalBytes * 100) };
}

export function linuxMemoryUsage(source: string): ResourceUsage {
  const fields = new Map([...source.matchAll(/^([A-Za-z_()]+):\s+(\d+)\s+kB\s*$/gm)].map(match => [match[1], Number(match[2]) * 1024]));
  const total = fields.get("MemTotal");
  if (!total) throw new Error("Memory counters unavailable");
  let available = fields.get("MemAvailable");
  // Old kernels lack MemAvailable; reclaimable cache should still not appear as exhausted RAM.
  if (available === undefined && fields.has("MemFree")) available = fields.get("MemFree")! + (fields.get("Buffers") ?? 0) + (fields.get("Cached") ?? 0) + (fields.get("SReclaimable") ?? 0) - (fields.get("Shmem") ?? 0);
  if (available === undefined) throw new Error("Available memory counter unavailable");
  return resourceUsage(total, available);
}

async function readCpu(): Promise<ServerMetrics["cpu"]> {
  const before = cpus();
  const started = performance.now();
  await delay(500);
  const after = cpus();
  const usagePercent = cpuUsage(before, after);
  return usagePercent === null ? null : { usagePercent, cores: after.length, sampleMs: Math.round(performance.now() - started) };
}
async function readMemory(): Promise<ResourceUsage> {
  return process.platform === "linux" ? linuxMemoryUsage(await readFile("/proc/meminfo", "utf8")) : resourceUsage(totalmem(), freemem());
}
async function readDisk(): Promise<ResourceUsage> {
  const path = process.platform === "linux" ? "/" : parse(resolve(process.env.FOXPOINT_APP_ROOT ?? process.cwd())).root;
  const stats = await statfs(path);
  return resourceUsage(stats.blocks * stats.bsize, stats.bavail * stats.bsize);
}

type Readers = { cpu: () => Promise<ServerMetrics["cpu"]>; memory: () => Promise<ResourceUsage>; disk: () => Promise<ResourceUsage> };
export function createMetricsCollector(readers: Readers = { cpu: readCpu, memory: readMemory, disk: readDisk }, now: () => number = Date.now) {
  let cached: ServerMetrics | undefined;
  let sampledAt = 0;
  let pending: Promise<ServerMetrics> | undefined;
  return async (): Promise<ServerMetrics> => {
    if (cached && now() - sampledAt < 2000) return cached;
    if (pending) return pending;
    pending = (async () => {
      const [cpu, memory, disk] = await Promise.allSettled([readers.cpu(), readers.memory(), readers.disk()]);
      sampledAt = now();
      cached = { sampledAt: new Date(sampledAt).toISOString(), environment: process.platform === "linux" ? "vps" : "local",
        cpu: cpu.status === "fulfilled" ? cpu.value : null,
        memory: memory.status === "fulfilled" ? memory.value : null,
        disk: disk.status === "fulfilled" ? disk.value : null };
      return cached;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
export const collectServerMetrics = createMetricsCollector();
