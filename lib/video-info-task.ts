import { cacheSet } from "@/lib/cache";
import { completeTask, failTask } from "@/lib/tasks";
import { getVideoInfo, RutubeApiError, type VideoInfo } from "@/lib/rutube";

// Фоновая обработка задачи get_video_info: ретраи с backoff — если RuTube «залагал»
// или прокси отвечает заглушкой, бэк продолжает пробовать, пока клиент пингует статус.

const INFO_CACHE_TTL_MS = 55 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 2_000, 4_000, 8_000, 16_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runVideoInfoTask(taskId: string, videoId: string): Promise<VideoInfo> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt]);
    try {
      const info = await getVideoInfo(videoId);
      cacheSet(`video-info:${videoId}`, info, INFO_CACHE_TTL_MS);
      completeTask(taskId, info);
      return info;
    } catch (error) {
      lastError = error;
      // Контент недоступен (скрыт/удалён/нет форматов) — повторять бессмысленно
      if (error instanceof RutubeApiError && !error.retriable) break;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "Ошибка сервера, попробуйте позже.";
  failTask(taskId, message);
  throw lastError;
}
