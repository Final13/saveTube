import { randomUUID } from "crypto";

// Хранилище фоновых задач (in-memory, globalThis-синглтон).
// Модель как в старом бэкенде: POST создаёт задачу и сразу возвращает task_id,
// обработка идёт в фоне (с ретраями), клиент пингует GET ?task_id до completed/failed.
// Если запрос к RuTube «залагал» — клиент не падает по таймауту, а ждёт опроса.

export type TaskStatus = "pending" | "completed" | "failed";

export interface Task<T = unknown> {
  task_id: string;
  type: string;
  status: TaskStatus;
  data?: T;
  message?: string;
  created_at: number;
  /** Входные данные задачи (например videoId) — нужны serverless-поллингу для догона */
  payload?: unknown;
  /** Задача прямо сейчас обрабатывается (single-flight для догона в GET) */
  processing?: boolean;
}

const TASK_TTL_MS = 10 * 60 * 1000; // как в старом бэке (Redis setEx 600)
const SWEEP_INTERVAL_MS = 60 * 1000;

const globalState = globalThis as unknown as {
  __savetubeTasks?: Map<string, Task>;
  __savetubeTasksLastSweep?: number;
  __savetubeTaskKeys?: Map<string, string>;
};

// Индекс «тип:ключ» → task_id для активных (pending) задач: повторный POST
// того же видео получает существующую задачу, а не плодит новую.
function keyIndex(): Map<string, string> {
  globalState.__savetubeTaskKeys ??= new Map();
  return globalState.__savetubeTaskKeys;
}

function store(): Map<string, Task> {
  if (!globalState.__savetubeTasks) {
    globalState.__savetubeTasks = new Map();
  }
  const now = Date.now();
  const lastSweep = globalState.__savetubeTasksLastSweep ?? 0;
  if (now - lastSweep > SWEEP_INTERVAL_MS) {
    globalState.__savetubeTasksLastSweep = now;
    const keys = keyIndex();
    for (const [id, task] of globalState.__savetubeTasks) {
      if (now - task.created_at > TASK_TTL_MS) {
        globalState.__savetubeTasks.delete(id);
        for (const [k, v] of keys) if (v === id) keys.delete(k);
      }
    }
  }
  return globalState.__savetubeTasks;
}

export function createTask(type: string, key?: string, payload?: unknown): Task {
  const task: Task = {
    task_id: randomUUID(),
    type,
    status: "pending",
    created_at: Date.now(),
    payload,
  };
  store().set(task.task_id, task);
  if (key) keyIndex().set(`${type}:${key}`, task.task_id);
  return task;
}

/** Активная (ещё не завершённая) задача по ключу, если такая уже создана. */
export function findActiveTaskByKey(type: string, key: string): Task | null {
  const id = keyIndex().get(`${type}:${key}`);
  if (!id) return null;
  const task = store().get(id);
  return task && task.status === "pending" ? task : null;
}

export function getTask(taskId: string): Task | null {
  return store().get(taskId) ?? null;
}

function removeKeyIndex(taskId: string): void {
  const keys = keyIndex();
  for (const [k, v] of keys) if (v === taskId) keys.delete(k);
}

export function completeTask<T>(taskId: string, data: T): void {
  const task = store().get(taskId);
  if (!task) return;
  task.status = "completed";
  task.data = data;
  removeKeyIndex(taskId);
}

export function failTask(taskId: string, message: string): void {
  const task = store().get(taskId);
  if (!task) return;
  task.status = "failed";
  task.message = message;
  removeKeyIndex(taskId);
}
