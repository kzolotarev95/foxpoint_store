"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Notice = { id: string; type: string; title: string; detail: string; href: string; createdAt: string; readAt: string | null };
type Feed = { notifications: Notice[]; unreadCount: number; asOf: string; hasMore: boolean };

function BellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4a4 4 0 0 0-4 4v2.4c0 .8-.2 1.7-.7 2.4L6 15h12l-1.3-2.2a4.8 4.8 0 0 1-.7-2.4V8a4 4 0 0 0-4-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
  </svg>;
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
async function responseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось обновить уведомления. Повторите действие.");
  return data;
}

export function CabinetNotificationsBell({ initial }: { initial: Feed }) {
  const [feed, setFeed] = useState(initial);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const request = useRef<AbortController | null>(null);
  const mutating = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    mounted.current = true;
    refresh.current = async () => {
      if (!mounted.current || document.hidden || mutating.current || request.current) return;
      const currentRevision = revision.current;
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const data: Feed = await responseJson(await fetch("/cabinet/notifications", { cache: "no-store", signal: controller.signal }));
        if (mounted.current && revision.current === currentRevision) { setFeed(data); setError(""); }
      } catch (cause) {
        if (mounted.current && revision.current === currentRevision) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Не удалось обновить уведомления. Проверяем соединение…");
      } finally {
        clearTimeout(timeout);
        if (request.current === controller) request.current = null;
      }
    };
    void refresh.current();
    const timer = setInterval(() => { void refresh.current(); }, 5000);
    const visible = () => { if (!document.hidden) void refresh.current(); };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && root.current && !root.current.contains(event.target)) root.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && root.current?.open) { root.current.open = false; root.current.querySelector("summary")?.focus(); } };
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      mounted.current = false; request.current?.abort(); request.current = null;
      if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  async function act(action: "read" | "clear", notificationId?: string) {
    if (mutating.current) return;
    mutating.current = true;
    revision.current++;
    request.current?.abort(); request.current = null;
    setWorking(true); setError(""); setMessage("");
    if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      await responseJson(await fetch(`/cabinet/notifications/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before: feed.asOf, ...(notificationId ? { notificationId } : {}) }), signal: controller.signal
      }));
      const data: Feed = await responseJson(await fetch("/cabinet/notifications", { cache: "no-store", signal: controller.signal }));
      if (mounted.current) {
        setFeed(data);
        setMessage(action === "clear" ? "Список очищен. Новые события появятся здесь." : notificationId ? "Уведомление прочитано." : "Уведомления прочитаны.");
        feedbackTimeout.current = setTimeout(() => { if (mounted.current) setMessage(""); }, 5000);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Не удалось обновить уведомления. Повторите действие.");
    } finally {
      clearTimeout(timeout); mutating.current = false;
      if (mounted.current) setWorking(false);
    }
  }

  return <details className="portalNotifications" ref={root} onToggle={() => { if (root.current?.open) void refresh.current(); }}>
    <summary className={feed.unreadCount ? "portalBellButton hasAlert" : "portalBellButton"} aria-label={feed.unreadCount ? `Открыть уведомления: непрочитанных ${feed.unreadCount}` : "Открыть уведомления"}>
      <BellIcon />
      {feed.unreadCount ? <span className="portalBellBadge">{feed.unreadCount > 99 ? "99+" : feed.unreadCount}</span> : null}
    </summary>
    <div className="portalNotificationPopover" aria-label="Уведомления и входы">
      <div className="portalNotificationHeader">
        <div className="portalNotificationHeading">
          <strong>Уведомления и входы</strong>
          <span>{feed.unreadCount ? `Непрочитанных: ${feed.unreadCount}.` : "Все уведомления прочитаны."} Обновляются автоматически.</span>
        </div>
        <span className="portalNotificationCount">{feed.unreadCount}</span>
      </div>
      {error ? <p className="portalNotificationFeedback errorText" role="alert">{error}</p> : null}
      {message ? <p className="portalNotificationFeedback" role="status">{message}</p> : null}
      <div className="portalNotificationList">
        {feed.notifications.length ? feed.notifications.map(notice => <div key={notice.id} className={notice.readAt ? "portalNotificationItem" : "portalNotificationItem isUnread"}>
          <span className="portalNotificationIcon" aria-hidden="true"><BellIcon /></span>
          <span className="portalNotificationBody">
            <Link href={notice.href} onClick={() => { if (!notice.readAt) void act("read", notice.id); if (root.current) root.current.open = false; }}><strong>{notice.title}</strong></Link>
            <span className="portalNotificationText">{notice.detail}</span>
            <span className="portalNotificationMeta">{formatDate(notice.createdAt)} · {notice.readAt ? "Прочитано" : "Новое"}</span>
            {!notice.readAt ? <button type="button" className="portalNotificationMarkRead" disabled={working} onClick={() => { void act("read", notice.id); }}>Прочитать</button> : null}
          </span>
        </div>) : <div className="portalNotificationEmpty">Новых событий пока нет. Ответы поддержки и входы будут появляться здесь.</div>}
      </div>
      <div className="portalNotificationFooter">
        {feed.hasMore ? <span className="portalNotificationFooterNote">Показаны последние 50 событий. Кнопки ниже применяются ко всему списку.</span> : null}
        <div className="portalNotificationFooterActions">
          <button type="button" className="secondaryButton portalGhostButton portalNotificationRead" disabled={working || !feed.unreadCount} onClick={() => { void act("read"); }}>Прочитать все</button>
          <button type="button" className="secondaryButton portalGhostButton portalNotificationClear" disabled={working || !feed.notifications.length} onClick={() => { void act("clear"); }}>Очистить список</button>
        </div>
      </div>
    </div>
  </details>;
}
