import { after } from "next/server";
import { getRate } from "@/lib/rates";
import { getPayment, markPaid } from "@/lib/payments-store";
import { upsertRecurrent } from "@/lib/recurrent-store";
import { sendPaymentSuccessEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";

// Клиент ЮKassa API v3 на голом fetch (Basic shopId:secret, Idempotence-Key на создание).
// Первый платёж — redirect с save_payment_method; продления — payment_method_id без подтверждения.

const API_URL = "https://api.yookassa.ru/v3";

function creds(): { shopId: string; secretKey: string } {
  const shopId = process.env.YOOKASSA_SHOP_ID ?? "";
  const secretKey = process.env.YOOKASSA_SECRET_KEY ?? "";
  if (!shopId || !secretKey) {
    throw new Error("Платёжный сервис временно недоступен.");
  }
  return { shopId, secretKey };
}

async function ykRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  idempotenceKey?: string,
): Promise<T> {
  const { shopId, secretKey } = creds();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(idempotenceKey ? { "Idempotence-Key": idempotenceKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const description = typeof data.description === "string" ? data.description : `HTTP ${res.status}`;
    throw new Error(`ЮKassa: ${description}`);
  }
  return data as T;
}

export interface YookassaPayment {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  paid: boolean;
  confirmation?: { type: string; confirmation_url?: string };
  payment_method?: {
    id: string;
    type?: string;
    saved?: boolean;
    card?: { last4?: string; card_type?: string };
  };
  metadata?: Record<string, string>;
}

/** Чек 54-ФЗ (УСН доход, без НДС) — как в T-Bank интеграции. */
function buildReceipt(email: string, title: string, amountRub: number): Record<string, unknown> {
  const value = amountRub.toFixed(2);
  return {
    customer: { email },
    tax_system_code: 1, // УСН доход
    items: [
      {
        description: title,
        quantity: "1",
        amount: { value, currency: "RUB" },
        vat_code: 1, // НДС не облагается
        payment_subject: "service",
        payment_method: "full_payment",
      },
    ],
  };
}

/** Первый платёж пользователя: редирект на страницу ЮKassa.
 *  saveMethod=true — карта сохраняется для автопродления (требует включённого
 *  рекуррента в магазине); false — обычный разовый платёж. */
export async function createRedirectPayment(
  input: {
    paymentId: number;
    amountRub: number;
    title: string;
    email: string;
  },
  opts?: { saveMethod?: boolean; idempotenceKey?: string },
): Promise<YookassaPayment> {
  const saveMethod = opts?.saveMethod ?? true;
  return ykRequest<YookassaPayment>(
    "POST",
    "/payments",
    {
      amount: { value: input.amountRub.toFixed(2), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: `${SITE_URL}/?success` },
      ...(saveMethod ? { save_payment_method: true } : {}),
      description: input.title,
      metadata: { payment_id: String(input.paymentId) },
      receipt: buildReceipt(input.email, input.title, input.amountRub),
    },
    opts?.idempotenceKey ?? `create-${input.paymentId}`,
  );
}

/** Автопродление: списание по сохранённому методу без участия пользователя. */
export async function createRecurrentCharge(input: {
  paymentId: number;
  amountRub: number;
  title: string;
  email: string;
  paymentMethodId: string;
  idempotenceKey: string;
}): Promise<YookassaPayment> {
  return ykRequest<YookassaPayment>(
    "POST",
    "/payments",
    {
      amount: { value: input.amountRub.toFixed(2), currency: "RUB" },
      capture: true,
      payment_method_id: input.paymentMethodId,
      description: input.title,
      metadata: { payment_id: String(input.paymentId), renewal: "true" },
      receipt: buildReceipt(input.email, input.title, input.amountRub),
    },
    input.idempotenceKey,
  );
}

/** Перепроверка статуса напрямую у ЮKassa (вебхуку не доверяем). */
export async function getYookassaPayment(id: string): Promise<YookassaPayment> {
  return ykRequest<YookassaPayment>("GET", `/payments/${encodeURIComponent(id)}`);
}

/**
 * Активация оплаченного платежа ЮKassa: продлевает подписку в общей таблице платежей
 * (от текущей даты окончания, если она в будущем) и сохраняет метод для автопродления.
 * Идемпотентно (markPaid сработает только на pending). true — активировано.
 */
export async function activateYookassaPayment(yk: YookassaPayment): Promise<number | null> {
  if (yk.status !== "succeeded" || !yk.paid) return null;

  const paymentId = Number(yk.metadata?.payment_id);
  if (!Number.isFinite(paymentId)) return null;

  const payment = await getPayment(paymentId);
  if (!payment) return null;

  const rate = getRate(payment.rate_index);
  if (!rate) return null;

  const base = Math.max(Date.now(), payment.subscription_until ?? 0);
  const until = base + rate.days * 24 * 60 * 60 * 1000;
  const activated = await markPaid(payment.id, until);

  if (activated) {
    // Письмо об оплате — только при реальной активации (повторы вебхука не дублируют),
    // после ответа, ошибки SMTP глушим
    after(async () => {
      try {
        await sendPaymentSuccessEmail({ to: payment.email, title: rate.title, until });
      } catch (error) {
        console.error("Failed to send payment success email:", error);
      }
    });
  }

  if (yk.payment_method?.saved && yk.payment_method.id) {
    await upsertRecurrent({
      email: payment.email,
      rateIndex: payment.rate_index,
      paymentMethodId: yk.payment_method.id,
      cardType: yk.payment_method.card?.card_type ?? null,
      cardLast4: yk.payment_method.card?.last4 ?? null,
      nextBillingAt: until,
    });
  }

  return payment.id;
}

/**
 * Отвязка сохранённого способа оплаты в ЮKassa (best-effort):
 * 404 — метода уже нет, считаем отвязанным; остальные ошибки пробрасываем.
 */
export async function deletePaymentMethod(paymentMethodId: string): Promise<void> {
  const { shopId, secretKey } = creds();
  const res = await fetch(
    `${API_URL}/payment_methods/${encodeURIComponent(paymentMethodId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`ЮKassa: не удалось отвязать карту (HTTP ${res.status}).`);
  }
}
