import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import Header from "@/components/header";
import Footer from "@/components/footer";
import Metrika from "@/components/metrika";
import { ThemeProvider } from "@/lib/theme";
import { getSession } from "@/lib/auth/session";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  // italic нужен для логотипа («Tube»): без него браузер рисует faux-italic,
  // который сдвигает верх «T» вправо и логотип визуально разрывается на «Save Tube»
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Скачать видео с RuTube бесплатно – Быстрый онлайн-загрузчик",
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  verification: {
    google: process.env.GOOGLE_VERIFICATION || undefined,
    yandex: process.env.YANDEX_VERIFICATION || undefined,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    siteName: SITE_NAME,
    locale: "ru_RU",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;

  // Валидируем куку: допустимы только light/dark/system
  const validTheme: "light" | "dark" | "system" | null =
    themeCookie === "light" || themeCookie === "dark" || themeCookie === "system"
      ? themeCookie
      : null;

  // Для SSR класса на <html>: только light/dark (system разрешается клиентским скриптом)
  const serverTheme = validTheme === "light" || validTheme === "dark" ? validTheme : "";

  // Для SSR иконки темы: передаём resolved значение только если кука явно light/dark.
  // Если куки нет или system — оставляем undefined, чтобы клиент сам определил prefers-color-scheme.
  const serverResolvedTheme: "light" | "dark" | undefined =
    validTheme === "dark" ? "dark" : validTheme === "light" ? "light" : undefined;

  // SSR-статус входа: шапка сразу рендерит «Кабинет» для залогиненных,
  // без мигания «Войти»→«Кабинет» после загрузки
  const session = await getSession();
  const loggedIn = Boolean(session.userId);

  return (
    <html
      lang="ru"
      className={`${inter.variable} h-full antialiased ${serverTheme}`.trim()}
      suppressHydrationWarning
    >
      {/* Инлайн-скрипт против FOUC: ставит класс dark/light на <html> до рендера body */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var m=document.cookie.match(new RegExp("(^| )theme=([^;]+)"));var s=m?decodeURIComponent(m[2]):null;var r;if(!s||s==="system"){r=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}else{r=s}var h=document.documentElement;h.classList.remove("light","dark");h.classList.add(r)}catch(e){}})();`,
        }}
      />
      <body className="flex min-h-full flex-col font-sans">
        <ThemeProvider defaultResolvedTheme={serverResolvedTheme}>
          <Header initialLoggedIn={loggedIn} initialTheme={serverResolvedTheme} />
          <main className="mx-auto w-full max-w-4xl flex-1 px-4">{children}</main>
          <Footer />
        </ThemeProvider>
        <Metrika />
      </body>
    </html>
  );
}
