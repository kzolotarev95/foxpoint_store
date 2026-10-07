import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAdminCookieName, readAdminSession } from "../../../../../lib/admin-auth";
import { getApiBaseUrl } from "../../../../../lib/api";
import type { AdminOverview } from "../../../../../lib/portal-types";
import { PrintButton } from "../../../../../components/print-button";

export default async function RouterLabelPage({ params }: { params: Promise<{ routerId: string }> }) {
  const token = (await cookies()).get(getAdminCookieName())?.value;
  if (!readAdminSession(token)) redirect("/admin/login");
  const { routerId } = await params;
  const response = await fetch(`${getApiBaseUrl()}/api/admin/overview`, {
    cache: "no-store", headers: { "x-admin-session": token! }
  });
  if (!response.ok) throw new Error("Не удалось загрузить роутер.");
  const overview = await response.json() as AdminOverview;
  const router = overview.routers.find(item => item.id === routerId);
  if (!router?.routerCode) notFound();
  const site = await fetch(`${getApiBaseUrl()}/api/site`, { cache: "no-store" }).then(item => item.json()) as { links: { appUrl: string } };
  const supportUrl = new URL("/support", site.links.appUrl);
  supportUrl.searchParams.set("router", router.routerCode);
  const qrImage = await QRCode.toDataURL(supportUrl.toString(), { errorCorrectionLevel: "M", margin: 4, width: 480 });
  return <main className="shell routerLabelShell">
    <div className="ctaRow routerLabelControls"><Link className="secondaryButton" href={`/admin?view=database&tab=routers#router-${router.id}`}>В базу роутеров</Link><PrintButton /></div>
    <section className="routerLabelSheet">
      <span className="pill">FOX POINT</span>
      <h1>Не работает интернет?</h1>
      <p>Отсканируйте QR-код и отправьте обращение в поддержку без регистрации.</p>
      <p className="routerLabelCode">{router.routerCode}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrImage} alt={`QR-код поддержки роутера ${router.routerCode}`} width={320} height={320} />
      <p>Код роутера уже будет заполнен. Укажите свой контакт и опишите проблему.</p>
      <small>Большинство случаев можем решить удалённо, но в редких случаях может потребоваться подключение к вашему компьютеру.</small>
      <p className="helperText">{supportUrl.toString()}</p>
    </section>
  </main>;
}
