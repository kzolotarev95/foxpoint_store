import Link from "next/link";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { fetchApiJson, getApiBaseUrl } from "../../lib/api";
import { getAdminCookieName, readAdminSession } from "../../lib/admin-auth";

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

  const response = await fetch(`${getApiBaseUrl()}/api/admin/settings`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: cookieStore.toString()
    },
    body: JSON.stringify({ settings }),
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    redirect(`/admin?error=${encodeURIComponent(payload?.error ?? "Не удалось сохранить настройки.")}`);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/login");
  redirect("/admin?saved=1");
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

  const response = await fetchApiJson<{ settings: AdminSettingRecord[] }>("/api/admin/settings", {
    headers: {
      cookie: cookieStore.toString()
    }
  });

  const settingsByGroup = response.settings.reduce<Record<string, AdminSettingRecord[]>>((groups, setting) => {
    groups[setting.group] ??= [];
    groups[setting.group].push(setting);
    return groups;
  }, {});

  const groupNames = Object.keys(settingsByGroup);
  const successMessage = getSingleParam(searchParams.saved) ? "Настройки сохранены." : null;
  const errorMessage = getSingleParam(searchParams.error);

  return (
    <main className="shell dashboardShell">
      <aside className="panel sideNav">
        <span className="pill">Админ-панель</span>
        <p className="navMeta">Вход защищён cookie-сессией. Все значения ниже сохраняются в PostgreSQL.</p>
        <ul>
          {groupNames.map((groupName) => (
            <li key={groupName}>
              <a href={`#${groupName}`}>{groupName}</a>
            </li>
          ))}
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
        <article className="panel hero">
          <span className="statusTag">Живые настройки</span>
          <h1 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "54px", lineHeight: 1 }}>
            Админка теперь управляет ценами, Telegram-ссылками, рефералами и тестовым периодом.
          </h1>
          <p>
            Это уже не заглушка: изменения идут через backend и базу данных, поэтому их можно
            менять без правки кода и повторного деплоя.
          </p>
          <div className="ctaRow">
            <Link className="primaryButton" href="/login">
              Проверить клиентский вход
            </Link>
            <Link className="secondaryButton" href="/">
              Открыть сайт
            </Link>
          </div>
        </article>

        {successMessage ? <div className="banner successBanner">{successMessage}</div> : null}
        {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

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
      </section>
    </main>
  );
}

