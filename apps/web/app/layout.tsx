import type { Metadata } from "next";
import { Manrope, Rubik } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-body"
});

const rubik = Rubik({
  subsets: ["latin", "cyrillic"],
  variable: "--font-heading"
});

export const metadata: Metadata = {
  title: "FOX POINT | Интернет должен просто работать",
  description: "Сайт, личный кабинет и админ-панель FOX POINT",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      {
        rel: "icon",
        url: "/favicon.ico"
      },
      {
        rel: "icon",
        url: "/images/foxpoint-logo.png",
        sizes: "512x512",
        type: "image/png"
      }
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png"
      }
    ],
    shortcut: ["/favicon.ico"]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FOX POINT"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body
        style={{
          fontFamily: "var(--font-body, sans-serif)"
        }}
        className={`${manrope.variable} ${rubik.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
