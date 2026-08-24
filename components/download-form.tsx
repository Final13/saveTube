"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Download, Loader2, Lock, Minus, Pause, Plus, X } from "lucide-react";
import PremiumModal from "@/components/premium-modal";
import SpeedoIcon from "@/components/speedo-icon";
import { buildProxyUrl } from "@/lib/proxy-nodes";
import type { PaymentProvider } from "@/lib/settings-store";

interface VideoMetadata {
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
}

interface VideoQuality {
  qualityLabel: string;
  resolution: string;
  description: string;
  url: string;
  fallbackUrl?: string;
}

interface VideoInfo {
  metadata: VideoMetadata;
  qualities: VideoQuality[];
}

const MIN_THREADS = 2;
const MAX_THREADS = 16;
// Попыток на сегмент: покрывает ротацию из 3 внешних нод + встроенный прокси (fallback)
const MAX_RETRIES = 4;

type PremiumScreen = "default" | "success" | "error";

// 4K = высота кадра от 2160p. Скачивание в 4K — только по подписке:
// трафик через прокси-ноды в разы больше, бесплатно не потянем.
const is4K = (q: VideoQuality) => parseInt(q.qualityLabel, 10) >= 2160;

// Опрос задачи get-segments до completed/failed (интервал 1.5с, до 90с).
// Serverless-нюанс (как у pollVideoInfoTask): poll может попасть на инстанс,
// который не знает задачу (404) — пересоздаём её и продолжаем опрос (до 2 раз).
// Module-level: внутри компонента react-hooks/purity ругается на Date.now().
async function pollSegmentsTask(
  initialTaskId: string,
  playlistUrl: string,
): Promise<{ segments: string[]; token: string }> {
  let taskId = initialTaskId;
  let recreations = 0;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`/api/get-segments?task_id=${encodeURIComponent(taskId)}`);
    const data = await res.json();
    if (res.status === 404 && recreations < 2) {
      recreations += 1;
      const recreate = await fetch("/api/get-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      });
      const recreated = await recreate.json();
      if (recreate.ok || recreate.status === 202) {
        // Пересоздание попало на кеш-хит — результат сразу
        if (recreated.segments) {
          return { segments: recreated.segments as string[], token: recreated.token as string };
        }
        taskId = recreated.task_id;
        continue;
      }
    }
    if (!res.ok) throw new Error(data.message || "Задание не найдено, попробуйте заново.");
    if (data.status === "completed") {
      return { segments: data.segments as string[], token: data.token as string };
    }
    if (data.status === "failed") {
      throw new Error(data.message || "Не удалось получить список сегментов, попробуйте позже.");
    }
  }
  throw new Error("RuTube отвечает слишком долго, попробуйте позже.");
}

export default function DownloadForm({
  sessionEmail,
  provider,
}: {
  /** Email сессии и платёжный провайдер — SSR-пропсы для модалки оплаты (без fetch при открытии) */
  sessionEmail: string | null;
  provider: PaymentProvider | null;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [preparing, setPreparing] = useState<number | null>(null); // индекс качества, которое готовится

  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  // Статус каждого потока: idle — стоит (иконка паузы), active — качает (спиннер),
  // retry — ждёт перед повтором (тоже пауза). Как в оригинале.
  const [slotStates, setSlotStates] = useState<Array<"idle" | "active" | "retry">>([]);
  const busySlotsRef = useRef<Set<number>>(new Set());
  const [done, setDone] = useState(false);

  const [threads, setThreads] = useState(MIN_THREADS);
  const threadsRef = useRef(MIN_THREADS);
  const proxyTokenRef = useRef<string | null>(null);

  const [premium, setPremium] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [premiumScreen, setPremiumScreen] = useState<PremiumScreen>("default");
  const [why4k, setWhy4k] = useState(false); // объяснение платного 4K в карточке качества

  // При загрузке: автопроверка подписки по cookie + экраны успеха/ошибки из URL (?success/?error)
  useEffect(() => {
    // Автопроверка подписки: сначала по cookie user_email (маркер устройства), если её
    // нет — по email сессии (/api/auth/me). Status-эндпоинт сам ставит cookie на 365д.
    const checkStatus = (email: string) =>
      fetch(`/api/payment/status?email=${encodeURIComponent(email)}`)
        .then((r) => r.json())
        .then((data) => data.status && setPremium(true))
        .catch(() => {});
    const savedEmail = document.cookie
      .split("; ")
      .find((r) => r.startsWith("user_email="))
      ?.split("=")[1];
    if (savedEmail) {
      checkStatus(decodeURIComponent(savedEmail));
    } else {
      fetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data?.email && checkStatus(data.email))
        .catch(() => {});
    }
    // Подписка, купленная через шапку, — разблокирует потоки без перезагрузки
    const onActivated = () => setPremium(true);
    window.addEventListener("premium-activated", onActivated);
    const params = new URLSearchParams(window.location.search);
    // Отложенное открытие модалки после монтирования (react-hooks/set-state-in-effect)
    if (params.has("success") || params.has("error")) {
      const screen = params.has("success") ? "success" : "error";
      setTimeout(() => {
        setPremiumScreen(screen);
        setPremiumOpen(true);
      }, 400);
    }
    return () => window.removeEventListener("premium-activated", onActivated);
  }, []);

  const activatePremium = () => {
    setPremium(true);
  };

  const reset = () => {
    setInfo(null);
    setDownloading(false);
    setDone(false);
    setDownloaded(0);
    setTotal(0);
    setError(null);
    setUrl("");
  };

  const handleConvert = async () => {
    setError(null);
    setInfo(null);
    setDone(false);
    setLoading(true);
    try {
      const res = await fetch("/api/get-video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 202) {
        throw new Error(data.message || "Ошибка сервера, попробуйте позже.");
      }
      // Быстрый путь — результат пришёл сразу; иначе пингуем статус задачи,
      // пока бэк в фоне пробует запрос заново (опрос до 90 с)
      const info =
        data.status === "completed" ? data.data : await pollVideoInfoTask(data.task_id);
      setInfo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сервера, попробуйте позже.");
    } finally {
      setLoading(false);
    }
  };

  // Serverless-нюанс: poll может попасть на инстанс, который не знает задачу (404) —
  // пересоздаём её и продолжаем опрос (до 2 раз), для пользователя это бесшовно
  const pollVideoInfoTask = async (initialTaskId: string) => {
    let taskId = initialTaskId;
    let recreations = 0;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`/api/get-video-info?task_id=${encodeURIComponent(taskId)}`);
      const data = await res.json();
      if (res.status === 404 && recreations < 2) {
        recreations += 1;
        const recreate = await fetch("/api/get-video-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const recreated = await recreate.json();
        if (recreate.ok || recreate.status === 202) {
          if (recreated.status === "completed") return recreated.data;
          taskId = recreated.task_id;
          continue;
        }
      }
      if (!res.ok) throw new Error(data.message || "Задание не найдено, попробуйте заново.");
      if (data.status === "completed") return data.data;
      if (data.status === "failed") {
        throw new Error(data.message || "Не удалось обработать видео, попробуйте позже.");
      }
    }
    throw new Error("RuTube отвечает слишком долго, попробуйте позже.");
  };

  const fetchSegment = async (
    segmentUrl: string,
    signal: AbortSignal,
    onState?: (state: "active" | "retry") => void,
  ): Promise<Blob> => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) throw new Error("Загрузка остановлена.");
      try {
        onState?.(attempt === 1 ? "active" : "retry");
        // На ретрае — следующая прокси-нода из списка (если внешние ноды заданы)
        const res = await fetch(buildProxyUrl(segmentUrl, proxyTokenRef.current, attempt - 1), {
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.blob();
      } catch (e) {
        // Отмена (упал другой воркер) — не ретраим, выходим сразу
        if (signal.aborted) throw new Error("Загрузка остановлена.");
        lastError = e instanceof Error ? e : new Error("Ошибка сети");
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    throw lastError ?? new Error("Не удалось скачать сегмент.");
  };

  const handleDownload = async (quality: VideoQuality, index: number) => {
    // 4K без подписки — вместо скачивания модалка оплаты (страховка к замене кнопки)
    if (is4K(quality) && !premium) {
      setPremiumScreen("default");
      setPremiumOpen(true);
      return;
    }
    setError(null);
    setPreparing(index);
    try {
      const res = await fetch("/api/get-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: quality.url }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 202)
        throw new Error(data.message || "Ошибка сервера, попробуйте позже.");
      // Кеш-хит — результат сразу; иначе пингуем статус задачи (бэк ретраит в фоне)
      const { segments, token } =
        res.status === 202
          ? await pollSegmentsTask(data.task_id, quality.url)
          : { segments: data.segments as string[], token: data.token as string };
      proxyTokenRef.current = token;
      await downloadSegments(segments, quality, info?.metadata.title ?? "video");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сервера, попробуйте позже.");
    } finally {
      setPreparing(null);
    }
  };

  const downloadSegments = async (
    segments: string[],
    quality: VideoQuality,
    title: string,
  ): Promise<void> => {
    setDownloading(true);
    setDone(false);
    setDownloaded(0);
    setTotal(segments.length);
    // Фактический старт загрузки — сигнал РСЯ (тест «реклама только при скачивании»)
    window.dispatchEvent(new Event("savetube-download-started"));
    setSlotStates(Array.from({ length: threadsRef.current }, () => "idle"));
    busySlotsRef.current = new Set();

    // Статус слота (потока) для живой анимации; слоты вне текущего числа потоков игнорим
    const setSlot = (slot: number | null, state: "idle" | "active" | "retry") => {
      if (slot === null) return;
      setSlotStates((prev) => {
        if (slot >= prev.length || prev[slot] === state) return prev;
        const next = [...prev];
        next[slot] = state;
        return next;
      });
    };
    const acquireSlot = (): number | null => {
      for (let i = 0; i < threadsRef.current; i++) {
        if (!busySlotsRef.current.has(i)) {
          busySlotsRef.current.add(i);
          return i;
        }
      }
      return null; // потоки уменьшили на лету — воркер доработает без слота
    };

    try {
      const chunks: Blob[] = new Array(segments.length);
      let cursor = 0;
      let finished = 0;
      // При падении любого воркера отменяем остальные (abort) и не берём новые сегменты —
      // иначе загрузка продолжает качать после показа ошибки
      const controller = new AbortController();
      let poolError: Error | null = null;

      // Воркер берёт РОВНО ОДИН сегмент и завершается: цикл пополнения ниже
      // пересчитывает threadsRef.current после КАЖДОГО сегмента, поэтому число
      // потоков реально меняется на лету. (С воркерами «качай всё до конца»
      // Promise.race не просыпался до исчерпания курсора — добавление не работало.)
      const runSegment = async () => {
        const slot = acquireSlot();
        const i = cursor++;
        try {
          chunks[i] = await fetchSegment(segments[i], controller.signal, (s) =>
            setSlot(slot, s),
          );
          finished++;
          setDownloaded(finished);
          // Видимая пауза слота после каждого сегмента (как в оригинале — эффект
          // живой загрузки: слот мелькает паузой и снова зеленеет)
          setSlot(slot, "idle");
          await new Promise((r) => setTimeout(r, 150));
        } finally {
          setSlot(slot, "idle");
          if (slot !== null) busySlotsRef.current.delete(slot);
        }
      };

      // Непрерывный пул: после каждого завершённого сегмента добираем воркеров до
      // threadsRef.current; при уменьшении числа — просто не добираем, лишние доработают
      const workers = new Set<Promise<void>>();
      while ((cursor < segments.length || workers.size > 0) && !poolError) {
        while (workers.size < threadsRef.current && cursor < segments.length && !poolError) {
          const p = runSegment().catch((e: Error) => {
            if (!poolError) {
              poolError = e;
              controller.abort();
            }
          });
          workers.add(p);
          p.finally(() => workers.delete(p));
        }
        await Promise.race(workers);
      }
      if (poolError) throw poolError;

      const blob = new Blob(chunks, { type: "video/mp4" });
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${sanitizeFilename(title)}-${quality.qualityLabel}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objectUrl);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки, попробуйте позже.");
    } finally {
      setDownloading(false);
      setSlotStates([]);
      busySlotsRef.current = new Set();
    }
  };

  const changeThreads = (delta: number) => {
    if (!premium) {
      // Управление числом потоков — функция подписки
      setPremiumScreen("default");
      setPremiumOpen(true);
      return;
    }
    const next = Math.min(MAX_THREADS, Math.max(MIN_THREADS, threads + delta));
    setThreads(next);
    threadsRef.current = next;
    // Индикаторы подгоняем под новое число: во время загрузки плашки рисуются из
    // slotStates, без этого новые потоки были бы невидимы до конца загрузки.
    // Вне загрузки slotStates пуст — плашки рисуются из threads.
    setSlotStates((prev) => {
      if (prev.length === 0 || prev.length === next) return prev;
      if (prev.length < next) {
        return [...prev, ...Array.from({ length: next - prev.length }, () => "idle" as const)];
      }
      return prev.slice(0, next); // лишние воркеры доработают — их setSlot игнорируется
    });
  };

  const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;

  return (
    <div className="w-full">
      {/* Форма ввода ссылки */}
      <div className="form-download space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleConvert()}
            placeholder="https://rutube.ru/video/..."
            disabled={loading || downloading}
            className="h-12 w-full sm:flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:focus:ring-sky-800 disabled:opacity-60"
          />
          <button
            onClick={handleConvert}
            disabled={loading || downloading || !url.trim()}
            className="flex h-12 items-center justify-center gap-2 rounded-lg bg-sky-600 px-6 font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Download className="size-5" />
            )}
            Скачать видео
          </button>
        </div>

        {error && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-3 text-red-700 dark:text-red-400">
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-5 shrink-0" />
              <p>{error}</p>
            </div>
            <button onClick={() => setError(null)} aria-label="Закрыть">
              <X className="size-5" />
            </button>
          </div>
        )}
      </div>

      {/* Результат: метаданные и качества (text-left — как в оригинале, секция главной центрированная) */}
      {info && !downloading && (
        <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 text-left">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Автор видео</p>
              <p className="font-medium">{info.metadata.author}</p>
              <p className="pt-2 text-sm text-zinc-500 dark:text-zinc-400">Заголовок видео</p>
              <p className="font-medium">{info.metadata.title}</p>
            </div>
            <button
              onClick={reset}
              aria-label="Сбросить"
              className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <X className="size-5" />
            </button>
          </div>

          <p className="text-sm text-zinc-500 dark:text-zinc-400">Выберите качество видео</p>
          {info.qualities.length === 0 ? (
            <p>Нет доступных форматов для скачивания</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {info.qualities.map((q, i) => (
                <div
                  key={q.resolution}
                  className="flex flex-col justify-between space-y-3 rounded-lg bg-white p-3 shadow-sm dark:bg-zinc-800"
                >
                  <div className="space-y-1 text-sm">
                    <p className="flex items-center justify-between">
                      Качество <span className="text-zinc-400">{q.resolution}</span>
                    </p>
                    <p>
                      <b>{q.qualityLabel}</b> ({q.description})
                    </p>
                  </div>
                  {is4K(q) && !premium ? (
                    <div className="space-y-2">
                      <button
                        onClick={() => {
                          setPremiumScreen("default");
                          setPremiumOpen(true);
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
                      >
                        <Lock className="size-4" /> Разблокировать
                      </button>
                      {/* Тултип, а не блок в потоке: размер карточки не меняется.
                          Ховер (десктоп) — group-hover, тап (мобилка) — тоггл по клику. */}
                      <div className="group relative">
                        <button
                          onClick={() => setWhy4k((v) => !v)}
                          className="w-full text-center text-xs text-zinc-500 underline decoration-dotted underline-offset-2 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                        >
                          Почему?
                        </button>
                        <p
                          className={`pointer-events-none absolute left-1/2 top-full z-10 mt-1 w-56 -translate-x-1/2 rounded-lg bg-orange-50 p-2 text-left text-xs leading-relaxed text-orange-900 shadow-md transition-opacity dark:bg-orange-950 dark:text-orange-200 ${
                            why4k ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          Видео в 4K весит в разы больше обычного — пропускать такой трафик через
                          наши серверы очень дорого. Поэтому скачивание в 4K доступно только по
                          подписке.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDownload(q, i)}
                      disabled={preparing !== null}
                      className="flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
                    >
                      {preparing === i ? (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Подождите
                        </>
                      ) : (
                        <>
                          <Download className="size-4" /> Скачать видео
                        </>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Прогресс загрузки */}
      {(downloading || done) && (
        <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4">
          <p className="font-medium">
            {done ? "Загрузка завершена!" : `Скачано ${progress}% (${downloaded} / ${total})`}
          </p>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className="h-full rounded-full bg-sky-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">Потоки загрузки:</span>
            {premium && (
              <button
                onClick={() => changeThreads(-1)}
                aria-label="Убавить поток"
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 p-1.5 text-zinc-600 dark:text-zinc-400 transition hover:bg-zinc-200 dark:hover:bg-zinc-800"
              >
                <Minus className="size-4" />
              </button>
            )}
            <div className="flex items-center gap-1">
              {(downloading ? slotStates : Array.from({ length: threads }, () => "idle" as const)).map(
                (state, i) => (
                  // Как в оригинале: круглая плашка, простаивает — серая с паузой,
                  // качает — зелёная со спиннером. Мелькает по факту работы потока.
                  <span
                    key={i}
                    className={`flex size-6 items-center justify-center rounded-full transition-colors ${
                      state === "active" ? "bg-green-600" : "bg-zinc-400 dark:bg-zinc-600"
                    }`}
                  >
                    {state === "active" ? (
                      <Loader2 className="size-4 animate-spin text-white" />
                    ) : (
                      <Pause className="size-4 fill-white text-white" />
                    )}
                  </span>
                ),
              )}
            </div>
            {premium && (
              <button
                onClick={() => changeThreads(1)}
                aria-label="Добавить поток"
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 p-1.5 text-zinc-600 dark:text-zinc-400 transition hover:bg-zinc-200 dark:hover:bg-zinc-800"
              >
                <Plus className="size-4" />
              </button>
            )}
            {!premium && (
              <button
                onClick={() => {
                  setPremiumScreen("default");
                  setPremiumOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-700"
              >
                <SpeedoIcon className="size-6 text-amber-400" /> Ускорить
              </button>
            )}
          </div>

          {done && (
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-200 dark:hover:bg-zinc-800"
            >
              Скачать другое видео
            </button>
          )}
        </div>
      )}

      {/* Модалка подписки (key — перемонтирование со свежим состоянием при каждом открытии) */}
      <PremiumModal
        key={`${premiumOpen}-${premiumScreen}`}
        open={premiumOpen}
        initialScreen={premiumScreen}
        sessionEmail={sessionEmail}
        provider={provider}
        onClose={() => setPremiumOpen(false)}
        onActivated={activatePremium}
      />
    </div>
  );
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "video";
}
