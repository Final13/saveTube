import { createHash } from "crypto";
import { cacheGet } from "@/lib/cache";
import { issueProxyToken } from "@/lib/proxy-token";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import type { SegmentsInfo } from "@/lib/rutube";
import { createTask, failTask, findActiveTaskByKey, getTask } from "@/lib/tasks";
import { enqueueTask, QueueFullError } from "@/lib/task-queue";
import { runSegmentsTask } from "@/lib/segments-task";
import { trackRequest } from "@/lib/metrics";

// Задачная модель, как у get-video-info: POST создаёт задачу и отвечает СРАЗУ
// 202 + task_id, выполнение с ретраями в фоне (очередь lib/task-queue.ts),
// клиент пингует GET ?task_id до completed/failed (1.5с, до 90с).
// Кеш-хит (30 мин) — старый синхронный ответ {segments, token} в POST, мгновенно.
// Повторный POST того же плейлиста получает уже созданную задачу (дедуп по md5(url)).
// Токен прокси выдаётся в момент ответа (кеш-хит POST и completed в poll).
//
// Serverless (Vercel): фон после ответа не живёт → выполнение драйвит poll-GET
// (до ~50с, maxDuration 60 в vercel.json; url в task.payload, single-flight
// task.processing). 404 (чужой инстанс) → клиент пересоздаёт задачу до 2 раз.

const RATE_LIMIT_PER_MINUTE = 20;
const POLL_RATE_LIMIT_PER_MINUTE = 120;
const POLL_RUN_BUDGET_MS = 50_000;
const IS_SERVERLESS = () => Boolean(process.env.VERCEL);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cacheKeyOf = (url: string) =>
  `segments:${createHash("md5").update(url).digest("hex")}`;

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

  const cacheKey = cacheKeyOf(url);

  // Кеш-хит — мгновенный синхронный ответ в старом контракте (фаст-пас клиента)
  const cached = cacheGet<SegmentsInfo["segments"]>(cacheKey);
  if (cached) {
    return Response.json({ segments: cached, token: issueProxyToken() });
  }

  // Дедуп: задача на этот плейлист уже обрабатывается — отдаём её, новую не плодим
  const existing = findActiveTaskByKey("get_segments", cacheKey);
  if (existing) {
    return Response.json({ task_id: existing.task_id, status: "pending" }, { status: 202 });
  }

  const task = createTask("get_segments", cacheKey, url);

  // Serverless: фон не живёт после ответа — отвечаем сразу, выполнение драйвит poll-GET
  if (IS_SERVERLESS()) {
    return Response.json({ task_id: task.task_id, status: "pending" }, { status: 202 });
  }

  try {
    void enqueueTask(() =>
      runSegmentsTask(task.task_id, url, cacheKey).then(
        () => {},
        () => {},
      ),
    );
  } catch (error) {
    if (error instanceof QueueFullError) {
      failTask(task.task_id, "Сервер перегружен, попробуйте через минуту.");
      return Response.json(
        { message: "Сервер перегружен, попробуйте через минуту." },
        { status: 429 },
      );
    }
    throw error;
  }

  return Response.json({ task_id: task.task_id, status: "pending" }, { status: 202 });
}

async function handleGet(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`segments-poll:${ip}`, POLL_RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json(
      { message: "Слишком много запросов, попробуйте через минуту." },
      { status: 429 },
    );
  }

  const taskId = new URL(request.url).searchParams.get("task_id") ?? "";
  if (!UUID_V4.test(taskId)) {
    return Response.json({ message: "Неверный формат номера задания." }, { status: 400 });
  }

  const task = getTask(taskId);
  if (!task || task.type !== "get_segments") {
    return Response.json(
      { message: "Задание не найдено, попробуйте заново." },
      { status: 404 },
    );
  }

  // Serverless: выполнение драйвит poll. Задача ещё не обрабатывается — запускаем
  // синхронно внутри этого запроса (single-flight по флагу processing).
  if (IS_SERVERLESS() && task.status === "pending" && !task.processing) {
    const url = typeof task.payload === "string" ? task.payload : null;
    if (!url) {
      return Response.json({ message: "Задание повреждено, попробуйте заново." }, { status: 404 });
    }
    task.processing = true;
    try {
      await Promise.race([
        runSegmentsTask(task.task_id, url, cacheKeyOf(url)).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, POLL_RUN_BUDGET_MS)),
      ]);
    } finally {
      task.processing = false;
    }
  }

  return Response.json({
    task_id: task.task_id,
    status: task.status,
    // Токен выдаём в момент ответа — его 3-часовой TTL начинает тикать со скачивания
    ...(task.status === "completed" ? { segments: task.data, token: issueProxyToken() } : {}),
    ...(task.status === "failed" ? { message: task.message } : {}),
  });
}

export async function POST(request: Request) {
  return trackRequest("get-segments", request, () => handlePost(request));
}

export async function GET(request: Request) {
  return trackRequest("get-segments-poll", request, () => handleGet(request));
}
