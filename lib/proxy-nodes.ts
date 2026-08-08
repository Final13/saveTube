// Список внешних прокси-нод для скачивания сегментов (масштабирование по полосе).
// NEXT_PUBLIC_PROXY_URLS — базовые URL нод через запятую (например https://proxy3.save-tube.ru).
// Встроенный /api/proxy основного сервера ВСЕГДА добавлен в конец ротации как
// гарантированный fallback: упавшие/устаревшие ноды обходятся автоматически,
// скачивание не ломается даже если все внешние ноды недоступны.

const BUILTIN_NODE = "/api/proxy";

const NODES = [
  ...(process.env.NEXT_PUBLIC_PROXY_URLS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean),
  BUILTIN_NODE,
];

let counter = 0;

/**
 * URL для скачивания сегмента через прокси.
 * Ноды перебираются round-robin; на ретрае (retry > 0) берётся следующая нода —
 * так падение одной ноды обходится автоматически.
 */
export function buildProxyUrl(segmentUrl: string, token: string | null, retry = 0): string {
  const base = NODES[(counter++ + retry) % NODES.length];
  const tokenParam = token ? `&t=${token}` : "";
  return `${base}?url=${encodeURIComponent(segmentUrl)}${tokenParam}`;
}
