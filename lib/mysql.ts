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

/** Создание нового клиента MySQL с настройками из env. */
function createMysqlClient(): ReturnType<typeof serverlessMysql> {
  const portValue = Number(process.env.MYSQL_PORT ?? "3306");
  const port = Number.isFinite(portValue) ? portValue : 3306;

  return serverlessMysql({
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
}

export type MysqlClient = ReturnType<typeof serverlessMysql>;

/** Получение singleton-клиента MySQL или null если не настроен. */
export function getMysqlClient(): MysqlClient | null {
  if (!isMysqlConfigured()) {
    return null;
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
