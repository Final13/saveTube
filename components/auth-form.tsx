"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Форма входа по одноразовому коду из письма (шаг 1: email → код на почту,
// шаг 2: ввод кода). Используется на странице /account и в модалке входа (шапка).
// Паролей нет: аккаунт создаётся автоматически при первом входе по коду
// или при первой оплате подписки.
export default function AuthForm({ onSuccess }: { onSuccess: () => void | Promise<void> }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeExpired, setCodeExpired] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRequestCode() {
    if (loading) return;
    setLoading(true);
    setError("");
    setCodeExpired(false);
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Не удалось отправить код.");
      setCode("");
      setCodeSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (loading) return;
    setLoading(true);
    setError("");
    setCodeExpired(false);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.expired) {
          setCodeExpired(true);
          setError("Код недействителен или просрочен.");
        } else {
          throw new Error(body.message || "Не удалось войти.");
        }
        return;
      }
      setCode("");
      await onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Вход — по одноразовому коду из письма, пароль не нужен. Если аккаунта ещё нет, он создастся
        автоматически (так же, как при первой оплате подписки).
      </p>
      <div className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-Mail"
          disabled={codeSent}
          className="h-12 w-full rounded-lg border border-zinc-300 bg-white px-4 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 text-zinc-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:focus:ring-sky-800 disabled:opacity-60"
        />
        {codeSent && (
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && code.length === 6 && void handleVerifyCode()}
            placeholder="Код из письма (6 цифр)"
            className="h-12 w-full rounded-lg border border-zinc-300 bg-white px-4 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 text-center text-lg text-zinc-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:focus:ring-sky-800"
          />
        )}

        {codeSent && !codeExpired && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Код отправлен на {email.trim()}. Действует 5 минут.
          </p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!codeSent && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Входя, вы соглашаетесь с{" "}
            <a
              href="/agreement"
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 transition hover:underline dark:text-sky-400"
            >
              Пользовательским соглашением
            </a>{" "}
            и подтверждаете ознакомление с{" "}
            <a
              href="/privacy-policy"
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 transition hover:underline dark:text-sky-400"
            >
              Политикой конфиденциальности
            </a>
            .
          </p>
        )}
        {!codeSent ? (
          <button
            onClick={() => void handleRequestCode()}
            disabled={loading || !EMAIL_REGEX.test(email.trim())}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-6 font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Loader2 className="size-5 animate-spin" />}
            Получить код
          </button>
        ) : (
          <>
            <button
              onClick={() => void handleVerifyCode()}
              disabled={loading || code.length !== 6}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-6 font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 className="size-5 animate-spin" />}
              Войти
            </button>
            <button
              onClick={() => void handleRequestCode()}
              disabled={loading}
              className="w-full text-center text-sm text-sky-700 dark:text-sky-400 transition hover:underline disabled:opacity-60"
            >
              {codeExpired ? "Выслать код повторно" : "Не пришёл код? Отправить ещё раз"}
            </button>
            <button
              onClick={() => {
                setCodeSent(false);
                setCode("");
                setCodeExpired(false);
                setError("");
              }}
              className="w-full text-center text-sm text-zinc-500 dark:text-zinc-400 transition hover:underline"
            >
              Изменить E-Mail
            </button>
          </>
        )}
      </div>
    </div>
  );
}
