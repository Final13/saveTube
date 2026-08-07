import crypto from "crypto";
import { getMysqlClient, tablePrefix } from "@/lib/mysql";

// Пользователи ЛК, таблица `{prefix}app_users` (НЕ {prefix}users — база
// WordPress-совместимая, там может быть wp_users от самого WordPress).
// Регистрации как отдельного действия нет: юзер создаётся автоматически
// при первой оплате (см. /api/payment), пароль приходит письмом.

export interface AppUser {
  id: string;
  email: string;
  password_hash: string;
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
          password_hash VARCHAR(255) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_app_users_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
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
  password_hash: string;
  created_ms: number | null;
}

function parseRow(row: UserRow): AppUser {
  return {
    id: String(row.id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    created_at: row.created_ms ? Number(row.created_ms) : null,
  };
}

const SELECT_FIELDS = `id, email, password_hash,
  UNIX_TIMESTAMP(created_at) * 1000 AS created_ms`;

/** Создать юзера (email храним в lower-case). Возвращает id. */
export async function createUser(data: {
  email: string;
  passwordHash: string;
}): Promise<string> {
  await ensureUsersSchema();
  const db = getMysqlClient();
  if (!db) throw new Error("Database not available");

  const id = crypto.randomUUID();
  await db.query(`INSERT INTO ${usersTable()} (id, email, password_hash) VALUES (?, ?, ?)`, [
    id,
    data.email.toLowerCase(),
    data.passwordHash,
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

export async function updateUserPassword(id: string, passwordHash: string): Promise<void> {
  await ensureUsersSchema();
  const db = getMysqlClient();
  if (!db) throw new Error("Database not available");

  await db.query(`UPDATE ${usersTable()} SET password_hash = ? WHERE id = ?`, [
    passwordHash,
    id,
  ]);
}
