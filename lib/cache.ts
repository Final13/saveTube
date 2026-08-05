// Простой in-memory TTL-кеш. Процесс Next один — этого достаточно;
// если появится несколько инстансов/нод, заменить на Redis (интерфейс тот же: get/set с TTL).
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const globalStore = globalThis as unknown as { __savetubeCache?: Map<string, CacheEntry<unknown>> };
const store = (globalStore.__savetubeCache ??= new Map());

// Периодическая чистка протухших записей, чтобы Map не росла бесконечно
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const now = Date.now();
  sweep(now);
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}
