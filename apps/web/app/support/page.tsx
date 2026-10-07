import Link from "next/link";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function PublicSupportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <main className="shell publicSupportShell">
      <section className="panel sectionPanel publicSupportCard">
        <Link href="/login" className="pill">FOX POINT</Link>
        <h1>Помощь с роутером</h1>
        <p className="sectionLead">Укажите код с таблички рядом с роутером и опишите проблему. Обращение можно отправить без регистрации.</p>
        {first(params.success) ? <div className="banner successBanner" role="status">{first(params.success)}</div> : null}
        {first(params.error) ? <div className="banner errorBanner" role="alert">{first(params.error)}</div> : null}
        <form action="/support/create" method="post" className="contentStack">
          <label className="fieldStack">
            <span className="fieldLabel">Код роутера</span>
            <input className="textInput" name="routerCode" defaultValue={first(params.router) ?? ""} placeholder="CLI-0001 или CLI-0001/02" maxLength={40} required />
          </label>
          <label className="fieldStack">
            <span className="fieldLabel">Телефон или Telegram для ответа</span>
            <input className="textInput" name="contact" placeholder="+7… или @username" minLength={3} maxLength={200} required />
          </label>
          <label className="fieldStack">
            <span className="fieldLabel">Что не работает?</span>
            <textarea className="textAreaInput" name="description" placeholder="Например: Wi-Fi подключён, но страницы не открываются." minLength={10} maxLength={3000} required rows={5} />
          </label>
          <div className="supportHoneypot" aria-hidden="true">
            <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          </div>
          <small className="helperText">Большинство случаев можем решить удалённо, но в редких случаях может потребоваться подключение к вашему компьютеру.</small>
          <button className="primaryButton" type="submit">Отправить обращение</button>
        </form>
        <p className="helperText" style={{ marginTop: "20px" }}>Поддержка ответит по указанному контакту. Код роутера помогает нам найти нужное устройство.</p>
      </section>
    </main>
  );
}
