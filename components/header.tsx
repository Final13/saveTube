"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { User, Zap } from "lucide-react";

// Шапка: логотип + вход в ЛК. Не залогинен — «Войти» на /account,
// залогинен — «Кабинет», с активной подпиской — значок «Премиум».
// Покупка подписки — через premium-modal («⚡ Ускорить» в форме скачивания).
export default function Header() {
  const [premium, setPremium] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.ok && setLoggedIn(true))
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
    <header className="sticky top-0 z-40 bg-slate-700">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-xl font-bold italic text-white">
          SaveTube
        </Link>
        {premium ? (
          <Link
            href="/account"
            className="flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-3 py-1.5 text-sm font-semibold text-amber-300 transition hover:bg-amber-400/25"
          >
            <Zap className="size-4 fill-amber-400 text-amber-400" /> Премиум
          </Link>
        ) : loggedIn ? (
          <Link
            href="/account"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-600"
          >
            <User className="size-4" /> Кабинет
          </Link>
        ) : (
          <Link
            href="/account"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-600"
          >
            Войти
          </Link>
        )}
      </div>
    </header>
  );
}
