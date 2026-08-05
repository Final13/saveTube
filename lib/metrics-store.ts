import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";

// Хранилище метрик запросов: SQLite data/metrics.db (тот же паттерн, что и payments-store).
// Записи старше RETENTION удаляются автоматически (раз в час при записи).

export interface MetricEvent {
  route: string;
  ip: string;
  status: number;
  ms: number;
}

export interface MetricsBucket {
  bucket: number; // unix ms — начало интервала
  total: number;
  blocked: number; // 429 — сработал rate-limit / лимит соединений
  forbidden: number; // 403 — невалидный токен/подпись
  errors: number; // 5xx
  avg_ms: number;
}

export interface IpStats {
  ip: string;
  total: number;
  blocked: number;
  forbidden: number;
}

export interface RouteStats {
  route: string;
  total: number;
  errors: number;
  avg_ms: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 дня
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const globalState = globalThis as unknown as {
  __savetubeMetricsDb?: Database.Database;
  __savetubeMetricsLastSweep?: number;
};

function getDb(): Database.Database {
  if (!globalState.__savetubeMetricsDb) {
    mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(path.join(DATA_DIR, "metrics.db"));
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route TEXT NOT NULL,
        ip TEXT NOT NULL,
        status INTEGER NOT NULL,
        ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_created ON request_metrics (created_at);
      CREATE INDEX IF NOT EXISTS idx_metrics_ip ON request_metrics (ip, created_at);
    `);
    globalState.__savetubeMetricsDb = db;
  }
  return globalState.__savetubeMetricsDb;
}

/** Fire-and-forget запись; никогда не роняет основной запрос. */
export function recordMetric(event: MetricEvent): void {
  try {
    const now = Date.now();
    getDb()
      .prepare(
        `INSERT INTO request_metrics (route, ip, status, ms, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(event.route, event.ip, event.status, Math.round(event.ms), now);

    const lastSweep = globalState.__savetubeMetricsLastSweep ?? 0;
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      globalState.__savetubeMetricsLastSweep = now;
      getDb()
        .prepare(`DELETE FROM request_metrics WHERE created_at < ?`)
        .run(now - RETENTION_MS);
    }
  } catch {
    // метрики не должны влиять на основной флоу
  }
}

export function getSummary(sinceMs: number): {
  total: number;
  blocked: number;
  forbidden: number;
  errors: number;
  avg_ms: number;
  unique_ips: number;
} {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END) AS forbidden,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors,
        ROUND(AVG(ms)) AS avg_ms,
        COUNT(DISTINCT ip) AS unique_ips
      FROM request_metrics WHERE created_at > ?`,
    )
    .get(sinceMs) as Record<string, number | null>;
  return {
    total: row.total ?? 0,
    blocked: row.blocked ?? 0,
    forbidden: row.forbidden ?? 0,
    errors: row.errors ?? 0,
    avg_ms: row.avg_ms ?? 0,
    unique_ips: row.unique_ips ?? 0,
  };
}

/** Таймсерия, сгруппированная по бакетам bucketMs. */
export function getTimeseries(sinceMs: number, bucketMs: number): MetricsBucket[] {
  const bucket = Math.max(1, Math.round(bucketMs));
  return getDb()
    .prepare(
      `SELECT (created_at / ?) * ? AS bucket,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END) AS forbidden,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors,
        ROUND(AVG(ms)) AS avg_ms
      FROM request_metrics WHERE created_at > ?
      GROUP BY bucket ORDER BY bucket`,
    )
    .all(bucket, bucket, sinceMs) as MetricsBucket[];
}

/** Топ IP по числу запросов. */
export function getTopIps(sinceMs: number, limit = 10): IpStats[] {
  return getDb()
    .prepare(
      `SELECT ip, COUNT(*) AS total,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END) AS forbidden
      FROM request_metrics WHERE created_at > ?
      GROUP BY ip ORDER BY total DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as IpStats[];
}

/** Подозрительные IP: много отказов (429/403) — потенциальные атаки/абьюз. */
export function getSuspiciousIps(sinceMs: number, limit = 10): IpStats[] {
  return getDb()
    .prepare(
      `SELECT ip, COUNT(*) AS total,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END) AS forbidden
      FROM request_metrics WHERE created_at > ?
      GROUP BY ip HAVING (blocked + forbidden) > 0
      ORDER BY (blocked + forbidden) DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as IpStats[];
}

export function getRouteStats(sinceMs: number): RouteStats[] {
  return getDb()
    .prepare(
      `SELECT route, COUNT(*) AS total,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors,
        ROUND(AVG(ms)) AS avg_ms
      FROM request_metrics WHERE created_at > ?
      GROUP BY route ORDER BY total DESC`,
    )
    .all(sinceMs) as RouteStats[];
}
