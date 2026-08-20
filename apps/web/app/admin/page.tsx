import Link from "next/link";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "../../lib/api";
import { getAdminCookieName, readAdminSession } from "../../lib/admin-auth";
import type { AdminOverview } from "../../lib/portal-types";

type AdminSettingRecord = {
  defaultValue: string;
  description: string;
  group: string;
  input: "number" | "text" | "url";
  key: string;
  label: string;
  public: boolean;
  value: string;
};

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) ? value[0] ?? null : null;
}

function getFieldInputMode(input: AdminSettingRecord["input"]): React.HTMLAttributes<HTMLInputElement>["inputMode"] {
  if (input === "number") {
    return "decimal";
  }

  if (input === "url") {
    return "url";
  }

  return "text";
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

async function saveSettingsAction(formData: FormData) {
  "use server";

  const cookieStore = await cookies();
  const token = cookieStore.get(getAdminCookieName())?.value;

  if (!readAdminSession(token)) {
    redirect("/admin/login");
  }

  const settings = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : ""])
  );
  const requestHeaders = new Headers({
    "content-type": "application/json",
    cookie: cookieStore.toString()
  });

  if (token) {
    requestHeaders.set("x-admin-session", token);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/admin/settings`, {
    method: "PUT",
    headers: requestHeaders,
    body: JSON.stringify({ settings }),
    cache: "no-store"
  });

  if (response.status === 401) {
    redirect("/admin/login?error=Сессия%20истекла.%20Войдите%20снова.");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    redirect(`/admin?error=${encodeURIComponent(payload?.error ?? "Не удалось сохранить настройки.")}`);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/login");
  redirect("/admin?saved=1");
}

async function createRouterAction(formData: FormData) {
  "use server";

  const cookieStore = await cookies();
  const token = cookieStore.get(getAdminCookieName())?.value;

  if (!readAdminSession(token)) {
    redirect("/admin/login");
  }

  const requestHeaders = new Headers({
    "content-type": "application/json",
    cookie: cookieStore.toString()
  });

  if (token) {
    requestHeaders.set("x-admin-session", token);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/admin/routers`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      userId: String(formData.get("userId") ?? "").trim(),
      displayName: String(formData.get("displayName") ?? "").trim(),
      model: String(formData.get("model") ?? "").trim() || undefined,
      serialNumber: String(formData.get("serialNumber") ?? "").trim() || undefined,
      configurationType: String(formData.get("configurationType") ?? "BASIC"),
      accessEnabled: formData.get("accessEnabled") === "on",
      supportType: String(formData.get("supportType") ?? "NONE"),
      startTrial: formData.get("startTrial") === "on",
      adminNote: String(formData.get("adminNote") ?? "").trim() || undefined
    }),
    cache: "no-store"
  });

  if (response.status === 401) {
    redirect("/admin/login?error=Сессия%20истекла.%20Войдите%20снова.");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    redirect(`/admin?error=${encodeURIComponent(payload?.error ?? "Не удалось привязать роутер.")}`);
  }

  revalidatePath("/admin");
  revalidatePath("/cabinet");
  redirect("/admin?success=Роутер%20успешно%20привязан.");
}

async function logoutAction() {
  "use server";

  const cookieStore = await cookies();
  cookieStore.delete(getAdminCookieName());
  redirect("/admin/login?signedOut=1");
}

export default async function AdminPage(props: { searchParams: PageSearchParams }) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get(getAdminCookieName())?.value;

  if (!readAdminSession(token)) {
    redirect("/admin/login");
  }
  const requestHeaders = new Headers({
    cookie: cookieStore.toString()
  });

  if (token) {
    requestHeaders.set("x-admin-session", token);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/admin/settings`, {
    cache: "no-store",
    headers: requestHeaders
  });

  if (response.status === 401) {
    redirect("/admin/login?error=Сессия%20истекла.%20Войдите%20снова.");
  }

  if (!response.ok) {
    throw new Error(`Failed to load admin settings: ${response.status}`);
  }

  const overviewResponse = await fetch(`${getApiBaseUrl()}/api/admin/overview`, {
    cache: "no-store",
    headers: requestHeaders
  });

  if (overviewResponse.status === 401) {
    redirect("/admin/login?error=Сессия%20истекла.%20Войдите%20снова.");
  }

  if (!overviewResponse.ok) {
    throw new Error(`Failed to load admin overview: ${overviewResponse.status}`);
  }

  const payload = (await response.json()) as { settings: AdminSettingRecord[] };
  const overview = (await overviewResponse.json()) as AdminOverview;

  const settingsByGroup = payload.settings.reduce<Record<string, AdminSettingRecord[]>>((groups, setting) => {
    groups[setting.group] ??= [];
    groups[setting.group].push(setting);
    return groups;
  }, {});

  const groupNames = Object.keys(settingsByGroup);
  const successMessage = getSingleParam(searchParams.saved) ? "Настройки сохранены." : null;
  const createSuccessMessage = getSingleParam(searchParams.success);
  const errorMessage = getSingleParam(searchParams.error);

  return (
    <main className="shell dashboardShell">
      <aside className="panel sideNav">
        <span className="pill">Админ-панель</span>
        <p className="navMeta">
          Вход защищён cookie-сессией. Здесь собраны живые настройки, обзор клиентов и ручная
          привязка роутеров для ежедневной работы с сервисом.
        </p>
        <ul>
          <li>
            <a href="#overview">Сводка</a>
          </li>
          <li>
            <a href="#assign">Привязать роутер</a>
          </li>
          {groupNames.map((groupName) => (
            <li key={groupName}>
              <a href={`#${groupName}`}>{groupName}</a>
            </li>
          ))}
          <li>
            <a href="#clients">Клиенты</a>
          </li>
          <li>
            <a href="#routers">Роутеры</a>
          </li>
          <li>
            <a href="#ops">Операции</a>
          </li>
        </ul>
        <div className="contentStack" style={{ marginTop: "18px" }}>
          <Link className="secondaryButton" href="/">
            На главную
          </Link>
          <form action={logoutAction}>
            <button className="secondaryButton fullWidthButton" type="submit">
              Выйти
            </button>
          </form>
        </div>
      </aside>

      <section className="contentStack">
        <article id="overview" className="panel hero">
          <span className="statusTag">Живые настройки</span>
          <h1 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "54px", lineHeight: 1 }}>
            Админка управляет настройками, обзором клиентов и ручными действиями MVP.
          </h1>
          <p>
            Изменения идут через backend и базу данных, поэтому клиентский кабинет, цены,
            Telegram-ссылки и ручные назначения можно менять без редактирования исходников.
          </p>

          <div className="miniGrid">
            <article className="metricCard">
              <div className="muted">Клиентов</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.stats.users}
              </div>
            </article>
            <article className="metricCard">
              <div className="muted">Роутеров</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.stats.routers}
              </div>
            </article>
            <article className="metricCard">
              <div className="muted">Активных подписок</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.stats.activeSubscriptions}
              </div>
            </article>
            <article className="metricCard">
              <div className="muted">Открытых тикетов</div>
              <div className="metricValue" style={{ fontFamily: "var(--font-heading, sans-serif)" }}>
                {overview.stats.openTickets}
              </div>
            </article>
          </div>
        </article>

        {successMessage ? <div className="banner successBanner">{successMessage}</div> : null}
        {createSuccessMessage ? <div className="banner successBanner">{createSuccessMessage}</div> : null}
        {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

        <section id="assign" className="panel sectionPanel">
          <span className="pill">Ручная привязка</span>
          <h2 style={{ marginTop: "18px", fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
            Создать устройство и назначить клиенту
          </h2>
          <form action={createRouterAction} className="contentStack">
            <div className="settingsGrid">
              <label className="fieldStack">
                <span className="fieldLabel">Клиент</span>
                <select className="textInput" name="userId" required>
                  <option value="">Выберите клиента</option>
                  {overview.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {user.email}
                    </option>
                  ))}
                </select>
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Название роутера</span>
                <input className="textInput" name="displayName" placeholder="Роутер дома" required type="text" />
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Модель</span>
                <input className="textInput" name="model" placeholder="Netis NX31" type="text" />
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Серийный номер</span>
                <input className="textInput" name="serialNumber" placeholder="SN-001" type="text" />
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Конфигурация</span>
                <select className="textInput" defaultValue="BASIC" name="configurationType">
                  <option value="BASIC">BASIC</option>
                  <option value="EXTENDED">EXTENDED</option>
                </select>
              </label>

              <label className="fieldStack">
                <span className="fieldLabel">Сопровождение</span>
                <select className="textInput" defaultValue="NONE" name="supportType">
                  <option value="NONE">Без сопровождения</option>
                  <option value="BASIC">Базовое</option>
                  <option value="EXTENDED">Расширенное</option>
                </select>
              </label>
            </div>

            <label className="checkboxRow">
              <input name="accessEnabled" type="checkbox" />
              <span>Сразу включить расширенный доступ</span>
            </label>

            <label className="checkboxRow">
              <input name="startTrial" type="checkbox" />
              <span>Активировать бесплатный тест при создании</span>
            </label>

            <label className="fieldStack">
              <span className="fieldLabel">Заметка администратора</span>
              <textarea className="textAreaInput" name="adminNote" placeholder="Комментарий по привязке, доставке или конфигурации." />
            </label>

            <div className="ctaRow">
              <button className="primaryButton" type="submit">
                Привязать роутер
              </button>
            </div>
          </form>
        </section>

        <form action={saveSettingsAction} className="contentStack">
          {groupNames.map((groupName) => (
            <section key={groupName} id={groupName} className="panel settingsSection">
              <div className="sectionHeader">
                <div>
                  <h2 style={{ margin: 0, fontFamily: "var(--font-heading, sans-serif)", fontSize: "34px" }}>
                    {groupName}
                  </h2>
                  <p className="sectionLead" style={{ marginTop: "10px" }}>
                    {groupName === "Коммуникации"
                      ? "Эти значения уже можно показывать на публичной части сайта."
                      : "Параметры ниже можно менять вручную без редактирования исходников."}
                  </p>
                </div>
              </div>

              <div className="settingsGrid">
                {settingsByGroup[groupName].map((setting) => (
                  <label key={setting.key} className="fieldStack">
                    <span className="fieldLabel">{setting.label}</span>
                    <input
                      className="textInput"
                      defaultValue={setting.value}
                      inputMode={getFieldInputMode(setting.input)}
                      name={setting.key}
                      type={setting.input === "number" ? "number" : setting.input === "url" ? "url" : "text"}
                    />
                    <span className="helperText">
                      {setting.description}
                      {setting.public ? " Это значение используется на публичных страницах." : ""}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}

          <div className="stickyActions">
            <button className="primaryButton" type="submit">
              Сохранить настройки
            </button>
          </div>
        </form>

        <section id="clients" className="gridTwo sectionSplit">
          <article className="panel sectionPanel">
            <span className="pill">Клиенты</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Последние профили</h2>
            <ul className="list">
              {overview.users.map((user) => (
                <li key={user.id}>
                  {user.name} · {user.email} · роутеров {user.routerCount} · код {user.referralCode}
                </li>
              ))}
            </ul>
          </article>

          <article id="routers" className="panel sectionPanel">
            <span className="pill">Роутеры</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Недавние назначения</h2>
            <ul className="list">
              {overview.routers.map((router) => (
                <li key={router.id}>
                  {router.displayName} · {router.ownerName} · {router.savedTemplate} · {formatDate(router.createdAt)}
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section id="ops" className="gridTwo sectionSplit">
          <article className="panel sectionPanel">
            <span className="pill">Операции</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Подписки, заказы и тикеты</h2>
            <ul className="list">
              {overview.subscriptions.map((subscription) => (
                <li key={subscription.id}>
                  {subscription.routerName} · {subscription.bundleLabel} · {subscription.priceLabel} · до{" "}
                  {formatDate(subscription.endAt)}
                </li>
              ))}
            </ul>
            <ul className="list" style={{ marginTop: "20px" }}>
              {overview.orders.map((order) => (
                <li key={order.id}>
                  Заказ {order.totalPriceLabel} · {order.customerName} · {order.status}
                </li>
              ))}
            </ul>
            <ul className="list" style={{ marginTop: "20px" }}>
              {overview.tickets.map((ticket) => (
                <li key={ticket.id}>
                  {ticket.customerName} · {ticket.category} · {ticket.status} · {ticket.routerName}
                </li>
              ))}
            </ul>
          </article>

          <article className="panel sectionPanel">
            <span className="pill">Аудит</span>
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)" }}>Последние действия</h2>
            <ul className="list">
              {overview.logs.length ? (
                overview.logs.map((log) => (
                  <li key={log.id}>
                    {log.action} · {log.entityType} · {log.entityId.slice(0, 8)} · {formatDate(log.createdAt)}
                  </li>
                ))
              ) : (
                <li>Пока нет записей аудита.</li>
              )}
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}
