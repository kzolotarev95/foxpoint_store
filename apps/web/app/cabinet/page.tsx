import Image from "next/image";
import Link from "next/link";
import { PortalHeader } from "../../components/portal-header";
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
    <main className="shell portalPage clientDashboardPage">
      <PortalHeader
        navItems={[
          { href: "#overview", label: "Кабинет", active: true },
          { href: "#routers", label: "Мои роутеры" },
          { href: "#support", label: "Поддержка" },
          { href: "#payments", label: "Платежи" },
          { href: "#profile", label: "Профиль" }
        ]}
        rightSlot={
          <>
            <Link className="portalGhostButton secondaryButton" href="#order">
              Заказать роутер
            </Link>
            <span className="portalIconButton" aria-hidden="true">
              ◦
            </span>
            <span className="portalUserChip">{overview.profile.name}</span>
            <form action={logoutClientAction}>
              <button className="portalGhostButton secondaryButton" type="submit">
                Выйти
              </button>
            </form>
          </>
        }
      />

      <section id="overview" className="panel portalHero dashboardHero">
        <div className="heroCopy dashboardHeroCopy">
          <span className="statusTag">Клиентский кабинет</span>
          <h1>Интернет должен просто работать.</h1>
          <p>
            {overview.profile.name}, здесь можно управлять роутерами, продлевать сервис, создавать
            заказы и писать в поддержку.
          </p>

          <div className="ctaRow">
            <Link className="primaryButton portalActionButton" href={overview.links.telegramBot} target="_blank">
              Управление
            </Link>
            <Link className="secondaryButton portalGhostButton" href="#routers">
              Мои роутеры
            </Link>
            <Link className="secondaryButton portalGhostButton" href={overview.links.support} target="_blank">
              Нужна помощь
            </Link>
          </div>
        </div>

        <div className="dashboardHeroVisual panel">
          <Image
            alt="FoxPoint кабинет"
            className="heroImage"
            height={720}
            priority
            src="/images/foxpoint-hero-welcome.jpg"
            width={960}
          />
        </div>
      </section>

      {welcomeMessage ? <div className="banner successBanner">{welcomeMessage}</div> : null}
      {successMessage ? <div className="banner successBanner">{successMessage}</div> : null}
      {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}
      {paymentUrl ? (
        <div className="banner successBanner">
          Ссылка на оплату готова.{" "}
          <a className="authInlineLink" href={paymentUrl} target="_blank">
            Открыть
          </a>
        </div>
      ) : null}

      <section className="miniGrid dashboardSummaryGrid">
        <article className="metricCard panel">
          <div className="muted">Роутеров</div>
          <div className="metricValue">{overview.stats.routerCount}</div>
          <p>Всего подключенных устройств в кабинете.</p>
        </article>
        <article className="metricCard panel">
          <div className="muted">Активных устройств</div>
          <div className="metricValue">{overview.stats.activeRouterCount}</div>
          <p>Устройства, которые сейчас в работе.</p>
        </article>
        <article className="metricCard panel">
          <div className="muted">Баланс</div>
          <div className="metricValue">{overview.profile.balanceLabel}</div>
          <p>Средства на аккаунте и доступные операции.</p>
        </article>
      </section>

      {!overview.routers.length ? (
        <section className="panel emptyState">
          <span className="pill">Пустой кабинет</span>
          <h2>К вашему аккаунту пока не добавлен роутер.</h2>
          <p>
            Если устройство уже у вас, напишите в поддержку и мы проверим привязку. Если роутера
            еще нет, можно сразу оформить заказ и перейти к доставке.
          </p>
          <div className="ctaRow">
            <form action={createRouterOrderAction}>
              <button className="primaryButton portalActionButton" type="submit">
                Заказать роутер
              </button>
            </form>
            <Link className="secondaryButton portalGhostButton" href={overview.links.support} target="_blank">
              Написать в поддержку
            </Link>
            <Link className="secondaryButton portalGhostButton" href="/">
              Как работает сервис
            </Link>
          </div>
        </section>
      ) : null}

      <section id="routers" className="panel sectionPanel">
        <span className="pill">Мои роутеры</span>
        <h2 className="sectionTitle">Все устройства и сроки в одном месте.</h2>
        <div className="routerList">
          {overview.routers.map((router) => (
            <article key={router.id} className="panel routerPanel">
              <div className="sectionHeader">
                <div>
                  <h3>{router.displayName}</h3>
                  <p className="sectionLead">
                    {router.model ?? "Модель уточняется"} · ID {router.id.slice(0, 8)} · статус {router.status}
                  </p>
                </div>
                <span className="statusTag">{router.currentSubscription?.status ?? "Без подписки"}</span>
              </div>

              <div className="detailGrid">
                <div className="metricCard">
                  <div className="muted">Текущий пакет</div>
                  <div className="metricValue">{router.currentPackage}</div>
                  <p>
                    До {formatDate(router.currentSubscription?.endAt)} · осталось{" "}
                    {router.currentSubscription?.daysRemaining ?? 0} дней
                  </p>
                </div>

                <div className="metricCard">
                  <div className="muted">Следующее продление</div>
                  <div className="metricValue">{router.savedTemplate.nextPriceLabel}</div>
                  <p>{router.savedTemplate.label}</p>
                </div>

                <div className="metricCard">
                  <div className="muted">Конфигурация</div>
                  <div className="metricValue">{router.configurationType}</div>
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
                    <h4>Сохранить пакет для продления</h4>
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
                    <h4>Продлить на {overview.catalog.periodDays} дней</h4>
                  </div>
                  <p className="sectionLead">
                    Система использует сохраненный пакет и создает отдельный платеж для этого
                    роутера.
                  </p>

                  <form action={renewRouterAction} className="stackedActions">
                    <input name="routerId" type="hidden" value={router.id} />
                    <button className="primaryButton portalActionButton" type="submit">
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
        <h2 className="sectionTitle">Готовый роутер под ключ</h2>
        <p className="sectionLead">
          Получаете настроенное устройство, подключаете дома и не тратите время на ручную
          настройку каждого телефона, телевизора и компьютера.
        </p>

        <div className="detailGrid">
          <div className="metricCard">
            <div className="muted">Роутер</div>
            <div className="metricValue">{overview.orderOffer.routerPriceLabel}</div>
          </div>
          <div className="metricCard">
            <div className="muted">Прошивка и настройка</div>
            <div className="metricValue">{overview.orderOffer.setupPriceLabel}</div>
          </div>
          <div className="metricCard">
            <div className="muted">Итого</div>
            <div className="metricValue">{overview.orderOffer.totalPriceLabel}</div>
          </div>
        </div>

        <div className="ctaRow">
          <form action={createRouterOrderAction}>
            <button className="primaryButton portalActionButton" type="submit">
              Создать заказ
            </button>
          </form>
          <Link className="secondaryButton portalGhostButton" href={overview.links.support} target="_blank">
            Задать вопрос
          </Link>
        </div>
      </section>

      <section id="support" className="panel sectionPanel">
        <span className="pill">Поддержка</span>
        <h2 className="sectionTitle">Создать обращение</h2>
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
            <button className="primaryButton portalActionButton" type="submit">
              Отправить обращение
            </button>
            <Link className="secondaryButton portalGhostButton" href={overview.links.support} target="_blank">
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
          <h2 className="sectionTitle">Последние оплаты</h2>
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
          <h2 className="sectionTitle">Готовые роутеры</h2>
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
          <h2 className="sectionTitle">Реферальный код</h2>
          <div className="metricValue">{overview.profile.referralCode}</div>
          <p className="sectionLead">
            Приглашено клиентов: {overview.referrals.invitedCount}. Доступно:{" "}
            {overview.referrals.availableRewardsLabel}. В ожидании:{" "}
            {overview.referrals.pendingRewardsLabel}.
          </p>
          <a className="secondaryButton portalGhostButton" href={overview.profile.referralLink}>
            Открыть реферальную ссылку
          </a>
        </article>

        <article className="panel sectionPanel">
          <span className="pill">Уведомления</span>
          <h2 className="sectionTitle">Последние события</h2>
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
        <h2 className="sectionTitle">Данные клиента</h2>
        <div className="detailGrid">
          <div className="metricCard">
            <div className="muted">Имя</div>
            <div className="metricValue">{overview.profile.name}</div>
          </div>
          <div className="metricCard">
            <div className="muted">Email</div>
            <div className="metricValue">{overview.profile.email ?? "Не привязан"}</div>
          </div>
          <div className="metricCard">
            <div className="muted">Telegram</div>
            <div className="metricValue">{overview.profile.telegram ?? "Еще не привязан"}</div>
          </div>
        </div>
        <p className="helperText">Дата регистрации: {formatDate(overview.profile.createdAt)}</p>
      </section>
    </main>
  );
}
