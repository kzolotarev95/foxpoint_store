"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function AdminSingleDisclosure(props: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const hasDirty = () => !!root.current?.querySelector('form[data-dirty="true"]');

  useEffect(() => {
    const close = (event: Event) => {
      if ((event as CustomEvent).detail === root.current || !open) return;
      if (hasDirty() && !window.confirm("Есть несохранённые изменения. Закрыть карточку? Введённые данные останутся до ухода со страницы.")) event.preventDefault();
      else setOpen(false);
    };
    document.addEventListener("admin-disclosure-open", close);
    return () => { document.removeEventListener("admin-disclosure-open", close); };
  }, [open]);

  return (
    <details ref={root} className="adminClientDisclosure" open={open}>
      <summary className="adminClientSummary" onClick={event => {
        event.preventDefault();
        if (open && hasDirty() && !window.confirm("Есть несохранённые изменения. Свернуть карточку?")) return;
        if (!open && !document.dispatchEvent(new CustomEvent("admin-disclosure-open", { detail: root.current, cancelable: true }))) return;
        setOpen(!open);
      }}>{props.summary}</summary>
      <div className="adminClientDisclosureBody">{props.children}</div>
    </details>
  );
}
