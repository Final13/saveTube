<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Save-Tube — сервис скачивания видео с RuTube

Next.js 16 + React 19, App Router, Tailwind v4, lucide-react, алиас `@/`. Только ru-язык.

## Как работает скачивание (не ломать без причины)

Вся логика — в нашем приложении, сторонние сервисы не используются, кроме публичного API и CDN RuTube:

1. `lib/rutube.ts` — парсинг ссылки (`/video/{id}/`, `/shorts/{id}/`, id = 32 hex), метаданные (`https://rutube.ru/api/video/{id}/`), master-плейлист (`https://rutube.ru/api/play/options/{id}/?no_404=true&referer&pver=v2&client=wdp&mq=all&av1=1` → `video_balancer.default`; в `/api/video/{id}/` поля `video_balancer` НЕТ). **Параметры `mq=all&av1=1` обязательны** — без них API отдаёт master урезанным (максимум 1080p, 1440p/2160p пропадают; так было в старом бэке). Master m3u8 дублирует каждое качество на 2 CDN (rtbcdn.ru + rutube.ru) — дедупликация по RESOLUTION, второй URL = fallback. Media m3u8 содержит ОТНОСИТЕЛЬНЫЕ пути `*.ts`.
2. `app/api/get-video-info` — задачная модель как в старом бэке: POST создаёт задачу (`lib/tasks.ts`, in-memory, TTL 10 мин) и отвечает сразу `{task_id, status}`; если RuTube ответил в inline-бюджет (20с, env `VIDEO_INFO_INLINE_MS`) — результат приходит прямо в POST (`status:completed` + `data`), иначе 202 `pending` и клиент пингует `GET ?task_id` (1.5с, до 90с). Обработка в фоне с ретраями 5× backoff (`lib/video-info-task.ts`) через **очередь с лимитом параллелизма** `lib/task-queue.ts` (env `VIDEO_INFO_CONCURRENCY`, дефолт 4; сверх лимита — FIFO; переполнение > `VIDEO_INFO_MAX_QUEUE`, дефолт 100 → 429 «сервер перегружен»). Повторный POST того же видео получает уже созданную задачу (дедуп по videoId, индекс в `lib/tasks.ts`). HTTP-ошибки retriable (DC-бан RuTube отдаёт 404-заглушку — пробуем другие прокси), «контент недоступен» — нет (`RutubeApiError.retriable`). `app/api/get-segments` — синхронный (быстрый CDN-запрос).
   **Serverless (Vercel, `process.env.VERCEL`):** фон после ответа не живёт, поэтому POST отвечает 202 сразу (без inline-ожидания), а выполнение драйвит poll-GET — первый poll синхронно выполняет задачу (бюджет 50с, `maxDuration: 60` в vercel.json; задача хранит videoId в `task.payload`, single-flight через `task.processing`). Poll на «чужом» инстансе → 404 → клиент пересоздаёт задачу до 2 раз (в `download-form.tsx`), бесшовно.
3. `app/api/proxy?url=` — ОБЯЗАТЕЛЕН: CDN RuTube не отдаёт `Access-Control-Allow-Origin`, браузер сегменты напрямую не скачает. Whitelist хостов: `*.rutube.ru`, `*.rtbcdn.ru` (не расширять без необходимости).
4. Клиент (`components/download-form.tsx`): пул воркеров (по умолчанию 2 потока, число читается из ref на лету), 3 ретрая с backoff на сегмент, склейка Blob → файл `{title}-{quality}.mp4` (контейнер реально MPEG-TS — проигрыватели его едят; настоящий муксинг в MP4 — отложенная задача).

## SEO-решения (зафиксированы, не откатывать)

- Sitemap — ТОЛЬКО `app/sitemap.ts` (MetadataRoute, `revalidate = 3600`). Никаких файлов в public/ и кронов.
- robots.txt — статичный `public/robots.txt` (НЕ `app/robots.ts` — конфликт со статикой). Одна секция `User-agent: *`, закрыты `/api/` и любые GET-параметры (`Disallow: /*?`). **При смене домена обновить Sitemap/Host в нём вручную** и задать `NEXT_PUBLIC_SITE_URL`.
- `metadataBase` + title template в `app/layout.tsx`; на страницах — `alternates.canonical` на чистый URL; верификация google/yandex из env; иконка — физический файл `public/favicon.svg`.
- Яндекс.Метрика — `components/metrika.tsx` (lazyOnload) по env `NEXT_PUBLIC_YM_ID`, цели через `lib/metrika.ts` (стаб-очередь `ym.a`).
- Структурированные данные (JSON-LD) не используются.

## Темы (светлая/тёмная, зафиксировано)

- Cookie `theme` = `light`/`dark`/`system` (365 дней, path=/, SameSite=Lax). `lib/theme.tsx` — ThemeProvider + `useTheme()` (`theme`, `resolvedTheme`, `setTheme`), при `system` слушает prefers-color-scheme.
- `app/layout.tsx` — серверное чтение cookie (поэтому layout async, страницы стали dynamic), класс `dark`/`light` на `<html>` + `suppressHydrationWarning`, инлайн-скрипт перед `<body>` ставит класс на documentElement ДО рендера (анти-FOUC, не удалять). ThemeProvider оборачивает всё в body.
- Tailwind v4 class-стратегия: `@custom-variant dark (&:where(.dark, .dark *))` в globals.css; базовые цвета body и `.prose-savetube` — тоже там. Тёмная палитра: фон zinc-950, карточки zinc-800/900, текст zinc-100/400, бордеры zinc-700/800, акценты sky/amber сохраняем (в dark — оттенок светлее).
- Переключатель — `components/theme-toggle.tsx` в шапке (pill-свитчер как на playerok: ползунок с солнцем/луной со звёздами, клик = light↔dark, `role="switch"`). Положение ползунка — через SSR-проп `initialTheme` из layout (как `initialLoggedIn` в шапке): при явной куке рендерится сразу верно, при system/без куки ползунок появляется после mount сразу в конечной позиции — дёрганья нет. Шапка (`components/header.tsx`) также получает `initialLoggedIn` из layout (`getSession()`) — «Войти»/«Кабинет» не мигает при перезагрузке.
- Курсор-рука на интерактивных элементах — глобальным CSS-правилом в globals.css (`button:not(:disabled)`, `[role="switch"]`, `select` → pointer; disabled → not-allowed). Tailwind v4 не ставит pointer на button по умолчанию.
- Новым компонентам и страницам — обязательно `dark:`-варианты классов. Светлую тему не менять.

## Env

См. `.env.example`: `NEXT_PUBLIC_SITE_URL` (обязателен в проде — metadataBase/sitemap/canonical), `YANDEX_VERIFICATION`, `GOOGLE_VERIFICATION`, `NEXT_PUBLIC_YM_ID`, `TBANK_TERMINAL_KEY`, `TBANK_PASSWORD`, `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_DATABASE`/`MYSQL_USER`/`MYSQL_PASSWORD` + `MYSQL_TABLE_PREFIX` (платежи и метрики; без них платежи/метрики отключены), `PROXY_TOKEN_SECRET` (обязателен в проде — без него прокси отдаёт 500), `NEXT_PUBLIC_RSY_ID` (без него РСЯ-баннер не рендерится), `RUTUBE_API_PROXY` (только для serverless — см. ниже), `SESSION_SECRET` (iron-session ЛК), `REDIS_URL` (OTP-коды входа в ЛК; без него auth-роуты отвечают 503, оплата не ломается), `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (письма ЛК; без них письма тихо пропускаются).

## Деплой на serverless (Vercel) — важно

**API rutube.ru банит дата-центровые IP** (Vercel/AWS → 404/403-заглушка), а CDN `*.rtbcdn.ru` — нет (проверено: сегменты и m3u8 с Vercel качаются). Поэтому на Vercel работает всё, кроме 2 текстовых API-запросов на видео — они идут через прокси с чистым IP:

- `lib/rutube.ts`: `rutubeApiFetch()` — если задан `RUTUBE_API_PROXY=http://user:pass@host:port`, API-запросы идут через undici `ProxyAgent`. Плейлисты и сегменты — всегда напрямую (иначе весь видео-трафик пошёл бы через платный прокси).
- Прокси нужен любой HTTP-с прокси с не-DC IP (подойдёт самый дешёвый RU-прокси: трафик ~5 КБ на конвертацию).
- Остальные serverless-ограничения в силе: in-memory лимиты и кеши — per-instance. Платежи/метрики на MySQL работают и на Vercel, если база доступна из интернета (на проде MySQL на localhost VPS → для Vercel недоступна, там платежи отвечают «сервис недоступен»). Vercel = витрина со скачиванием, прод = VPS.

## Платежи T-Bank (не ломать без причины)

- Тарифы в `lib/rates.ts`: 7д/39₽, 30д/99₽, 365д/299₽ — как на проде, менять только осознанно.
- `lib/tbank.ts` — подпись: скалярные поля + `Password`, сортировка ключей case-insensitive, конкатенация значений, sha256. `Init` с чеком 54-ФЗ (УСН доход, `DATA.PaymentMethod=QR:true`), `GetState` для перепроверки. На dev (`NODE_ENV !== production`) проверка TLS-сертификата банка отключена (antivirus MITM ломает fetch локально); в проде — строгая.
- Вебхук `app/api/payment/notification`: проверка подписи → `CONFIRMED` → перепроверка через `GetState` (защита от подделки) → идемпотентный `markPaid`. Ответ банку строго `"OK"`/`"ERROR"` (ERROR = банк пришлёт повтор).
- Хранилище `lib/payments-store.ts` — MySQL (serverless-mysql, `lib/mysql.ts`, globalThis-синглтон), таблица `{MYSQL_TABLE_PREFIX}payments` (дефолт `wp_`). Колонки унаследованы от старого бэкенда (`payment_id/payment_email/payment_rate_index/payment_amount/payment_title/payment_status/payment_merchant_id/payment_untiled_at`) — существующие оплаченные подписки в общей базе распознаются без миграции; `payment_amount` хранит РУБЛИ (как старые записи), в банк уходят копейки. `OrderId` = `payment_id`. Таблица создаётся сама, только если её нет.
- Фронт: `components/premium-modal.tsx` (тарифы → email → `GET /api/payment` → редирект на `PaymentURL`; поллинг `/api/payment/status` 5с×25; экраны оплаты/проверки «я уже купил»). Cookie `user_email` на 365д ставит status-эндпоинт, `download-form` автопроверяет подписку по ней. Модалка перемонтируется по `key` — так обходится линт-правило set-state-in-effect, не «чинить».
- Потоки загрузки (как в оригинале): `+/-` видны ТОЛЬКО при активной подписке; бесплатным — кнопка «⚡ Ускорить» (открывает модалку). Шапка (`components/header.tsx`, клиентская): «Войти» → ссылка на `/account`; при активной подписке — значок «⚡ Премиум» → `/account`.
- `?success`/`?error` (SuccessURL/FailURL банка) открывают модалку через setTimeout — тоже осознанный обход линта.

## ЮKassa — второй провайдер + автопродление (зафиксировано)

- **Переключатель провайдера** — в `/admin` («Оплата»): `tbank` (разовые) ↔ `yookassa` (рекуррент). Хранится в `{prefix}app_settings` (`lib/settings-store.ts`), влияет только на НОВЫЕ платежи. Активные подписки живут в `{prefix}payments` и работают независимо от провайдера — поэтому туда пишут оба (колонка `payment_provider`: NULL = легаси T-Bank).
- `lib/yookassa.ts` — клиент API v3 на голом fetch (Basic `YOOKASSA_SHOP_ID:YOOKASSA_SECRET_KEY`, `Idempotence-Key` на создание). Первый платёж — redirect + `save_payment_method: true` + чек 54-ФЗ (УСН, vat_code 1). Контракт `/api/payment` для фронта одинаковый: `{url, payment_id}`.
- Вебхук `app/api/payment/yookassa-notification` (URL для кабинета ЮKassa: `https://<домен>/api/payment/yookassa-notification`): вебхуку НЕ доверяем — статус перепроверяем через `getYookassaPayment`, активация идемпотентна (`markPaid`), продление от `max(now, текущая дата окончания)`. Ответ всегда 200, кроме временной недоступности API (502 = повтор).
- Рекуррент: `{prefix}recurrent_subscriptions` (`lib/recurrent-store.ts`, одна запись на email). Автосписания — `app/api/cron/billing` (системный cron раз в час: `curl -H "Authorization: Bearer $CRON_SECRET" <домен>/api/cron/billing`): списывает только пока провайдер = yookassa, при неудаче — ретрай через сутки.
- **Важно:** рекуррент работает только если в магазине ЮKassa включены повторные платежи (через менеджера ЮKassa). Без этого `save_payment_method: true` отклоняется.
- Админка `/admin` — раздел «Оплата» (`app/admin/payments-panel.tsx`): переключатель, список автопродлений, последние 50 платежей. API — `app/api/admin/payments` (GET/POST, только админ).

## Авторизация и ЛК (OTP по email, зафиксировано)

- **Паролей больше НЕТ нигде** (bcryptjs удалён, `lib/auth/password.ts` удалён). Колонка `password_hash` в `{prefix}app_users` осталась от старой модели, мигрирована в NULL через INFORMATION_SCHEMA (паттерн из payments-store) и игнорируется — старые хеши не используются.
- Юзер создаётся автоматически при первой оплате в `/api/payment` — БЕЗ пароля, сессия ставится сразу на 1 год, welcome-письмо (без пароля, «кабинет создан, вы уже вошли») через `after()` (SMTP-ошибки не ломают оплату). Если юзер с таким email уже есть — НЕ логиним (вход только по коду из письма).
- Вход и регистрация вне покупки — единый OTP-флоу (оба роута под `trackRequest`, rate-limit 5/мин по IP):
  - `POST /api/auth/request-code {email}` — 6-значный код в Redis `otp:{email}` (EX 300), письмо с кодом через `after()`. Ответ всегда `{ok:true}` (анти-перебор). Антиспам по email: `otp-sent:{email}` SET NX EX 60 — чаще раза в минуту → 429 «Код уже отправлен, проверьте почту.».
  - `POST /api/auth/verify-code {email, code}` — код верен: юзер есть? вход : создаём юзера; `setSession` на год; код удаляется (одноразовый). Неверен/просрочен → 400 `{message, expired:true}` — фронт показывает «код просрочен» и «Выслать код повторно».
  - `POST /api/auth/logout`, `GET /api/auth/me` (401 без сессии) — без изменений. Роутов `login`/`forgot-password` больше нет.
- Redis — `lib/redis.ts` (ioredis, globalThis-синглтон, lazy connect), env `REDIS_URL` (формат `redis://[:password@]host:port`; локально docker `savetube-redis`, `redis://localhost:6379`). **Без REDIS_URL auth-роуты отвечают 503 «Сервис временно недоступен»** (не падают), оплата от Redis не зависит.
- Сессия — iron-session (`lib/auth/session.ts`), cookie `savetube_session` на 1 год, httpOnly, sameSite lax, secure в проде, секрет `SESSION_SECRET`. Юзеры — `lib/auth/user-store.ts`, таблица `{prefix}app_users` (НЕ `{prefix}users` — база WordPress-совместимая): id CHAR(36) UUID, email UNIQUE (lower-case), created_at; автосоздание как у recurrent-store.
- ЛК `/account` — ТОЛЬКО по сессии: нет сессии → OTP-форма (шаг 1: email + «Получить код»; шаг 2: код 6 цифр + «Войти»; при expired — «Выслать код повторно»); есть → статус подписки, автопродление с картой и «Отвязать карту», история платежей, «Выйти». `/api/account` и `/api/account/unlink` берут email из сессии, без неё — 401. Cookie `user_email` остаётся — её использует download-form для автопроверки подписки, НЕ путать с сессией.
- Отвязка карты: `deleteRecurrent` выполняется всегда, DELETE способа оплаты в ЮKassa — best-effort (при невключённом рекурренте там 405, ошибку игнорируем). Подписка действует до оплаченной даты.
- Письма (`lib/email.ts`, nodemailer, `SMTP_*`): welcome (без пароля, ссылка на /account), OTP (`sendOtpEmail`, крупный код, «действует 5 минут»), payment-success (тариф + «активна до»; шлётся из обоих вебхуков и крона продлений только при реальной активации `markPaid` → дублей при повторах вебхука нет, через `after()`, ошибки глушим). Без `SMTP_*` письма тихо пропускаются. На dev (`NODE_ENV !== production`) TLS-проверка SMTP отключена (антивирус MITM), в проде строгая — как в lib/tbank.ts.
- Почта поддержки — `s@save-tube.ru` (`SUPPORT_EMAIL` в `lib/site.ts`).

## Защита от злоупотреблений (зафиксировано)

- worker_threads/Redis из старого бэкенда не нужны: задачи get-video-info — in-memory (`lib/tasks.ts`), кеш — in-memory TTL (`lib/cache.ts`, на серверless заменить на Redis с тем же интерфейсом). Очередь задач — своя in-memory (`lib/task-queue.ts`, лимит параллелизма + FIFO + отказ при переполнении), worker_threads специально не тянем (каждый воркер старого бэка жрал 300-400 МБ).
- `lib/rate-limit.ts` — скользящее окно по IP + счётчик concurrency. Лимиты: `get-video-info` 10/мин, `get-segments` 20/мин, прокси 16 одновременных стримов на IP (= MAX_THREADS на клиенте; слот освобождается в `finally` стрима).
- Кеши: `get-video-info` 55 мин, `get-segments` (md5) 30 мин — чтобы не дёргать RuTube на каждый запрос.
- Прокси закрыт HMAC-токеном (`lib/proxy-token.ts`, `${exp}.${sig}`, TTL 3ч): выдаёт `get-segments`, клиент шлёт `&t=`. Без валидного токена — 403. Плюс whitelist хостов (см. выше).

## Масштабирование: внешние прокси-ноды

Когда упрётся полоса основного сервера — сегментный трафик выносится на отдельные VPS:

- `proxy-node/server.js` — самодостаточная нода на голом Node.js (ноль зависимостей): та же проверка HMAC-токена (тот же `PROXY_TOKEN_SECRET`!), whitelist хостов, лимит 16 стримов/IP, CORS (`PROXY_NODE_ORIGIN`), `/health`. Логика зеркалит `app/api/proxy/route.ts` — **менять их синхронно**.
- Клиент выбирает ноду в `lib/proxy-nodes.ts` из `NEXT_PUBLIC_PROXY_URLS` (базовые URL через запятую; заданы `https://proxy3.save-tube.ru,https://proxy4.save-tube.ru,https://proxy5.save-tube.ru`): round-robin, на ретрае — следующая нода (failover автоматический). Встроенный `/api/proxy` **всегда добавлен в конец ротации** как гарантированный fallback — скачивание работает даже при недоступных внешних нодах (поэтому `MAX_RETRIES` на клиенте = 4: покрывает 3 внешние ноды + встроенный).
- Поднятие ноды: скопировать `proxy-node/` на VPS → `PROXY_TOKEN_SECRET=... PORT=3100 PROXY_NODE_ORIGIN=https://save-tube.ru pm2 start server.js --name proxy-node` → повесить поддомен (nginx/caddy с TLS) → добавить URL в `NEXT_PUBLIC_PROXY_URLS` основного приложения и пересобрать. Без `PROXY_TOKEN_SECRET` нода отвечает всем 403. **Важно:** на proxy4/5 может стоять СТАРЫЙ код ноды (путь `/api/v1/proxy`, без токена — открытая дыра) — обновить на наш `proxy-node/` (путь `/api/proxy`, HMAC обязателен; нода принимает и `/`, и `/api/proxy`, и `/api/v1/proxy` — под существующий nginx подходит без правки location).
- **proxy3.save-tube.ru — ЗАДЕПЛОЕНА наша нода** (2026-08, `/root/nodejs/proxy_server`, pm2 `proxy-node`, порт 3000, старый код в `proxy_server.bak`). `PROXY_NODE_ORIGIN` там списком: `https://save-tube.ru,https://www.save-tube.ru,http://localhost:3000,http://localhost:3001` (CORS — echo origin из списка, чужие origin без ACAO). Из nginx-конфига (`/etc/nginx/conf.d/proxy-backend.conf`, бэкап `.bak-cors`) убраны `add_header Access-Control-*` — CORS отдаёт ТОЛЬКО нода, иначе дублированные ACAO ломают fetch в браузере. `/health` снаружи недоступен (nginx проксирует только `/api/v1/proxy`) — проверка живости: запрос с валидным токеном.
- Секреты в репо не коммитить: `.env*`, `data/`. Старый бэкенд (PHP/воркеры/прокси-ноды, с кредами в коде) лежит вне репо — в загрузках пользователя (`Downloads/Telegram Desktop/Архив (2)`, `Архив (3)`).

## Реклама РСЯ

`components/rsy-banner.tsx` — блоки `R-A-{NEXT_PUBLIC_RSY_ID}-{4..8}`, ротация 30с, крестик после 5с, скрыт при ширине <830px. id партнёра 14782353 уже в `.env.example`/`.env.local`.

## Админка метрик (/admin)

- Доступ: email из `ADMIN_EMAILS` + ключ `ADMIN_KEY` (форма на `/admin`); cookie `admin_session` = HMAC-подпись на ADMIN_KEY, 7 дней, httpOnly. **Без ADMIN_KEY админка закрыта полностью.** Логин rate-limit'ится (5/мин по IP). Логика — `lib/admin-auth.ts`, проверка везде через `getAdminEmail()`.
- Сбор: обёртка `trackRequest(route, request, handler)` из `lib/metrics.ts` — стоит на всех API-роутах (включая вебхук и admin-login; новые роуты — оборачивать так же). Замеряет route/ip/status/ms, пишет fire-and-forget.
- Хранилище: `lib/metrics-store.ts` — MySQL, таблица `{MYSQL_TABLE_PREFIX}request_metrics`, автоочистка старше 3 дней раз в час при записи. Без настроенной MySQL запись — no-op, дашборд показывает нули.
- Отдача: `GET /api/admin/metrics?window=15m|1h|6h|24h|3d` — summary, таймсерия по бакетам, топ IP, подозрительные IP (много 429/403 = атаки/абьюз), статистика роутов, live (активные стримы из `getConcurrencySnapshot()` в rate-limit.ts + очередь задач из `getTaskQueueSnapshot()` в task-queue.ts + аптайм).
- Дашборд `app/admin/metrics-dashboard.tsx` — автообновление 30с, SVG-график без внешних зависимостей (recharts специально не тянем). Страница `force-dynamic` + `robots: noindex`, в robots.txt `Disallow: /admin`.

## Отложено (следующие итерации)

- MP3-конвертация (ffmpeg.wasm или серверная), мультиязычность — не было запроса. MP3 упоминается только в текстах (как на проде).
- Настоящий муксинг TS→MP4.
