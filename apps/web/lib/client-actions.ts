"use server";

import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./api";
import {
  clearClientSessionCookie,
  fetchClientApi,
  setClientSessionCookie
} from "./client-auth";

function encodeMessage(message: string): string {
  return encodeURIComponent(message);
}

function getReturnToPath(formData: FormData, fallback: string): string {
  const candidate = String(formData.get("returnTo") ?? "").trim();

  if (!candidate.startsWith("/cabinet")) {
    return fallback;
  }

  return candidate;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function loginWithEmailAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const referralCode = String(formData.get("referralCode") ?? "").trim();

  const response = await fetch(`${getApiBaseUrl()}/api/auth/email`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      name: name || undefined,
      referralCode: referralCode || undefined
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    const errorMessage = await parseApiError(response, "Не удалось выполнить вход.");
    redirect(`/login?error=${encodeMessage(errorMessage)}&ref=${encodeURIComponent(referralCode)}`);
  }

  const payload = (await response.json()) as { isNew: boolean; token: string };
  await setClientSessionCookie(payload.token);
  redirect(payload.isNew ? "/cabinet?welcome=1" : "/cabinet");
}

export async function authenticateClientAction(formData: FormData) {
  const mode = String(formData.get("mode") ?? "login").trim() === "register" ? "register" : "login";
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const referralCode = String(formData.get("referralCode") ?? "").trim();

  const response = await fetch(`${getApiBaseUrl()}/api/auth/credentials`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      mode,
      login,
      password,
      referralCode: referralCode || undefined
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    const errorMessage = await parseApiError(response, "Не удалось выполнить вход.");
    redirect(
      `/login?mode=${mode}&error=${encodeMessage(errorMessage)}&login=${encodeURIComponent(login)}&ref=${encodeURIComponent(
        referralCode
      )}`
    );
  }

  const payload = (await response.json()) as { isNew: boolean; token: string };
  await setClientSessionCookie(payload.token);
  redirect(payload.isNew ? "/cabinet?welcome=1" : "/cabinet");
}

export async function logoutClientAction() {
  await clearClientSessionCookie();
  redirect("/login?signedOut=1");
}

export async function createRouterOrderAction(formData: FormData) {
  const returnTo = getReturnToPath(formData, "/cabinet");
  const payload = await fetchClientApi<{ paymentUrl: string; totalPriceLabel: string }>("/api/orders", {
    method: "POST"
  });

  redirect(
    `${returnTo}?success=${encodeMessage(
      `Заказ создан. Сумма ${payload.totalPriceLabel}.`
    )}&payment=${encodeURIComponent(payload.paymentUrl)}`
  );
}

export async function createSupportTicketAction(formData: FormData) {
  const returnTo = getReturnToPath(formData, "/cabinet/support");
  const category = String(formData.get("category") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const routerId = String(formData.get("routerId") ?? "").trim();

  try {
    await fetchClientApi("/api/support", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        category,
        description,
        routerId: routerId || undefined
      })
    });
  } catch (error) {
    redirect(`${returnTo}?error=${encodeMessage(error instanceof Error ? error.message : "Не удалось создать заявку.")}`);
  }

  redirect(`${returnTo}?success=Обращение%20создано.`);
}

export async function attachProfileEmailAction(formData: FormData) {
  const returnTo = getReturnToPath(formData, "/cabinet/profile");
  const email = String(formData.get("email") ?? "").trim();

  try {
    await fetchClientApi("/api/me/profile/email", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email
      })
    });
  } catch (error) {
    redirect(`${returnTo}?error=${encodeMessage(error instanceof Error ? error.message : "Не удалось привязать email.")}`);
  }

  redirect(`${returnTo}?success=Email%20привязан.`);
}

export async function saveProfileCredentialsAction(formData: FormData) {
  const returnTo = getReturnToPath(formData, "/cabinet/profile");
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  try {
    await fetchClientApi("/api/me/profile/password", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        login,
        password
      })
    });
  } catch (error) {
    redirect(
      `${returnTo}?error=${encodeMessage(error instanceof Error ? error.message : "Не удалось сохранить логин и пароль.")}`
    );
  }

  redirect(`${returnTo}?success=Логин%20и%20пароль%20сохранены.`);
}

export async function requestTwoFactorSetupAction(formData: FormData) {
  const returnTo = getReturnToPath(formData, "/cabinet/profile");

  try {
    const payload = await fetchClientApi<{ created: boolean }>("/api/me/profile/request", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        kind: "TWO_FACTOR"
      })
    });

    if (!payload.created) {
      redirect(`${returnTo}?success=Запрос%20на%202FA%20уже%20открыт.`);
    }
  } catch (error) {
    redirect(`${returnTo}?error=${encodeMessage(error instanceof Error ? error.message : "Не удалось отправить запрос на 2FA.")}`);
  }

  redirect(`${returnTo}?success=Запрос%20на%202FA%20отправлен%20в%20поддержку.`);
}

export async function requestAccountDeletionAction(formData: FormData) {
  const returnTo = getReturnToPath(formData, "/cabinet/profile");

  try {
    const payload = await fetchClientApi<{ created: boolean }>("/api/me/profile/request", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        kind: "DELETE_ACCOUNT"
      })
    });

    if (!payload.created) {
      redirect(`${returnTo}?success=Запрос%20на%20удаление%20уже%20создан.`);
    }
  } catch (error) {
    redirect(
      `${returnTo}?error=${encodeMessage(error instanceof Error ? error.message : "Не удалось отправить запрос на удаление.")}`
    );
  }

  redirect(`${returnTo}?success=Запрос%20на%20удаление%20аккаунта%20отправлен.`);
}

export async function saveRouterTemplateAction(formData: FormData) {
  const returnTo = getReturnToPath(formData, "/cabinet/routers");
  const routerId = String(formData.get("routerId") ?? "").trim();
  const supportType = String(formData.get("supportType") ?? "NONE").trim();
  const accessEnabled = formData.get("accessEnabled") === "on";

  try {
    await fetchClientApi(`/api/routers/${routerId}/template`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        accessEnabled,
        supportType
      })
    });
  } catch (error) {
    redirect(`${returnTo}?error=${encodeMessage(error instanceof Error ? error.message : "Не удалось сохранить пакет.")}`);
  }

  redirect(`${returnTo}?success=Пакет%20для%20продления%20сохранен.`);
}

export async function renewRouterAction(formData: FormData) {
  const returnTo = getReturnToPath(formData, "/cabinet/routers");
  const routerId = String(formData.get("routerId") ?? "").trim();

  try {
    const payload = await fetchClientApi<{
      amountLabel: string;
      paymentUrl: string;
      requiresActivation: boolean;
    }>(`/api/routers/${routerId}/renew`, {
      method: "POST"
    });
    const activationMessage = payload.requiresActivation
      ? " После оплаты заявка уйдет на ручную перенастройку."
      : "";

    redirect(
      `${returnTo}?success=${encodeMessage(
        `Продление создано на ${payload.amountLabel}.${activationMessage}`
      )}&payment=${encodeURIComponent(payload.paymentUrl)}`
    );
  } catch (error) {
    redirect(`${returnTo}?error=${encodeMessage(error instanceof Error ? error.message : "Не удалось продлить пакет.")}`);
  }
}
