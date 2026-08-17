<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Save-Tube — скачивание видео с RuTube

Next.js 16 + React 19, App Router, Tailwind v4, lucide-react, алиас `@/`. Только ru-язык.

## Скачивание (не ломать)

Только публичный API и CDN RuTube, сторонних сервисов нет.

- `lib/rutube.ts`: ссылки `/video/{id}/`, `/shorts/{id}/` (id = 32 hex); метаданные `rutube.ru/api/video/{id}/` (там НЕТ `video_balancer`); master `rutube.ru/api/play/options/{id}/?no_404=true&referer&pver=v2&client=wdp&mq=all&av1=1` → `video_balancer.default`. **`mq=all&av1=1` обязательны** — без них master урезан до 1080p. Master дублирует качества на 2 CDN (rtbcdn.ru + rutube.ru): дедуп по RESOLUTION, 2-й URL = fallback. Media m3u8 — относительные пути `*.ts`.
- `app/api/get-video-info` — задачная модель: POST → задача (`lib/tasks.ts`, in-memory, TTL 10 мин, дедуп по videoId) → СРАЗУ 202 `pending` + task_id — **без inline-ожидания (решение владельца)**; результат — poll `GET ?task_id` (1.5с, до 90с). Кеш-хит (55 мин) — `completed`+`data` сразу в POST. Ретраи 5× backoff (`lib/video-info-task.ts`), очередь `lib/task-queue.ts` (FIFO, `VIDEO_INFO_CONCURRENCY`=4, > `VIDEO_INFO_MAX_QUEUE`=100 → 429). HTTP-ошибки retriable (DC-бан = 404-заглушка), «контент недоступен» — нет.
- `app/api/get-segments` — та же задачная модель: POST → 202 `pending` + task_id, poll → `completed` + `{segments, token}` / `failed`. Дедуп по md5(url), ретраи 5× (`lib/segments-task.ts`; неретраибельно: HTTP 404, невалидный URL, пустой плейлист). **Кеш-хит (30 мин) — старый синхронный ответ `{segments, token}` в POST (обратная совместимость).** Токен выдаётся в момент ответа — его TTL тикает со скачивания.
- **Serverless (`process.env.VERCEL`):** фон после ответа не живёт → POST сразу 202, выполнение драйвит poll-GET (50с, `maxDuration: 60`; videoId в `task.payload`, single-flight `task.processing`). 404 (чужой инстанс) → клиент пересоздаёт задачу до 2 раз.
- `app/api/proxy?url=` — обязателен (CDN без CORS). Whitelist `*.rutube.ru`, `*.rtbcdn.ru` — не расширять.
- Клиент (`components/download-form.tsx`): пул одно-сегментных воркеров (дефолт 2, пополнение до `threadsRef` после каждого сегмента — потоки +/- меняются на лету; воркер «качай до конца очереди» НЕ возвращать: `Promise.race` не просыпался), `slotStates` подгоняется в `changeThreads`, 4 ретрая с backoff на сегмент, Blob → `{title}-{quality}.mp4` (реально MPEG-TS; муксинг отложен).

## SEO (не откатывать)

- Sitemap — только `app/sitemap.ts` (MetadataRoute, `revalidate = 3600`); без файлов в public/ и кронов.
- robots.txt — статичный `public/robots.txt` (НЕ `app/robots.ts`): `User-agent: *`, закрыты `/api/` и `/*?`. При смене домена — обновить Sitemap/Host вручную + задать `NEXT_PUBLIC_SITE_URL`.
- `metadataBase` + title template в `app/layout.tsx`, `alternates.canonical` на страницах, верификация google/yandex из env, иконка — `public/favicon.svg`.
- Метрика — `components/metrika.tsx` (lazyOnload) по `NEXT_PUBLIC_YM_ID`, цели через `lib/metrika.ts`. JSON-LD не используется.

## Темы (зафиксировано)

- Cookie `theme` = `light`/`dark`/`system` (365 дней). `lib/theme.tsx` — ThemeProvider + `useTheme()`, при `system` слушает prefers-color-scheme.
- `app/layout.tsx` — серверное чтение cookie (поэтому layout async, страницы dynamic), класс на `<html>` + `suppressHydrationWarning` + инлайн-скрипт до рендера (анти-FOUC, не удалять). ThemeProvider оборачивает body.
- Tailwind v4 class-стратегия: `@custom-variant dark` в globals.css. **Палитра playerok (не откатывать):** в `@theme` переопределены `sky-*` (#1453FF акцент, #5286FF в dark) и `zinc-950/900/50` (#14161A фон, #282933 карточки, #F2F4F7 блоки светлой).
- Переключатель `components/theme-toggle.tsx` (pill, `role="switch"`): ползунок — SSR-проп `initialTheme` из layout. Шапка получает `initialLoggedIn` из layout (`getSession()`) — «Войти»/«Кабинет» не мигает.
- cursor-pointer на интерактивных — глобально в globals.css. Новым компонентам — обязательно `dark:`-варианты. Светлую тему не менять.

## Env

Полный список — `.env.example`. При отсутствии: `NEXT_PUBLIC_SITE_URL` — обязателен в проде (metadataBase/sitemap/canonical); `MYSQL_*` — платежи/метрики отключены; `PROXY_TOKEN_SECRET` — прокси 500 в проде; `NEXT_PUBLIC_RSY_ID` — нет РСЯ-баннера; `REDIS_URL` — auth-роуты 503 (оплата работает); `SMTP_*` — письма тихо пропускаются.

## Serverless (Vercel)

- **API rutube.ru банит DC-IP** (Vercel/AWS → 404/403-заглушка), CDN `*.rtbcdn.ru` — нет. Текстовые API-запросы — через прокси: `rutubeApiFetch()` в `lib/rutube.ts` + `RUTUBE_API_PROXY=http://user:pass@host:port` (undici ProxyAgent, дешёвый RU-прокси). Плейлисты и сегменты — всегда напрямую.
- **API T-Bank тоже режет зарубежные DC-IP** (проверено боем): `tbankRequest()` в `lib/tbank.ts` через `TBANK_API_PROXY` (формат как у RUTUBE_API_PROXY). Пусто — напрямую (VPS с RU-IP). API ЮKassa с Vercel доступен напрямую.
- In-memory лимиты/кеши — per-instance. Прод-MySQL на localhost VPS → на Vercel недоступна (платежи — «сервис недоступен»). Vercel = витрина со скачиванием, прод = VPS.

## Платежи T-Bank (не ломать)

- Тарифы `lib/rates.ts`: 7д/39₽, 30д/99₽, 365д/299₽ — менять только осознанно.
- `lib/tbank.ts`: подпись = скалярные поля + `Password`, сортировка ключей case-insensitive, конкатенация, sha256. `Init` с чеком 54-ФЗ (УСН доход, `DATA.PaymentMethod=QR:true`), `GetState` — перепроверка. На dev TLS-проверка банка отключена (антивирус MITM), в проде строгая.
- Вебхук `app/api/payment/notification`: подпись → `CONFIRMED` → перепроверка `GetState` → идемпотентный `markPaid`. Ответ строго `"OK"`/`"ERROR"` (ERROR = банк пришлёт повтор).
- Хранилище `lib/payments-store.ts` (MySQL, `lib/mysql.ts` globalThis-синглтон): таблица `{MYSQL_TABLE_PREFIX}payments` (дефолт `wp_`), колонки от старого бэкенда — старые подписки распознаются без миграции. `payment_amount` в РУБЛЯХ (в банк — копейки), `OrderId` = `payment_id`. Таблица самосоздаётся. **Синглтон само-переподключается** (патч `client.query`): на «closed state»/«Connection lost»/ECONNRESET сбрасывается, запрос повторяется раз со свежим клиентом; не откатывать, иначе MySQL-роуты умирают до рестарта.
- Фронт `components/premium-modal.tsx`: тарифы → `GET /api/payment` → редирект на `PaymentURL`, поллинг `/api/payment/status` 5с×25. **Привязка подписки — по email сессии, если залогинен** (инпут = `receipt_email` для чека 54-ФЗ, пусто → email сессии); незалогиненные — параметр `email` = и привязка, и чек (авто-регистрация). Cookie `user_email` (365д) ставит status-эндпоинт, download-form автопроверяет по ней. **Перемонтирование модалки по `key` и открытие по `?success`/`?error` через setTimeout — осознанные обходы линта, не «чинить».**
- Потоки `+/-` видны ТОЛЬКО при активной подписке, 4K — тоже (гейт в download-form); бесплатным — «⚡ Ускорить» (модалка). Шапка: только «Войти»/«Кабинет» → `/account` («⚡ Премиум» убран владельцем).

## ЮKassa + автопродление (зафиксировано)

- Переключатель провайдера в `/admin` («Оплата»): `tbank` (разовые) ↔ `yookassa` (рекуррент), в `{prefix}app_settings` (`lib/settings-store.ts`), влияет только на новые платежи. Подписки обоих — в `{prefix}payments` (`payment_provider`: NULL = легаси T-Bank).
- `lib/yookassa.ts` — API v3 на fetch (Basic, `Idempotence-Key`). **Два магазина:** боевой `YOOKASSA_SHOP_ID`/`YOOKASSA_SECRET_KEY` и тестовый `YOOKASSA_TEST_*` — тестовый берётся на dev, на Vercel (VERCEL=1) и на проде для плательщиков из `ADMIN_EMAILS` (выбор по email аккаунта/параметра, не чека). Перепроверка `getYookassaPayment(id, email?)`: email известен → магазин по нему; нет (вебхук) → боевой, при 404 — тестовый. Первый платёж: redirect + `save_payment_method: true` + чек 54-ФЗ (vat_code 1). Контракт `/api/payment` общий: `{url, payment_id}`.
- Вебхук `app/api/payment/yookassa-notification`: не доверяем — перепроверка `getYookassaPayment`, идемпотентный `markPaid`, продление от `max(now, текущий конец)`. Ответ всегда 200, кроме недоступности API (502 = повтор). **Самолечение:** `GET /api/payment/status?payment_id=` при pending-платеже ЮKassa сам перепроверяет и активирует — спасает, когда вебхук не настроен. Продления в кроне при `succeeded` тоже активируются без вебхука.
- Рекуррент: `{prefix}recurrent_subscriptions` (`lib/recurrent-store.ts`, одна запись на email). Автосписания — `app/api/cron/billing` (cron раз в час, `Authorization: Bearer $CRON_SECRET`): только при провайдере yookassa, неудача → ретрай через сутки. **Требует включённых повторных платежей в магазине ЮKassa (через менеджера).**
- `GET /api/payment/provider` — публичный эндпоинт активного провайдера: фраза об автопродлении («Можно отключить в любой момент в личном кабинете») показывается **всем** при `yookassa` (решение владельца), при tbank скрыта; стоит между тарифами и email-инпутом. Юр-строка под инпутом — по сессии: без неё «Регистрируясь…» (оплата = регистрация), с сессией «Оплачивая…».
- Админка «Оплата» (`app/admin/payments-panel.tsx` + `app/api/admin/payments`): таблицы **постранично по 10** (курсор по id, `?payments_before=`/`?recurrent_before=`). Счётчик автопродлений — `countActiveRecurrent()` (COUNT-запрос). Колонка «Способ» — `{prefix}payments.payment_method` (ЮKassa: «Visa •• 1234»/«SberPay»/«ЮMoney»; T-Bank NULL) и `recurrent_subscriptions.card_type/card_last4`. «Способы оплаты» — разбивка по всем оплаченным (`getPaymentMethodStats`: карты → «Банковская карта»; NULL → T-Bank/«ЮKassa — без данных»). Бэкфилл — «Подтянуть способы из ЮKassa» (POST `{action:"backfill-methods"}`, по `merchant_id`, ≤200 за раз, идемпотентно).

## Авторизация и ЛК (OTP по email, зафиксировано)

- **Паролей НЕТ.** `password_hash` в `{prefix}app_users` — легаси, игнорируется.
- Юзер создаётся при первой оплате в `/api/payment`: сессия сразу на 1 год + welcome-письмо через `after()` (SMTP-ошибки не ломают оплату). Email уже есть — НЕ логиним (вход только по коду).
- OTP-флоу (оба роута под `trackRequest`, rate-limit 5/мин по IP):
  - `POST /api/auth/request-code` — 6-значный код в Redis `otp:{email}` EX 300, письмо через `after()`, ответ всегда `{ok:true}` (анти-перебор). Антиспам `otp-sent:{email}` NX EX 60 → 429 `{alreadySent:true}` → фронт переключается на шаг ввода кода (код уже в почте).
  - `POST /api/auth/verify-code` — код верен: вход или создание юзера, `setSession` на год, код одноразовый. Неверен/просрочен → 400 `{expired:true}` → «код просрочен» + «Выслать повторно».
  - `logout` — уничтожает сессию + сносит cookie `user_email` (прем-маркер устройства): после выхода управление потоками выключается; вернуть без логина — «Я уже купил подписку». `me` — 401 без сессии. Роутов `login`/`forgot-password` нет.
- Redis — `lib/redis.ts` (ioredis, globalThis-синглтон, lazy), `REDIS_URL` (локально docker `savetube-redis`).
- Сессия — iron-session (`lib/auth/session.ts`), cookie `savetube_session` на 1 год, секрет `SESSION_SECRET`. Юзеры — `{prefix}app_users` (НЕ `users`, база WP-совместимая): id UUID, email UNIQUE lower-case.
- ЛК `/account` только по сессии: нет → OTP-форма; есть → подписка, автопродление, «Отвязать карту», история, «Выйти». `/api/account*` без сессии — 401. Cookie `user_email` — для download-form, НЕ путать с сессией.
- Отвязка карты: `deleteRecurrent` всегда, DELETE в ЮKassa — best-effort (405 игнорируем). Подписка действует до оплаченной даты.
- Письма (`lib/email.ts`, nodemailer): welcome, OTP (5 мин), payment-success — только при реальной активации `markPaid` (дублей нет), через `after()`, ошибки глушим. На dev TLS-проверка SMTP отключена. Поддержка — `s@save-tube.ru` (`SUPPORT_EMAIL` в `lib/site.ts`).

## Защита (зафиксировано)

- worker_threads не тянем (воркер старого бэка жрал 300-400 МБ).
- `lib/rate-limit.ts`: get-video-info 10/мин, get-segments 20/мин, прокси 16 одновременных стримов/IP (слот — `releaseOnce` идемпотентно, в `finally` и `cancel`; `cancel()` через `reader.cancel()`, не `body.cancel()` — на залоченном стриме `ERR_INVALID_STATE`).
- Прокси закрыт HMAC-токеном (`lib/proxy-token.ts`, TTL 3ч): выдаёт `get-segments`, клиент шлёт `&t=`, без токена — 403.

## Прокси-ноды (масштабирование)

- `proxy-node/server.js` — голый Node.js, ноль зависимостей: whitelist, 16 стримов/IP, CORS (`PROXY_NODE_ORIGIN`), `/health`, **троттлинг `PROXY_SPEED_MBPS`** (МБ/с на стрим, дефолт 2; "0" — без лимита; token-bucket с АБСОЛЮТНЫМ расписанием `nextSlot += chunkTime` — иначе лаги таймера Windows накапливаются, -17% скорости; кредит 200мс, ресинк после отставания >500мс). **Слот — `releaseOnce` при ЛЮБОМ исходе, включая не-200 от CDN** — иначе утечка: 16× 404/502 → нода навсегда даёт 429 этому IP. **Токена НЕТ (решение владельца): ноды открыты всем.** Логика зеркалит `app/api/proxy/route.ts` кроме авторизации — менять синхронно.
- **Инцидент 2026-08-12 (транзитный):** rutube молча дропает IP — API/CDN-хосты висят без ответа минутами, у разных IP по-разному; симптомы — failed «fetch failed», get-segments 502; retries×5 забивают очередь на время бана. Само проходит. При рецидивах — `RUTUBE_API_PROXY` на VPS и/или ноды в других сетях (текущие 3 — одна подсеть 157.22.192.x).
- Клиент выбирает ноду в `lib/proxy-nodes.ts` из `NEXT_PUBLIC_PROXY_URLS` (через запятую, путь `/api/v1/proxy`): round-robin, на ретрае — следующая. **Встроенный `/api/proxy` — fallback, только когда ВСЕ ноды отказали** (`MAX_RETRIES` = 4). Пустой список — только встроенный.
- Задеплоены: proxy1=.83, proxy2=.82, proxy3=.81 (157.22.192.x, pm2 `proxy-node`, порт 3000, код `/root/nodejs/proxy_server`). proxy4/5.save-tube.ru — мёртвые, не использовать. CORS отдаёт ТОЛЬКО нода (в nginx `add_header Access-Control-*` убраны). `/health` снаружи закрыт nginx'ом.
- Поднятие ноды: `proxy-node/` на VPS → `PORT=3100 PROXY_NODE_ORIGIN='*' pm2 start server.js --name proxy-node` → поддомен с TLS → URL в `NEXT_PUBLIC_PROXY_URLS` + пересборка. Принимает пути `/`, `/api/proxy`, `/api/v1/proxy`.
- Секреты не коммитить: `.env*`, `data/`. Старый PHP-бэкенд — вне репо, в загрузках (Telegram-архивы 2, 3).

## РСЯ

`components/rsy-banner.tsx`: блоки `R-A-{NEXT_PUBLIC_RSY_ID}-{4..8}`, ротация 30с, крестик после 5с, скрыт при ширине <830px, партнёр 14782353. Контейнер — `w-full` без overflow/max-width, крестик `-top-8 right-0`. **Скрытие — только `invisible` (visibility), не `hidden` (display:none)** — Яндекс не рендерит в скрытый контейнер (`CONTAINER_IS_HIDDEN`). **Крестик — destroy блока + очистка контейнера**: креативы RTB ставят себе `visibility:visible` и игнорируют invisible-родителя. Ротация после закрытия продолжается; на скрытой вкладке — пауза (visibilitychange). **Премиум без рекламы:** layout считает `hideAds` (email из сессии/cookie `user_email` → `hasActiveSubscription`, серверно; без MySQL — показывается), футер баннер не рендерит.

## Админка метрик (/admin)

- Доступ: email из `ADMIN_EMAILS` + ключ `ADMIN_KEY`; cookie `admin_session` = HMAC на ADMIN_KEY, 7 дней. **Без ADMIN_KEY закрыта полностью.** Логин rate-limit 5/мин. `lib/admin-auth.ts`, проверка — `getAdminEmail()`.
- Сбор: `trackRequest(route, request, handler)` из `lib/metrics.ts` — на ВСЕХ API-роутах (новые тоже оборачивать): route/ip/status/ms, fire-and-forget.
- Хранилище `lib/metrics-store.ts`: MySQL `{prefix}request_metrics`, автоочистка > 3 дней. Без MySQL — no-op, нули.
- `GET /api/admin/metrics?window=15m|1h|6h|24h|3d`: summary, таймсерия, топ/подозрительные IP (много 429/403), статистика роутов, live (стримы `getConcurrencySnapshot()` + очередь `getTaskQueueSnapshot()` + аптайм).
- Дашборд `app/admin/metrics-dashboard.tsx`: автообновление 30с, свой SVG (recharts не тянем). Страница `force-dynamic` + `noindex`, в robots.txt `Disallow: /admin`.

## CI/CD (GitHub Actions → VPS 157.22.192.87, юзер save-tube)

- Деплой по push в main: `.github/workflows/deploy.yml`. **Сборка в GitHub-раннере** (на VPS 3.7 ГБ RAM `next build` → OOM): `.env` из секрета `ENV_FILE` ДО build (NEXT_PUBLIC_* вшиваются) → `npm install` (НЕ `npm ci`: локфайл с Windows неполон — падает на wasm32 `@emnapi/*`) → `npm run build` → `npm prune --omit=dev` → tar → scp → распаковка в `/var/www/save-tube/data/savetube` + линковка public + `pm2 startOrReload ecosystem.config.js` (процесс `savetube`, порт 3000).
- **Node 22 — юзерспейсная**: `/var/www/save-tube/data/opt/node22` (симлинк → `node-v22.23.2-linux-x64`). Системная Node 20 НЕ подходит (undici@8 требует >= 22.19, иначе билд падает на `markAsUncloneable`). В workflow — `export PATH=.../opt/node22/bin:$PATH`, в ecosystem — `interpreter`. Root/sudo нет.
- Статика: `public/` симлинкуется в веб-рут `/var/www/save-tube/data/www/save-tube.ru` — отдаёт nginx; остальное — proxy на `127.0.0.1:3000`.
- `script_stop` в appleboy/ssh-action@v1 удалён — в скрипте стоит `set -e` явно. Секреты: `SSH_PRIVATE_KEY` (ed25519, пара в `~/.ssh/savetube_deploy_ed25519`), `ENV_FILE` (продовый .env; REDIS_URL локальный).

## Отложено

- MP3-конвертация, мультиязычность (MP3 упоминается только в текстах).
- Настоящий муксинг TS→MP4.
