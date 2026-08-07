import { cacheGet } from "@/lib/cache";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { parseRutubeUrl, type VideoInfo } from "@/lib/rutube";
import { createTask, getTask } from "@/lib/tasks";
import { runVideoInfoTask } from "@/lib/video-info-task";
import { trackRequest } from "@/lib/metrics";

// Модель как в старом бэкенде: POST создаёт задачу и отвечает сразу, клиент пингует
// GET ?task_id до completed/failed. Если RuTube отвечает быстро — результат отдаём
// прямо в POST (inline-бюджет), опрос не нужен. Если «залагал» — обработка продолжается
// в фоне с ретраями, клиент просто ждёт (запрос не падает по таймауту).

const RATE_LIMIT_PER_MINUTE = 10;
const POLL_RATE_LIMIT_PER_MINUTE = 120;
// Сколько ждём результат внутри POST, прежде чем перейти на опрос (env — для тестов)
const INLINE_BUDGET_MS = () => Number(process.env.VIDEO_INFO_INLINE_MS ?? 20_000);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const cached = cacheGet<VideoInfo>(`video-info:${videoId}`);
  if (cached) {
    const task = createTask("get_video_info");
    task.status = "completed";
    task.data = cached;
    return Response.json({ task_id: task.task_id, status: "completed", data: cached });
  }

  const task = createTask("get_video_info");

  // Фоновая обработка с ретраями; не ждём дольше inline-бюджета
  const processing = runVideoInfoTask(task.task_id, videoId).catch(() => {});
  await Promise.race([
    processing,
    new Promise((resolve) => setTimeout(resolve, INLINE_BUDGET_MS())),
  ]);

  const current = getTask(task.task_id) ?? task;
  if (current.status === "completed") {
    return Response.json({ task_id: current.task_id, status: "completed", data: current.data });
  }
  if (current.status === "failed") {
    return Response.json(
      { task_id: current.task_id, status: "failed", message: current.message },
      { status: 502 },
    );
  }
  return Response.json({ task_id: current.task_id, status: "pending" }, { status: 202 });
}

async function handleGet(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`video-info-poll:${ip}`, POLL_RATE_LIMIT_PER_MINUTE, 60_000)) {
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
  if (!task || task.type !== "get_video_info") {
    return Response.json(
      { message: "Задание не найдено, попробуйте заново." },
      { status: 404 },
    );
  }

  return Response.json({
    task_id: task.task_id,
    status: task.status,
    ...(task.status === "completed" ? { data: task.data } : {}),
    ...(task.status === "failed" ? { message: task.message } : {}),
  });
}

export async function POST(request: Request) {
  return trackRequest("get-video-info", request, () => handlePost(request));
}

export async function GET(request: Request) {
  return trackRequest("get-video-info-poll", request, () => handleGet(request));
}
