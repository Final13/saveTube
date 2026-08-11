import { getMysqlClient, tablePrefix } from "@/lib/mysql";

// Хранилище платежей и подписок: MySQL, таблица `{prefix}payments`.
// Колонки унаследованы от старого бэкенда (payment_*), поэтому существующие
// оплаченные подписки в общей базе продолжают распознаваться без миграции данных.

export interface Payment {
  id: number;
  email: string;
  rate_index: number;
  status: 0 | 1; // 0 — ожидает оплаты, 1 — оплачен
  merchant_id: string | null;
  subscription_until: number | null; // unix ms
  provider: string | null; // 'tbank' | 'yookassa', NULL — легаси (T-Bank)
}

function paymentsTable(): string {
  return `${tablePrefix()}payments`;
}

let schemaPromise: Promise<void> | null = null;

/** Таблица создаётся только если её ещё нет (на боевой базе она уже существует). */
function ensurePaymentsSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getMysqlClient();
      if (!db) return;
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${paymentsTable()} (
          payment_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          payment_email VARCHAR(255) NOT NULL,
          payment_rate_index INT NOT NULL,
          payment_amount INT NOT NULL,
          payment_title VARCHAR(255) NOT NULL,
          payment_status TINYINT NOT NULL DEFAULT 0,
          payment_merchant_id VARCHAR(64) NULL,
          payment_untiled_at DATETIME NULL,
          payment_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (payment_id),
          INDEX idx_payments_email (payment_email, payment_status, payment_untiled_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      // Колонка провайдера: NULL — легаси-записи (T-Bank)
      const columns = (await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'payment_provider'`,
        [paymentsTable()],
      )) as Array<{ COLUMN_NAME: string }>;
      if (columns.length === 0) {
        await db.query(
          `ALTER TABLE ${paymentsTable()} ADD COLUMN payment_provider VARCHAR(10) NULL`,
        );
      }
      // Легаси-таблица от старого бэкенда могла создаться с NOT NULL без дефолта
      // на служебных колонках — INSERT тогда падает в strict mode. Приводим к NULL
      // (данные не меняются, старые записи не трогаются).
      const strictCols = (await db.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()
           AND COLUMN_NAME IN ('payment_merchant_id', 'payment_untiled_at')`,
        [paymentsTable()],
      )) as Array<{ COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string }>;
      for (const col of strictCols) {
        if (col.IS_NULLABLE === "NO") {
          await db.query(
            `ALTER TABLE ${paymentsTable()} MODIFY COLUMN ${col.COLUMN_NAME} ${col.COLUMN_TYPE} NULL`,
          );
        }
      }
    })();
    schemaPromise.catch(() => {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

interface PaymentRow {
  id: number;
  email: string;
  rate_index: number;
  status: number;
  merchant_id: string | null;
  subscription_until: number | null;
  provider: string | null;
}

function parsePayment(row: PaymentRow): Payment {
  return {
    id: Number(row.id),
    email: String(row.email),
    rate_index: Number(row.rate_index),
    status: Number(row.status) === 1 ? 1 : 0,
    merchant_id: row.merchant_id ? String(row.merchant_id) : null,
    subscription_until: row.subscription_until ? Number(row.subscription_until) : null,
    provider: row.provider ? String(row.provider) : null,
  };
}

/** Создание платежа (pending). amountRub — в рублях, как в существующих записях базы. */
export async function createPayment(input: {
  email: string;
  rateIndex: number;
  amountRub: number;
  title: string;
  provider?: "tbank" | "yookassa";
}): Promise<number> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) throw new Error("Сервис временно недоступен, попробуйте позже.");

  // payment_merchant_id задаём явно: в легаси-таблице на боевой базе колонка
  // NOT NULL без дефолта — пропуск поля роняет INSERT в strict mode.
  const result = (await db.query(
    `INSERT INTO ${paymentsTable()}
       (payment_email, payment_rate_index, payment_amount, payment_title, payment_status, payment_merchant_id, payment_provider)
     VALUES (?, ?, ?, ?, 0, '', ?)`,
    [input.email, input.rateIndex, input.amountRub, input.title, input.provider ?? "tbank"],
  )) as { insertId: number };
  return Number(result.insertId);
}

export async function getPayment(id: number): Promise<Payment | null> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return null;

  const rows = (await db.query(
    `SELECT payment_id AS id, payment_email AS email, payment_rate_index AS rate_index,
       payment_status AS status, payment_merchant_id AS merchant_id,
       payment_provider AS provider,
       UNIX_TIMESTAMP(payment_untiled_at) * 1000 AS subscription_until
     FROM ${paymentsTable()} WHERE payment_id = ? LIMIT 1`,
    [id],
  )) as PaymentRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return parsePayment(rows[0]);
}

export async function setMerchantId(id: number, merchantId: string): Promise<void> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return;
  await db.query(`UPDATE ${paymentsTable()} SET payment_merchant_id = ? WHERE payment_id = ?`, [
    merchantId,
    id,
  ]);
}

/** Идемпотентная активация: переводит в оплачено только если ещё pending. true — активировано сейчас. */
export async function markPaid(id: number, subscriptionUntil: number): Promise<boolean> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return false;

  const result = (await db.query(
    `UPDATE ${paymentsTable()}
     SET payment_status = 1, payment_untiled_at = FROM_UNIXTIME(? / 1000)
     WHERE payment_id = ? AND payment_status = 0`,
    [subscriptionUntil, id],
  )) as { affectedRows: number };
  return result.affectedRows > 0;
}

export async function hasActiveSubscription(email: string): Promise<boolean> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return false;

  const rows = (await db.query(
    `SELECT 1 FROM ${paymentsTable()}
     WHERE payment_email = ? AND payment_status = 1 AND payment_untiled_at > NOW()
     LIMIT 1`,
    [email],
  )) as unknown[];
  return rows.length > 0;
}

/** Проверка по паре payment_id + email (для поллинга статуса с фронта) */
export async function isPaymentActive(id: number, email: string): Promise<boolean> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return false;

  const rows = (await db.query(
    `SELECT 1 FROM ${paymentsTable()}
     WHERE payment_id = ? AND payment_email = ? AND payment_status = 1 AND payment_untiled_at > NOW()
     LIMIT 1`,
    [id, email],
  )) as unknown[];
  return rows.length > 0;
}

export interface PaymentListItem {
  id: number;
  email: string;
  rate_index: number;
  amount: number; // рубли
  title: string;
  status: 0 | 1;
  provider: string; // 'tbank' | 'yookassa' | 'legacy'
  merchant_id: string | null;
  subscription_until: number | null; // unix ms
  created_at: number | null; // unix ms, дата создания платежа
}

/** Последние платежи (для админки), новые первыми. */
export async function listPayments(limit = 50): Promise<PaymentListItem[]> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT payment_id AS id, payment_email AS email, payment_rate_index AS rate_index,
       payment_amount AS amount, payment_title AS title, payment_status AS status,
       payment_provider AS provider, payment_merchant_id AS merchant_id,
       UNIX_TIMESTAMP(payment_untiled_at) * 1000 AS subscription_until,
       UNIX_TIMESTAMP(payment_created_at) * 1000 AS created_at
     FROM ${paymentsTable()} ORDER BY payment_id DESC LIMIT ?`,
    [limit],
  )) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    email: String(row.email),
    rate_index: Number(row.rate_index),
    amount: Number(row.amount),
    title: String(row.title),
    status: Number(row.status) === 1 ? 1 : 0,
    provider: row.provider ? String(row.provider) : "legacy",
    merchant_id: row.merchant_id ? String(row.merchant_id) : null,
    subscription_until: row.subscription_until ? Number(row.subscription_until) : null,
    created_at: row.created_at ? Number(row.created_at) : null,
  }));
}

/** Последние платежи конкретного email (для ЛК), новые первыми. */
export async function listPaymentsByEmail(email: string, limit = 10): Promise<PaymentListItem[]> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT payment_id AS id, payment_email AS email, payment_rate_index AS rate_index,
       payment_amount AS amount, payment_title AS title, payment_status AS status,
       payment_provider AS provider, payment_merchant_id AS merchant_id,
       UNIX_TIMESTAMP(payment_untiled_at) * 1000 AS subscription_until,
       UNIX_TIMESTAMP(payment_created_at) * 1000 AS created_at
     FROM ${paymentsTable()} WHERE payment_email = ? ORDER BY payment_id DESC LIMIT ?`,
    [email, limit],
  )) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    email: String(row.email),
    rate_index: Number(row.rate_index),
    amount: Number(row.amount),
    title: String(row.title),
    status: Number(row.status) === 1 ? 1 : 0,
    provider: row.provider ? String(row.provider) : "legacy",
    merchant_id: row.merchant_id ? String(row.merchant_id) : null,
    subscription_until: row.subscription_until ? Number(row.subscription_until) : null,
    created_at: row.created_at ? Number(row.created_at) : null,
  }));
}
