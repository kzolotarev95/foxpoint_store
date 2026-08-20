import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createAdminSessionToken,
  getAdminCookieName,
  getAdminSessionMaxAge,
  isAdminCredentialPairValid,
  readAdminSession
} from "../../../lib/admin-auth";
import { getSessionCookieOptions } from "../../../lib/session-cookie";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) ? value[0] ?? null : null;
}

async function loginAction(formData: FormData) {
  "use server";

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!isAdminCredentialPairValid(username, password)) {
    redirect("/admin/login?error=Неверный%20логин%20или%20пароль");
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: getAdminCookieName(),
    value: createAdminSessionToken(username),
    ...(await getSessionCookieOptions(getAdminSessionMaxAge()))
  });

  redirect("/admin");
}

export default async function AdminLoginPage(props: { searchParams: PageSearchParams }) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get(getAdminCookieName())?.value;

  if (readAdminSession(token)) {
    redirect("/admin");
  }

  const errorMessage = getSingleParam(searchParams.error);
  const signedOutMessage = getSingleParam(searchParams.signedOut)
    ? "Сессия завершена."
    : null;

  return (
    <main className="shell authShell">
      <section className="panel authPanel adminAuthPanel">
        <span className="pill">Вход в админку</span>

        {signedOutMessage ? <div className="banner successBanner">{signedOutMessage}</div> : null}
        {errorMessage ? <div className="banner errorBanner">{errorMessage}</div> : null}

        <form action={loginAction} className="authForm">
          <label className="fieldStack">
            <span className="fieldLabel">Логин</span>
            <input autoComplete="username" className="textInput" name="username" type="text" />
          </label>

          <label className="fieldStack">
            <span className="fieldLabel">Пароль</span>
            <input autoComplete="current-password" className="textInput" name="password" type="password" />
          </label>

          <button className="primaryButton fullWidthButton" type="submit">
            Войти
          </button>

          <Link className="secondaryButton fullWidthButton" href="/">
            Вернуться на главную
          </Link>
        </form>
      </section>
    </main>
  );
}
