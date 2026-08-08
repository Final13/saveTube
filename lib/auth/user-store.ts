import crypto from "crypto";
import { getMysqlClient, tablePrefix } from "@/lib/mysql";

// Пользователи ЛК, таблица `{prefix}app_users` (НЕ {prefix}users — база
// WordPress-совместимая, там может быть wp_users от самого WordPress).
// Паролей нет: вход по одноразовому коду из письма (OTP в Redis, см.
// /api/auth/request-code). Колонка password_hash осталась от старой модели
// и игнорируется (мигрирована в NULL, в INSERT не участвует).

export interface AppUser {
  id: string;
  email: string;
  created_at: number | null; // unix ms
}

function usersTable(): string {
  return `${tablePrefix()}app_users`;
}

let schemaPromise: Promise<void> | null = null;

function ensureUsersSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getMysqlClient();
      if (!db) return;
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${usersTable()} (
          id CHAR(36) NOT NULL,
          email VARCHAR(255) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_app_users_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      // Существующая таблица создана с password_hash NOT NULL — INSERT без
      // пароля тогда падает. Приводим колонку к NULL (данные не трогаем),
      // паттерн как в lib/payments-store.ts.
      const columns = (await db.query(
        `SELECT COLUMN_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'password_hash'`,
        [usersTable()],
      )) as Array<{ COLUMN_TYPE: string; IS_NULLABLE: string }>;
      if (columns.length > 0 && columns[0].IS_NULLABLE === "NO") {
        await db.query(
          `ALTER TABLE ${usersTable()} MODIFY COLUMN password_hash ${columns[0].COLUMN_TYPE} NULL`,
        );
      }
    })();
    schemaPromise.catch(() => {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

interface UserRow {
  id: string;
  email: string;
  created_ms: number | null;
}

function parseRow(row: UserRow): AppUser {
  return {
    id: String(row.id),
    email: String(row.email),
    created_at: row.created_ms ? Number(row.created_ms) : null,
  };
}

const SELECT_FIELDS = `id, email,
  UNIX_TIMESTAMP(created_at) * 1000 AS created_ms`;

/** Создать юзера (email храним в lower-case). Возвращает id. */
export async function createUser(data: { email: string }): Promise<string> {
  await ensureUsersSchema();
  const db = getMysqlClient();
  if (!db) throw new Error("Database not available");

  const id = crypto.randomUUID();
  await db.query(`INSERT INTO ${usersTable()} (id, email) VALUES (?, ?)`, [
    id,
    data.email.toLowerCase(),
  ]);
  return id;
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  await ensureUsersSchema();
  const db = getMysqlClient();
  if (!db) return null;

  const rows = (await db.query(
    `SELECT ${SELECT_FIELDS} FROM ${usersTable()} WHERE email = ? LIMIT 1`,
    [email.toLowerCase()],
  )) as UserRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return parseRow(rows[0]);
}

export async function findUserById(id: string): Promise<AppUser | null> {
  await ensureUsersSchema();
  const db = getMysqlClient();
  if (!db) return null;

  const rows = (await db.query(
    `SELECT ${SELECT_FIELDS} FROM ${usersTable()} WHERE id = ? LIMIT 1`,
    [id],
  )) as UserRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return parseRow(rows[0]);
}
