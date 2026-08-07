import { createHash } from "crypto";
import { Agent, fetch as undiciFetch } from "undici";
import { SITE_URL } from "@/lib/site";

// Интеграция T-Bank (Tinkoff API v2): создание платежа (Init) и проверка статуса (GetState).
// Алгоритм подписи: только скалярные поля верхнего уровня + Password,
// сортировка ключей регистронезависимо, конкатенация значений, sha256 hex.
//
// На dev-машине TLS до securepay.tinkoff.ru может перехватываться антивирусом
// (self-signed cert в цепочке → fetch падает). Для локальной разработки проверка
// сертификата отключена (как CURLOPT_SSL_VERIFYPEER=false в старом бэке); в проде — строгая.

const API_URL = "https://securepay.tinkoff.ru/v2";

const devInsecureAgent =
  process.env.NODE_ENV !== "production"
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

const TERMINAL_KEY = () => process.env.TBANK_TERMINAL_KEY ?? "";
const PASSWORD = () => process.env.TBANK_PASSWORD ?? "";

function stringifyValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Подпись запроса/уведомления T-Bank. Поле Token в подпись не входит. */
export function tbankToken(data: Record<string, unknown>): string {
  const scalarEntries = Object.entries(data).filter(
    ([key, value]) => key !== "Token" && value !== null && typeof value !== "object",
  );
  scalarEntries.push(["Password", PASSWORD()]);
  scalarEntries.sort(([a], [b]) => {
    const ka = a.toUpperCase();
    const kb = b.toUpperCase();
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const concat = scalarEntries.map(([, value]) => stringifyValue(value)).join("");
  return createHash("sha256").update(concat).digest("hex");
}

async function tbankRequest<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, Token: tbankToken(payload) }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  } as const;
  const res = devInsecureAgent
    ? await undiciFetch(`${API_URL}/${method}`, { ...init, dispatcher: devInsecureAgent })
    : await fetch(`${API_URL}/${method}`, init);
  if (!res.ok) throw new Error(`T-Bank недоступен (HTTP ${res.status}).`);
  return res.json() as Promise<T>;
}

export interface InitPaymentResult {
  Success: boolean;
  PaymentId?: string;
  PaymentURL?: string;
  ErrorCode?: string;
  Message?: string;
}

/** Создание платежа. amount — в копейках. Возвращает PaymentURL для редиректа пользователя. */
export async function initPayment(input: {
  orderId: string;
  amount: number;
  description: string;
  email: string;
}): Promise<InitPaymentResult> {
  return tbankRequest<InitPaymentResult>("Init", {
    TerminalKey: TERMINAL_KEY(),
    Amount: input.amount,
    OrderId: input.orderId,
    PayType: "O",
    Description: input.description,
    NotificationURL: `${SITE_URL}/api/payment/notification`,
    SuccessURL: `${SITE_URL}/?success`,
    FailURL: `${SITE_URL}/?error`,
    // Чек по 54-ФЗ
    Receipt: {
      Email: input.email,
      Taxation: "usn_income",
      Items: [
        {
          Name: "Оплата подписки",
          Price: input.amount,
          Quantity: 1,
          Amount: input.amount,
          Tax: "none",
          PaymentMethod: "full_payment",
          PaymentObject: "service",
        },
      ],
    },
    DATA: { QR: "true" },
  });
}

export interface PaymentState {
  Success: boolean;
  Status?: string;
  ErrorCode?: string;
  Message?: string;
}

/** Перепроверка статуса платежа напрямую у банка (не доверяем только вебхуку) */
export async function getPaymentState(paymentId: string): Promise<PaymentState> {
  return tbankRequest<PaymentState>("GetState", {
    TerminalKey: TERMINAL_KEY(),
    PaymentId: paymentId,
  });
}
