import { getMysqlClient, tablePrefix } from "@/lib/mysql";

// Хранилище метрик запросов: MySQL, таблица `{prefix}request_metrics`.
// Запись fire-and-forget — сбор метрик не влияет на основной запрос.
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

const RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 дня
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const globalState = globalThis as unknown as {
  __savetubeMetricsLastSweep?: number;
};

function metricsTable(): string {
  return `${tablePrefix()}request_metrics`;
}

let schemaPromise: Promise<void> | null = null;

function ensureMetricsSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getMysqlClient();
      if (!db) return;
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${metricsTable()} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          route VARCHAR(64) NOT NULL,
          ip VARCHAR(45) NOT NULL,
          status SMALLINT NOT NULL,
          ms INT NOT NULL,
          created_at BIGINT NOT NULL,
          PRIMARY KEY (id),
          INDEX idx_metrics_created (created_at),
          INDEX idx_metrics_ip (ip, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
    // Схема не должна кешировать ошибку навсегда — при сбое пробуем снова при следующем вызове.
    schemaPromise.catch(() => {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

/** Fire-and-forget запись; никогда не роняет основной запрос. */
export function recordMetric(event: MetricEvent): void {
  void (async () => {
    try {
      await ensureMetricsSchema();
      const db = getMysqlClient();
      if (!db) return;

      const now = Date.now();
      await db.query(
        `INSERT INTO ${metricsTable()} (route, ip, status, ms, created_at) VALUES (?, ?, ?, ?, ?)`,
        [event.route, event.ip, event.status, Math.round(event.ms), now],
      );

      const lastSweep = globalState.__savetubeMetricsLastSweep ?? 0;
      if (now - lastSweep > SWEEP_INTERVAL_MS) {
        globalState.__savetubeMetricsLastSweep = now;
        await db.query(`DELETE FROM ${metricsTable()} WHERE created_at < ?`, [
          now - RETENTION_MS,
        ]);
      }
    } catch {
      // метрики не должны влиять на основной флоу
    }
  })();
}

interface SummaryRow {
  total: number | null;
  blocked: number | null;
  forbidden: number | null;
  errors: number | null;
  avg_ms: number | null;
  unique_ips: number | null;
}

export async function getSummary(sinceMs: number): Promise<{
  total: number;
  blocked: number;
  forbidden: number;
  errors: number;
  avg_ms: number;
  unique_ips: number;
}> {
  const empty = { total: 0, blocked: 0, forbidden: 0, errors: 0, avg_ms: 0, unique_ips: 0 };
  await ensureMetricsSchema();
  const db = getMysqlClient();
  if (!db) return empty;

  const rows = (await db.query(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END) AS forbidden,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors,
      ROUND(AVG(ms)) AS avg_ms,
      COUNT(DISTINCT ip) AS unique_ips
    FROM ${metricsTable()} WHERE created_at > ?`,
    [sinceMs],
  )) as SummaryRow[];
  const row = rows[0] ?? {};
  return {
    total: Number(row.total ?? 0),
    blocked: Number(row.blocked ?? 0),
    forbidden: Number(row.forbidden ?? 0),
    errors: Number(row.errors ?? 0),
    avg_ms: Number(row.avg_ms ?? 0),
    unique_ips: Number(row.unique_ips ?? 0),
  };
}

/** Таймсерия, сгруппированная по бакетам bucketMs. */
export async function getTimeseries(sinceMs: number, bucketMs: number): Promise<MetricsBucket[]> {
  await ensureMetricsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const bucket = Math.max(1, Math.round(bucketMs));
  const rows = (await db.query(
    `SELECT (created_at DIV ?) * ? AS bucket,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END) AS forbidden,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors,
      ROUND(AVG(ms)) AS avg_ms
    FROM ${metricsTable()} WHERE created_at > ?
    GROUP BY bucket ORDER BY bucket`,
    [bucket, bucket, sinceMs],
  )) as MetricsBucket[];
  return rows.map((r) => ({
    bucket: Number(r.bucket),
    total: Number(r.total),
    blocked: Number(r.blocked),
    forbidden: Number(r.forbidden),
    errors: Number(r.errors),
    avg_ms: Number(r.avg_ms),
  }));
}

/** Топ IP по числу запросов. */
export async function getTopIps(sinceMs: number, limit = 10): Promise<IpStats[]> {
  await ensureMetricsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT ip, COUNT(*) AS total,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END) AS forbidden
    FROM ${metricsTable()} WHERE created_at > ?
    GROUP BY ip ORDER BY total DESC LIMIT ?`,
    [sinceMs, limit],
  )) as IpStats[];
  return rows.map((r) => ({
    ip: String(r.ip),
    total: Number(r.total),
    blocked: Number(r.blocked),
    forbidden: Number(r.forbidden),
  }));
}

/** Подозрительные IP: много отказов (429/403) — потенциальные атаки/абьюз. */
export async function getSuspiciousIps(sinceMs: number, limit = 10): Promise<IpStats[]> {
  await ensureMetricsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT ip, COUNT(*) AS total,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END) AS forbidden
    FROM ${metricsTable()} WHERE created_at > ?
    GROUP BY ip HAVING (blocked + forbidden) > 0
    ORDER BY (blocked + forbidden) DESC LIMIT ?`,
    [sinceMs, limit],
  )) as IpStats[];
  return rows.map((r) => ({
    ip: String(r.ip),
    total: Number(r.total),
    blocked: Number(r.blocked),
    forbidden: Number(r.forbidden),
  }));
}

export async function getRouteStats(sinceMs: number): Promise<RouteStats[]> {
  await ensureMetricsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT route, COUNT(*) AS total,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors,
      ROUND(AVG(ms)) AS avg_ms
    FROM ${metricsTable()} WHERE created_at > ?
    GROUP BY route ORDER BY total DESC`,
    [sinceMs],
  )) as RouteStats[];
  return rows.map((r) => ({
    route: String(r.route),
    total: Number(r.total),
    errors: Number(r.errors),
    avg_ms: Number(r.avg_ms),
  }));
}
