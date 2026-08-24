"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Gauge, Loader2, MonitorPlay, MonitorSmartphone, X, Zap } from "lucide-react";
import { RATES } from "@/lib/rates";
import SpeedoIcon from "@/components/speedo-icon";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 25; // ~2 минуты ожидания оплаты

// При открытии модалки по умолчанию выбран месячный тариф
const DEFAULT_RATE_INDEX = Math.max(
  0,
  RATES.findIndex((r) => r.days === 30),
);

// Бенефиты подписки на экране тарифов
const BENEFITS = [
  { icon: MonitorPlay, text: "Скачивание в 4K-качестве" },
  { icon: Gauge, text: "Увеличенная скорость загрузки" },
  { icon: Ban, text: "Без рекламы на сайте" },
  { icon: MonitorSmartphone, text: "Работает на всех устройствах" },
  { icon: Zap, text: "Ускорение сразу после оплаты" },
];

// Бейджики способов оплаты (файлы в public/payments)
const PAYMENT_BADGES = [
  { src: "/payments/card.svg", alt: "Банковская карта" },
  { src: "/payments/sbp.svg", alt: "СБП" },
  { src: "/payments/tpay.svg", alt: "T-Pay" },
  { src: "/payments/sberpay.svg", alt: "SberPay" },
  { src: "/payments/umoney.svg", alt: "ЮMoney" },
];

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
  const [rateIndex, setRateIndex] = useState<number>(DEFAULT_RATE_INDEX);
  const [email, setEmail] = useState(getEmailCookie);
  const [checkEmail, setCheckEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const pollCount = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Если юзер залогинен — узнаём email аккаунта: подписка привяжется к нему,
  // а инпут становится полем «email для чека» (дефолт — тот же email)
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.email) {
          setSessionEmail(data.email);
          setEmail(data.email);
        }
      })
      .catch(() => {});
  }, []);

  // Провайдер оплаты: фразу об автопродлении показываем только при рекурренте (ЮKassa),
  // при разовых платежах T-Bank она была бы неправдой. Не ответил — скрываем.
  useEffect(() => {
    fetch("/api/payment/provider")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setProvider(data?.provider ?? null))
      .catch(() => {});
  }, []);

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

    let query: string;
    let bindEmail: string;
    if (sessionEmail) {
      // Привязку решает сервер по сессии; инпут — только email для чека
      const receipt = email.trim() || sessionEmail;
      if (!EMAIL_REGEX.test(receipt)) {
        setError("Пожалуйста, введите корректный E-Mail для чека");
        return;
      }
      query = `rate=${rateIndex}&receipt_email=${encodeURIComponent(receipt)}`;
      bindEmail = sessionEmail;
    } else {
      const trimmed = email.trim();
      if (!EMAIL_REGEX.test(trimmed)) {
        setError("Пожалуйста, введите корректный E-Mail адрес");
        return;
      }
      query = `email=${encodeURIComponent(trimmed)}&rate=${rateIndex}`;
      bindEmail = trimmed;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/payment?${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка сервера, попробуйте позднее");
      window.open(data.url, "_blank");
      setScreen("wait");
      startPolling(data.payment_id, bindEmail);
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
    setRateIndex(DEFAULT_RATE_INDEX);
    setError(null);
    setCheckEmail("");
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
      <div className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="flex items-start justify-between">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <SpeedoIcon className="size-10 -mt-1 text-amber-500" /> Ускорить загрузку
          </p>
          <button onClick={close} aria-label="Закрыть">
            <X className="size-5 text-zinc-400 dark:text-zinc-500 transition hover:text-zinc-700" />
          </button>
        </div>

        {screen === "default" && (
          <>
            <div className="flex gap-2">
              {RATES.map((rate, i) =>
                rate.hidden ? null : (
                  <button
                    key={rate.title}
                    onClick={() => setRateIndex(i)}
                    className={`flex-1 rounded-lg border p-3 text-center transition flex flex-col ${
                      rate.oldPriceRub ? "" : "justify-center"
                    } ${
                      rateIndex === i
                        ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600 dark:border-sky-500 dark:bg-sky-950 dark:ring-sky-500"
                        : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
                    }`}
                  >
                    {/* Строка скидки — только у тарифа со старой ценой;
                        у остальных цена с длительностью центрируются по вертикали */}
                    {rate.oldPriceRub ? (
                      <span className="flex h-5 items-center justify-center gap-1">
                        <span className="text-xs text-zinc-400 line-through dark:text-zinc-500">
                          {rate.oldPriceRub} ₽
                        </span>
                        <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold leading-5 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                          -{Math.floor((1 - rate.priceRub / rate.oldPriceRub) * 100)}%
                        </span>
                      </span>
                    ) : null}
                    <span className="block text-xl font-bold text-sky-700 dark:text-sky-400">
                      {rate.priceRub} ₽
                    </span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      на {rate.title}
                    </span>
                  </button>
                ),
              )}
            </div>
            <ul className="space-y-1.5">
              {BENEFITS.map(({ icon: Icon, text }) => (
                <li
                  key={text}
                  className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                >
                  <Icon className="size-4 shrink-0 text-sky-600 dark:text-sky-500" />
                  {text}
                </li>
              ))}
            </ul>
            {provider === "yookassa" && (
              <p className="text-left text-base leading-[1.6] text-zinc-500 dark:text-zinc-400">
                Автоматическое продление подписки. Можно отключить в любой момент в личном кабинете.
              </p>
            )}
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder={sessionEmail ? "E-Mail для чека" : "Ваш E-Mail"}
              className="h-11 w-full rounded-lg border border-zinc-300 px-4 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:focus:ring-sky-800"
            />
            {sessionEmail && (
              <p className="-mt-2 text-left text-xs text-zinc-500 dark:text-zinc-400">
                На этот e-mail придёт чек.
              </p>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              onClick={handlePay}
              disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="size-5 animate-spin" /> : null}
              Оплатить
            </button>
            <div className="flex items-center justify-center gap-1.5">
              {PAYMENT_BADGES.map((badge) => (
                <span
                  key={badge.alt}
                  className="flex h-8 w-16 items-center justify-center rounded-md border border-zinc-300 bg-white px-1.5 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <img src={badge.src} alt={badge.alt} className="h-5 w-auto" />
                </span>
              ))}
            </div>
            <button
              onClick={() => {
                setError(null);
                setScreen("confirm");
              }}
              className="w-full text-center text-sm text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300"
            >
              Я уже купил подписку
            </button>
            <p className="text-left text-xs leading-[1.6] text-zinc-500 dark:text-zinc-400">
              {/* Без сессии оплата = регистрация, с сессией — просто оплата */}
              {sessionEmail ? "Оплачивая" : "Регистрируясь"}, вы соглашаетесь с{" "}
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
