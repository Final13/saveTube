"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { User, Zap } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import AuthModal from "@/components/auth-modal";

// Шапка: логотип + вход в ЛК. Не залогинен — «Войти» открывает модалку входа,
// залогинен — «Кабинет» на /account, с активной подпиской — значок «Премиум».
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
  const [premium, setPremium] = useState(false);
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setLoggedIn(r.ok))
      .catch(() => {});

    const savedEmail = document.cookie
      .split("; ")
      .find((r) => r.startsWith("user_email="))
      ?.split("=")[1];
    if (savedEmail) {
      fetch(`/api/payment/status?email=${savedEmail}`)
        .then((r) => r.json())
        .then((data) => data.status && setPremium(true))
        .catch(() => {});
    }
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-xl font-bold italic text-sky-600 dark:text-sky-400">
          SaveTube
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle initialTheme={initialTheme} />
          {premium ? (
            <Link
              href="/account"
              className="flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-3 py-1.5 text-sm font-semibold text-amber-600 transition hover:bg-amber-400/25 dark:text-amber-300"
            >
              <Zap className="size-4 fill-amber-400 text-amber-400" /> Премиум
            </Link>
          ) : loggedIn ? (
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
