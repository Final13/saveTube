"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { RATES } from "@/lib/rates";

interface Page<T> {
  items: T[];
  hasMore: boolean;
}

interface PaymentsData {
  provider: "tbank" | "yookassa";
  methodStats: Array<{ method: string; count: number }>;
  recurrentActive: { total: number; byDays: Record<number, number> };
  payments: Page<{
    id: number;
    email: string;
    rate_index: number;
    amount: number;
    title: string;
    status: 0 | 1;
    provider: string;
    method: string | null;
    merchant_id: string | null;
    subscription_until: number | null;
    created_at: number | null;
  }>;
  recurrent: Page<{
    id: number;
    email: string;
    rate_index: number;
    yookassa_payment_method_id: string;
    card_type: string | null;
    card_last4: string | null;
    active: boolean;
    success_streak: number;
    next_billing_at: number;
    created_at: number | null;
  }>;
}

const PROVIDERS = [
  { key: "tbank" as const, label: "T-Bank", hint: "разовые платежи" },
  { key: "yookassa" as const, label: "ЮKassa", hint: "автопродление" },
];

// Колонки таблицы автопродлений, по которым есть сортировка
type RecurrentSortKey =
  | "email"
  | "rate_index"
  | "method"
  | "created_at"
  | "next_billing_at"
  | "success_streak"
  | "active";

function rateTitle(index: number): string {
  return RATES[index]?.title ?? `#${index}`;
}

// Коды методов ЮKassa → читаемые подписи (в recurrent card_type лежит код метода,
// если метод не карта; для карт там тип карты + last4)
const METHOD_LABELS: Record<string, string> = {
  bank_card: "Банковская карта",
  sberbank: "SberPay",
  yoo_money: "ЮMoney",
  sbp: "СБП",
  tinkoff_bank: "T-Pay",
  alfa_pay: "Alfa Pay",
  mir_pay: "Mir Pay",
};

function methodLabel(cardType: string | null, cardLast4: string | null): string {
  if (cardLast4) return `${cardType ? `${cardType} ` : ""}•• ${cardLast4}`;
  if (!cardType) return "—";
  return METHOD_LABELS[cardType] ?? cardType;
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
  const [backfilling, setBackfilling] = useState(false);
  const [backfillingStreaks, setBackfillingStreaks] = useState(false);
  const [loadingMore, setLoadingMore] = useState<"payments" | "recurrent" | null>(null);
  const [recurrentSort, setRecurrentSort] = useState<{
    key: RecurrentSortKey;
    dir: "asc" | "desc";
  } | null>(null);
  const [loadingAllRecurrent, setLoadingAllRecurrent] = useState(false);

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

  // Догрузка следующей страницы таблицы (курсор — id последней показанной записи)
  async function loadMore(table: "payments" | "recurrent") {
    if (!data || loadingMore) return;
    const page = data[table];
    const last = page.items[page.items.length - 1];
    if (!page.hasMore || !last) return;
    setLoadingMore(table);
    try {
      const response = await fetch(`/api/admin/payments?${table}_before=${last.id}`, { cache: "no-store" });
      if (!response.ok) {
        setError("Не удалось загрузить ещё.");
        return;
      }
      const body = (await response.json()) as {
        payments?: PaymentsData["payments"];
        recurrent?: PaymentsData["recurrent"];
      };
      setData((prev) => {
        if (!prev) return prev;
        if (table === "payments") {
          if (!body.payments) return prev;
          return {
            ...prev,
            payments: {
              items: [...prev.payments.items, ...body.payments.items],
              hasMore: body.payments.hasMore,
            },
          };
        }
        if (!body.recurrent) return prev;
        return {
          ...prev,
          recurrent: {
            items: [...prev.recurrent.items, ...body.recurrent.items],
            hasMore: body.recurrent.hasMore,
          },
        };
      });
      setError("");
    } catch {
      setError("Ошибка сети.");
    } finally {
      setLoadingMore(null);
    }
  }

  // Клик по заголовку: переключает направление; для сортировки догружает ВСЕ записи
  // (курсорная постраничка несовместима с произвольным ORDER BY, записей немного)
  async function toggleRecurrentSort(key: RecurrentSortKey) {
    setRecurrentSort((prev) =>
      prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
    if (!data?.recurrent.hasMore || loadingAllRecurrent) return;
    setLoadingAllRecurrent(true);
    try {
      const response = await fetch("/api/admin/payments?recurrent_all=1", { cache: "no-store" });
      if (response.ok) {
        const body = (await response.json()) as { recurrent?: PaymentsData["recurrent"] };
        if (body.recurrent) {
          const all = body.recurrent;
          setData((prev) => (prev ? { ...prev, recurrent: all } : prev));
        }
      }
    } catch {
      // не страшно — отсортируется то, что уже загружено
    } finally {
      setLoadingAllRecurrent(false);
    }
  }

  const recurrentItems = useMemo(() => {
    if (!data) return [];
    const items = [...data.recurrent.items];
    if (!recurrentSort) return items;
    const dir = recurrentSort.dir === "asc" ? 1 : -1;
    const value = (r: PaymentsData["recurrent"]["items"][number]): string | number => {
      switch (recurrentSort.key) {
        case "email":
          return r.email;
        case "rate_index":
          return r.rate_index;
        case "method":
          return methodLabel(r.card_type, r.card_last4);
        case "created_at":
          return r.created_at ?? 0;
        case "next_billing_at":
          return r.next_billing_at;
        case "success_streak":
          return r.success_streak;
        case "active":
          return r.active ? 1 : 0;
      }
    };
    items.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : va - Number(vb);
      return cmp * dir;
    });
    return items;
  }, [data, recurrentSort]);

  // Заголовок-колонка автопродлений с сортировкой
  const th = (key: RecurrentSortKey, label: string, className = "py-1 pr-4") => {
    const active = recurrentSort?.key === key ? recurrentSort : null;
    return (
      <th
        onClick={() => void toggleRecurrentSort(key)}
        className={`${className} cursor-pointer select-none font-medium transition hover:text-slate-600 dark:hover:text-zinc-300`}
        title="Нажмите для сортировки"
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active ? (
            active.dir === "asc" ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )
          ) : (
            <ChevronsUpDown className="size-3.5 opacity-40" />
          )}
        </span>
      </th>
    );
  };

  // Бэкфилл способов оплаты для старых платежей ЮKassa (колонка появилась позже)
  async function backfillMethods() {
    if (backfilling) return;
    setBackfilling(true);
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-methods" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message || "Не удалось подтянуть способы.");
        return;
      }
      await load();
    } catch {
      setError("Ошибка сети.");
    } finally {
      setBackfilling(false);
    }
  }

  // Бэкфилл серий успешных автосписаний по прошлым платежам «(автопродление)»
  async function backfillStreaks() {
    if (backfillingStreaks) return;
    setBackfillingStreaks(true);
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-streaks" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message || "Не удалось подтянуть серии.");
        return;
      }
      await load();
    } catch {
      setError("Ошибка сети.");
    } finally {
      setBackfillingStreaks(false);
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
            <h3 className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-zinc-200">
              Автопродления (активных: {data.recurrentActive.total}){" "}
              <span className="font-normal text-slate-500 dark:text-zinc-400">
                — 365 дней: {data.recurrentActive.byDays[365] ?? 0}, 30 дней:{" "}
                {data.recurrentActive.byDays[30] ?? 0}, 7 дней: {data.recurrentActive.byDays[7] ?? 0}
              </span>
              <button
                onClick={() => void backfillStreaks()}
                disabled={backfillingStreaks}
                title="Пересчитать «Успешных подряд» по прошлым платежам «(автопродление)»"
                className="rounded-md border border-sky-600 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400 transition hover:bg-sky-50 dark:hover:bg-sky-950 disabled:opacity-60"
              >
                {backfillingStreaks ? "Подтягиваю…" : "Подтянуть серии"}
              </button>
            </h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  {th("email", "Email")}
                  {th("rate_index", "Тариф")}
                  {th("method", "Способ")}
                  {th("created_at", "Дата подписки")}
                  {th("next_billing_at", "Следующее списание")}
                  {th("success_streak", "Успешных подряд")}
                  {th("active", "Статус", "py-1")}
                </tr>
              </thead>
              <tbody>
                {recurrentItems.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-zinc-800 text-slate-700 dark:text-zinc-200">
                    <td className="py-1.5 pr-4">{r.email}</td>
                    <td className="py-1.5 pr-4">{rateTitle(r.rate_index)}</td>
                    <td className="py-1.5 pr-4">{methodLabel(r.card_type, r.card_last4)}</td>
                    <td className="py-1.5 pr-4">{formatDate(r.created_at)}</td>
                    <td className="py-1.5 pr-4">{formatDate(r.next_billing_at)}</td>
                    <td className="py-1.5 pr-4">{r.success_streak}</td>
                    <td
                      className={`py-1.5 ${r.active ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}
                    >
                      {r.active ? "активно" : "выключено"}
                    </td>
                  </tr>
                ))}
                {recurrentItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-center text-slate-400">
                      Пока нет автопродлений
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {loadingAllRecurrent && (
              <p className="mt-2 text-xs text-slate-400">Загружаю все записи для сортировки…</p>
            )}
            {data.recurrent.hasMore && !recurrentSort && (
              <button
                onClick={() => void loadMore("recurrent")}
                disabled={loadingMore === "recurrent"}
                className="mt-3 w-full rounded-lg border border-slate-200 dark:border-zinc-800 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 transition hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-60"
              >
                {loadingMore === "recurrent" ? "Загрузка…" : "Показать ещё 10"}
              </button>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
            <h3 className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-zinc-200">
              Способы оплаты (все оплаченные)
              {data.methodStats.some((s) => s.method === "ЮKassa — без данных") && (
                <button
                  onClick={() => void backfillMethods()}
                  disabled={backfilling}
                  className="rounded-md border border-sky-600 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400 transition hover:bg-sky-50 dark:hover:bg-sky-950 disabled:opacity-60"
                >
                  {backfilling ? "Подтягиваю…" : "Подтянуть способы из ЮKassa"}
                </button>
              )}
            </h3>
            {(() => {
              const total = data.methodStats.reduce((sum, s) => sum + s.count, 0);
              if (total === 0) {
                return <p className="mt-2 text-sm text-slate-400">Оплаченных платежей пока нет.</p>;
              }
              return (
                <div className="mt-3 space-y-2">
                  {data.methodStats.map((s) => {
                    const pct = (s.count / total) * 100;
                    return (
                      <div key={s.method}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-slate-700 dark:text-zinc-200">{s.method}</span>
                          <span className="text-xs text-slate-400">
                            {s.count} · {pct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
                          <div className="h-full rounded-full bg-sky-600" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
                  <th className="py-1 pr-4 font-medium">Способ</th>
                  <th className="py-1 pr-4 font-medium">Статус</th>
                  <th className="py-1 pr-4 font-medium">Дата платежа</th>
                  <th className="py-1 font-medium">Подписка до</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.items.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 dark:border-zinc-800 text-slate-700 dark:text-zinc-200">
                    <td className="py-1.5 pr-4 font-mono text-xs">{p.id}</td>
                    <td className="py-1.5 pr-4">{p.email}</td>
                    <td className="py-1.5 pr-4">{p.amount} ₽</td>
                    <td className="py-1.5 pr-4">
                      {p.provider === "yookassa" ? "ЮKassa" : p.provider === "tbank" ? "T-Bank" : "—"}
                    </td>
                    <td className="py-1.5 pr-4">{p.method ?? "—"}</td>
                    <td
                      className={`py-1.5 pr-4 ${p.status === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                    >
                      {p.status === 1 ? "оплачен" : "ожидает"}
                    </td>
                    <td className="py-1.5 pr-4">{formatDate(p.created_at)}</td>
                    <td className="py-1.5">{formatDate(p.subscription_until)}</td>
                  </tr>
                ))}
                {data.payments.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-3 text-center text-slate-400">
                      Платежей пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {data.payments.hasMore && (
              <button
                onClick={() => void loadMore("payments")}
                disabled={loadingMore === "payments"}
                className="mt-3 w-full rounded-lg border border-slate-200 dark:border-zinc-800 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 transition hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-60"
              >
                {loadingMore === "payments" ? "Загрузка…" : "Показать ещё 10"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
