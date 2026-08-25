"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void error;
  }, [error]);

  return (
    <main className="shell" style={{ padding: "3rem 0" }}>
      <section className="panel hero" style={{ padding: "2rem" }}>
        <span className="pill">Ошибка</span>
        <h1>Страница временно недоступна</h1>
        <p>Попробуйте обновить страницу еще раз.</p>
        <div className="ctaRow">
          <button className="primaryButton" onClick={reset} type="button">
            Попробовать еще раз
          </button>
          <Link className="secondaryButton" href="/">
            На главную
          </Link>
        </div>
      </section>
    </main>
  );
}
