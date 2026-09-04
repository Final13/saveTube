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
      // Колонка провайдера: NULL — легаси-записи (T-Bank).
      // Колонка способа оплаты: "Visa •• 1234" / "SberPay" / "ЮMoney" и т.п. (только ЮKassa)
      const columns = (await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('payment_provider', 'payment_method')`,
        [paymentsTable()],
      )) as Array<{ COLUMN_NAME: string }>;
      const existingCols = new Set(columns.map((c) => c.COLUMN_NAME));
      if (!existingCols.has("payment_provider")) {
        await db.query(
          `ALTER TABLE ${paymentsTable()} ADD COLUMN payment_provider VARCHAR(10) NULL`,
        );
      }
      if (!existingCols.has("payment_method")) {
        await db.query(
          `ALTER TABLE ${paymentsTable()} ADD COLUMN payment_method VARCHAR(64) NULL`,
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

/** Идемпотентная активация: переводит в оплачено только если ещё pending. true — активировано сейчас.
 *  method — способ оплаты ("Visa •• 1234", "SberPay"...), если известен (ЮKassa). */
export async function markPaid(id: number, subscriptionUntil: number, method?: string | null): Promise<boolean> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return false;

  const result = (await db.query(
    `UPDATE ${paymentsTable()}
     SET payment_status = 1, payment_untiled_at = FROM_UNIXTIME(? / 1000),
       payment_method = COALESCE(?, payment_method)
     WHERE payment_id = ? AND payment_status = 0`,
    [subscriptionUntil, method ?? null, id],
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
  method: string | null; // способ оплаты ("Visa •• 1234", "SberPay"...), только ЮKassa
  merchant_id: string | null;
  subscription_until: number | null; // unix ms
  created_at: number | null; // unix ms, дата создания платежа
}

export interface AdminPage<T> {
  items: T[];
  hasMore: boolean; // есть ли ещё записи за курсором
}

/** Последние платежи (для админки), новые первыми, страницами по курсору id. */
export async function listPayments(limit = 10, beforeId?: number | null): Promise<AdminPage<PaymentListItem>> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return { items: [], hasMore: false };

  // Тянем limit+1 — по лишней строке понимаем, есть ли продолжение
  const rows = (await db.query(
    `SELECT payment_id AS id, payment_email AS email, payment_rate_index AS rate_index,
       payment_amount AS amount, payment_title AS title, payment_status AS status,
       payment_provider AS provider, payment_method AS method, payment_merchant_id AS merchant_id,
       UNIX_TIMESTAMP(payment_untiled_at) * 1000 AS subscription_until,
       UNIX_TIMESTAMP(payment_created_at) * 1000 AS created_at
     FROM ${paymentsTable()}
     ${beforeId ? "WHERE payment_id < ?" : ""}
     ORDER BY payment_id DESC LIMIT ?`,
    beforeId ? [beforeId, limit + 1] : [limit + 1],
  )) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  return {
    hasMore,
    items: rows.slice(0, limit).map((row) => ({
      id: Number(row.id),
      email: String(row.email),
      rate_index: Number(row.rate_index),
      amount: Number(row.amount),
      title: String(row.title),
      status: Number(row.status) === 1 ? 1 : 0,
      provider: row.provider ? String(row.provider) : "legacy",
      method: row.method ? String(row.method) : null,
      merchant_id: row.merchant_id ? String(row.merchant_id) : null,
      subscription_until: row.subscription_until ? Number(row.subscription_until) : null,
      created_at: row.created_at ? Number(row.created_at) : null,
    })),
  };
}

export interface PaymentMethodStat {
  method: string; // метка корзины: "Банковская карта", "SberPay", "T-Bank"...
  count: number;
}

// Типы карт ЮKassa (если last4 не пришёл, метка — просто тип карты)
const CARD_TYPES = new Set([
  "visa", "mastercard", "mir", "маэстро", "maestro", "unionpay", "jcb",
  "americanexpress", "dinersclub", "unknown",
]);

/** Нормализация способа оплаты в метку корзины (общая для разбивки и графиков):
 *  все карты (с last4 и без) → «Банковская карта», NULL → T-Bank / «ЮKassa — без данных». */
function methodBasketLabel(methodFull: string | null, provider: string | null): string {
  const full = methodFull ? String(methodFull).trim() : "";
  if (!full) return provider === "yookassa" ? "ЮKassa — без данных" : "T-Bank";
  // карта с last4 ("Visa •• 1234") или карта без данных о типе/last4
  if (
    full.includes(" ••") ||
    full === "Банковская карта" ||
    CARD_TYPES.has(full.toLowerCase().replace(/[\s-]/g, ""))
  ) {
    return "Банковская карта";
  }
  return full;
}

/** Разбивка оплаченных платежей по способам оплаты (все время, для админки).
 *  Все карты (Visa, MasterCard, Mir...) схлопываются в «Банковская карта». */
export async function getPaymentMethodStats(): Promise<PaymentMethodStat[]> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT payment_method AS method_full, payment_provider AS provider, COUNT(*) AS cnt
     FROM ${paymentsTable()}
     WHERE payment_status = 1
     GROUP BY method_full, provider`,
  )) as Array<{ method_full: string | null; provider: string | null; cnt: number }>;

  const merged = new Map<string, number>();
  for (const row of rows) {
    const label = methodBasketLabel(row.method_full, row.provider);
    merged.set(label, (merged.get(label) ?? 0) + Number(row.cnt));
  }
  return Array.from(merged, ([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count);
}

export interface SubscriptionDayStat {
  date: string; // "YYYY-MM-DD"
  /** Новые подписки: оплаченные платежи без «(автопродление)» в названии */
  newSubs: number;
  /** Успешные автопродления (название «…(автопродление)» ставит крон billing) */
  renewals: number;
  /** Новые подписки по тарифам (rate_index → шт) — спрос на конкретные тарифы */
  newSubsByRate: Record<number, number>;
  /** Все оплаченные платежи дня по способам оплаты (метка корзины → шт) */
  paymentsByMethod: Record<string, number>;
}

export interface RateDemandStat {
  rateIndex: number;
  current: number;
  prev: number;
}

export interface MethodDemandStat {
  method: string; // метка корзины: «Банковская карта», «SberPay», «T-Bank»...
  current: number;
  prev: number;
}

export interface SubscriptionStats {
  /** Все дни периода по порядку, включая нулевые */
  days: SubscriptionDayStat[];
  newSubsTotal: number;
  renewalsTotal: number;
  /** Итоги за такой же по длине период ДО текущего — для оценки роста */
  prevNewSubsTotal: number;
  prevRenewalsTotal: number;
  /** Спрос по тарифам: итоги текущего и предыдущего периода (только тарифы с продажами) */
  rateDemand: RateDemandStat[];
  /** Спрос на способы оплаты: итоги текущего и предыдущего периода, по убыванию */
  methodDemand: MethodDemandStat[];
}

/** Динамика подписок по дням для админки: новые vs автопродления, разбивка новых
 *  по тарифам, всех платежей — по способам оплаты + итоги предыдущего такого же
 *  периода (рост в %). Даты — по TZ MySQL-сервера (на VPS совпадает с app).
 *  null — без MySQL. */
export async function getSubscriptionStats(days = 30): Promise<SubscriptionStats | null> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return null;

  const windowDays = Math.max(1, Math.min(365, Math.floor(days) || 30));
  // Интервал — литералом: значение проверено целое, а `INTERVAL ? DAY` с плейсхолдером
  // у mysqljs/MySQL ведёт себя нестабильно. Берём двойное окно — для «предыдущего» периода.
  const rows = (await db.query(
    `SELECT DATE_FORMAT(payment_created_at, '%Y-%m-%d') AS d,
            payment_rate_index AS rate,
            SUM(payment_title LIKE '%(автопродление)%') AS renewals,
            SUM(payment_title NOT LIKE '%(автопродление)%') AS new_subs
     FROM ${paymentsTable()}
     WHERE payment_status = 1
       AND payment_created_at >= CURDATE() - INTERVAL ${windowDays * 2} DAY
     GROUP BY d, payment_rate_index`,
  )) as Array<{ d: string; rate: number; renewals: number; new_subs: number }>;

  // Способы оплаты по дням — все оплаченные платежи (и новые, и продления)
  const methodRows = (await db.query(
    `SELECT DATE_FORMAT(payment_created_at, '%Y-%m-%d') AS d,
            payment_method AS method_full, payment_provider AS provider, COUNT(*) AS cnt
     FROM ${paymentsTable()}
     WHERE payment_status = 1
       AND payment_created_at >= CURDATE() - INTERVAL ${windowDays * 2} DAY
     GROUP BY d, method_full, provider`,
  )) as Array<{ d: string; method_full: string | null; provider: string | null; cnt: number }>;

  interface DayBucket {
    newSubs: number;
    renewals: number;
    byRate: Map<number, number>;
  }
  const byDate = new Map<string, DayBucket>();
  for (const row of rows) {
    const dateKey = String(row.d);
    let bucket = byDate.get(dateKey);
    if (!bucket) {
      bucket = { newSubs: 0, renewals: 0, byRate: new Map() };
      byDate.set(dateKey, bucket);
    }
    bucket.newSubs += Number(row.new_subs);
    bucket.renewals += Number(row.renewals);
    const rate = Number(row.rate);
    bucket.byRate.set(rate, (bucket.byRate.get(rate) ?? 0) + Number(row.new_subs));
  }

  const methodsByDate = new Map<string, Map<string, number>>();
  for (const row of methodRows) {
    const dateKey = String(row.d);
    let bucket = methodsByDate.get(dateKey);
    if (!bucket) {
      bucket = new Map();
      methodsByDate.set(dateKey, bucket);
    }
    const label = methodBasketLabel(row.method_full, row.provider);
    bucket.set(label, (bucket.get(label) ?? 0) + Number(row.cnt));
  }

  const keyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date();

  const daysList: SubscriptionDayStat[] = [];
  const currentByRate = new Map<number, number>();
  const prevByRate = new Map<number, number>();
  const currentByMethod = new Map<string, number>();
  const prevByMethod = new Map<string, number>();
  let newSubsTotal = 0;
  let renewalsTotal = 0;
  let prevNewSubsTotal = 0;
  let prevRenewalsTotal = 0;
  for (let i = windowDays * 2 - 1; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const dateKey = keyOf(date);
    const bucket = byDate.get(dateKey);
    const methodBucket = methodsByDate.get(dateKey);
    const newSubs = bucket?.newSubs ?? 0;
    const renewals = bucket?.renewals ?? 0;
    if (i >= windowDays) {
      prevNewSubsTotal += newSubs;
      prevRenewalsTotal += renewals;
      bucket?.byRate.forEach((count, rate) => {
        prevByRate.set(rate, (prevByRate.get(rate) ?? 0) + count);
      });
      methodBucket?.forEach((count, method) => {
        prevByMethod.set(method, (prevByMethod.get(method) ?? 0) + count);
      });
    } else {
      const newSubsByRate: Record<number, number> = {};
      bucket?.byRate.forEach((count, rate) => {
        newSubsByRate[rate] = count;
        currentByRate.set(rate, (currentByRate.get(rate) ?? 0) + count);
      });
      const paymentsByMethod: Record<string, number> = {};
      methodBucket?.forEach((count, method) => {
        paymentsByMethod[method] = count;
        currentByMethod.set(method, (currentByMethod.get(method) ?? 0) + count);
      });
      daysList.push({ date: dateKey, newSubs, renewals, newSubsByRate, paymentsByMethod });
      newSubsTotal += newSubs;
      renewalsTotal += renewals;
    }
  }

  const rateDemand: RateDemandStat[] = Array.from(
    new Set([...currentByRate.keys(), ...prevByRate.keys()]),
  )
    .sort((a, b) => a - b)
    .map((rateIndex) => ({
      rateIndex,
      current: currentByRate.get(rateIndex) ?? 0,
      prev: prevByRate.get(rateIndex) ?? 0,
    }))
    .filter((r) => r.current > 0 || r.prev > 0);

  const methodDemand: MethodDemandStat[] = Array.from(
    new Set([...currentByMethod.keys(), ...prevByMethod.keys()]),
  )
    .map((method) => ({
      method,
      current: currentByMethod.get(method) ?? 0,
      prev: prevByMethod.get(method) ?? 0,
    }))
    .filter((m) => m.current > 0 || m.prev > 0)
    .sort((a, b) => b.current + b.prev - (a.current + a.prev));

  return {
    days: daysList,
    newSubsTotal,
    renewalsTotal,
    prevNewSubsTotal,
    prevRenewalsTotal,
    rateDemand,
    methodDemand,
  };
}

/** Оплаченные платежи ЮKassa без записанного способа (для разового бэкфилла из админки). */
export async function listPaidYookassaWithoutMethod(
  limit = 200,
): Promise<Array<{ id: number; email: string; merchant_id: string }>> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT payment_id AS id, payment_email AS email, payment_merchant_id AS merchant_id
     FROM ${paymentsTable()}
     WHERE payment_status = 1 AND payment_provider = 'yookassa' AND payment_method IS NULL
       AND payment_merchant_id IS NOT NULL AND payment_merchant_id <> ''
     ORDER BY payment_id DESC LIMIT ?`,
    [limit],
  )) as Array<{ id: number; email: string; merchant_id: string }>;
  return rows.map((row) => ({
    id: Number(row.id),
    email: String(row.email),
    merchant_id: String(row.merchant_id),
  }));
}

/** Записать способ оплаты платежу (бэкфилл из админки). */
export async function setPaymentMethod(id: number, method: string): Promise<void> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return;
  await db.query(`UPDATE ${paymentsTable()} SET payment_method = ? WHERE payment_id = ?`, [method, id]);
}

/** Последние платежи конкретного email (для ЛК), новые первыми. */
export async function listPaymentsByEmail(email: string, limit = 10): Promise<PaymentListItem[]> {
  await ensurePaymentsSchema();
  const db = getMysqlClient();
  if (!db) return [];

  const rows = (await db.query(
    `SELECT payment_id AS id, payment_email AS email, payment_rate_index AS rate_index,
       payment_amount AS amount, payment_title AS title, payment_status AS status,
       payment_provider AS provider, payment_method AS method, payment_merchant_id AS merchant_id,
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
    method: row.method ? String(row.method) : null,
    merchant_id: row.merchant_id ? String(row.merchant_id) : null,
    subscription_until: row.subscription_until ? Number(row.subscription_until) : null,
    created_at: row.created_at ? Number(row.created_at) : null,
  }));
}
