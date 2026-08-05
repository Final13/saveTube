// In-memory rate-limit (скользящее окно) и счётчик одновременных соединений по IP.
// Цель — не дать одному IP бомбить запросами и убивать сервер.
// Если появится несколько инстансов — вынести в Redis.

const globalState = globalThis as unknown as {
  __savetubeRateLimits?: Map<string, number[]>;
  __savetubeConcurrency?: Map<string, number>;
};

const windows = (globalState.__savetubeRateLimits ??= new Map());
const concurrency = (globalState.__savetubeConcurrency ??= new Map());

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** true — запрос разрешён; false — лимит превышен */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (windows.get(key) ?? []).filter((t: number) => now - t < windowMs);
  if (timestamps.length >= limit) {
    windows.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  windows.set(key, timestamps);
  // Чистка старых ключей, чтобы Map не росла бесконечно
  if (windows.size > 10_000) {
    for (const [k, ts] of windows) {
      const alive = ts.filter((t: number) => now - t < windowMs);
      if (alive.length === 0) windows.delete(k);
      else windows.set(k, alive);
    }
  }
  return true;
}

/** Занять слот одновременного соединения. false — слотов нет (429). Вернуть слот через release(). */
export function acquire(key: string, max: number): boolean {
  const current = concurrency.get(key) ?? 0;
  if (current >= max) return false;
  concurrency.set(key, current + 1);
  return true;
}

export function release(key: string): void {
  const current = (concurrency.get(key) ?? 1) - 1;
  if (current <= 0) concurrency.delete(key);
  else concurrency.set(key, current);
}

/** Текущие занятые слоты соединений по ключам (для страницы метрик). */
export function getConcurrencySnapshot(): Array<{ key: string; count: number }> {
  return Array.from(concurrency.entries()).map(([key, count]) => ({ key, count }));
}
