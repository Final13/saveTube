// Список внешних прокси-нод для скачивания сегментов (масштабирование по полосе).
// NEXT_PUBLIC_PROXY_URLS — базовые URL нод через запятую (у нас: proxy1/2/3.save-tube.ru
// с путём /api/v1/proxy под их nginx). Ротация round-robin, на ретрае — следующая нода.
// Встроенный /api/proxy — fallback, участвует ТОЛЬКО когда все ноды уже отказали
// в этой серии попыток (retry >= числа нод). Пустой список — только встроенный.

const BUILTIN_NODE = "/api/proxy";

const NODES = (process.env.NEXT_PUBLIC_PROXY_URLS ?? "")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  // Только валидные абсолютные URL: защита от кривого значения env
  // (напр. когда в значение вставили всю строку «NEXT_PUBLIC_PROXY_URLS=https://...»).
  .filter((s) => s.startsWith("https://") || s.startsWith("http://"));

let counter = 0;

export function buildProxyUrl(segmentUrl: string, token: string | null, retry = 0): string {
  let base: string;
  if (NODES.length === 0) {
    base = BUILTIN_NODE;
  } else if (retry < NODES.length) {
    base = NODES[(counter++ + retry) % NODES.length];
  } else {
    // Все ноды отказали — fallback на основной сервер
    base = BUILTIN_NODE;
  }
  const tokenParam = token ? `&t=${token}` : "";
  return `${base}?url=${encodeURIComponent(segmentUrl)}${tokenParam}`;
}
