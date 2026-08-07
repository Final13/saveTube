"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Download, Loader2, Minus, Plus, X, Zap } from "lucide-react";
import PremiumModal from "@/components/premium-modal";
import { buildProxyUrl } from "@/lib/proxy-nodes";

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
const MAX_RETRIES = 3;

type PremiumScreen = "default" | "success" | "error";

export default function DownloadForm({ premiumBlock = false }: { premiumBlock?: boolean }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [preparing, setPreparing] = useState<number | null>(null); // индекс качества, которое готовится

  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [activeThreads, setActiveThreads] = useState(0);
  const [done, setDone] = useState(false);

  const [threads, setThreads] = useState(MIN_THREADS);
  const threadsRef = useRef(MIN_THREADS);
  const proxyTokenRef = useRef<string | null>(null);

  const [premium, setPremium] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [premiumScreen, setPremiumScreen] = useState<PremiumScreen>("default");

  // При загрузке: автопроверка подписки по cookie + экраны успеха/ошибки из URL (?success/?error)
  useEffect(() => {
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

  const pollVideoInfoTask = async (taskId: string) => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`/api/get-video-info?task_id=${encodeURIComponent(taskId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Задание не найдено, попробуйте заново.");
      if (data.status === "completed") return data.data;
      if (data.status === "failed") {
        throw new Error(data.message || "Не удалось обработать видео, попробуйте позже.");
      }
    }
    throw new Error("RuTube отвечает слишком долго, попробуйте позже.");
  };

  const fetchSegment = async (segmentUrl: string): Promise<Blob> => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // На ретрае — следующая прокси-нода из списка (если внешние ноды заданы)
        const res = await fetch(buildProxyUrl(segmentUrl, proxyTokenRef.current, attempt - 1));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.blob();
      } catch (e) {
        lastError = e instanceof Error ? e : new Error("Ошибка сети");
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    throw lastError ?? new Error("Не удалось скачать сегмент.");
  };

  const handleDownload = async (quality: VideoQuality, index: number) => {
    setError(null);
    setPreparing(index);
    try {
      const res = await fetch("/api/get-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: quality.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка сервера, попробуйте позже.");
      proxyTokenRef.current = data.token;
      await downloadSegments(data.segments as string[], quality, info?.metadata.title ?? "video");
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

    try {
      const chunks: Blob[] = new Array(segments.length);
      let cursor = 0;
      let finished = 0;
      let inFlight = 0;

      const worker = async () => {
        while (cursor < segments.length) {
          const i = cursor++;
          inFlight++;
          setActiveThreads(inFlight);
          chunks[i] = await fetchSegment(segments[i]);
          inFlight--;
          setActiveThreads(inFlight);
          finished++;
          setDownloaded(finished);
        }
      };

      // Пул воркеров пополняется до threadsRef.current — число потоков можно менять на лету
      let poolError: Error | null = null;
      const workers = new Set<Promise<void>>();
      while ((cursor < segments.length || workers.size > 0) && !poolError) {
        while (workers.size < threadsRef.current && cursor < segments.length && !poolError) {
          const p = worker().catch((e: Error) => {
            poolError = e;
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
      setActiveThreads(0);
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
            className="h-12 flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-zinc-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
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
            Конвертировать
          </button>
        </div>

        {error && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
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

      {/* Результат: метаданные и качества */}
      {info && !downloading && (
        <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm text-zinc-500">Автор видео</p>
              <p className="font-medium">{info.metadata.author}</p>
              <p className="pt-2 text-sm text-zinc-500">Заголовок видео</p>
              <p className="font-medium">{info.metadata.title}</p>
            </div>
            <button
              onClick={reset}
              aria-label="Сбросить"
              className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
            >
              <X className="size-5" />
            </button>
          </div>

          <p className="text-sm text-zinc-500">Выберите качество видео</p>
          {info.qualities.length === 0 ? (
            <p>Нет доступных форматов для скачивания</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {info.qualities.map((q, i) => (
                <div
                  key={q.resolution}
                  className="flex flex-col justify-between space-y-3 rounded-lg bg-white p-3 shadow-sm"
                >
                  <div className="space-y-1 text-sm">
                    <p className="flex items-center justify-between">
                      Качество <span className="text-zinc-400">{q.resolution}</span>
                    </p>
                    <p>
                      <b>{q.qualityLabel}</b> ({q.description})
                    </p>
                  </div>
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Прогресс загрузки */}
      {(downloading || done) && (
        <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="font-medium">
            {done ? "Загрузка завершена!" : `Скачано ${progress}% (${downloaded} / ${total})`}
          </p>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-sky-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">Потоки загрузки:</span>
            {premium && (
              <button
                onClick={() => changeThreads(-1)}
                aria-label="Убавить поток"
                className="rounded-lg border border-zinc-300 p-1.5 text-zinc-600 transition hover:bg-zinc-200"
              >
                <Minus className="size-4" />
              </button>
            )}
            <div className="flex items-center gap-1">
              {Array.from({ length: threads }).map((_, i) => (
                <Loader2
                  key={i}
                  className={`size-4 ${i < activeThreads ? "animate-spin text-sky-600" : "text-zinc-300"}`}
                />
              ))}
            </div>
            {premium && (
              <button
                onClick={() => changeThreads(1)}
                aria-label="Добавить поток"
                className="rounded-lg border border-zinc-300 p-1.5 text-zinc-600 transition hover:bg-zinc-200"
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
                <Zap className="size-4 fill-yellow-400 text-yellow-400" /> Ускорить
              </button>
            )}
          </div>

          {done && (
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200"
            >
              Скачать другое видео
            </button>
          )}
        </div>
      )}

      {/* Блок «Ускорить загрузку» */}
      {premiumBlock && !premium && (
        <div className="mt-6 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-semibold text-amber-800">
            <Zap className="size-5" /> Ускорить загрузку
          </p>
          <p className="text-sm text-amber-800">
            По умолчанию скачивание видео происходит в 2 потока. Подписка позволит указать любое
            количество потоков и скачивать видео значительно быстрее.
          </p>
          <button
            onClick={() => {
              setPremiumScreen("default");
              setPremiumOpen(true);
            }}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            Выберите подписку
          </button>
        </div>
      )}

      {/* Модалка подписки (key — перемонтирование со свежим состоянием при каждом открытии) */}
      <PremiumModal
        key={`${premiumOpen}-${premiumScreen}`}
        open={premiumOpen}
        initialScreen={premiumScreen}
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
