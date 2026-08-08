"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, LogOut, Zap } from "lucide-react";
import { RATES } from "@/lib/rates";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AccountData {
  email: string;
  premium_until: number | null;
  recurrent: {
    rate_index: number;
    card_type: string | null;
    card_last4: string | null;
    next_billing_at: number;
    active: boolean;
  } | null;
  payments: Array<{
    id: number;
    amount: number;
    title: string;
    status: 0 | 1;
    provider: string;
    subscription_until: number | null;
  }>;
}

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function providerLabel(provider: string): string {
  return provider === "yookassa" ? "ЮKassa" : provider === "tbank" ? "T-Bank" : "—";
}

// Личный кабинет по сессии (iron-session cookie savetube_session).
// Нет сессии — вход по одноразовому коду из письма (шаг 1: email → код на почту,
// шаг 2: ввод кода); есть сессия — статус подписки, автопродление с отвязкой
// карты, история платежей, кнопка «Выйти». Паролей нет: аккаунт создаётся
// автоматически при первой оплате или при первом входе по коду.
export default function AccountPanel() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeExpired, setCodeExpired] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/account", { cache: "no-store" });
      const body = await res.json();
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      if (!res.ok) throw new Error(body.message || "Ошибка загрузки.");
      setData(body);
      setAuthed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Отложенный запрос после монтирования (react-hooks/set-state-in-effect)
    setTimeout(() => void load(), 0);
  }, [load]);

  async function handleRequestCode() {
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError("");
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
      setAuthError(e instanceof Error ? e.message : "Ошибка сети.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError("");
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
          setAuthError("Код недействителен или просрочен.");
        } else {
          throw new Error(body.message || "Не удалось войти.");
        }
        return;
      }
      setCode("");
      await load();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Ошибка сети.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // даже при ошибке сети локально считаем, что вышли
    }
    setData(null);
    setAuthed(false);
    setCodeSent(false);
    setCodeExpired(false);
  }

  async function handleUnlink() {
    if (unlinking) return;
    if (!window.confirm("Отвязать карту? Автопродление будет отключено, подписка продолжит действовать до оплаченной даты.")) {
      return;
    }
    setUnlinking(true);
    try {
      const res = await fetch("/api/account/unlink", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Не удалось отвязать карту.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети.");
    } finally {
      setUnlinking(false);
    }
  }

  if (authed === null) {
    return (
      <div className="mt-4 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
        <Loader2 className="size-5 animate-spin" /> Загрузка…
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="mt-4 max-w-md space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Вход — по одноразовому коду из письма, пароль не нужен. Если аккаунта ещё нет, он
          создастся автоматически (так же, как при первой оплате подписки).
        </p>
        <div className="space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4">
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
              className="h-12 w-full rounded-lg border border-zinc-300 bg-white px-4 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 text-center text-lg tracking-[0.5em] text-zinc-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:focus:ring-sky-800"
            />
          )}

          {codeSent && !codeExpired && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Код отправлен на {email.trim()}. Действует 5 минут.
            </p>
          )}
          {authError && <p className="text-sm text-red-600 dark:text-red-400">{authError}</p>}

          {!codeSent ? (
            <button
              onClick={() => void handleRequestCode()}
              disabled={authLoading || !EMAIL_REGEX.test(email.trim())}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-6 font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authLoading && <Loader2 className="size-5 animate-spin" />}
              Получить код
            </button>
          ) : (
            <>
              <button
                onClick={() => void handleVerifyCode()}
                disabled={authLoading || code.length !== 6}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-6 font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {authLoading && <Loader2 className="size-5 animate-spin" />}
                Войти
              </button>
              <button
                onClick={() => void handleRequestCode()}
                disabled={authLoading}
                className="w-full text-center text-sm text-sky-700 dark:text-sky-400 transition hover:underline disabled:opacity-60"
              >
                {codeExpired ? "Выслать код повторно" : "Не пришёл код? Отправить ещё раз"}
              </button>
              <button
                onClick={() => {
                  setCodeSent(false);
                  setCode("");
                  setCodeExpired(false);
                  setAuthError("");
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

  const premiumActive = data?.premium_until !== null && data?.premium_until !== undefined;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{data?.email}</p>
        <button
          onClick={() => void handleLogout()}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <LogOut className="size-4" />
          Выйти
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loading && !data && (
        <p className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <Loader2 className="size-5 animate-spin" /> Загрузка…
        </p>
      )}

      {data && (
        <>
          {/* Статус подписки */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4">
            {premiumActive ? (
              <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                <Zap className="size-5 fill-amber-400 text-amber-400" />
                Подписка активна до {formatDate(data.premium_until)}
              </p>
            ) : (
              <p className="font-medium text-zinc-600 dark:text-zinc-400">Активной подписки нет.</p>
            )}
          </div>

          {/* Привязанная карта / автопродление */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4">
            <h2 className="font-semibold text-slate-800 dark:text-zinc-100">Автопродление</h2>
            {data.recurrent ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm">
                  <CreditCard className="size-5 text-zinc-500 dark:text-zinc-400" />
                  {data.recurrent.card_type ? `${data.recurrent.card_type} ` : ""}••{" "}
                  {data.recurrent.card_last4 ?? "····"}
                </span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {RATES[data.recurrent.rate_index]?.title ?? "Подписка"}, следующее списание —{" "}
                  {formatDate(data.recurrent.next_billing_at)}
                </span>
                <button
                  onClick={handleUnlink}
                  disabled={unlinking}
                  className="ml-auto flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-60"
                >
                  {unlinking && <Loader2 className="size-4 animate-spin" />}
                  Отвязать карту
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Карта не привязана. Автопродление появится после оплаты подписки через ЮKassa.
              </p>
            )}
          </div>

          {/* История платежей */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4">
            <h2 className="font-semibold text-slate-800 dark:text-zinc-100">История платежей</h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="py-1 pr-4 font-medium">#</th>
                  <th className="py-1 pr-4 font-medium">Платёж</th>
                  <th className="py-1 pr-4 font-medium">Сумма</th>
                  <th className="py-1 pr-4 font-medium">Провайдер</th>
                  <th className="py-1 pr-4 font-medium">Статус</th>
                  <th className="py-1 font-medium">Подписка до</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300">
                    <td className="py-1.5 pr-4 font-mono text-xs">{p.id}</td>
                    <td className="py-1.5 pr-4">{p.title}</td>
                    <td className="py-1.5 pr-4">{p.amount} ₽</td>
                    <td className="py-1.5 pr-4">{providerLabel(p.provider)}</td>
                    <td
                      className={`py-1.5 pr-4 ${p.status === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                    >
                      {p.status === 1 ? "оплачен" : "ожидает"}
                    </td>
                    <td className="py-1.5">{formatDate(p.subscription_until)}</td>
                  </tr>
                ))}
                {data.payments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 text-center text-zinc-400">
                      Платежей не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
