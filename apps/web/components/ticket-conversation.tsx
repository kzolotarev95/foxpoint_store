"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type TicketConversationMessage = {
  authorRole: "ADMIN" | "CLIENT";
  body: string;
  createdAt: string;
  id: string;
};

type TicketConversationProps = {
  adminLabel: string;
  closedLabel: string;
  clientLabel: string;
  replyActionUrl: string;
  replyButtonLabel: string;
  replyPlaceholder: string;
  ticketId: string;
  refreshUrl: string;
  status: string;
  messages: TicketConversationMessage[];
};

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

export function TicketConversation({
  adminLabel,
  closedLabel,
  clientLabel,
  messages: initialMessages,
  replyActionUrl,
  replyButtonLabel,
  replyPlaceholder,
  refreshUrl,
  status: initialStatus,
  ticketId
}: TicketConversationProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [ticketStatus, setTicketStatus] = useState(initialStatus);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const syncInFlight = useRef(false);
  const threadBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(initialMessages);
    setTicketStatus(initialStatus);
  }, [initialMessages, initialStatus]);

  useEffect(() => {
    if (ticketStatus !== "CLOSED") {
      return;
    }

    const detailsElement = threadBodyRef.current?.closest("details");
    if (detailsElement instanceof HTMLDetailsElement) {
      detailsElement.open = false;
    }
  }, [ticketStatus]);

  useEffect(() => {
    let active = true;

    const syncTicket = async () => {
      if (syncInFlight.current) {
        return;
      }

      syncInFlight.current = true;

      try {
        const response = await fetch(refreshUrl, {
          headers: {
            Accept: "application/json"
          },
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              messages?: TicketConversationMessage[];
              status?: string;
            }
          | null;

        if (!active || !payload?.messages || !payload.status) {
          return;
        }

        setMessages(payload.messages);
        setTicketStatus(payload.status);
      } catch {
        // Ignore transient sync issues.
      } finally {
        syncInFlight.current = false;
      }
    };

    void syncTicket();
    const interval = window.setInterval(() => {
      void syncTicket();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = message.trim();
    if (!trimmed || isSending || ticketStatus === "CLOSED") {
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("ticketId", ticketId);
      formData.set("message", trimmed);

      const response = await fetch(replyActionUrl, {
        body: formData,
        headers: {
          Accept: "application/json"
        },
        method: "POST"
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; message?: TicketConversationMessage }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Не удалось отправить сообщение.");
        return;
      }

      if (payload?.message) {
        setMessages((current) => [...current, payload.message as TicketConversationMessage]);
      }

      setMessage("");
    } catch {
      setError("Не удалось отправить сообщение.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div ref={threadBodyRef} className="clientSupportThreadBody">
      <div className="clientSupportMessageList">
        {messages.map((item) => (
          <article
            key={item.id}
            className={item.authorRole === "ADMIN" ? "clientSupportMessage isAdmin" : "clientSupportMessage isClient"}
          >
            <div className="clientSupportMessageBubble">
              <div className="clientSupportMessageMeta">
                <strong>{item.authorRole === "ADMIN" ? adminLabel : clientLabel}</strong>
                <span>{formatMessageTime(item.createdAt)}</span>
              </div>
              <p>{item.body}</p>
            </div>
          </article>
        ))}
      </div>

      {ticketStatus === "CLOSED" ? (
        <div className="clientSupportClosedNote">{closedLabel}</div>
      ) : (
        <form className="clientSupportReplyForm" onSubmit={handleSubmit}>
          <textarea
            className="textInput clientSupportReplyInput"
            disabled={isSending}
            maxLength={3000}
            minLength={1}
            name="message"
            onChange={(event) => setMessage(event.target.value)}
            placeholder={replyPlaceholder}
            required
            rows={1}
            value={message}
          />
          <button className="primaryButton portalActionButton clientSupportReplyButton" disabled={isSending} type="submit">
            {isSending ? "..." : replyButtonLabel}
          </button>
        </form>
      )}

      {error ? <div className="clientSupportClosedNote">{error}</div> : null}
    </div>
  );
}
