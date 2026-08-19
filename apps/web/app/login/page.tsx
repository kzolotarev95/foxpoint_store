import Link from "next/link";

const authModes = [
  {
    title: "Вход через Telegram",
    text: "Приоритетный MVP-сценарий для текущих клиентов и будущей связки с ботом.",
    action: "Подключить Telegram auth"
  },
  {
    title: "Email + одноразовый код",
    text: "Резервный вход без классического пароля и без сложного сценария восстановления.",
    action: "Подключить email login"
  }
];

export default function LoginPage() {
  return (
    <main className="shell" style={{ padding: "24px 0 56px" }}>
      <section className="panel" style={{ padding: "28px" }}>
        <span className="pill">Авторизация</span>
        <h1 className="sectionTitle" style={{ fontFamily: "var(--font-heading, sans-serif)", marginTop: "14px" }}>
          Вход на сайте
        </h1>
        <p className="sectionLead">
          На этом этапе здесь уже есть точка сборки под авторизацию, которую дальше можно
          подключить к реальным Telegram и email-потокам.
        </p>
      </section>

      <section className="gridTwo" style={{ marginTop: "24px" }}>
        {authModes.map((mode) => (
          <article key={mode.title} className="panel entryCard">
            <h2 style={{ fontFamily: "var(--font-heading, sans-serif)", fontSize: "30px" }}>{mode.title}</h2>
            <p>{mode.text}</p>
            <div className="ctaRow" style={{ marginTop: "auto" }}>
              <Link className="primaryButton" href="/cabinet">
                {mode.action}
              </Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

