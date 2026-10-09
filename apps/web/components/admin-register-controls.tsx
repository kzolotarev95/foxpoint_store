"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function AdminRegisterNavigation({ children }: { children: ReactNode }) {
  const router = useRouter(); const path = usePathname(); const params = useSearchParams(); const [pending, start] = useTransition();
  const location = `${path}?${params}`;
  const previous = useRef(location);
  const [pendingHref,setPendingHref]=useState<string|null>(null);
  const anchor = useRef<{ top: number; name: string; start: number | null; end: number | null } | null>(null);
  useEffect(() => {
    if (previous.current === location) return;
    previous.current = location;
    const saved = anchor.current; anchor.current = null;
    if (!saved) return;
    requestAnimationFrame(() => {
      const section = [...document.querySelectorAll<HTMLElement>('[data-admin-results]')].find(item=>item.getClientRects().length);
      if (section) window.scrollBy({ top: section.getBoundingClientRect().top - saved.top, behavior: "instant" });
      const field = [...document.querySelectorAll<HTMLInputElement>(`input[name]`)].find(input => input.name === saved.name && input.getClientRects().length);
      field?.focus({ preventScroll: true });
      if (field?.type === "search" && saved.start !== null) field.setSelectionRange(saved.start, saved.end);
    });
  }, [location]);
  function navigate(href: string, confirmed=false) {
    if(!confirmed){
      const field = document.activeElement as HTMLInputElement | null;
      const section=[...document.querySelectorAll<HTMLElement>('[data-admin-results]')].find(item=>item.getClientRects().length);
      anchor.current = { top: section?.getBoundingClientRect().top ?? 0, name: field?.name || "q", start: field?.selectionStart ?? null, end: field?.selectionEnd ?? null };
      if(document.querySelector('form[data-dirty="true"]')){setPendingHref(href);return;}
    }
    setPendingHref(null);
    start(() => router.push(href, { scroll: false }));
  }
  return <div className="adminRegisterNavigation" aria-busy={pending} onSubmitCapture={event => {
    const form = event.target as HTMLFormElement;
    if (form.dataset.adminQuery === undefined) return;
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key,value] of new FormData(form)) if (typeof value === "string" && value) next.set(key,value);
    navigate(`/admin?${next}`);
  }} onClickCapture={event => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-admin-query-link]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault(); navigate(link.href);
  }}>{pending ? <p className="helperText adminRegisterUpdating" role="status">Обновляем результаты…</p> : null}{pendingHref?<div className="adminUnsavedOverlay"><section className="panel" role="alertdialog" aria-modal="true" aria-labelledby="admin-unsaved-title"><h2 id="admin-unsaved-title">Есть несохранённые изменения</h2><p>При обновлении списка открытая форма может закрыться. Продолжить без сохранения?</p><div className="ctaRow"><button className="secondaryButton" type="button" autoFocus onClick={()=>{setPendingHref(null);anchor.current=null;}}>Вернуться к форме</button><button className="primaryButton" type="button" onClick={()=>navigate(pendingHref,true)}>Обновить список без сохранения</button></div></section></div>:null}{children}</div>;
}
export function AdminQrToggle() {
  const [enabled,setEnabled] = useState(false);
  useEffect(() => { document.documentElement.dataset.adminQr = enabled ? "shown" : "hidden"; return () => { delete document.documentElement.dataset.adminQr; }; }, [enabled]);
  return <button type="button" className="secondaryButton" aria-pressed={enabled} onClick={() => setEnabled(!enabled)}>{enabled ? "Скрыть QR-инструменты" : "Показать QR-инструменты"}</button>;
}
export function AdminQrTools({ id, code, name }: { id: string; code: string | null; name: string }) {
  return code ? <div className="ctaRow adminQrTools"><span className="helperText">{code} · {name}</span><Link className="secondaryButton" prefetch={false} target="_blank" href={`/support?router=${encodeURIComponent(code)}`}>Ссылка поддержки</Link><Link className="secondaryButton" prefetch={false} target="_blank" href={`/admin/routers/${id}/label`}>QR / печатная табличка</Link></div> : null;
}
export function AdminQueryFilters({ view = "database", tab = "clients", statuses = [], statusKey = "recordStatus", extra = false }: { view?: string; tab?: string; statuses?: Array<[string,string]>; statusKey?: string; extra?: boolean }) {
  const params = useSearchParams();
  return <form key={params.toString()} action="/admin" data-admin-query className="adminRegisterFilters">
    <input type="hidden" name="view" value={view}/>{view === "database" ? <input type="hidden" name="tab" value={tab}/> : null}
    <input type="hidden" name="month" value={params.get("month") ?? ""}/>
    <label><span className="fieldLabel">Поиск: имя, CLI, SPB, контакт</span><input className="textInput" name="q" type="search" defaultValue={params.get("q") ?? ""}/></label>
    {view === "database" ? <><label><span className="fieldLabel">План</span><select name="plan" className="textInput" defaultValue={params.get("plan") ?? ""}><option value="">Все планы</option>{["Сервер","Техничка","Полный","Самостоятельно","Индивидуальный"].map(p=><option key={p}>{p}</option>)}</select></label><label><span className="fieldLabel">Город</span><input className="textInput" name="city" defaultValue={params.get("city") ?? ""}/></label></> : null}
    {statuses.length ? <label><span className="fieldLabel">Состояние</span><select className="textInput" name={statusKey} defaultValue={params.get(statusKey) ?? ""}><option value="">Все</option>{statuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label> : null}
    {view === "database" ? <label><span className="fieldLabel">Срок услуги</span><select className="textInput" name="expiry" defaultValue={params.get("expiry") ?? ""}><option value="">Любой</option><option value="active">Активная платная</option><option value="soon">До 5 дней</option><option value="expired">Истекла</option><option value="pending">Ожидает активации</option><option value="none">Без подписки</option></select></label> : null}
    {extra ? <><label><span className="fieldLabel">Тип события</span><input className="textInput" name="logAction" defaultValue={params.get("logAction") ?? ""}/></label><label><span className="fieldLabel">Администратор</span><input className="textInput" name="logAdmin" defaultValue={params.get("logAdmin") ?? ""}/></label><label><span className="fieldLabel">С даты · МСК</span><input className="textInput" name="from" type="date" defaultValue={params.get("from") ?? ""}/></label><label><span className="fieldLabel">По дату · МСК</span><input className="textInput" name="to" type="date" defaultValue={params.get("to") ?? ""}/></label></> : null}
    <label><span className="fieldLabel">Сортировка</span><select className="textInput" name="sort" defaultValue={params.get("sort") ?? "created"}><option value="created">Новые сначала</option><option value="name">Имя</option><option value="code">Код</option><option value="end">Ближайший срок</option></select></label>
    <label><span className="fieldLabel">На странице</span><select className="textInput" name="pageSize" defaultValue={params.get("pageSize") ?? "25"}>{[25,50,100].map(v=><option key={v}>{v}</option>)}</select></label>
    <div className="ctaRow"><button className="secondaryButton" type="submit">Применить</button><Link data-admin-query-link className="secondaryButton" scroll={false} href={`/admin?view=${view}${view === "database" ? `&tab=${tab}` : ""}`}>Сбросить фильтры</Link></div>
  </form>;
}
export function AdminStickySearch({children}:{children:ReactNode}) {
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=root.current;
    if(!element)return;
    const observer=new ResizeObserver(()=>{
      const sticky=getComputedStyle(element).position==="sticky";
      element.parentElement?.style.setProperty("--admin-search-height",sticky?`${element.getBoundingClientRect().height}px`:"0px");
    });
    observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  return <div className="adminStickySearch" ref={root}>{children}</div>;
}
export function AdminPagination({ total, page, pageSize }: { total: number; page: number; pageSize: number }) {
  const params = useSearchParams(); const pages = Math.max(1,Math.ceil(total/pageSize));
  function href(next:number) { const q = new URLSearchParams(params.toString()); q.set("page",String(next)); return `/admin?${q}`; }
  return <nav className="adminPagination"><span>Найдено {total} · страница {page} из {pages}</span><div className="ctaRow">{page>1?<Link data-admin-query-link scroll={false} className="secondaryButton" href={href(page-1)}>Назад</Link>:null}{page<pages?<Link data-admin-query-link scroll={false} className="secondaryButton" href={href(page+1)}>Далее</Link>:null}</div></nav>;
}
