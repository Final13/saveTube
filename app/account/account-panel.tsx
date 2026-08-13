"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, LogOut, Zap } from "lucide-react";
import AuthForm from "@/components/auth-form";
import { RATES } from "@/lib/rates";

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

// Коды сохранённых методов ЮKassa → читаемые подписи (в card_type лежит код метода,
// если метод не карта; для карт там тип карты, а last4 — в card_last4).
const METHOD_LABELS: Record<string, string> = {
  bank_card: "Банковская карта",
  sberbank: "SberPay",
  yoo_money: "ЮMoney",
  sbp: "СБП",
  tinkoff_bank: "T-Pay",
  alfa_pay: "Alfa Pay",
  mir_pay: "Mir Pay",
};

function recurrentMethodLabel(cardType: string | null, cardLast4: string | null): string {
  if (cardLast4) return `${cardType ? `${cardType} ` : ""}•• ${cardLast4}`;
  if (cardType && METHOD_LABELS[cardType]) return METHOD_LABELS[cardType];
  return cardType ?? "Сохранённый способ оплаты";
}

// Личный кабинет по сессии (iron-session cookie savetube_session).
// Нет сессии — вход по одноразовому коду из письма (шаг 1: email → код на почту,
// шаг 2: ввод кода); есть сессия — статус подписки, автопродление с отвязкой
// карты, история платежей, кнопка «Выйти». Паролей нет: аккаунт создаётся
// автоматически при первой оплате или при первом входе по коду.
export default function AccountPanel() {
  const [authed, setAuthed] = useState<boolean | null>(null);
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

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // даже при ошибке сети локально считаем, что вышли
    }
    setData(null);
    setAuthed(false);
  }

  async function handleUnlink() {
    if (unlinking) return;
    if (!window.confirm("Отвязать способ оплаты? Автопродление будет отключено, подписка продолжит действовать до оплаченной даты.")) {
      return;
    }
    setUnlinking(true);
    try {
      const res = await fetch("/api/account/unlink", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Не удалось отвязать способ оплаты.");
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
      <div className="mt-4 max-w-md">
        <AuthForm onSuccess={load} />
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
                  {recurrentMethodLabel(data.recurrent.card_type, data.recurrent.card_last4)}
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
                  Отвязать способ оплаты
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Способ оплаты не привязан. Автопродление появится после оплаты подписки через ЮKassa.
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
