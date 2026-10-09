import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAdminCookieName, readAdminSession } from "../../../../../lib/admin-auth";
import { getApiBaseUrl } from "../../../../../lib/api";
import { PrintButton } from "../../../../../components/print-button";
const images = new Map<string, Promise<string>>();
function qrImageFor(url: string) {
  let image = images.get(url);
  if (!image) {
    image = QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 4, width: 480 });
    images.set(url, image);
    if (images.size > 256) images.delete(images.keys().next().value!);
    image.catch(() => images.delete(url));
  }
  return image;
}

export default async function RouterLabelPage({ params }: { params: Promise<{ routerId: string }> }) {
  const token = (await cookies()).get(getAdminCookieName())?.value;
  if (!readAdminSession(token)) redirect("/admin/login");
  const { routerId } = await params;
  const response = await fetch(`${getApiBaseUrl()}/api/admin/routers/${encodeURIComponent(routerId)}/label`, {
    cache: "no-store", headers: { "x-admin-session": token! }
  });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Не удалось загрузить роутер.");
  const {router} = await response.json() as {router:{id:string;routerCode:string|null;displayName:string}};
  if (!router?.routerCode) notFound();
  const site = await fetch(`${getApiBaseUrl()}/api/site`, { cache: "no-store" }).then(item => item.json()) as { links: { appUrl: string } };
  const supportUrl = new URL("/support", site.links.appUrl);
  supportUrl.searchParams.set("router", router.routerCode);
  const qrImage = await qrImageFor(supportUrl.toString());
  return <main className="shell routerLabelShell">
    <div className="ctaRow routerLabelControls"><Link className="secondaryButton" href={`/admin?view=database&tab=routers#router-${router.id}`}>В базу роутеров</Link><PrintButton /></div>
    <section className="routerLabelSheet">
      <span className="pill">FOX POINT</span>
      <h1>Не работает интернет?</h1>
      <p>Отсканируйте QR-код и отправьте обращение в поддержку без регистрации.</p>
      <p className="routerLabelCode">{router.routerCode}</p>
      <p className="routerLabelCode">{router.displayName}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrImage} alt={`QR-код поддержки роутера ${router.routerCode}`} width={320} height={320} />
      <p>Код роутера уже будет заполнен. Укажите свой контакт и опишите проблему.</p>
      <small>Большинство случаев можем решить удалённо, но в редких случаях может потребоваться подключение к вашему компьютеру.</small>
      <p className="helperText">{supportUrl.toString()}</p>
    </section>
  </main>;
}
