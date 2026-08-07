import { getAdminEmail } from "@/lib/admin-auth";
import {
  getRouteStats,
  getSummary,
  getSuspiciousIps,
  getTimeseries,
  getTopIps,
} from "@/lib/metrics-store";
import { getConcurrencySnapshot } from "@/lib/rate-limit";
import { getTaskQueueSnapshot } from "@/lib/task-queue";

// Доступные окна и размер бакета агрегации для графика
const WINDOWS: Record<string, { ms: number; bucketMs: number }> = {
  "15m": { ms: 15 * 60_000, bucketMs: 60_000 },
  "1h": { ms: 60 * 60_000, bucketMs: 60_000 },
  "6h": { ms: 6 * 60 * 60_000, bucketMs: 5 * 60_000 },
  "24h": { ms: 24 * 60 * 60_000, bucketMs: 15 * 60_000 },
  "3d": { ms: 3 * 24 * 60 * 60_000, bucketMs: 60 * 60_000 },
};

// Агрегированные метрики для страницы /admin. Только для админа (cookie admin_session).
export async function GET(request: Request) {
  const admin = await getAdminEmail();
  if (!admin) {
    return Response.json({ message: "Forbidden" }, { status: 403 });
  }

  const windowKey = new URL(request.url).searchParams.get("window") ?? "1h";
  const w = WINDOWS[windowKey] ?? WINDOWS["1h"];
  const since = Date.now() - w.ms;

  return Response.json({
    window: windowKey,
    summary: await getSummary(since),
    timeseries: await getTimeseries(since, w.bucketMs),
    topIps: await getTopIps(since, 10),
    suspiciousIps: await getSuspiciousIps(since, 10),
    routes: await getRouteStats(since),
    live: {
      streams: getConcurrencySnapshot(),
      queue: getTaskQueueSnapshot(),
      uptimeSec: Math.round(process.uptime()),
    },
  });
}
