// Список внешних прокси-нод для скачивания сегментов (масштабирование по полосе).
// NEXT_PUBLIC_PROXY_URLS — базовые URL нод через запятую (например https://proxy1.save-tube.ru).
// Пусто — используется встроенный /api/proxy основного сервера.

const NODES = (process.env.NEXT_PUBLIC_PROXY_URLS ?? "")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

let counter = 0;

/**
 * URL для скачивания сегмента через прокси.
 * Ноды перебираются round-robin; на ретрае (retry > 0) берётся следующая нода —
 * так падение одной ноды обходится автоматически.
 */
export function buildProxyUrl(segmentUrl: string, token: string | null, retry = 0): string {
  const base = NODES.length === 0 ? "/api/proxy" : NODES[(counter++ + retry) % NODES.length];
  const tokenParam = token ? `&t=${token}` : "";
  return `${base}?url=${encodeURIComponent(segmentUrl)}${tokenParam}`;
}
