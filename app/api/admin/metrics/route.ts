import { getAdminEmail } from "@/lib/admin-auth";
import {
  getRouteStats,
  getSummary,
  getSuspiciousIps,
  getTimeseries,
  getTopIps,
} from "@/lib/metrics-store";
import { getConcurrencySnapshot } from "@/lib/rate-limit";

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
    summary: getSummary(since),
    timeseries: getTimeseries(since, w.bucketMs),
    topIps: getTopIps(since, 10),
    suspiciousIps: getSuspiciousIps(since, 10),
    routes: getRouteStats(since),
    live: {
      streams: getConcurrencySnapshot(),
      uptimeSec: Math.round(process.uptime()),
    },
  });
}
