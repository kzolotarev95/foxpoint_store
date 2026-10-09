"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function AdminFormGuard() {
  const router = useRouter();
  const [confirmation,setConfirmation] = useState<string|null>(null);
  const pendingConfirmation = useRef<((accepted:boolean)=>void)|null>(null);
  function answer(accepted:boolean) {
    const resolve=pendingConfirmation.current;
    pendingConfirmation.current=null;
    setConfirmation(null);
    resolve?.(accepted);
  }
  useEffect(() => {
    const confirmAction=(message:string)=>new Promise<boolean>(resolve=>{
      if(pendingConfirmation.current){resolve(false);return;}
      pendingConfirmation.current=resolve;
      setConfirmation(message);
    });
    const dirty = new Set<HTMLFormElement>();
    const hasDirty = () => { for (const form of dirty) if (!form.isConnected || !form.dataset.dirty) dirty.delete(form); return dirty.size > 0; };
    const change = (event: Event) => { const form = (event.target as HTMLElement).closest<HTMLFormElement>("form[data-admin-path]"); if (form) { dirty.add(form); form.dataset.dirty = "true"; } };
    const nestedClose = (event: MouseEvent) => {
      const summary = (event.target as HTMLElement).closest("details.adminClientEdit > summary");
      const details = summary?.parentElement as HTMLDetailsElement | null;
      if (details?.open && details.querySelector('form[data-dirty="true"]') && !window.confirm("Есть несохранённые изменения. Свернуть форму?")) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => { if (hasDirty()) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => { if ((event.target as HTMLElement).closest("a[href]:not([data-admin-query-link])") && hasDirty() && !window.confirm("Есть несохранённые изменения. Покинуть страницу?")) event.preventDefault(); };
    const submit = async (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement;
      if (!form.dataset.adminPath) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (form.dataset.saving) return;
      const button = event.submitter as HTMLButtonElement | null;
      if (!button?.formNoValidate && !form.reportValidity()) return;
      if (button?.dataset.confirm && !await confirmAction(button.dataset.confirm)) return;
      const path = button?.dataset.adminPath ?? form.dataset.adminPath;
      const body: Record<string, string | boolean> = {};
      for (const [key, value] of new FormData(form)) if (typeof value === "string" && key !== "returnTo") body[key] = value;
      form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach(input => { body[input.name] = input.checked; });
      if (/^\/api\/admin\/routers\/[^/]+$/.test(path!) && !body.applyPlan) for (const key of ["serviceTariff", "planPrice", "planPeriodDays", "planAccessEnabled", "planSupportType"]) delete body[key];
      delete body.applyPlan;
      let message = form.querySelector<HTMLElement>(".adminFormResult");
      if (!message) { message = document.createElement("p"); message.className = "adminFormResult helperText"; message.setAttribute("role", "status"); form.append(message); }
      message.textContent = "Сохраняем…"; form.dataset.saving = "true";
      const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")].map(button => ({ button, disabled: button.disabled })); buttons.forEach(({ button }) => { button.disabled = true; });
      try {
        const isSettings=path==="/api/admin/settings";
        const response = await fetch("/admin/database/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, body: isSettings?{settings:Object.fromEntries(Object.entries(body).filter(([key])=>key!=="group").map(([key,value])=>[key,String(value)]))}:body }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить запись.");
        dirty.delete(form); delete form.dataset.dirty; form.dispatchEvent(new CustomEvent("admin-form-saved", { bubbles: true })); message.textContent = "Сохранено.";
        form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input=>{input.value="";}); router.refresh();
      } catch (error) { message.textContent = error instanceof Error ? error.message : "Сбой соединения. Данные остаются в форме."; }
      finally { delete form.dataset.saving; buttons.forEach(({ button, disabled }) => { button.disabled = disabled; }); }
    };
    document.addEventListener("input", change); document.addEventListener("change", change); document.addEventListener("submit", submit, true); document.addEventListener("click", click, true); document.addEventListener("click", nestedClose, true); window.addEventListener("beforeunload", unload);
    return () => { pendingConfirmation.current?.(false); pendingConfirmation.current=null; document.removeEventListener("input", change); document.removeEventListener("change", change); document.removeEventListener("submit", submit, true); document.removeEventListener("click", click, true); document.removeEventListener("click", nestedClose, true); window.removeEventListener("beforeunload", unload); };
  }, [router]);
  return confirmation?<div className="adminUnsavedOverlay"><section className="panel" role="alertdialog" aria-modal="true" aria-labelledby="admin-action-title" onKeyDown={event=>{if(event.key==="Escape")answer(false);}}><h2 id="admin-action-title">Подтверждение действия</h2><p>{confirmation}</p><div className="ctaRow"><button type="button" className="secondaryButton" autoFocus onClick={()=>answer(false)}>Отмена</button><button type="button" className="primaryButton" onClick={()=>answer(true)}>Подтвердить действие</button></div></section></div>:null;
}
