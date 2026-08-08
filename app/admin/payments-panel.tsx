"use client";

import { useCallback, useEffect, useState } from "react";
import { RATES } from "@/lib/rates";

interface PaymentsData {
  provider: "tbank" | "yookassa";
  payments: Array<{
    id: number;
    email: string;
    rate_index: number;
    amount: number;
    title: string;
    status: 0 | 1;
    provider: string;
    merchant_id: string | null;
    subscription_until: number | null;
  }>;
  recurrent: Array<{
    id: number;
    email: string;
    rate_index: number;
    yookassa_payment_method_id: string;
    active: boolean;
    next_billing_at: number;
    created_at: number | null;
  }>;
}

const PROVIDERS = [
  { key: "tbank" as const, label: "T-Bank", hint: "разовые платежи" },
  { key: "yookassa" as const, label: "ЮKassa", hint: "автопродление" },
];

function rateTitle(index: number): string {
  return RATES[index]?.title ?? `#${index}`;
}

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("ru-RU", {
    day: "numeric",
    month: "numeric",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Раздел «Оплата» в админке: переключатель провайдера (влияет на новые платежи всех
// пользователей, активные подписки продолжают работать), рекуррентные подписки, история.
export default function PaymentsPanel() {
  const [data, setData] = useState<PaymentsData | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/payments", { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 403 ? "Сессия истекла, войдите снова." : "Ошибка загрузки.");
        return;
      }
      setData((await response.json()) as PaymentsData);
      setError("");
    } catch {
      setError("Ошибка сети.");
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    return () => clearTimeout(initial);
  }, [load]);

  async function switchProvider(provider: "tbank" | "yookassa") {
    if (saving || data?.provider === provider) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message || "Не удалось сохранить.");
        return;
      }
      await load();
    } catch {
      setError("Ошибка сети.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-8">
      <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100">Оплата</h2>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500 dark:text-zinc-400">Провайдер для новых платежей:</span>
        <div className="flex rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              disabled={saving}
              onClick={() => void switchProvider(p.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                data?.provider === p.key
                  ? "bg-sky-600 font-semibold text-white"
                  : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
              }`}
            >
              {p.label} <span className="text-xs opacity-75">({p.hint})</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          активные подписки работают независимо от переключателя
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <p className="mt-4 text-sm text-slate-500 dark:text-zinc-400">Загрузка…</p>}

      {data && (
        <>
          <div className="mt-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-zinc-200">
              Автопродления ЮKassa ({data.recurrent.filter((r) => r.active).length})
            </h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="py-1 pr-4 font-medium">Email</th>
                  <th className="py-1 pr-4 font-medium">Тариф</th>
                  <th className="py-1 pr-4 font-medium">Следующее списание</th>
                  <th className="py-1 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.recurrent.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-zinc-800 text-slate-700 dark:text-zinc-200">
                    <td className="py-1.5 pr-4">{r.email}</td>
                    <td className="py-1.5 pr-4">{rateTitle(r.rate_index)}</td>
                    <td className="py-1.5 pr-4">{formatDate(r.next_billing_at)}</td>
                    <td
                      className={`py-1.5 ${r.active ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}
                    >
                      {r.active ? "активно" : "выключено"}
                    </td>
                  </tr>
                ))}
                {data.recurrent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-slate-400">
                      Пока нет автопродлений
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-zinc-200">Последние платежи</h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="py-1 pr-4 font-medium">#</th>
                  <th className="py-1 pr-4 font-medium">Email</th>
                  <th className="py-1 pr-4 font-medium">Сумма</th>
                  <th className="py-1 pr-4 font-medium">Провайдер</th>
                  <th className="py-1 pr-4 font-medium">Статус</th>
                  <th className="py-1 font-medium">Подписка до</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 dark:border-zinc-800 text-slate-700 dark:text-zinc-200">
                    <td className="py-1.5 pr-4 font-mono text-xs">{p.id}</td>
                    <td className="py-1.5 pr-4">{p.email}</td>
                    <td className="py-1.5 pr-4">{p.amount} ₽</td>
                    <td className="py-1.5 pr-4">
                      {p.provider === "yookassa" ? "ЮKassa" : p.provider === "tbank" ? "T-Bank" : "—"}
                    </td>
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
                    <td colSpan={6} className="py-3 text-center text-slate-400">
                      Платежей пока нет
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
