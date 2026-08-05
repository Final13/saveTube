import { cacheGet, cacheSet } from "@/lib/cache";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { getVideoInfo, parseRutubeUrl, type VideoInfo } from "@/lib/rutube";
import { trackRequest } from "@/lib/metrics";

// Плейлисты в ответе живут ~1 час (expire в URL CDN), кешируем чуть меньше
const INFO_CACHE_TTL_MS = 55 * 60 * 1000;
const RATE_LIMIT_PER_MINUTE = 10;

async function handlePost(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`video-info:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json(
      { message: "Слишком много запросов, попробуйте через минуту." },
      { status: 429 },
    );
  }

  let url: string;
  try {
    const body = await request.json();
    url = String(body?.url ?? "");
  } catch {
    return Response.json({ message: "Некорректный запрос." }, { status: 400 });
  }

  const videoId = parseRutubeUrl(url);
  if (!videoId) {
    return Response.json(
      { message: "Введите корректную ссылку на видео RuTube (rutube.ru/video/...)." },
      { status: 400 },
    );
  }

  const cacheKey = `video-info:${videoId}`;
  const cached = cacheGet<VideoInfo>(cacheKey);
  if (cached) return Response.json(cached);

  try {
    const info = await getVideoInfo(videoId);
    cacheSet(cacheKey, info, INFO_CACHE_TTL_MS);
    return Response.json(info);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка сервера, попробуйте позже.";
    return Response.json({ message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  return trackRequest("get-video-info", request, () => handlePost(request));
}
