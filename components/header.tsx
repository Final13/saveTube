"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { User } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import AuthModal from "@/components/auth-modal";

// Шапка: логотип + вход в ЛК. Не залогинен — «Войти» открывает модалку входа,
// залогинен — «Кабинет» на /account.
// initialLoggedIn приходит с SSR (layout читает сессию) — без мигания «Войти»→«Кабинет»;
// fetch ниже корректирует в обе стороны (logout в другой вкладке и т.п.).
// Покупка подписки — через premium-modal («⚡ Ускорить» в форме скачивания).
export default function Header({
  initialLoggedIn = false,
  initialTheme,
}: {
  initialLoggedIn?: boolean;
  initialTheme?: "light" | "dark";
}) {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setLoggedIn(r.ok))
      .catch(() => {});
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
        <Link href="/" className="flex items-center text-2xl text-sky-600 dark:text-sky-400">
          <span className="font-bold">Save</span>
          {/* -ml-1 сближает «Tube» со «Save»: у курсива верх «T» уходит вправо,
              и без сдвига логотип визуально разрывается на два слова */}
          <span className="-ml-1 italic">Tube</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle initialTheme={initialTheme} />
          {loggedIn ? (
            <Link
              href="/account"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <User className="size-4" /> Кабинет
            </Link>
          ) : (
            <button
              onClick={() => setAuthOpen(true)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Войти
            </button>
          )}
        </div>
      </div>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={() => {
          setLoggedIn(true);
          router.refresh();
        }}
      />
    </header>
  );
}
