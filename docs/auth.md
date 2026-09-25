# Авторизация и ЛК (OTP по email, зафиксировано)

- **Паролей НЕТ.** `password_hash` в `{prefix}app_users` — легаси, игнорируется.
- Юзер создаётся при первой оплате в `/api/payment`: сессия сразу на 1 год + welcome-письмо через `after()` (SMTP-ошибки не ломают оплату). Email уже есть — НЕ логиним (вход только по коду).
- OTP-флоу (оба роута под `trackRequest`, rate-limit 5/мин по IP):
  - `POST /api/auth/request-code` — 6-значный код в Redis `otp:{email}` EX 300, письмо через `after()`, ответ всегда `{ok:true}` (анти-перебор). Антиспам `otp-sent:{email}` NX EX 60 → 429 `{alreadySent:true}` → фронт переключается на шаг ввода кода (код уже в почте).
  - `POST /api/auth/verify-code` — код верен: вход или создание юзера, `setSession` на год, код одноразовый. Неверен/просрочен → 400 `{expired:true}` → «код просрочен» + «Выслать повторно».
  - `logout` — уничтожает сессию + сносит cookie `user_email` (прем-маркер устройства): после выхода управление потоками выключается; вернуть без логина — «Я уже купил подписку». `me` — 401 без сессии. Роутов `login`/`forgot-password` нет.
- Redis — `lib/redis.ts` (ioredis, globalThis-синглтон, lazy), `REDIS_URL` (локально docker `savetube-redis`).
- Сессия — iron-session (`lib/auth/session.ts`), cookie `savetube_session` на 1 год, секрет `SESSION_SECRET`. Юзеры — `{prefix}app_users` (НЕ `users`, база WP-совместимая): id UUID, email UNIQUE lower-case.
- ЛК `/account` только по сессии: нет → OTP-форма; есть → подписка, автопродление, «Отвязать карту», история, «Выйти». `/api/account*` без сессии — 401. Cookie `user_email` — для download-form, НЕ путать с сессией.
- Отвязка карты: `deleteRecurrent` всегда (tombstone `active=0` + `unlinked_at` — отвязка абсолютна: автосписания возобновляет только новая явная оплата), DELETE в ЮKassa — best-effort (405 игнорируем). Подписка действует до оплаченной даты.
- Письма (`lib/email.ts`, nodemailer): welcome, OTP (5 мин), payment-success — только при реальной активации `markPaid` (дублей нет), через `after()`, ошибки глушим. На dev TLS-проверка SMTP отключена. Поддержка — `s@save-tube.ru` (`SUPPORT_EMAIL` в `lib/site.ts`).
