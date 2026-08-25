"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void error;
  }, [error]);

  return (
    <html lang="ru">
      <body style={{ fontFamily: "sans-serif", margin: 0 }}>
        <main style={{ padding: "3rem 1rem" }}>
          <section
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "1.5rem",
              margin: "0 auto",
              maxWidth: "42rem",
              padding: "2rem"
            }}
          >
            <h1 style={{ marginTop: 0 }}>Страница временно недоступна</h1>
            <p>Попробуйте обновить страницу еще раз.</p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button onClick={reset} type="button">
                Попробовать еще раз
              </button>
              <Link href="/">На главную</Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
