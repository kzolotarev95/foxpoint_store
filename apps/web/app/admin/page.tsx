const adminSections = [
  "Клиенты",
  "Роутеры",
  "Подписки",
  "Заказы",
  "Поддержка",
  "Рефералы",
  "Настройки",
  "Аудит"
];

export default function AdminPage() {
  return (
    <main className="shell dashboardShell">
      <aside className="panel sideNav">
        <span className="pill">Админ-панель</span>
        <ul>
          {adminSections.map((section) => (
            <li key={section}>
              <a href={`#${section}`}>{section}</a>
            </li>
          ))}
        </ul>
      </aside>

      <section className="contentStack">
        <article className="panel hero">
          <span className="statusTag">MVP operations</span>
          <h1 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "54px", lineHeight: 1 }}>
            Админка собрана вокруг ручных процессов, которые обязательны по ТЗ.
          </h1>
          <p>
            Здесь будут жить привязка роутеров к клиентам, активация тестового периода, обработка
            оплат, проверка рефералов, статусы заказов и журнал действий.
          </p>
        </article>

        <section className="miniGrid">
          <article className="panel metricCard">
            <div className="muted">Клиентов</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              128
            </div>
            <div className="muted">Будущий список с фильтрами и карточкой клиента</div>
          </article>
          <article className="panel metricCard">
            <div className="muted">Роутеров</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              214
            </div>
            <div className="muted">Модели, серийные номера, конфигурации и сроки</div>
          </article>
          <article className="panel metricCard">
            <div className="muted">Ожидают активации</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              7
            </div>
            <div className="muted">То, что нельзя автоматически считать уже рабочим</div>
          </article>
        </section>

        <section className="gridTwo">
          <article className="panel featureCard" id="Клиенты">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "30px" }}>Клиенты и аккаунты</h3>
            <p>
              Единая карточка клиента нужна для объединения входов через Telegram и email, просмотра
              роутеров, платежей, заказов, тикетов и реферальной истории.
            </p>
          </article>

          <article className="panel featureCard" id="Роутеры">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "30px" }}>Роутеры и сроки</h3>
            <p>
              Администратор вручную создаёт устройство, назначает владельца, указывает конфигурацию,
              услуги, тестовый период и будущую цену продления.
            </p>
          </article>

          <article className="panel featureCard" id="Подписки">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "30px" }}>Подписки и платежи</h3>
            <p>
              Здесь будут фильтры по истекающим подпискам, ожидающим ручной активации и платежам,
              где критично не допускать дублей по callback.
            </p>
          </article>

          <article className="panel featureCard" id="Рефералы">
            <h3 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "30px" }}>Рефералы и баланс</h3>
            <p>
              Проверка статусов заказов, подтверждение наград и ручные корректировки будут
              логироваться через отдельный слой аудита.
            </p>
          </article>
        </section>
      </section>
    </main>
  );
}
