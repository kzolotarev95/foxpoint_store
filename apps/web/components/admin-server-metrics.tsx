"use client";

import { useEffect, useState, type ReactNode } from "react";

type Usage = { totalBytes: number; usedBytes: number; availableBytes: number; usagePercent: number };
type Metrics = { sampledAt: string; environment: "vps" | "local"; cpu: { usagePercent: number; cores: number; sampleMs: number } | null; memory: Usage | null; disk: Usage | null };
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const bytes = (value: number) => value >= 1024 ** 3 ? `${number.format(value / 1024 ** 3)} ГБ` : `${number.format(value / 1024 ** 2)} МБ`;

function ResourceIcon({ kind }: { kind: "cpu" | "memory" | "disk" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {kind === "cpu" ? <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 9h6v6H9zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" /></> : kind === "memory" ? <><rect x="3" y="5" width="18" height="13" rx="2" /><path d="M7 9v5m5-5v5m5-5v5M7 18v3m5-3v3m5-3v3" /></> : <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 14h18m-4 3h1m-5 0h1" /></>}
  </svg>;
}

function MetricCard({ kind, label, value, detail, usage, stale }: { kind: "cpu" | "memory" | "disk"; label: string; value: ReactNode; detail: string; usage: number | null; stale: boolean }) {
  const tone = usage !== null && usage >= 90 ? "critical" : usage !== null && usage >= 75 ? "warning" : "normal";
  return <div className="adminServerMetric" data-tone={tone} data-stale={stale}>
    <div className="adminServerMetricLabel"><ResourceIcon kind={kind} /><span>{label}</span></div>
    <strong className="adminServerMetricValue">{value}</strong>
    <div className="adminServerMetricMeter" role="meter" aria-label={`${label}: занято`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage ?? undefined} aria-valuetext={usage === null ? "Нет данных" : `${number.format(usage)}%`}><span style={{ width: `${usage ?? 0}%` }} /></div>
    <span className="adminServerMetricDetail">{detail}</span>
  </div>;
}

export function AdminServerMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [lastSuccess, setLastSuccess] = useState(0);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let controller: AbortController | undefined;
    async function update() {
      if (disposed || document.hidden || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 6500);
      try {
        const response = await fetch("/admin/server-metrics", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? "Войдите в админку повторно" : "Нет связи с сервером");
        const current = await response.json() as Metrics;
        if (!disposed) { setMetrics(current); setError(""); setLastSuccess(Date.now()); setClock(Date.now()); }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Нет связи с сервером");
      } finally { clearTimeout(timeout); inFlight = false; }
    }
    function visibilityChanged() { setPaused(document.hidden); if (!document.hidden) { setClock(Date.now()); void update(); } }
    setPaused(document.hidden);
    void update();
    const timer = setInterval(() => { setClock(Date.now()); void update(); }, 3000);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => { disposed = true; clearInterval(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, []);
  const stale = Boolean(error) || Boolean(lastSuccess && clock - lastSuccess > 10000);
  const incomplete = Boolean(metrics && (!metrics.cpu || !metrics.memory || !metrics.disk));
  const status = error || (paused ? "Обновление на паузе" : stale ? "Данные устарели" : incomplete ? "Часть данных недоступна" : metrics ? "Обновляется каждые 3 с" : "Получаем показатели…");
  const title = metrics?.environment === "local" ? "Ресурсы · локальный компьютер" : "Ресурсы VPS";
  const missing = metrics ? "Нет данных" : "Загрузка…";
  return <section className="adminServerMetrics" aria-label="Ресурсы сервера">
    <div className="adminServerMetricsHeader"><span>{title}</span><span className="adminServerMetricsStatus" data-status={stale || incomplete ? "error" : paused ? "paused" : metrics ? "live" : "loading"}><i aria-hidden="true" />{status}</span></div>
    <div className="adminServerMetricsGrid">
      <MetricCard kind="cpu" label="ЦП" value={metrics?.cpu ? `${number.format(metrics.cpu.usagePercent)}%` : "—"} detail={metrics?.cpu ? `Нагрузка · ядер: ${metrics.cpu.cores}` : missing} usage={metrics?.cpu?.usagePercent ?? null} stale={stale} />
      <MetricCard kind="memory" label="ОЗУ" value={metrics?.memory ? `${number.format(metrics.memory.usagePercent)}%` : "—"} detail={metrics?.memory ? `${bytes(metrics.memory.usedBytes)} из ${bytes(metrics.memory.totalBytes)}` : missing} usage={metrics?.memory?.usagePercent ?? null} stale={stale} />
      <MetricCard kind="disk" label="Диск" value={metrics?.disk ? bytes(metrics.disk.availableBytes) : "—"} detail={metrics?.disk ? `Свободно из ${bytes(metrics.disk.totalBytes)}` : missing} usage={metrics?.disk?.usagePercent ?? null} stale={stale} />
    </div>
    {metrics ? <span className="adminServerMetricsTime">Последние данные: {new Date(metrics.sampledAt).toLocaleTimeString("ru-RU",{timeZone:"Europe/Moscow"})} МСК</span> : null}
  </section>;
}
