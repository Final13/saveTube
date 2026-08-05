import { createHash } from "crypto";
import { cacheGet, cacheSet } from "@/lib/cache";
import { issueProxyToken } from "@/lib/proxy-token";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { getSegments, type SegmentsInfo } from "@/lib/rutube";
import { trackRequest } from "@/lib/metrics";

const SEGMENTS_CACHE_TTL_MS = 30 * 60 * 1000;
const RATE_LIMIT_PER_MINUTE = 20;

async function handlePost(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`segments:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
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

  if (!url) {
    return Response.json({ message: "Не указан плейлист качества." }, { status: 400 });
  }

  const cacheKey = `segments:${createHash("md5").update(url).digest("hex")}`;
  let segments = cacheGet<SegmentsInfo["segments"]>(cacheKey);

  if (!segments) {
    try {
      segments = (await getSegments(url)).segments;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ошибка сервера, попробуйте позже.";
      return Response.json({ message }, { status: 502 });
    }
    cacheSet(cacheKey, segments, SEGMENTS_CACHE_TTL_MS);
  }

  // Токен для прокси-роута: без него скачивание сегментов невозможно
  return Response.json({ segments, token: issueProxyToken() });
}

export async function POST(request: Request) {
  return trackRequest("get-segments", request, () => handlePost(request));
}
