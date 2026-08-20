import Link from "next/link";
import { fetchClientApi } from "../../lib/client-auth";
import type { ClientOverview } from "../../lib/portal-types";
import {
  createRouterOrderAction,
  createSupportTicketAction,
  logoutClientAction,
  renewRouterAction,
  saveRouterTemplateAction
} from "../../lib/client-actions";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) ? value[0] ?? null : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

export default async function CabinetPage(props: { searchParams: PageSearchParams }) {
  const [overview, searchParams] = await Promise.all([
    fetchClientApi<ClientOverview>("/api/me/overview"),
    props.searchParams
  ]);
  const successMessage = getSingleParam(searchParams.success);
  const errorMessage = getSingleParam(searchParams.error);
  const paymentUrl = getSingleParam(searchParams.payment);
  const welcomeMessage = getSingleParam(searchParams.welcome)
    ? "Профиль создан. Теперь кабинет готов к работе."
    : null;

  return (
    <main className="shell dashboardShell">
      <aside className="panel sideNav">
        <span className="pill">Личный кабинет</span>
        <p className="navMeta">
          {overview.profile.name}
          <br />
          {overview.profile.email ?? "Email не привязан"}
        </p>
        <ul>
          <li>
            <a href="#overview">Сводка</a>
          </li>
          <li>
            <a href="#routers">Мои роутеры</a>
          </li>
          <li>
            <a href="#order">Заказать роутер</a>
          </li>
          <li>
            <a href="#support">Поддержка</a>
          </li>
          <li>
            <a href="#payments">Платежи</a>
          </li>
          <li>
            <a href="#referrals">Рефералы</a>
          </li>
          <li>
            <a href="#profile">Профиль</a>
          </li>
        </ul>

        <div className="contentStack" style={{ marginTop: "18px" }}>
          <Link className="secondaryButton" href={overview.links.telegramBot} target="_blank">
            Telegram
          </Link>
          <form action={logoutClientAction}>
            <button className="secondaryButton fullWidthButton" type="submit">
              Выйти
            </button>
          </form>
        </div>
      </aside>

      <section className="dashboardMain contentStack">
        <section id="overview" className="panel hero">
          <span className="statusTag">Клиентский MVP</span>
          <h1 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
            {overview.profile.name}, все основные сценарии уже собраны в одном кабинете.
          </h1>
          <p>
            Здесь можно посмотреть роутеры, сохранить пакет для продления, создать заказ, написать в
            поддержку и использовать реферальный код.
          </p>
          <div className="ctaRow">
            <Link className="primaryButton" href={overview.links.telegramBot} target="_blank">
              Открыть Telegram
            </Link>
            <Link className="secondaryButton" href={overview.links.support} target="_blank">
              Поддержка
            </Link>
            <Link className="secondaryButton" href={overview.links.telegramChannel} target="_blank">
              Канал
            </Link>
          </div>
        </section>

        {welcomeMessage ? <div className="banner successBanner">{welcomeMessage}</div> : null}
        {successMessage ? <div className="banner successBanner">{successMessage}</div> : null}
        {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}
        {paymentUrl ? (
          <div className="banner successBanner">
            Ссылка на оплату или переход к менеджеру готова.{" "}
            <a className="authInlineLink" href={paymentUrl} target="_blank">
              Открыть
            </a>
          </div>
        ) : null}

        <section className="miniGrid">
          <article className="metricCard panel">
            <div className="muted">Роутеров</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {overview.stats.routerCount}
            </div>
          </article>
          <article className="metricCard panel">
            <div className="muted">Активных устройств</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {overview.stats.activeRouterCount}
            </div>
          </article>
          <article className="metricCard panel">
            <div className="muted">Баланс</div>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {overview.profile.balanceLabel}
            </div>
          </article>
        </section>

        {!overview.routers.length ? (
          <section className="panel emptyState">
            <span className="pill">Пустой кабинет</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              К вашему аккаунту пока не добавлен роутер.
            </h2>
            <p>
              Если устройство уже у вас, напишите в поддержку и мы проверим привязку. Если роутера
              еще нет, можно сразу оформить заказ и перейти к доставке.
            </p>
            <div className="ctaRow">
              <form action={createRouterOrderAction}>
                <button className="primaryButton" type="submit">
                  Заказать роутер
                </button>
              </form>
              <Link className="secondaryButton" href={overview.links.support} target="_blank">
                Написать в поддержку
              </Link>
              <Link className="secondaryButton" href="/">
                Как работает сервис
              </Link>
            </div>
          </section>
        ) : null}

        <section id="routers" className="contentStack">
          <div className="sectionBlock">
            <span className="pill">Мои роутеры</span>
            <h2 className="sectionTitle" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              Все устройства, пакеты и сроки в одном месте.
            </h2>
          </div>

          <div className="routerList">
            {overview.routers.map((router) => (
              <article key={router.id} className="panel routerPanel">
                <div className="sectionHeader">
                  <div>
                    <h3 style={{ margin: 0, fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
                      {router.displayName}
                    </h3>
                    <p className="sectionLead" style={{ marginTop: "10px", fontSize: "16px" }}>
                      {router.model ?? "Модель уточняется"} · ID {router.id.slice(0, 8)} · статус {router.status}
                    </p>
                  </div>
                  <span className="statusTag">{router.currentSubscription?.status ?? "Без подписки"}</span>
                </div>

                <div className="detailGrid">
                  <div className="metricCard">
                    <div className="muted">Текущий пакет</div>
                    <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                      {router.currentPackage}
                    </div>
                    <p>
                      До {formatDate(router.currentSubscription?.endAt)} · осталось{" "}
                      {router.currentSubscription?.daysRemaining ?? 0} дней
                    </p>
                  </div>

                  <div className="metricCard">
                    <div className="muted">Следующее продление</div>
                    <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                      {router.savedTemplate.nextPriceLabel}
                    </div>
                    <p>{router.savedTemplate.label}</p>
                  </div>

                  <div className="metricCard">
                    <div className="muted">Конфигурация</div>
                    <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                      {router.configurationType}
                    </div>
                    <p>Серийный номер: {router.serialNumber ?? "не указан"}</p>
                  </div>
                </div>

                {router.trial ? (
                  <div className="banner successBanner">
                    Пробный период: до {formatDate(router.trial.endAt)}. Осталось{" "}
                    {router.trial.daysRemaining ?? 0} дней.
                  </div>
                ) : null}

                {router.currentSubscription?.pendingActivation ? (
                  <div className="banner errorBanner">
                    Для этого пакета потребуется ручная перенастройка. До подтверждения админом
                    услуга остается в статусе ожидания.
                  </div>
                ) : null}

                <div className="dashboardSectionGrid">
                  <form action={saveRouterTemplateAction} className="panel formCard">
                    <input name="routerId" type="hidden" value={router.id} />
                    <div className="sectionBlock compactBlock">
                      <span className="pill">Изменить пакет</span>
                      <h4 style={{ margin: 0, fontFamily: "var(--font-heading, sans-serif)", fontSize: "24px" }}>
                        Сохранить пакет для продления
                      </h4>
                    </div>

                    <label className="checkboxRow">
                      <input defaultChecked={router.savedTemplate.accessEnabled} name="accessEnabled" type="checkbox" />
                      <span>Расширенный доступ за {overview.catalog.extendedAccessPrice} ₽</span>
                    </label>

                    <label className="fieldStack">
                      <span className="fieldLabel">Сопровождение</span>
                      <select className="textInput" defaultValue={router.savedTemplate.supportType} name="supportType">
                        <option value="NONE">Без сопровождения</option>
                        <option value="BASIC">Базовое сопровождение</option>
                        <option value="EXTENDED">Расширенное сопровождение</option>
                      </select>
                    </label>

                    <button className="secondaryButton" type="submit">
                      Сохранить пакет
                    </button>
                  </form>

                  <div className="panel formCard">
                    <div className="sectionBlock compactBlock">
                      <span className="pill">Быстрое продление</span>
                      <h4 style={{ margin: 0, fontFamily: "var(--font-heading, sans-serif)", fontSize: "24px" }}>
                        Продлить на {overview.catalog.periodDays} дней
                      </h4>
                    </div>
                    <p className="sectionLead" style={{ fontSize: "16px" }}>
                      Система использует сохраненный пакет и создает отдельный платеж для этого
                      роутера.
                    </p>

                    <form action={renewRouterAction} className="stackedActions">
                      <input name="routerId" type="hidden" value={router.id} />
                      <button className="primaryButton" type="submit">
                        Продлить за {router.savedTemplate.nextPriceLabel}
                      </button>
                    </form>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="order" className="panel sectionPanel">
          <span className="pill">Заказать роутер</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Готовый роутер под ключ</h2>
          <p className="sectionLead">
            Получаете настроенное устройство, подключаете дома и не тратите время на ручную
            настройку каждого телефона, телевизора и компьютера.
          </p>

          <div className="detailGrid">
            <div className="metricCard">
              <div className="muted">Роутер</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.orderOffer.routerPriceLabel}
              </div>
            </div>
            <div className="metricCard">
              <div className="muted">Прошивка и настройка</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.orderOffer.setupPriceLabel}
              </div>
            </div>
            <div className="metricCard">
              <div className="muted">Итого</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.orderOffer.totalPriceLabel}
              </div>
            </div>
          </div>

          <div className="ctaRow">
            <form action={createRouterOrderAction}>
              <button className="primaryButton" type="submit">
                Создать заказ
              </button>
            </form>
            <Link className="secondaryButton" href={overview.links.support} target="_blank">
              Задать вопрос
            </Link>
          </div>
        </section>

        <section id="support" className="panel sectionPanel">
          <span className="pill">Поддержка</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Создать обращение</h2>
          <form action={createSupportTicketAction} className="contentStack">
            <label className="fieldStack">
              <span className="fieldLabel">Категория</span>
              <input
                className="textInput"
                name="category"
                placeholder="Например: Продление, настройка, доставка"
                required
                type="text"
              />
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Роутер</span>
              <select className="textInput" name="routerId">
                <option value="">Без привязки к роутеру</option>
                {overview.routers.map((router) => (
                  <option key={router.id} value={router.id}>
                    {router.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Описание</span>
              <textarea
                className="textAreaInput"
                name="description"
                placeholder="Опишите ситуацию и что именно нужно сделать."
                required
              />
            </label>

            <div className="ctaRow">
              <button className="primaryButton" type="submit">
                Отправить обращение
              </button>
              <Link className="secondaryButton" href={overview.links.support} target="_blank">
                Открыть поддержку в Telegram
              </Link>
            </div>
          </form>

          {!!overview.tickets.length ? (
            <div className="timelineGrid compactTimeline">
              {overview.tickets.map((ticket) => (
                <article key={ticket.id} className="timelineCard">
                  <div className="timelineIndex">{ticket.status}</div>
                  <p>
                    {ticket.category}
                    <br />
                    Обновлено: {formatDate(ticket.updatedAt)}
                  </p>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section id="payments" className="gridTwo sectionSplit">
          <article className="panel sectionPanel">
            <span className="pill">История платежей</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Последние оплаты</h2>
            <ul className="list">
              {overview.payments.length ? (
                overview.payments.map((payment) => (
                  <li key={payment.id}>
                    {payment.amountLabel} · {payment.status} · {payment.routerName ?? "Заказ роутера"} ·{" "}
                    {formatDate(payment.createdAt)}
                  </li>
                ))
              ) : (
                <li>Пока нет платежей.</li>
              )}
            </ul>
          </article>

          <article className="panel sectionPanel">
            <span className="pill">Заказы</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Готовые роутеры</h2>
            <ul className="list">
              {overview.orders.length ? (
                overview.orders.map((order) => (
                  <li key={order.id}>
                    {order.totalPriceLabel} · {order.status} · создан {formatDate(order.createdAt)}
                  </li>
                ))
              ) : (
                <li>Пока нет оформленных заказов.</li>
              )}
            </ul>
          </article>
        </section>

        <section id="referrals" className="gridTwo sectionSplit">
          <article className="panel sectionPanel">
            <span className="pill">Пригласить и заработать</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Реферальный код</h2>
            <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
              {overview.profile.referralCode}
            </div>
            <p className="sectionLead" style={{ fontSize: "16px" }}>
              Приглашено клиентов: {overview.referrals.invitedCount}. Доступно:{" "}
              {overview.referrals.availableRewardsLabel}. В ожидании:{" "}
              {overview.referrals.pendingRewardsLabel}.
            </p>
            <a className="secondaryButton" href={overview.profile.referralLink}>
              Открыть реферальную ссылку
            </a>
          </article>

          <article className="panel sectionPanel">
            <span className="pill">Уведомления</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Последние события</h2>
            <ul className="list">
              {overview.notifications.length ? (
                overview.notifications.map((notification) => (
                  <li key={notification.id}>
                    {notification.type} · {formatDate(notification.createdAt)}
                  </li>
                ))
              ) : (
                <li>Пока нет уведомлений.</li>
              )}
            </ul>
          </article>
        </section>

        <section id="profile" className="panel sectionPanel">
          <span className="pill">Профиль</span>
          <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Данные клиента</h2>
          <div className="detailGrid">
            <div className="metricCard">
              <div className="muted">Имя</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.profile.name}
              </div>
            </div>
            <div className="metricCard">
              <div className="muted">Email</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.profile.email ?? "Не привязан"}
              </div>
            </div>
            <div className="metricCard">
              <div className="muted">Telegram</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.profile.telegram ?? "Еще не привязан"}
              </div>
            </div>
          </div>
          <p className="helperText">Дата регистрации: {formatDate(overview.profile.createdAt)}</p>
        </section>
      </section>
    </main>
  );
}
