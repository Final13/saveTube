import { cacheSet } from "@/lib/cache";
import { completeTask, failTask } from "@/lib/tasks";
import { getSegments, type SegmentsInfo } from "@/lib/rutube";

// Фоновая обработка задачи get_segments: ретраи с backoff — если CDN «залагал»
// (молчаливый дроп IP со стороны RuTube случается), бэк продолжает пробовать,
// пока клиент пингует статус. Зеркалит lib/video-info-task.ts.

const SEGMENTS_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 2_000, 4_000, 8_000, 16_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Неретраибельно: мёртвый/протухший плейлист (404), невалидный URL, пустой плейлист —
// повторы не помогут. Сетевые сбои и прочие HTTP-коды (403 DC-бан, 5xx) — ретраим.
function isNonRetriable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("HTTP 404") ||
    message.includes("Недопустимый адрес") ||
    message.includes("не содержит сегментов")
  );
}

export async function runSegmentsTask(
  taskId: string,
  playlistUrl: string,
  cacheKey: string,
): Promise<SegmentsInfo> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt]);
    try {
      const info = await getSegments(playlistUrl);
      cacheSet(cacheKey, info.segments, SEGMENTS_CACHE_TTL_MS);
      completeTask(taskId, info.segments);
      return info;
    } catch (error) {
      lastError = error;
      if (isNonRetriable(error)) break;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "Ошибка сервера, попробуйте позже.";
  failTask(taskId, message);
  throw lastError;
}
