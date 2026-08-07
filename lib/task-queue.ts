// Очередь фоновых задач (in-memory, globalThis-синглтон). Одна нода обрабатывает
// задачи с ограниченным параллелизмом: сверх лимита задачи ждут FIFO, а не стартуют
// все разом — под нагрузкой/дудосом RuTube и прокси не долбятся тысячами запросов.
// Лимит регулируется env VIDEO_INFO_CONCURRENCY (дефолт 4). Переполнение очереди
// (> VIDEO_INFO_MAX_QUEUE, дефолт 100) отклоняется QueueFullError — нода не умирает.

export class QueueFullError extends Error {
  constructor() {
    super("Очередь задач переполнена");
    this.name = "QueueFullError";
  }
}

interface QueuedJob {
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const globalState = globalThis as unknown as {
  __savetubeTaskQueue?: QueuedJob[];
  __savetubeTaskQueueRunning?: number;
};

function state() {
  globalState.__savetubeTaskQueue ??= [];
  globalState.__savetubeTaskQueueRunning ??= 0;
  return {
    queued: globalState.__savetubeTaskQueue,
    get running() {
      return globalState.__savetubeTaskQueueRunning ?? 0;
    },
    set running(value: number) {
      globalState.__savetubeTaskQueueRunning = value;
    },
  };
}

export function taskQueueConcurrency(): number {
  const value = Number(process.env.VIDEO_INFO_CONCURRENCY ?? 4);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 4;
}

function taskQueueMaxSize(): number {
  const value = Number(process.env.VIDEO_INFO_MAX_QUEUE ?? 100);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 100;
}

function pump(): void {
  const s = state();
  while (s.running < taskQueueConcurrency() && s.queued.length > 0) {
    const job = s.queued.shift()!;
    s.running += 1;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        s.running -= 1;
        pump();
      });
  }
}

/** Ставит задачу в очередь. Промис резолвится, когда задача реально отработала.
 *  При переполнении очереди синхронно бросает QueueFullError. */
export function enqueueTask(run: () => Promise<void>): Promise<void> {
  const s = state();
  if (s.queued.length >= taskQueueMaxSize()) {
    throw new QueueFullError();
  }
  const promise = new Promise<void>((resolve, reject) => {
    s.queued.push({ run, resolve, reject });
  });
  pump();
  return promise;
}

export function getTaskQueueSnapshot() {
  const s = state();
  return {
    queued: s.queued.length,
    running: s.running,
    concurrency: taskQueueConcurrency(),
    maxQueue: taskQueueMaxSize(),
  };
}
