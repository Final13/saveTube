// Ядро логики скачивания с RuTube.
// Все эндпоинты проверены на живом видео (см. AGENTS.md):
//   метаданные  — https://rutube.ru/api/video/{id}/
//   плейлисты   — https://rutube.ru/api/play/options/{id}/?pver=v2 -> video_balancer.default (master m3u8)
//   сегменты    — media m3u8 содержит ОТНОСИТЕЛЬНЫЕ пути *.ts
// CDN RuTube НЕ отдаёт Access-Control-Allow-Origin, поэтому сегменты качаются через app/api/proxy.

const RUTUBE_HEADERS: HeadersInit = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
  Referer: "https://rutube.ru/",
};

const FETCH_TIMEOUT_MS = 15_000;

export interface VideoMetadata {
  title: string;
  author: string;
  thumbnail: string;
  duration: number; // секунды
}

export interface VideoQuality {
  qualityLabel: string; // "720p"
  resolution: string; // "1280x720"
  description: string; // "Хорошее (HD)"
  url: string; // media-плейлист (основной CDN)
  fallbackUrl?: string; // тот же вариант на резервном CDN
}

export interface VideoInfo {
  metadata: VideoMetadata;
  qualities: VideoQuality[];
}

/** Извлекает id видео (32 hex) из ссылки rutube.ru/video/{id}/ или rutube.ru/shorts/{id}/ */
export function parseRutubeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!isRutubeHost(url.hostname)) return null;
  const match = url.pathname.match(/^\/(?:video|shorts)\/([a-f0-9]{32})\/?/);
  return match ? match[1] : null;
}

function isRutubeHost(hostname: string): boolean {
  return hostname === "rutube.ru" || hostname.endsWith(".rutube.ru");
}

/** Whitelist хостов для прокси: только CDN RuTube */
export function isAllowedCdnUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const h = url.hostname;
  return (
    h === "rutube.ru" || h.endsWith(".rutube.ru") || h === "rtbcdn.ru" || h.endsWith(".rtbcdn.ru")
  );
}

/** Русское описание качества по высоте кадра */
export function getQualityDescription(qualityLabel: string): string {
  const n = parseInt(qualityLabel, 10);
  if (Number.isNaN(n) || n <= 232) return "Очень плохое";
  if (n <= 240) return "Плохое";
  if (n <= 360) return "Среднее (мобильное)";
  if (n <= 480) return "Нормальное (SD)";
  if (n <= 720) return "Хорошее (HD)";
  if (n <= 1080) return "Отличное (Full HD)";
  if (n <= 1440) return "Очень чёткое (2K)";
  return "Максимальное (4K)";
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: RUTUBE_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Видео не найдено. Проверьте ссылку."
        : `RuTube недоступен (HTTP ${res.status}), попробуйте позже.`,
    );
  }
  return res.json();
}

/** Метаданные + список доступных качеств видео */
export async function getVideoInfo(videoId: string): Promise<VideoInfo> {
  const [videoData, playOptions] = await Promise.all([
    fetchJson(`https://rutube.ru/api/video/${videoId}/`),
    fetchJson(`https://rutube.ru/api/play/options/${videoId}/?pver=v2`),
  ]);

  const masterUrl: string | undefined = playOptions?.video_balancer?.default;
  if (!masterUrl) {
    throw new Error("Видео недоступно для скачивания (возможно, оно скрыто или удалено).");
  }

  const metadata: VideoMetadata = {
    title: videoData?.title ?? "Видео",
    author: videoData?.author?.name ?? "Неизвестный автор",
    thumbnail: videoData?.thumbnail_url ?? "",
    duration: Math.round((videoData?.duration ?? 0) / 1000),
  };

  const qualities = await parseMasterPlaylist(masterUrl);
  if (!qualities.length) {
    throw new Error("Нет доступных форматов для скачивания.");
  }
  return { metadata, qualities };
}

/** Парсит master m3u8: варианты качества, дедупликация по RESOLUTION (второй CDN — fallback) */
async function parseMasterPlaylist(masterUrl: string): Promise<VideoQuality[]> {
  const res = await fetch(masterUrl, {
    headers: RUTUBE_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Не удалось получить список качеств (HTTP ${res.status}).`);
  const text = await res.text();

  const lines = text.split("\n").map((l) => l.trim());
  const byResolution = new Map<string, VideoQuality>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1];
    const streamUrl = lines[i + 1];
    if (!resolution || !streamUrl || streamUrl.startsWith("#")) continue;

    const height = resolution.split("x")[1];
    const existing = byResolution.get(resolution);
    if (existing) {
      existing.fallbackUrl = streamUrl; // тот же вариант на резервном CDN
    } else {
      byResolution.set(resolution, {
        qualityLabel: `${height}p`,
        resolution,
        description: getQualityDescription(`${height}p`),
        url: streamUrl,
      });
    }
  }

  return [...byResolution.values()].sort(
    (a, b) => parseInt(b.qualityLabel, 10) - parseInt(a.qualityLabel, 10),
  );
}

export interface SegmentsInfo {
  segments: string[]; // абсолютные URL сегментов
}

/** Парсит media m3u8 выбранного качества: относительные пути сегментов -> абсолютные URL */
export async function getSegments(playlistUrl: string): Promise<SegmentsInfo> {
  if (!isAllowedCdnUrl(playlistUrl)) {
    throw new Error("Недопустимый адрес плейлиста.");
  }
  const res = await fetch(playlistUrl, {
    headers: RUTUBE_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Не удалось получить список сегментов (HTTP ${res.status}).`);
  const text = await res.text();

  const segments = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => new URL(l, playlistUrl).toString());

  if (!segments.length) throw new Error("Плейлист не содержит сегментов.");
  return { segments };
}
