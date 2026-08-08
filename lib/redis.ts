/**
 * Клиент Redis (ioredis); singleton на процесс, lazy connect.
 * Без REDIS_URL возвращает null — auth-роуты в этом случае отвечают 503,
 * остальная функциональность (оплата и т.д.) от Redis не зависит.
 * Формат REDIS_URL: redis://[:password@]host:port
 */
import { Redis } from "ioredis";

const globalForRedis = globalThis as unknown as {
  redisClient?: Redis | null;
};

/** Получение singleton-клиента Redis или null если REDIS_URL не задан. */
export function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (globalForRedis.redisClient === undefined) {
    globalForRedis.redisClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      // Быстрый отказ: недоступный Redis не должен вешать HTTP-запрос
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
    });
    globalForRedis.redisClient.on("error", (error) => {
      console.error("Redis error:", error);
    });
  }

  return globalForRedis.redisClient;
}
