import { verifyProxyToken } from "@/lib/proxy-token";
import { acquire, getClientIp, release } from "@/lib/rate-limit";
import { isAllowedCdnUrl } from "@/lib/rutube";
import { trackRequest } from "@/lib/metrics";

// Прокси для TS-сегментов: CDN RuTube не отдаёт Access-Control-Allow-Origin,
// поэтому браузер качает сегменты через этот роут.
// Защита: только whitelist-хосты RuTube + подписанный токен (выдаёт /api/get-segments)
// + лимит одновременных соединений с одного IP.
// Лимит = MAX_THREADS на клиенте (подписка до 16 потоков) — иначе премиум упирался бы в 429
const MAX_CONCURRENT_PER_IP = 16;

// Лимит скорости на ОДИН стрим в МБ/с (как Throttle bps=2MB в старом бэке).
// Можно дробное, "0" — без лимита. Держать синхронно с proxy-node/server.js.
const mbps = Number(process.env.PROXY_SPEED_MBPS ?? 2);
const SPEED_LIMIT_BPS = (Number.isFinite(mbps) ? mbps : 2) * 1024 * 1024;

async function handleGet(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url") ?? "";

  if (!verifyProxyToken(searchParams.get("t"))) {
    return Response.json({ message: "Недействительный токен." }, { status: 403 });
  }

  if (!isAllowedCdnUrl(url)) {
    return Response.json({ message: "Недопустимый адрес." }, { status: 400 });
  }

  const ip = getClientIp(request);
  if (!acquire(`proxy:${ip}`, MAX_CONCURRENT_PER_IP)) {
    return Response.json(
      { message: "Слишком много одновременных загрузок, попробуйте позже." },
      { status: 429 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://rutube.ru/",
      },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    release(`proxy:${ip}`);
    return Response.json({ message: "CDN недоступен, попробуйте позже." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    release(`proxy:${ip}`);
    return Response.json(
      { message: `Ошибка CDN (HTTP ${upstream.status}).` },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "video/mp2t");
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  headers.set("Cache-Control", "private, max-age=3600");

  // Освобождаем слот, когда поток закрыт (клиентом или по завершении)
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      // Token-bucket троттлинг стрима (см. proxy-node/server.js): средняя ≈ bps,
      // стартовый кредит 200мс; расписание абсолютное — опоздания таймера
      // компенсируются, ресинхронизация после отставания > 500мс (пауза клиента)
      let nextSlot = Date.now() - 200;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (SPEED_LIMIT_BPS > 0) {
            nextSlot += (value.byteLength / SPEED_LIMIT_BPS) * 1000;
            const waitMs = nextSlot - Date.now();
            if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
            else if (waitMs < -500) nextSlot = Date.now();
          }
          controller.enqueue(value);
        }
        controller.close();
      } catch {
        controller.error(new Error("upstream aborted"));
      } finally {
        reader.releaseLock();
        release(`proxy:${ip}`);
      }
    },
    cancel() {
      upstream.body?.cancel();
      release(`proxy:${ip}`);
    },
  });

  return new Response(stream, { status: 200, headers });
}

export async function GET(request: Request) {
  return trackRequest("proxy", request, () => handleGet(request));
}
