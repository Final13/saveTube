/**
 * Клиент MySQL через serverless-mysql; singleton на процесс.
 * Без переменных окружения MYSQL_* возвращает null (платежи/метрики отключены).
 */
import serverlessMysql from "serverless-mysql";

const globalForMysql = globalThis as unknown as {
  mysqlClient?: ReturnType<typeof serverlessMysql>;
};

/** Проверка наличия всех необходимых переменных окружения для подключения к MySQL. */
function isMysqlConfigured(): boolean {
  return Boolean(
    process.env.MYSQL_HOST &&
      process.env.MYSQL_DATABASE &&
      process.env.MYSQL_USER &&
      process.env.MYSQL_PASSWORD,
  );
}

// Маркер пропатченного клиента: клиенты, созданные до появления авто-переподключения
// (например, закешированные в globalThis до HMR), считаются потенциально мёртвыми.
const RECONNECT_MARK = "__savetubeReconnect__";

/** Ошибки мёртвого/оборванного соединения, после которых имеет смысл пересоздать клиент. */
function isDeadConnectionError(error: Error): boolean {
  return (
    error.message.includes("closed state") ||
    error.message.includes("Connection lost") ||
    error.message.includes("ECONNRESET")
  );
}

/** Создание нового клиента MySQL с настройками из env. */
function createMysqlClient(): ReturnType<typeof serverlessMysql> {
  const portValue = Number(process.env.MYSQL_PORT ?? "3306");
  const port = Number.isFinite(portValue) ? portValue : 3306;

  const client = serverlessMysql({
    config: {
      host: process.env.MYSQL_HOST,
      port,
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      charset: "utf8mb4",
      connectTimeout: 10000,
    },
  });

  // MySQL рвёт простаивающие соединения (wait_timeout, рестарт сервера), а mysql2 сам
  // не переподключается — без этого патча синглтон после обрыва вечно отвечает
  // "Can't add new command when connection is in closed state" до рестарта процесса.
  // На таких ошибках сбрасываем синглтон и повторяем запрос один раз со свежим клиентом.
  const originalQuery = client.query.bind(client) as MysqlClient["query"];
  const wrapped = (async (...args: unknown[]) => {
    try {
      return await originalQuery(...(args as [string, unknown[]?]));
    } catch (error) {
      if (error instanceof Error && isDeadConnectionError(error)) {
        globalForMysql.mysqlClient = undefined;
        const fresh = getMysqlClient();
        if (!fresh) throw error;
        return fresh.query(...(args as [string, unknown[]?]));
      }
      throw error;
    }
  }) as MysqlClient["query"];
  client.query = wrapped;
  (client as unknown as Record<string, unknown>)[RECONNECT_MARK] = true;
  return client;
}

export type MysqlClient = ReturnType<typeof serverlessMysql>;

/** Получение singleton-клиента MySQL или null если не настроен. */
export function getMysqlClient(): MysqlClient | null {
  if (!isMysqlConfigured()) {
    return null;
  }

  const cached = globalForMysql.mysqlClient as
    | (MysqlClient & Record<string, unknown>)
    | undefined;
  if (cached && !cached[RECONNECT_MARK]) {
    globalForMysql.mysqlClient = undefined;
  }

  if (!globalForMysql.mysqlClient) {
    globalForMysql.mysqlClient = createMysqlClient();
  }

  return globalForMysql.mysqlClient;
}

/** Префикс таблиц в общей базе (по умолчанию WordPress-префикс wp_). */
export function tablePrefix(): string {
  return process.env.MYSQL_TABLE_PREFIX ?? "wp_";
}
