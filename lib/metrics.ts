import { recordMetric } from "@/lib/metrics-store";
import { getClientIp } from "@/lib/rate-limit";

// Обёртка API-роута: замеряет время ответа и пишет метрику (route, ip, status, ms).
// Запись fire-and-forget — сбор метрик не влияет на основной запрос.
export async function trackRequest(
  route: string,
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const start = Date.now();
  try {
    const response = await handler();
    recordMetric({
      route,
      ip: getClientIp(request),
      status: response.status,
      ms: Date.now() - start,
    });
    return response;
  } catch (error) {
    recordMetric({ route, ip: getClientIp(request), status: 500, ms: Date.now() - start });
    throw error;
  }
}
