"use client";

import { useState, type FormEvent } from "react";

type TicketConversationMessage = {
  authorRole: "ADMIN" | "CLIENT";
  body: string;
  createdAt: string;
  id: string;
};

type TicketConversationProps = {
  adminLabel: string;
  closed: boolean;
  closedLabel: string;
  clientLabel: string;
  replyActionUrl: string;
  replyButtonLabel: string;
  replyPlaceholder: string;
  ticketId: string;
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
  closed,
  closedLabel,
  clientLabel,
  messages: initialMessages,
  replyActionUrl,
  replyButtonLabel,
  replyPlaceholder,
  ticketId
}: TicketConversationProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = message.trim();
    if (!trimmed || isSending || closed) {
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
    <div className="clientSupportThreadBody">
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

      {closed ? (
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
