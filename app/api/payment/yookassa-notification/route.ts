import { activateYookassaPayment, getYookassaPayment } from "@/lib/yookassa";
import { trackRequest } from "@/lib/metrics";

// Вебхук ЮKassa о статусе платежа.
// Вебхуку не доверяем: статус перепроверяем через API (getYookassaPayment),
// активация идемпотентна. Отвечаем 200 быстро, даже если событие не наше.
async function handlePost(request: Request) {
  let body: { event?: string; object?: { id?: string } };
  try {
    body = await request.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  if (body.event !== "payment.succeeded" || !body.object?.id) {
    return new Response("OK", { status: 200 });
  }

  try {
    const yk = await getYookassaPayment(body.object.id);
    await activateYookassaPayment(yk);
  } catch {
    // ЮKassa временно недоступна — она пришлёт уведомление повторно
    return new Response("ERROR", { status: 502 });
  }

  return new Response("OK", { status: 200 });
}

export async function POST(request: Request) {
  return trackRequest("yookassa-notification", request, () => handlePost(request));
}
