import Link from "next/link";
import { dashboardSections } from "../../components/site-data";

const routers = [
  {
    name: "Роутер дома",
    model: "Netis NX31",
    plan: "Расширенный доступ + расширенное сопровождение",
    expiry: "30.09.2026",
    remaining: "42 дня"
  },
  {
    name: "Роутер у родителей",
    model: "Keenetic Hopper",
    plan: "Базовое сопровождение",
    expiry: "12.09.2026",
    remaining: "24 дня"
  }
];

const metrics = [
  { label: "Активных роутеров", value: "2", note: "Оба привязаны к одному клиенту" },
  { label: "Ближайшее продление", value: "12.09", note: "Не теряем устройство из вида" },
  { label: "Баланс", value: "1 000 ₽", note: "Готов для внутренних начислений" }
];

export default function CabinetPage() {
  return (
    <main className="shell dashboardShell">
      <aside className="panel sideNav">
        <span className="pill">Личный кабинет</span>
        <ul>
          {dashboardSections.map((section) => (
            <li key={section}>
              <a href={`#${section}`}>{section}</a>
            </li>
          ))}
        </ul>
      </aside>

      <section className="contentStack">
        <article className="panel hero">
          <span className="statusTag">Каркас клиента</span>
          <h1 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "54px", lineHeight: 1 }}>
            Кабинет уже собран вокруг реальной логики ТЗ.
          </h1>
          <p>
            Здесь заложены разделы под несколько роутеров, подписки, заказы, поддержку, рефералов и
            профиль. Следующий шаг — подключить эти блоки к реальному API.
          </p>
          <div className="ctaRow">
            <Link className="primaryButton" href="/">
              На главную
            </Link>
            <Link className="secondaryButton" href="/admin">
              В админку
            </Link>
          </div>
        </article>

        <section className="miniGrid">
          {metrics.map((metric) => (
            <article key={metric.label} className="panel metricCard">
              <div className="muted">{metric.label}</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {metric.value}
              </div>
              <div className="muted">{metric.note}</div>
            </article>
          ))}
        </section>

        <section id="Мои роутеры" className="contentStack">
          <article className="panel" style={{ padding: "24px" }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
              Мои роутеры
            </h2>
            <p className="sectionLead" style={{ marginTop: "12px" }}>
              В ТЗ один клиент может владеть несколькими устройствами, поэтому этот блок сразу
              ориентирован на список, а не на одиночную карточку.
            </p>
          </article>

          <div className="gridTwo">
            {routers.map((router) => (
              <article key={router.name} className="panel routerCard">
                <span className="statusTag">Активен</span>
                <h3 style={{ marginTop: "14px", fontFamily: "var(--font-heading, sans-serif)", fontSize: "28px" }}>
                  {router.name}
                </h3>
                <p>{router.model}</p>
                <ul className="list" style={{ marginTop: "16px" }}>
                  <li>Пакет: {router.plan}</li>
                  <li>Оплачено до: {router.expiry}</li>
                  <li>Осталось: {router.remaining}</li>
                </ul>
                <div className="ctaRow" style={{ marginTop: "18px" }}>
                  <a className="primaryButton" href="#Подписки и оплата">
                    Продлить
                  </a>
                  <a className="secondaryButton" href="#Поддержка">
                    Поддержка
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="Подписки и оплата" className="gridTwo">
          <article className="panel featureCard">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "28px" }}>
              Быстрое продление
            </h3>
            <p>
              Сохранённый пакет нужен, чтобы клиент продлевал обслуживание одной кнопкой, не
              собирая комбинацию услуг заново каждый месяц.
            </p>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              1 998 ₽
            </div>
            <div className="muted">Расширенный доступ + расширенное сопровождение на 30 дней</div>
          </article>

          <article className="panel featureCard">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "28px" }}>
              Изменение подписки
            </h3>
            <p>
              При переходе с базовой конфигурации на расширенную логика уже предполагает ручную
              перенастройку и статус ожидания активации.
            </p>
            <div className="statusTag" style={{ marginTop: "18px" }}>
              Оплачено, ожидает подключения
            </div>
          </article>
        </section>

        <section id="Поддержка" className="gridTwo">
          <article className="panel ticketCard">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "28px" }}>
              Поддержка
            </h3>
            <p>Обращения можно привязывать к конкретному роутеру, чтобы не смешивать разные кейсы.</p>
            <ul className="list" style={{ marginTop: "16px" }}>
              <li>Нет доступа к сайту на телевизоре</li>
              <li>Нужно проверить продление после оплаты</li>
              <li>Связаться со специалистом по новому устройству</li>
            </ul>
          </article>

          <article className="panel ticketCard" id="Пригласить и заработать">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "28px" }}>
              Реферальная программа
            </h3>
            <p>
              В MVP уже предусмотрены код, история начислений, внутренний баланс и проверка
              подтверждённых заказов и подписок.
            </p>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              FP-2026
            </div>
            <div className="muted">Пример персонального реферального кода</div>
          </article>
        </section>
      </section>
    </main>
  );
}

