import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "FoxPoint | Интернет, как раньше",
  description: "Сайт, личный кабинет и админ-панель проекта 'Интернет, как раньше'"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body
        style={{
          fontFamily: "var(--font-body, sans-serif)"
        }}
        className={manrope.variable}
      >
        {children}
      </body>
    </html>
  );
}
