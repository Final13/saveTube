import { getMysqlClient, tablePrefix } from "@/lib/mysql";

// Глобальные настройки приложения в MySQL, таблица `{prefix}app_settings` (key-value).
// Сейчас хранит только платёжный провайдер: tbank (разовые платежи) | yookassa (рекуррент).

export type PaymentProvider = "tbank" | "yookassa";

const PROVIDER_KEY = "payment_provider";
const DEFAULT_PROVIDER: PaymentProvider = "tbank";

function settingsTable(): string {
  return `${tablePrefix()}app_settings`;
}

let schemaPromise: Promise<void> | null = null;

function ensureSettingsSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getMysqlClient();
      if (!db) return;
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${settingsTable()} (
          setting_key VARCHAR(64) NOT NULL,
          setting_value TEXT NULL,
          PRIMARY KEY (setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
    schemaPromise.catch(() => {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

/** Текущий платёжный провайдер. Без БД — T-Bank (поведение по умолчанию). */
export async function getPaymentProvider(): Promise<PaymentProvider> {
  await ensureSettingsSchema();
  const db = getMysqlClient();
  if (!db) return DEFAULT_PROVIDER;

  const rows = (await db.query(`SELECT setting_value FROM ${settingsTable()} WHERE setting_key = ? LIMIT 1`, [
    PROVIDER_KEY,
  ])) as Array<{ setting_value: string | null }>;
  const value = rows[0]?.setting_value;
  return value === "yookassa" ? "yookassa" : "tbank";
}

export async function setPaymentProvider(provider: PaymentProvider): Promise<void> {
  await ensureSettingsSchema();
  const db = getMysqlClient();
  if (!db) throw new Error("База данных недоступна.");

  await db.query(
    `INSERT INTO ${settingsTable()} (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [PROVIDER_KEY, provider],
  );
}
