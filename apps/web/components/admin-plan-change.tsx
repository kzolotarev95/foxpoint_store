"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminOverview } from "../lib/portal-types";
import { adminDate, adminInputDate, adminMoney } from "../lib/admin-display";

type Router = AdminOverview["routers"][number];
type Subscription = AdminOverview["subscriptions"][number];
const plans = ["Сервер","Техничка","Полный","Самостоятельно","Индивидуальный"];
export function AdminPlanChange({ router, subscriptions }: { router: Router; subscriptions: Router["services"] }) {
  const [open,setOpen]=useState(false); const [plan,setPlan]=useState(router.serviceTariff ?? "Сервер");
  const [price,setPrice]=useState(router.planPrice); const [period,setPeriod]=useState(router.planPeriodDays);
  const [operation,setOperation]=useState("plan_only"); const [policy,setPolicy]=useState("preserve");
  const [amount,setAmount]=useState(router.planPrice); const [days,setDays]=useState(30);
  const [subscriptionId,setSubscriptionId]=useState(subscriptions.length === 1 ? subscriptions[0].id : "");
  const [end,setEnd]=useState(""); const [effective,setEffective]=useState(adminInputDate(new Date().toISOString()));
  const [paidAt,setPaidAt]=useState(adminInputDate(new Date().toISOString()));
  const [key,setKey]=useState(""); const [confirmed,setConfirmed]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);
  useEffect(()=>{setKey(crypto.randomUUID());},[]);
  const selected=useMemo(()=>subscriptions.find(s=>s.id===subscriptionId),[subscriptionId,subscriptions]);
  const nextTime=Math.max(new Date(selected?.endAt ?? 0).getTime(),new Date(`${effective}:00+03:00`).getTime(),new Date(`${paidAt}:00+03:00`).getTime())+days*86400000;
  const nextEnd=policy==="explicit" ? end ? `${end}:00+03:00` : null : policy==="extend" && !selected?.pendingActivation && selected?.startAt ? Number.isFinite(nextTime)?new Date(nextTime).toISOString():null : selected?.endAt ?? null;
  function choose(value:string) { setPlan(value); const p=value==="Самостоятельно"?0:value==="Индивидуальный"?0:value==="Полный"?2000:1000; setPrice(p); setAmount(p); setConfirmed(false); if(value==="Самостоятельно"){setOperation("plan_only");setPolicy("preserve");} }
  function close(){if(formRef.current?.dataset.dirty && !window.confirm("Закрыть несохранённую форму изменения плана?"))return;setOpen(false);setKey(crypto.randomUUID());setConfirmed(false);}
  return <section className="adminPlanChange">
    <button className="primaryButton" type="button" onClick={()=>{if(open)close();else{setOpen(true);setConfirmed(false);}}}>Изменить план</button>
    {open ? <form ref={formRef} data-admin-path={`/api/admin/routers/${router.id}/plan-change`} className="contentStack" onChange={()=>setConfirmed(false)} onSubmit={event=>{ if(!confirmed) event.preventDefault(); }}>
      <h3>Изменить план · {router.routerCode} · {router.displayName}</h3>
      <input type="hidden" name="requestKey" value={key}/>
      <div className="settingsGrid">
        <label><span className="fieldLabel">Новый план</span><select className="textInput" name="plan" value={plan} onChange={e=>choose(e.target.value)}>{plans.map(p=><option key={p}>{p}</option>)}</select></label>
        <label><span className="fieldLabel">Согласованная цена периода, ₽</span><input className="textInput" name="price" type="number" value={price} onChange={e=>setPrice(Number(e.target.value))} min={plan==="Самостоятельно"?0:0.01} max="1000000" step="0.01" required/></label>
        <label><span className="fieldLabel">Период · дней</span><input className="textInput" type="number" name="periodDays" min="1" max="3650" value={plan==="Индивидуальный"?period:30} readOnly={plan!=="Индивидуальный"} onChange={e=>setPeriod(Number(e.target.value))}/></label>
        <label><span className="fieldLabel">Начало изменения · МСК</span><input className="textInput" type="datetime-local" name="effectiveAt" value={effective} onChange={e=>setEffective(e.target.value)} required/></label>
        <label><span className="fieldLabel">Что регистрируем</span><select className="textInput" name="operation" value={operation} onChange={e=>{ setOperation(e.target.value);setPolicy("preserve"); }}><option value="plan_only">Смена плана без новой оплаты</option><option value="received_payment" disabled={plan==="Самостоятельно"}>Зафиксировать полученную оплату</option><option value="correction">Исправить ранее записанную ручную операцию</option></select></label>
        <label><span className="fieldLabel">Правило оплаченного срока</span><select className="textInput" name="termPolicy" value={policy} onChange={e=>setPolicy(e.target.value)}><option value="preserve">Сохранить оплаченный срок без начисления дней</option>{operation==="received_payment"?<option value="extend">Добавить явно согласованные дни</option>:null}<option value="explicit">Указать согласованное окончание вручную</option></select></label>
        <label><span className="fieldLabel">Изменяемая услуга</span><select className="textInput" name="subscriptionId" value={subscriptionId} onChange={e=>setSubscriptionId(e.target.value)}><option value="">Новая услуга / выбрать</option>{subscriptions.map(s=><option key={s.id} value={s.id}>{s.accessEnabled?"Сервер":""}{s.supportType!=="NONE"?" + сопровождение":""} · {adminDate(s.endAt)}</option>)}</select></label>
        {policy==="explicit"?<label><span className="fieldLabel">Согласованное окончание · МСК</span><input className="textInput" type="datetime-local" name="endAt" value={end} onChange={e=>setEnd(e.target.value)} required/></label>:null}
        {operation!=="plan_only"?<><label><span className="fieldLabel">Полученная / исправленная сумма, ₽</span><input className="textInput" name="amount" type="number" min="0.01" max="1000000" step="0.01" required value={amount} onChange={e=>setAmount(Number(e.target.value))}/></label><label><span className="fieldLabel">Дата получения · МСК</span><input className="textInput" name="paidAt" type="datetime-local" value={paidAt} onChange={e=>setPaidAt(e.target.value)} required/></label></>:null}
        {policy==="extend"?<label><span className="fieldLabel">Согласованные оплаченные дни</span><input className="textInput" name="days" type="number" min="1" max="3650" value={days} onChange={e=>setDays(Number(e.target.value))} required/></label>:null}
        {operation==="correction"?<label><span className="fieldLabel">ID прежней ручной оплаты из журнала</span><input className="textInput" name="paymentId" required/></label>:null}
        <label><span className="fieldLabel">Способ / основание</span><input className="textInput" name="method" defaultValue="Ручная регистрация" minLength={2} maxLength={120} required/></label>
      </div>
      {plan==="Индивидуальный"?<><label className="checkboxRow"><input type="checkbox" name="accessEnabled" defaultChecked={router.planAccessEnabled}/> Сервер в индивидуальном плане</label><label><span className="fieldLabel">Индивидуальное сопровождение</span><select className="textInput" name="supportType" defaultValue={router.planSupportType}><option value="NONE">Нет</option><option value="BASIC">Базовое</option><option value="EXTENDED">Расширенное</option></select></label></>:null}
      <label><span className="fieldLabel">Причина / примечание</span><textarea className="textAreaInput" name="reason" minLength={8} maxLength={1000} required/></label>
      <div className="panel adminInfoCard"><strong>{router.serviceTariff ?? router.savedTemplate} → {plan} · {adminMoney(price)} / {plan==="Индивидуальный"?period:30} дней</strong><p>Срок: {adminDate(selected?.endAt)} → {plan==="Самостоятельно"?"Без подписки":adminDate(nextEnd)}. {selected?.pendingActivation && policy==="extend"?`До активации удерживается ${(selected.pendingDays ?? 0)+days} дней.`:""}</p><p className="helperText">{plan==="Самостоятельно"?"Подписки прекращаются; история сохраняется.":`${["Сервер","Полный"].includes(plan)?"Серверный доступ":"Без серверного доступа"}; ${["Техничка","Полный"].includes(plan)?"сопровождение включено":"без сопровождения; индивидуальный состав задаётся отдельно"}.`}</p><p className="helperText">Пропорциональный перерасчёт не выполняется. Остальные устройства клиента сохраняют свои условия. Исправление старой операции не создаёт новое поступление.</p></div>
      <label className="checkboxRow"><input name="conditionsConfirmed" required checked={confirmed} type="checkbox" onChange={e=>{e.stopPropagation();setConfirmed(e.target.checked);}}/> Проверены новый план, оплата и правило сохранения срока</label>
      <div className="ctaRow"><button className="primaryButton" type="submit" disabled={!confirmed||!key} data-confirm={`Сохранить изменение плана ${router.routerCode} · ${router.displayName}?`}>Подтвердить изменение</button><button className="secondaryButton" type="button" onClick={close}>Закрыть / новая операция</button></div>
    </form>:null}
  </section>;
}
export function AdminPaymentForm({ subscription, price }: { subscription: Subscription; price: number }) {
  const period=subscription.periodDays??30;
  const [days,setDays]=useState(period),[amount,setAmount]=useState(price),[custom,setCustom]=useState(period!==30);
  const [key,setKey]=useState(""); const [date,setDate]=useState(adminInputDate(new Date().toISOString()));
  useEffect(()=>{setKey(crypto.randomUUID());},[]);
  const nextTime=Math.max(new Date(subscription.endAt ?? 0).getTime(),new Date(`${date}:00+03:00`).getTime())+days*86400000;
  const end=subscription.pendingActivation||!Number.isFinite(nextTime)?null:new Date(nextTime).toISOString();
  return <form data-admin-path={`/api/admin/subscriptions/${subscription.id}/payments`} className="contentStack">
    <h4>Зафиксировать полученную оплату</h4><input type="hidden" name="requestKey" value={key}/>
    <label><span className="fieldLabel">Оплаченный срок</span><select className="textInput" value={custom?"custom":String(days)} onChange={e=>{const individual=e.target.value==="custom";setCustom(individual);if(!individual){const d=Number(e.target.value);setDays(d);setAmount(Number((price*d/period).toFixed(2)));}}}>{[30,90,180,360].map(d=><option key={d} value={d}>{d} суток · {adminMoney(price*d/period)}</option>)}<option value="custom">Индивидуальные условия · период {period} дней</option></select></label>
    <div className="settingsGrid"><label><span className="fieldLabel">Полученная сумма, ₽</span><input className="textInput" type="number" min="0.01" max="1000000" step="0.01" name="amount" value={amount} onChange={e=>setAmount(Number(e.target.value))} required/></label><label><span className="fieldLabel">Оплаченные дни</span><input className="textInput" type="number" name="days" min="1" max="3650" value={days} readOnly={!custom} onChange={e=>setDays(Number(e.target.value))} required/></label><label><span className="fieldLabel">Дата оплаты · МСК</span><input className="textInput" name="paidAt" type="datetime-local" value={date} onChange={e=>setDate(e.target.value)} required/></label><label><span className="fieldLabel">Способ</span><select className="textInput" name="method"><option>Перевод</option><option>Наличные</option><option>Банковский платёж</option><option>Другой согласованный способ</option></select></label></div>
    <label><span className="fieldLabel">Основание / примечание</span><input className="textInput" name="reason" minLength={8} maxLength={1000} required/></label>
    <p className="helperText">{adminDate(subscription.endAt)} → {subscription.pendingActivation?`Удерживается ${(subscription.pendingDays??0)+days} дней до активации`:adminDate(end)}. Сумма {adminMoney(amount)}. Остаток сохраняется; стандартный период равен ровно 30 суткам.</p>
    <button className="primaryButton" type="submit" disabled={!key} data-confirm="Зарегистрировать уже полученную оплату? Повторное сохранение этой операции не добавит деньги или дни второй раз.">Записать оплату</button><button className="secondaryButton" type="button" onClick={()=>{if(window.confirm("Новая отдельная оплата? Это создаст другой ключ операции; прежняя оплата уже должна быть сохранена."))setKey(crypto.randomUUID());}}>Следующая отдельная оплата</button>
  </form>;
}
