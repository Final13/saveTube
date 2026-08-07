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
}

const TASK_TTL_MS = 10 * 60 * 1000; // как в старом бэке (Redis setEx 600)
const SWEEP_INTERVAL_MS = 60 * 1000;

const globalState = globalThis as unknown as {
  __savetubeTasks?: Map<string, Task>;
  __savetubeTasksLastSweep?: number;
};

function store(): Map<string, Task> {
  if (!globalState.__savetubeTasks) {
    globalState.__savetubeTasks = new Map();
  }
  const now = Date.now();
  const lastSweep = globalState.__savetubeTasksLastSweep ?? 0;
  if (now - lastSweep > SWEEP_INTERVAL_MS) {
    globalState.__savetubeTasksLastSweep = now;
    for (const [id, task] of globalState.__savetubeTasks) {
      if (now - task.created_at > TASK_TTL_MS) globalState.__savetubeTasks.delete(id);
    }
  }
  return globalState.__savetubeTasks;
}

export function createTask(type: string): Task {
  const task: Task = {
    task_id: randomUUID(),
    type,
    status: "pending",
    created_at: Date.now(),
  };
  store().set(task.task_id, task);
  return task;
}

export function getTask(taskId: string): Task | null {
  return store().get(taskId) ?? null;
}

export function completeTask<T>(taskId: string, data: T): void {
  const task = store().get(taskId);
  if (!task) return;
  task.status = "completed";
  task.data = data;
}

export function failTask(taskId: string, message: string): void {
  const task = store().get(taskId);
  if (!task) return;
  task.status = "failed";
  task.message = message;
}
