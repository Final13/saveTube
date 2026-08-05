import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";

// Хранилище платежей и подписок: SQLite файлом в data/ (ноль инфраструктуры).

export interface Payment {
  id: number;
  email: string;
  rate_index: number;
  amount: number; // копейки
  title: string;
  status: 0 | 1; // 0 — ожидает оплаты, 1 — оплачен
  merchant_id: string | null;
  subscription_until: number | null; // unix ms
  created_at: number;
}

const DATA_DIR = path.join(process.cwd(), "data");

const globalState = globalThis as unknown as { __savetubeDb?: Database.Database };

function getDb(): Database.Database {
  if (!globalState.__savetubeDb) {
    mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(path.join(DATA_DIR, "payments.db"));
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        rate_index INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        title TEXT NOT NULL,
        status INTEGER NOT NULL DEFAULT 0,
        merchant_id TEXT,
        subscription_until INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_payments_email ON payments (email, status, subscription_until);
    `);
    globalState.__savetubeDb = db;
  }
  return globalState.__savetubeDb;
}

export function createPayment(input: {
  email: string;
  rateIndex: number;
  amount: number;
  title: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO payments (email, rate_index, amount, title, status, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(input.email, input.rateIndex, input.amount, input.title, Date.now());
  return Number(result.lastInsertRowid);
}

export function getPayment(id: number): Payment | null {
  const row = getDb().prepare(`SELECT * FROM payments WHERE id = ?`).get(id);
  return (row as Payment) ?? null;
}

export function setMerchantId(id: number, merchantId: string): void {
  getDb().prepare(`UPDATE payments SET merchant_id = ? WHERE id = ?`).run(merchantId, id);
}

/** Идемпотентная активация: переводит в оплачено только если ещё pending. true — активировано сейчас. */
export function markPaid(id: number, subscriptionUntil: number): boolean {
  const result = getDb()
    .prepare(`UPDATE payments SET status = 1, subscription_until = ? WHERE id = ? AND status = 0`)
    .run(subscriptionUntil, id);
  return result.changes > 0;
}

export function hasActiveSubscription(email: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM payments
       WHERE email = ? AND status = 1 AND subscription_until > ?
       LIMIT 1`,
    )
    .get(email, Date.now());
  return row !== undefined;
}

/** Проверка по паре payment_id + email (для поллинга статуса с фронта) */
export function isPaymentActive(id: number, email: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM payments
       WHERE id = ? AND email = ? AND status = 1 AND subscription_until > ?
       LIMIT 1`,
    )
    .get(id, email, Date.now());
  return row !== undefined;
}
