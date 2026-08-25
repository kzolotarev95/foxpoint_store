"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function CabinetError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void error;
  }, [error]);

  return (
    <main className="shell portalPage clientDashboardPage clientRoutersExperience">
      <section className="panel clientSupportHeroCard" style={{ marginTop: "1rem" }}>
        <div className="clientSupportHeroOrb">
          <span aria-hidden="true">!</span>
        </div>
        <div className="clientSupportHeroCopy">
          <h2>Кабинет временно недоступен</h2>
          <p>Попробуйте обновить страницу или вернуться в кабинет еще раз.</p>
        </div>
        <div className="clientSupportHeroActions">
          <button className="clientSupportHeroButton isPrimary" onClick={reset} type="button">
            Попробовать еще раз
          </button>
          <Link className="clientSupportHeroButton isSecondary" href="/cabinet">
            В кабинет
          </Link>
        </div>
      </section>
    </main>
  );
}
