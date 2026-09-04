import { getMysqlClient, tablePrefix } from "@/lib/mysql";
import { getRate } from "@/lib/rates";

// Рекуррентные подписки ЮKassa, таблица `{prefix}recurrent_subscriptions`.
// Запись создаётся после первой успешной оплаты с save_payment_method:
// дальше /api/cron/billing списывает по сохранённому payment_method_id.

export interface RecurrentSubscription {
  id: number;
  email: string;
  rate_index: number;
  yookassa_payment_method_id: string;
  card_type: string | null; // например "Mir", "Visa"
  card_last4: string | null;
  active: boolean;
  /** Сколько успешных автосписаний подряд (сброс при неудачном списании) */
  success_streak: number;
  next_billing_at: number; // unix ms
  created_at: number | null; // unix ms
}

function recurrentTable(): string {
  return `${tablePrefix()}recurrent_subscriptions`;
}

let schemaPromise: Promise<void> | null = null;

function ensureRecurrentSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getMysqlClient();
      if (!db) return;
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${recurrentTable()} (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          email VARCHAR(255) NOT NULL,
          rate_index INT NOT NULL,
          yookassa_payment_method_id VARCHAR(64) NOT NULL,
          card_type VARCHAR(32) NULL,
          card_last4 VARCHAR(4) NULL,
          active TINYINT NOT NULL DEFAULT 1,
          success_streak INT NOT NULL DEFAULT 0,
          next_billing_at DATETIME NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_recurrent_email (email),
          INDEX idx_recurrent_due (active, next_billing_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      // Колонки карты для ЛК (на существующей таблице — добавляем миграцией)
      const columns = (await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()`,
        [recurrentTable()],
      )) as Array<{ COLUMN_NAME: string }>;
      const existing = new Set(columns.map((c) => c.COLUMN_NAME));
      if (!existing.has("card_type")) {
        await db.query(`ALTER TABLE ${recurrentTable()} ADD COLUMN card_type VARCHAR(32) NULL`);
      }
      if (!existing.has("card_last4")) {
        await db.query(`ALTER TABLE ${recurrentTable()} ADD COLUMN card_last4 VARCHAR(4) NULL`);
      }
      if (!existing.has("success_streak")) {
        await db.query(
          `ALTER TABLE ${recurrentTable()} ADD COLUMN success_streak INT NOT NULL DEFAULT 0`,
        );
      }
    })();
    schemaPromise.catch(() => {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

interface RecurrentRow {
  id: number;
  email: string;
  rate_index: number;
  yookassa_payment_method_id: string;
  card_type: string | null;
  card_last4: string | null;
  active: number;
  success_streak: number;
  next_billing_ms: number;
  created_ms: number | null;
}

function parseRow(row: RecurrentRow): RecurrentSubscription {
  return {
    id: Number(row.id),
    email: String(row.email),
    rate_index: Number(row.rate_index),
    yookassa_payment_method_id: String(row.yookassa_payment_method_id),
    card_type: row.card_type ? String(row.card_type) : null,
    card_last4: row.card_last4 ? String(row.card_last4) : null,
    active: Number(row.active) === 1,
    success_streak: Number(row.success_streak),
    next_billing_at: Number(row.next_billing_ms),
    created_at: row.created_ms ? Number(row.created_ms) : null,
  };
}

const SELECT_FIELDS = `id, email, rate_index, yookassa_payment_method_id, card_type, card_last4, active, success_streak,
  UNIX_TIMESTAMP(next_billing_at) * 1000 AS next_billing_ms,
  UNIX_TIMESTAMP(created_at) * 1000 AS created_ms`;

/** Сохранить/обновить рекуррент после успешной оплаты (одна активная запись на email). */
export async function upsertRecurrent(input: {
  email: string;
  rateIndex: number;
  paymentMethodId: string;
  cardType?: string | null;
  cardLast4?: string | null;
  nextBillingAt: number; // unix ms
}): Promise<void> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return;

  await db.query(
    `INSERT INTO ${recurrentTable()}
       (email, rate_index, yookassa_payment_method_id, card_type, card_last4, active, next_billing_at)
     VALUES (?, ?, ?, ?, ?, 1, FROM_UNIXTIME(? / 1000))
     ON DUPLICATE KEY UPDATE
       rate_index = VALUES(rate_index),
       yookassa_payment_method_id = VALUES(yookassa_payment_method_id),
       card_type = VALUES(card_type),
       card_last4 = VALUES(card_last4),
       active = 1,
       next_billing_at = VALUES(next_billing_at)`,
    [
      input.email,
      input.rateIndex,
      input.paymentMethodId,
      input.cardType ?? null,
      input.cardLast4 ?? null,
      input.nextBillingAt,
    ],
  );
}

/** Рекуррент по email (для ЛК). */
export async function getRecurrentByEmail(email: string): Promise<RecurrentSubscription | null> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return null;

  const rows = (await db.query(`SELECT ${SELECT_FIELDS} FROM ${recurrentTable()} WHERE email = ? LIMIT 1`, [
    email,
  ])) as RecurrentRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return parseRow(rows[0]);
}

/** Удалить рекуррент (отвязка карты — автопродление прекращается). */
export async function deleteRecurrent(email: string): Promise<void> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return;
  await db.query(`DELETE FROM ${recurrentTable()} WHERE email = ?`, [email]);
}

/** Подписки, которым пора списывать (active и next_billing_at <= сейчас). */
export async function getDueRecurrent(): Promise<RecurrentSubscription[]> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT ${SELECT_FIELDS} FROM ${recurrentTable()}
     WHERE active = 1 AND next_billing_at <= NOW() ORDER BY next_billing_at`,
  )) as RecurrentRow[];
  return rows.map(parseRow);
}

/** Отложить следующее списание (после неуспешной попытки — ретрай через retryInMs). */
export async function postponeRecurrent(id: number, retryInMs: number): Promise<void> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return;
  await db.query(
    `UPDATE ${recurrentTable()} SET next_billing_at = FROM_UNIXTIME(? / 1000) WHERE id = ?`,
    [Date.now() + retryInMs, id],
  );
}

/** Успешное списание: следующее — в новую дату окончания подписки. */
export async function markRecurrentBilled(id: number, nextBillingAt: number): Promise<void> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return;
  await db.query(
    `UPDATE ${recurrentTable()} SET next_billing_at = FROM_UNIXTIME(? / 1000) WHERE id = ?`,
    [nextBillingAt, id],
  );
}

/** +1 к серии успешных автосписаний (вызывать только при реальной активации продления). */
export async function bumpRecurrentStreak(email: string): Promise<void> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return;
  await db.query(
    `UPDATE ${recurrentTable()} SET success_streak = success_streak + 1 WHERE email = ?`,
    [email],
  );
}

/** Сброс серии «подряд» после неудачного списания (canceled). */
export async function resetRecurrentStreak(id: number): Promise<void> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return;
  await db.query(`UPDATE ${recurrentTable()} SET success_streak = 0 WHERE id = ?`, [id]);
}

/** Разовый бэкфилл серий: пересчитывает success_streak по оплаченным платежам
 *  с названием «…(автопродление)» (так помечает продления крон billing).
 *  Два шага: агрегация платежей → UPDATE по email-параметру. Без кросс-табличного
 *  сравнения строк: payments — от старого бэкенда, коллации колонок могут
 *  отличаться, JOIN/подзапрос падает с «Illegal mix of collations».
 *  Идемпотентно (полный пересчёт). Число обновлённых строк, null — без MySQL. */
export async function backfillRecurrentStreaks(): Promise<number | null> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return null;

  const counts = (await db.query(
    `SELECT payment_email AS email, COUNT(*) AS cnt FROM ${tablePrefix()}payments
     WHERE payment_status = 1 AND payment_title LIKE '%(автопродление)%'
     GROUP BY payment_email`,
  )) as Array<{ email: string; cnt: number }>;

  await db.query(`UPDATE ${recurrentTable()} SET success_streak = 0`);

  let updated = 0;
  for (const row of counts) {
    const result = (await db.query(
      `UPDATE ${recurrentTable()} SET success_streak = ? WHERE email = ?`,
      [Number(row.cnt), String(row.email)],
    )) as { affectedRows?: number };
    updated += result.affectedRows ?? 0;
  }
  return updated;
}

/** Активные автопродления: всего + разбивка по длительности тарифа + сколько подписок
 *  продлились ≥1/≥2/≥3 раз (по success_streak) + полное распределение по числу
 *  продлений подряд (streak × тариф), включая 0 — таблица в админке. */
export async function recurrentActiveStats(): Promise<{
  total: number;
  byDays: Record<number, number>;
  renewed: { ge1: number; ge2: number; ge3: number };
  streaks: Array<{ streak: number; byDays: Record<number, number>; total: number }>;
}> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return { total: 0, byDays: {}, renewed: { ge1: 0, ge2: 0, ge3: 0 }, streaks: [] };

  const rows = (await db.query(
    `SELECT rate_index, success_streak, COUNT(*) AS cnt FROM ${recurrentTable()}
     WHERE active = 1 GROUP BY rate_index, success_streak`,
  )) as Array<{ rate_index: number; success_streak: number; cnt: number }>;

  const byDays: Record<number, number> = {};
  const renewed = { ge1: 0, ge2: 0, ge3: 0 };
  const streakMap = new Map<number, { byDays: Record<number, number>; total: number }>();
  let total = 0;
  for (const row of rows) {
    const cnt = Number(row.cnt);
    const days = getRate(Number(row.rate_index))?.days ?? Number(row.rate_index);
    byDays[days] = (byDays[days] ?? 0) + cnt;
    total += cnt;
    const streak = Number(row.success_streak);
    if (streak >= 1) renewed.ge1 += cnt;
    if (streak >= 2) renewed.ge2 += cnt;
    if (streak >= 3) renewed.ge3 += cnt;
    let bucket = streakMap.get(streak);
    if (!bucket) {
      bucket = { byDays: {}, total: 0 };
      streakMap.set(streak, bucket);
    }
    bucket.byDays[days] = (bucket.byDays[days] ?? 0) + cnt;
    bucket.total += cnt;
  }
  const streaks = Array.from(streakMap, ([streak, value]) => ({ streak, ...value })).sort(
    (a, b) => a.streak - b.streak,
  );
  return { total, byDays, renewed, streaks };
}

/** Все рекуррентные подписки (для админки), новые первыми, страницами по курсору id. */
export async function listRecurrent(
  limit = 10,
  beforeId?: number | null,
): Promise<{ items: RecurrentSubscription[]; hasMore: boolean }> {
  await ensureRecurrentSchema();
  const db = getMysqlClient();
  if (!db) return { items: [], hasMore: false };

  // Тянем limit+1 — по лишней строке понимаем, есть ли продолжение
  const rows = (await db.query(
    `SELECT ${SELECT_FIELDS} FROM ${recurrentTable()}
     ${beforeId ? "WHERE id < ?" : ""}
     ORDER BY id DESC LIMIT ?`,
    beforeId ? [beforeId, limit + 1] : [limit + 1],
  )) as RecurrentRow[];
  const hasMore = rows.length > limit;
  return { hasMore, items: rows.slice(0, limit).map(parseRow) };
}
