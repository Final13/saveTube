import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";

// Сессия ЛК: iron-session, подписанная cookie `savetube_session` на год.
// Паролей нет: вход по одноразовому коду из письма (OTP в Redis),
// аккаунт также создаётся автоматически при первой оплате.
export interface SessionData {
  userId?: string;
  email?: string;
  /** true — сессия создана авто-регистрацией при покупке (не явным входом по коду) */
  auto?: boolean;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function getSessionOptions() {
  const password = process.env.SESSION_SECRET;
  if (!password) {
    throw new Error("SESSION_SECRET is not set");
  }

  return {
    cookieName: "savetube_session",
    password,
    ttl: ONE_YEAR_SECONDS,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

export async function setSession(user: { id: string; email: string }, opts?: { auto?: boolean }) {
  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.auto = opts?.auto === true;
  await session.save();
}

export async function destroySession() {
  const session = await getSession();
  session.destroy();
}
