import nodemailer from "nodemailer";
import { SITE_URL, SUPPORT_EMAIL } from "@/lib/site";

// SMTP-письма (nodemailer): welcome при авто-регистрации, одноразовый код
// для входа (OTP), payment-success после оплаты подписки.
// Без SMTP_* письма тихо пропускаются — оплата/логин от почты не зависят.

function getTransporter() {
  const host = process.env.SMTP_HOST;
  // Дефолт 465 (SSL), как в canvaskit — тот же почтовый хостинг владельца
  const port = Number(process.env.SMTP_PORT ?? "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    // На dev антивирус MITM'ит TLS — проверка отключена. На проде строгая, КРОМЕ
    // SMTP_INSECURE_TLS=true: продовый почтовик — локальный Exim с self-signed
    // сертификатом (mail.save-tube.ru — этот же сервер, MITM невозможен).
    tls: {
      rejectUnauthorized:
        process.env.SMTP_INSECURE_TLS === "true" ? false : process.env.NODE_ENV === "production",
    },
    // Таймауты обязательны: зависший SMTP не должен вешать HTTP-запрос
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getFrom(): string {
  return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@example.com";
}

/** Письмо после авто-регистрации при первой оплате (сессия уже стоит). */
export async function sendWelcomeEmail(data: { to: string }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("SMTP is not configured, welcome email not sent");
    return false;
  }

  await transporter.sendMail({
    from: getFrom(),
    to: data.to,
    subject: "Добро пожаловать! Ваш личный кабинет создан",
    html: `<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif;color:#333;text-align:center">
      <p style="font-size:24px;margin:24px 0">Привет 👋</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px">Спасибо за оплату подписки Save-Tube! Мы создали для вас личный кабинет — вы уже вошли в него на этом устройстве.</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 24px">В личном кабинете можно посмотреть статус подписки, историю платежей и управлять автопродлением. Вход на других устройствах — по одноразовому коду из письма.</p>
      <a href="${SITE_URL}/account" style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;padding:14px 32px;border-radius:9999px;font-weight:600">Открыть личный кабинет</a>
      <p style="font-size:14px;color:#666;margin-top:24px">Вопросы? Напишите нам: ${escapeHtml(SUPPORT_EMAIL)}</p>
    </div>`,
  });

  return true;
}

/** Письмо с одноразовым кодом для входа в личный кабинет. */
export async function sendOtpEmail(data: { to: string; code: string }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("SMTP is not configured, OTP email not sent");
    return false;
  }

  await transporter.sendMail({
    from: getFrom(),
    to: data.to,
    subject: `Код для входа: ${data.code}`,
    html: `<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif;color:#333;text-align:center">
      <p style="font-size:24px;margin:24px 0">Код для входа</p>
      <p style="font-size:40px;font-weight:700;letter-spacing:8px;margin:0 0 16px">${escapeHtml(data.code)}</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 24px">Введите этот код на странице входа Save-Tube. Код действует 5 минут.</p>
      <p style="font-size:14px;color:#666;margin-top:24px">Если вы не запрашивали код, просто проигнорируйте это письмо.</p>
    </div>`,
  });

  return true;
}

/** Письмо после успешной оплаты подписки. */
export async function sendPaymentSuccessEmail(data: {
  to: string;
  title: string;
  until: number; // unix ms, дата окончания подписки
}) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("SMTP is not configured, payment success email not sent");
    return false;
  }

  const untilFormatted = new Date(data.until).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await transporter.sendMail({
    from: getFrom(),
    to: data.to,
    subject: "Подписка оплачена",
    html: `<div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif;color:#333;text-align:center">
      <p style="font-size:24px;margin:24px 0">Оплата прошла успешно 🎉</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 8px"><strong>Тариф:</strong> ${escapeHtml(data.title)}</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 24px"><strong>Подписка активна до:</strong> ${escapeHtml(untilFormatted)}</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 24px">Статус подписки и историю платежей всегда можно посмотреть в личном кабинете.</p>
      <a href="${SITE_URL}/account" style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;padding:14px 32px;border-radius:9999px;font-weight:600">Личный кабинет</a>
      <p style="font-size:14px;color:#666;margin-top:24px">Вопросы? Напишите нам: ${escapeHtml(SUPPORT_EMAIL)}</p>
    </div>`,
  });

  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
