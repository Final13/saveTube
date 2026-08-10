// Выделенная прокси-нода для скачивания сегментов RuTube (масштабирование по полосе).
// Голый Node.js, ноль зависимостей: копируется на VPS одним файлом и запускается `node server.js`.
//
// Нода ОТКРЫТАЯ (решение владельца, как в старом бэке): токен не проверяется.
// Защита: whitelist хостов (только CDN RuTube) + лимит одновременных стримов на IP.
//
// Env:
//   PORT               — порт (по умолчанию 3100)
//   PROXY_NODE_ORIGIN  — допустимые Origin фронта для CORS, через запятую
//                        ("*" — любой; у нас прод-код работает с "*")

import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.PORT ?? 3100);
const ORIGINS = (process.env.PROXY_NODE_ORIGIN ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Лимит = MAX_THREADS на клиенте (подписка до 16 потоков)
const MAX_CONCURRENT_PER_IP = 16;
const UPSTREAM_TIMEOUT_MS = 30_000;

const UPSTREAM_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Referer: "https://rutube.ru/",
};

// --- Whitelist хостов: только CDN RuTube (как isAllowedCdnUrl в lib/rutube.ts) ---

function isAllowedCdnUrl(raw) {
  let url;
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

// --- Счётчик одновременных соединений по IP ---

const concurrency = new Map();
const acquire = (ip) => {
  const current = concurrency.get(ip) ?? 0;
  if (current >= MAX_CONCURRENT_PER_IP) return false;
  concurrency.set(ip, current + 1);
  return true;
};
const release = (ip) => {
  const current = (concurrency.get(ip) ?? 1) - 1;
  if (current <= 0) concurrency.delete(ip);
  else concurrency.set(ip, current);
};

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function setCors(req, res) {
  const reqOrigin = req.headers.origin;
  let allow = null;
  if (ORIGINS.includes("*")) allow = "*";
  else if (reqOrigin && ORIGINS.includes(reqOrigin)) allow = reqOrigin;
  else if (!reqOrigin) allow = ORIGINS[0]; // небраузерные клиенты (curl/health)
  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
}

function respondJson(req, res, status, message) {
  setCors(req, res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message }));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Preflight
  if (req.method === "OPTIONS") {
    setCors(req, res);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.writeHead(204);
    res.end();
    return;
  }

  // Health-check (для мониторинга/балансировщика)
  if (url.pathname === "/health") {
    respondJson(req, res, 200, "ok");
    return;
  }

  // Пути: "/" — чистая установка, "/api/v1/proxy" и "/api/proxy" — совместимость
  // с существующими nginx-конфигами (старые серверы проксируют только эти пути —
  // так ноду можно перезалить без правки nginx)
  const isProxyPath = ["/", "/api/proxy", "/api/v1/proxy"].includes(url.pathname);
  if (!isProxyPath || req.method !== "GET") {
    respondJson(req, res, 404, "Not found.");
    return;
  }

  const target = url.searchParams.get("url") ?? "";
  if (!isAllowedCdnUrl(target)) {
    respondJson(req, res, 400, "Недопустимый адрес.");
    return;
  }

  const ip = getClientIp(req);
  if (!acquire(ip)) {
    respondJson(req, res, 429, "Слишком много одновременных загрузок, попробуйте позже.");
    return;
  }

  // Слот освобождается ровно один раз — при закрытии ответа любым путём
  let released = false;
  const releaseOnce = () => {
    if (!released) {
      released = true;
      release(ip);
    }
  };

  const upstreamReq = https.get(
    target,
    { headers: UPSTREAM_HEADERS, timeout: UPSTREAM_TIMEOUT_MS },
    (upstream) => {
      if (upstream.statusCode !== 200) {
        upstream.resume();
        respondJson(
          req,
          res,
          upstream.statusCode === 404 ? 404 : 502,
          `Ошибка CDN (HTTP ${upstream.statusCode}).`,
        );
        return;
      }

      setCors(req, res);
      const headers = {
        "Content-Type": upstream.headers["content-type"] ?? "video/mp2t",
        "Cache-Control": "private, max-age=3600",
      };
      if (upstream.headers["content-length"]) {
        headers["Content-Length"] = upstream.headers["content-length"];
      }
      res.writeHead(200, headers);

      upstream.pipe(res);
      upstream.on("error", () => res.destroy());
      res.on("close", () => {
        upstream.destroy();
        releaseOnce();
      });
    },
  );

  upstreamReq.on("timeout", () => upstreamReq.destroy(new Error("upstream timeout")));
  upstreamReq.on("error", () => {
    if (!res.headersSent) respondJson(req, res, 502, "CDN недоступен, попробуйте позже.");
    else res.destroy();
    releaseOnce();
  });
});

server.listen(PORT, () => {
  console.log(`[proxy-node] listening on :${PORT}, origins: ${ORIGINS.join(", ")}`);
});
