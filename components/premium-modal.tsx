"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, Zap } from "lucide-react";
import { RATES } from "@/lib/rates";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 25; // ~2 минуты ожидания оплаты

type Screen = "default" | "wait" | "success" | "error" | "confirm" | "confirm-success";

interface PremiumModalProps {
  open: boolean;
  initialScreen?: Screen;
  onClose: () => void;
  onActivated: () => void;
}

function getEmailCookie(): string {
  if (typeof document === "undefined") return "";
  const row = document.cookie.split("; ").find((r) => r.startsWith("user_email="));
  return row ? decodeURIComponent(row.split("=")[1]) : "";
}

export default function PremiumModal({
  open,
  initialScreen = "default",
  onClose,
  onActivated,
}: PremiumModalProps) {
  // Компонент перемонтируется по key при каждом открытии — начальные состояния считаем на маунте
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [rateIndex, setRateIndex] = useState<number | null>(null);
  const [email, setEmail] = useState(getEmailCookie);
  const [checkEmail, setCheckEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const pollCount = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    pollCount.current = 0;
  };

  // Чистим поллинг при размонтировании
  useEffect(() => stopPolling, []);

  const activate = (targetScreen: Screen) => {
    stopPolling();
    setScreen(targetScreen);
    onActivated();
  };

  const startPolling = (paymentId: number, userEmail: string) => {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      pollCount.current++;
      if (pollCount.current > POLL_MAX_ATTEMPTS) {
        stopPolling();
        setScreen("error");
        return;
      }
      try {
        const res = await fetch(
          `/api/payment/status?payment_id=${paymentId}&email=${encodeURIComponent(userEmail)}`,
        );
        const data = await res.json();
        if (data.status) activate("success");
      } catch {
        // сеть моргнула — ждём следующий тик
      }
    }, POLL_INTERVAL_MS);
  };

  const handlePay = async () => {
    setError(null);
    const trimmed = email.trim();
    if (!EMAIL_REGEX.test(trimmed)) {
      setError("Пожалуйста, введите корректный E-Mail адрес");
      return;
    }
    if (rateIndex === null) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/payment?email=${encodeURIComponent(trimmed)}&rate=${rateIndex}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка сервера, попробуйте позднее");
      window.open(data.url, "_blank");
      setScreen("wait");
      startPolling(data.payment_id, trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сервера, попробуйте позднее");
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    setError(null);
    const trimmed = checkEmail.trim();
    if (!EMAIL_REGEX.test(trimmed)) {
      setError("Пожалуйста, введите корректный E-Mail адрес");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/payment/status?email=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка сервера, попробуйте позднее");
      if (data.status) {
        activate("confirm-success");
      } else {
        throw new Error("На данный E-Mail не найдено активной подписки!");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сервера, попробуйте позднее");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    stopPolling();
    setScreen("default");
    setRateIndex(null);
    setError(null);
    setCheckEmail("");
    setAgreed(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="flex items-start justify-between">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <Zap className="size-5 text-amber-500" /> Ускорить загрузку
          </p>
          <button onClick={close} aria-label="Закрыть">
            <X className="size-5 text-zinc-400 dark:text-zinc-500 transition hover:text-zinc-700" />
          </button>
        </div>

        {screen === "default" && (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              По-умолчанию скачивание видео происходит в 2-ух потоках, подписка позволит указать
              любое количество потоков!
            </p>
            <p className="text-sm font-medium">Выберите подписку</p>
            <div className="grid grid-cols-3 gap-2">
              {RATES.map((rate, i) => (
                <button
                  key={rate.title}
                  onClick={() => setRateIndex(i)}
                  className={`rounded-lg border p-3 text-center transition ${
                    rateIndex === i
                      ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600 dark:border-sky-500 dark:bg-sky-950 dark:ring-sky-500"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
                  }`}
                >
                  <p className="text-sm font-semibold">{rate.title}</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{rate.priceRub} рублей</p>
                </button>
              ))}
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="Ваш E-Mail"
              className="h-11 w-full rounded-lg border border-zinc-300 px-4 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:focus:ring-sky-800"
            />
            <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-sky-600"
              />
              <span>
                Регистрируясь, я соглашаюсь с{" "}
                <a
                  href="/agreement"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-700 transition hover:underline dark:text-sky-400"
                >
                  Пользовательским соглашением
                </a>{" "}
                и{" "}
                <a
                  href="/privacy-policy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-700 transition hover:underline dark:text-sky-400"
                >
                  Политикой конфиденциальности
                </a>
                .
              </span>
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              onClick={handlePay}
              disabled={rateIndex === null || loading || !agreed}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="size-5 animate-spin" /> : null}
              Оплатить
            </button>
            <button
              onClick={() => {
                setError(null);
                setScreen("confirm");
              }}
              className="w-full text-center text-sm text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300"
            >
              Я уже купил подписку
            </button>
          </>
        )}

        {screen === "wait" && (
          <div className="space-y-3 text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-sky-600" />
            <p className="font-semibold">Ожидаю оплату</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Статус оплаты проверяется каждые 5 секунд на протяжении 2-ух минут, просто подождите,
              не закрывайте окно
            </p>
          </div>
        )}

        {screen === "success" && (
          <div className="space-y-3">
            <p className="font-semibold text-green-700 dark:text-green-400">Оплата прошла успешно!</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Теперь Вы можете управлять потоками загрузки. Можете закрыть окно.
            </p>
          </div>
        )}

        {screen === "error" && (
          <div className="space-y-3">
            <p className="font-semibold text-red-600 dark:text-red-400">Оплата не прошла</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Оплата не прошла, попробуйте позже, либо если оплата все же прошла, нажмите «Я уже
              купил подписку» и проверьте свой E-Mail.
            </p>
            <button
              onClick={() => {
                setError(null);
                setScreen("confirm");
              }}
              className="w-full text-center text-sm text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300"
            >
              Я уже купил подписку
            </button>
          </div>
        )}

        {screen === "confirm" && (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Укажите E-Mail который вы указывали при оплате, и нажмите «Проверить»
            </p>
            <input
              type="email"
              value={checkEmail}
              onChange={(e) => {
                setCheckEmail(e.target.value);
                setError(null);
              }}
              placeholder="Ваш E-Mail"
              className="h-11 w-full rounded-lg border border-zinc-300 px-4 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:focus:ring-sky-800"
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              onClick={handleCheck}
              disabled={!checkEmail.trim() || loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="size-5 animate-spin" /> : null}
              Проверить
            </button>
            <button
              onClick={() => {
                setError(null);
                setScreen("default");
              }}
              className="w-full text-center text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            >
              Назад к тарифам
            </button>
          </>
        )}

        {screen === "confirm-success" && (
          <div className="space-y-3">
            <p className="font-semibold text-green-700 dark:text-green-400">Подписка активирована!</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Теперь Вы можете управлять потоками загрузки. Можете закрыть окно.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
