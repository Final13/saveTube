<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Save-Tube — скачивание видео с RuTube

Next.js 16 + React 19, App Router, Tailwind v4, lucide-react, алиас `@/`. Только ru-язык.

Подробные справки (читать при работе в соответствующей зоне): `docs/deploy.md` (CI/CD), `docs/proxy-nodes.md`, `docs/admin-payments.md`, `docs/auth.md`, `docs/incident-2026-09-10.md`.

## Скачивание (не ломать)

Только публичный API и CDN RuTube, сторонних сервисов нет.

- `lib/rutube.ts`: ссылки `/video/{id}/`, `/shorts/{id}/` (id = 32 hex); метаданные `rutube.ru/api/video/{id}/` (там НЕТ `video_balancer`); master `rutube.ru/api/play/options/{id}/?no_404=true&referer&pver=v2&client=wdp&mq=all&av1=1` → `video_balancer.default`. **`mq=all&av1=1` обязательны** — иначе master урезан до 1080p. Master дублирует качества на 2 CDN (rtbcdn.ru + rutube.ru): дедуп по RESOLUTION, 2-й URL = fallback. Media m3u8 — относительные пути `*.ts`.
- `app/api/get-video-info` — задачная модель: POST → задача (`lib/tasks.ts`, in-memory, TTL 10 мин, дедуп по videoId) → СРАЗУ 202 `pending` + task_id — **без inline-ожидания (решение владельца)**; результат — poll `GET ?task_id` (1.5с, до 90с). Кеш-хит (55 мин) — `completed`+`data` сразу в POST. Ретраи 5× backoff (`lib/video-info-task.ts`), очередь `lib/task-queue.ts` (FIFO, `VIDEO_INFO_CONCURRENCY`=4, > `VIDEO_INFO_MAX_QUEUE`=100 → 429). HTTP-ошибки retriable (DC-бан = 404-заглушка), «контент недоступен» — нет.
- `app/api/get-segments` — так же: POST → 202 `pending` + task_id, poll → `completed` + `{segments, token}` / `failed`. Дедуп по md5(url), ретраи 5× (`lib/segments-task.ts`; неретраибельно: HTTP 404, невалидный URL, пустой плейлист). **Кеш-хит (30 мин) — старый синхронный ответ `{segments, token}` в POST (обратная совместимость).** Токен выдаётся в момент ответа — TTL тикает со скачивания.
- **Serverless (`process.env.VERCEL`):** фон после ответа не живёт → POST сразу 202, выполнение драйвит poll-GET (50с, `maxDuration: 60`; videoId в `task.payload`, single-flight `task.processing`). 404 (чужой инстанс) → клиент пересоздаёт задачу до 2 раз.
- `app/api/proxy?url=` — обязателен (CDN без CORS). Whitelist `*.rutube.ru`, `*.rtbcdn.ru` — не расширять.
- Клиент (`components/download-form.tsx`): пул одно-сегментных воркеров (дефолт 2, пополнение до `threadsRef` после каждого сегмента — потоки +/- на лету; воркер «качай до конца очереди» НЕ возвращать: `Promise.race` не просыпался), `slotStates` подгоняется в `changeThreads`, 4 ретрая с backoff на сегмент, Blob → `{title}-{quality}.mp4` (реально MPEG-TS; муксинг отложен).

## SEO (не откатывать)

- Sitemap — только `app/sitemap.ts` (MetadataRoute, `revalidate = 3600`); без файлов в public/ и кронов.
- robots.txt — статичный `public/robots.txt` (НЕ `app/robots.ts`): `User-agent: *`, закрыты `/api/` и `/*?`. При смене домена — обновить Sitemap/Host + `NEXT_PUBLIC_SITE_URL`.
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

- **API rutube.ru банит DC-IP** (Vercel/AWS → 404/403-заглушка), CDN `*.rtbcdn.ru` — нет. Текстовые API-запросы — через `rutubeApiFetch()` в `lib/rutube.ts` + `RUTUBE_API_PROXY=http://user:pass@host:port` (undici ProxyAgent, дешёвый RU-прокси). Плейлисты и сегменты — всегда напрямую.
- **API T-Bank тоже режет зарубежные DC-IP** (проверено боем): `tbankRequest()` в `lib/tbank.ts` через `TBANK_API_PROXY` (формат как выше). Пусто — напрямую (VPS с RU-IP). API ЮKassa с Vercel доступен напрямую.
- In-memory лимиты/кеши — per-instance. Прод-MySQL на localhost VPS → на Vercel недоступна (платежи — «сервис недоступен»). Vercel = витрина со скачиванием, прод = VPS.

## Платежи T-Bank (не ломать)

- Тарифы `lib/rates.ts`: 7д/39₽, 30д/89₽, 365д/299₽ — менять только осознанно. Скрыть тариф из модалки — флаг `Rate.hidden` (элементы НЕ удалять и НЕ переставлять: rate_index хранится в платежах/рекуррентах).
- `lib/tbank.ts`: подпись = скалярные поля + `Password`, сортировка ключей case-insensitive, конкатенация, sha256. `Init` с чеком 54-ФЗ (УСН доход, `DATA.PaymentMethod=QR:true`), `GetState` — перепроверка. На dev TLS-проверка банка отключена (антивирус MITM), в проде строгая.
- Вебхук `app/api/payment/notification`: подпись → `CONFIRMED` → перепроверка `GetState` → идемпотентный `markPaid`. Ответ строго `"OK"`/`"ERROR"` (ERROR = банк пришлёт повтор).
- Хранилище `lib/payments-store.ts` (MySQL, `lib/mysql.ts` globalThis-синглтон): таблица `{MYSQL_TABLE_PREFIX}payments` (дефолт `wp_`), колонки от старого бэкенда — старые подписки распознаются без миграции. `payment_amount` в РУБЛЯХ (в банк — копейки), `OrderId` = `payment_id`. Таблица самосоздаётся. **Синглтон само-переподключается** (патч `client.query`): на «closed state»/«Connection lost»/ECONNRESET сбрасывается, запрос повторяется раз со свежим клиентом; не откатывать — MySQL-роуты умрут до рестарта.
- Фронт `components/premium-modal.tsx`: тарифы → `GET /api/payment` → редирект на `PaymentURL`, поллинг `/api/payment/status` 5с×25. **Дефолт при открытии — 30д** (`DEFAULT_RATE_INDEX` по `days===30`). Иконка «ускорения» — `components/speedo-icon.tsx` (спидометр, keyframes `.speedo-needle` в globals.css, `prefers-reduced-motion` учтён): в шапке модалки (`size-10 -mt-1 text-amber-500`) и на кнопке «Ускорить» в download-form (`size-6 text-amber-400`), вместо молнии. Карточки тарифов: крупная цена + «на N дней»; у 30д — зачёркнутая `Rate.oldPriceRub` (156₽, осознанно) и бейдж `-N%` (маркетинг, на списание не влияет); без `oldPriceRub` — цена по центру (`flex-col justify-center`). Под тарифами — бенефиты, под кнопкой — бейджики платёжек из `public/payments/` (из CanvasKit; sberpay.svg 218 КБ; плашки как у email-инпута: белые / `dark:bg-zinc-800 dark:border-zinc-700`), юр-строка внизу. **Привязка подписки — по email сессии, если залогинен** (инпут = `receipt_email` для чека 54-ФЗ, пусто → email сессии); без сессии параметр `email` = привязка и чек (авто-регистрация). Cookie `user_email` (365д) ставит status-эндпоинт; download-form — по ней, без неё — по сессии (`/api/auth/me`). **Перемонтирование по `key` и открытие по `?success`/`?error` через setTimeout — осознанные обходы линта, не «чинить».**
- Потоки `+/-` видны ТОЛЬКО при активной подписке, 4K — тоже (гейт в download-form); бесплатным — «⚡ Ускорить» (модалка). Шапка: только «Войти»/«Кабинет» → `/account` («⚡ Премиум» убран владельцем).

## ЮKassa + автопродление (зафиксировано)

- Переключатель провайдера в `/admin` («Оплата»): `tbank` (разовые) ↔ `yookassa` (рекуррент), в `{prefix}app_settings` (`lib/settings-store.ts`), влияет только на новые платежи. Подписки обоих — в `{prefix}payments` (`payment_provider`: NULL = легаси T-Bank).
- `lib/yookassa.ts` — API v3 на fetch (Basic, `Idempotence-Key`). **Два магазина:** боевой `YOOKASSA_SHOP_ID`/`YOOKASSA_SECRET_KEY` и тестовый `YOOKASSA_TEST_*` — тестовый на dev, на Vercel (VERCEL=1) и на проде для плательщиков из `ADMIN_EMAILS` (выбор по email аккаунта/параметра, не чека). Перепроверка `getYookassaPayment(id, email?)`: email известен → магазин по нему; нет (вебхук) → боевой, при 404 — тестовый. Первый платёж: redirect + `save_payment_method: true` + чек 54-ФЗ (vat_code 1). **В metadata платежа всегда кладём `email` плательщика** (и у первого, и у продлений) — внешняя копия привязки платёж↔плательщик, читается через API всегда (чеки `/v3/receipts` — нет); урок инцидента 10.09. Контракт `/api/payment` общий: `{url, payment_id}`.
- Вебхук `app/api/payment/yookassa-notification`: не доверяем — перепроверка `getYookassaPayment`, идемпотентный `markPaid`, продление от `max(now, текущий конец)`. Ответ всегда 200, кроме недоступности API (502 = повтор). **Самолечение:** `GET /api/payment/status?payment_id=` при pending-платеже ЮKassa сам перепроверяет и активирует (спасает, когда вебхук не настроен). Продления в кроне при `succeeded` тоже активируются без вебхука.
- Рекуррент: `{prefix}recurrent_subscriptions` (`lib/recurrent-store.ts`, одна запись на email). Автосписания — `app/api/cron/billing` (cron раз в час, `Authorization: Bearer $CRON_SECRET`): только при провайдере yookassa, неудача → ретрай через сутки; **canceled с reason `*revoked*` (разрешение отозвано) → `deleteRecurrent`, ретраев нет** — метод мёртв навсегда. `success_streak` (успешных списаний подряд, колонка «Успешных подряд» в админке): +1 в `activateYookassaPayment` при `activated && metadata.renewal` (идемпотентно), сброс при canceled в кроне. **Требует включённых повторных платежей в магазине ЮKassa (через менеджера).**
- Провайдер и email сессии приходят в модалку **SSR-пропсами** (`getPaymentProvider()`/`getSession()` в `app/page.tsx` и `app/download-link/page.tsx` → DownloadForm → PremiumModal) — fetch'ей `/api/payment/provider` и `/api/auth/me` у модалки нет, надписи не вспыхивают. Фраза об автопродлении («Можно отключить в любой момент в личном кабинете») — **всем** при `yookassa` (решение владельца), при tbank скрыта; между бенефитами и email-инпутом. Юр-строка внизу — по сессии: без неё «Регистрируясь…» (оплата = регистрация), с сессией «Оплачивая…». `GET /api/payment/provider` оставлен публичным (внешние потребители).
- Админка «Оплата» (`app/admin/payments-panel.tsx` + `app/api/admin/payments`) — **детали в `docs/admin-payments.md`**. Ключевое: пагинация по 10, сортировка по всем колонкам автопродлений, счётчики `recurrentActiveStats()`, бэкфиллы `backfill-methods`/`backfill-streaks` (идемпотентные, двухшаговые — БЕЗ кросс-табличного сравнения: у payments иная коллация, «Illegal mix of collations»), 5 SVG-графиков из `getSubscriptionStats()` — **только завершённые дни, сегодня исключён**.

## Авторизация и ЛК (OTP по email, зафиксировано)

**Паролей НЕТ** — вход по 6-значному коду на email (Redis `otp:{email}` EX 300); юзер создаётся при первой оплате (сессия сразу на год, welcome-письмо через `after()`). Сессия — iron-session (`lib/auth/session.ts`, cookie `savetube_session` на год, `SESSION_SECRET`); юзеры — `{prefix}app_users` (НЕ `users`). Cookie `user_email` (365д) — прем-маркер устройства для download-form, НЕ путать с сессией; `logout` её сносит. `/api/account*` без сессии — 401. Отвязка карты: `deleteRecurrent` всегда, DELETE в ЮKassa best-effort. Письма (`lib/email.ts`) — через `after()`, ошибки глушим; поддержка `s@save-tube.ru`. Детали флоу и ЛК — `docs/auth.md`.

## Защита (зафиксировано)

- **Инцидент 2026-09-10 (ransomware-вайп БД; детали и flashback-метод — `docs/incident-2026-09-10.md`):** `bind-address = 127.0.0.1` (наружу НЕ открывать), пароль `savetube_user` сменён, юзеров `%` в mysql.user быть не должно.
- worker_threads не тянем (воркер старого бэка жрал 300-400 МБ).
- `lib/rate-limit.ts`: get-video-info 10/мин, get-segments 20/мин, прокси 16 одновременных стримов/IP (слот — `releaseOnce` идемпотентно, в `finally` и `cancel`; `cancel()` через `reader.cancel()`, не `body.cancel()` — на залоченном стриме `ERR_INVALID_STATE`).
- Прокси закрыт HMAC-токеном (`lib/proxy-token.ts`, TTL 3ч): выдаёт `get-segments`, клиент шлёт `&t=`, без токена — 403.

## Прокси-ноды (масштабирование)

Клиент выбирает ноду в `lib/proxy-nodes.ts` из `NEXT_PUBLIC_PROXY_URLS` (round-robin, на ретрае — следующая); **встроенный `/api/proxy` — fallback, только когда ВСЕ ноды отказали** (`MAX_RETRIES` = 4). Ноды открыты всем (токена НЕТ — решение владельца), логика зеркалит `app/api/proxy/route.ts`. Слот стрима — `releaseOnce` при ЛЮБОМ исходе (иначе утечка → 429 навсегда). Детали (server.js, троттлинг, деплой ноды, инцидент 2026-08-12) — `docs/proxy-nodes.md`.

## РСЯ

`components/rsy-banner.tsx`: блоки `R-A-{NEXT_PUBLIC_RSY_ID}-{4..8}`, ротация 30с, крестик после 5с, скрыт <830px, партнёр 14782353. Контейнер — `w-full` без overflow/max-width, крестик `-top-8 right-0`. **Скрытие — только `invisible`, не `hidden`** (Яндекс не рендерит: `CONTAINER_IS_HIDDEN`). **Крестик — destroy + очистка контейнера** (креативы RTB сами ставят `visibility:visible`). Ротация: после закрытия продолжается, на скрытой вкладке — пауза. **Премиум без рекламы:** layout считает `hideAds` (email из сессии/cookie `user_email` → `hasActiveSubscription`, серверно; без MySQL — показывается), футер баннер не рендерит. ТЕСТ: показ — после старта скачивания (`ADS_AFTER_DOWNLOAD_ONLY`, событие `savetube-download-started`).

## Админка метрик (/admin)

- Доступ: email из `ADMIN_EMAILS` + ключ `ADMIN_KEY`; cookie `admin_session` = HMAC на ADMIN_KEY, 7 дней. **Без ADMIN_KEY закрыта полностью.** Логин rate-limit 5/мин. `lib/admin-auth.ts`, проверка — `getAdminEmail()`.
- Сбор: `trackRequest(route, request, handler)` из `lib/metrics.ts` — на ВСЕХ API-роутах (новые тоже оборачивать): route/ip/status/ms, fire-and-forget.
- Хранилище `lib/metrics-store.ts`: MySQL `{prefix}request_metrics`, автоочистка > 3 дней. Без MySQL — no-op, нули.
- `GET /api/admin/metrics?window=15m|1h|6h|24h|3d`: summary, таймсерия, топ/подозрительные IP (много 429/403), статистика роутов, live (стримы `getConcurrencySnapshot()` + очередь `getTaskQueueSnapshot()` + аптайм).
- Дашборд `app/admin/metrics-dashboard.tsx`: автообновление 30с, свой SVG (recharts не тянем). Страница `force-dynamic` + `noindex`, в robots.txt `Disallow: /admin`.

## CI/CD

Деплой по push в main: GitHub Actions → VPS 157.22.192.87 (юзер save-tube), **сборка в раннере** (`npm install` НЕ `ci`), pm2 `savetube` на порту 3000. Детали (Node 22 юзерспейс, симлинки, секреты, ловушки) — `docs/deploy.md`.

## Бэкапы БД (после инцидента 2026-09-10)

- Дамп на сервере: крон юзера save-tube `59 23 * * *` (дамп на конец дня) → `/var/www/save-tube/data/backup_savetube.sh` (mysqldump из кредов .env, без `wp_request_metrics`) → gzip в `/var/www/save-tube/data/backups/`, ротация 7 шт, лог `backup.log`.
- **С VPS api.telegram.org заблокирован хостером** (IPv4/IPv6 молчат, google и api.github.com доступны) — отправку в ТГ делает `.github/workflows/backup.yml` (только `workflow_dispatch`; **schedule убран — GH-шедулер best-effort, молча пропустил первый же ран 10.09**): scp свежего дампа ключом `SSH_PRIVATE_KEY` → sendDocument с датой в подписи. Триггер — серверный крон `4 0 * * *` → `/var/www/save-tube/data/gh_dispatch_backup.sh` (POST dispatches, лог в `backup.log`); токен — fine-grained PAT (Actions RW, только этот репо) в `/var/www/save-tube/data/.gh_dispatch_token` (0600, вне `.env`, деплой не трогает). Секреты `TG_TOKEN` (бот @saveTubeDumpBot) и `TG_CHAT_ID` (группа SaveTube dumps) — в настройках репо.
- Binlog (`log_bin=ON`, 7 дней) не трогать — второй эшелон (point-in-time).
- **ISPmanager-бэкапы (третий эшелон, образы всего сервера):** расписание 03:00 — полная по четвергам, дифференциальная в остальные дни → `/var/backup` (isptar томами по 100 МБ). Лимиты в `/usr/local/mgr5/etc/backup.conf`: `count_limit 1:7` (1 полная + 7 дифф.) и `size_limit` 4.9 ГБ — **не поднимать: диск всего 20G** (12.09 неконтролируемый рост 7:7 без лимита сожрал ~10 ГБ → переполнение → падение mysql; копии тогда удалили начисто, цепочка дифф. пересоздаётся ближайшей полной в четверг).

## Отложено

- MP3-конвертация, мультиязычность (MP3 упоминается только в текстах).
- Настоящий муксинг TS→MP4.
