<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Save-Tube — сервис скачивания видео с RuTube

Next.js 16 + React 19, App Router, Tailwind v4, lucide-react, алиас `@/`. Только ru-язык.

## Как работает скачивание (не ломать без причины)

Вся логика — в нашем приложении, сторонние сервисы не используются, кроме публичного API и CDN RuTube:

1. `lib/rutube.ts` — парсинг ссылки (`/video/{id}/`, `/shorts/{id}/`, id = 32 hex), метаданные (`https://rutube.ru/api/video/{id}/`), master-плейлист (`https://rutube.ru/api/play/options/{id}/?pver=v2` → `video_balancer.default`; в `/api/video/{id}/` поля `video_balancer` НЕТ). Master m3u8 дублирует каждое качество на 2 CDN (rtbcdn.ru + rutube.ru) — дедупликация по RESOLUTION, второй URL = fallback. Media m3u8 содержит ОТНОСИТЕЛЬНЫЕ пути `*.ts`.
2. `app/api/get-video-info` — задачная модель как в старом бэке: POST создаёт задачу (`lib/tasks.ts`, in-memory, TTL 10 мин) и отвечает сразу `{task_id, status}`; если RuTube ответил в inline-бюджет (20с, env `VIDEO_INFO_INLINE_MS`) — результат приходит прямо в POST (`status:completed` + `data`), иначе 202 `pending` и клиент пингует `GET ?task_id` (1.5с, до 90с). Обработка в фоне с ретраями 5× backoff (`lib/video-info-task.ts`); HTTP-ошибки retriable (DC-бан RuTube отдаёт 404-заглушку — пробуем другие прокси), «контент недоступен» — нет (`RutubeApiError.retriable`). `app/api/get-segments` — синхронный (быстрый CDN-запрос).
3. `app/api/proxy?url=` — ОБЯЗАТЕЛЕН: CDN RuTube не отдаёт `Access-Control-Allow-Origin`, браузер сегменты напрямую не скачает. Whitelist хостов: `*.rutube.ru`, `*.rtbcdn.ru` (не расширять без необходимости).
4. Клиент (`components/download-form.tsx`): пул воркеров (по умолчанию 2 потока, число читается из ref на лету), 3 ретрая с backoff на сегмент, склейка Blob → файл `{title}-{quality}.mp4` (контейнер реально MPEG-TS — проигрыватели его едят; настоящий муксинг в MP4 — отложенная задача).

## SEO-решения (зафиксированы, не откатывать)

- Sitemap — ТОЛЬКО `app/sitemap.ts` (MetadataRoute, `revalidate = 3600`). Никаких файлов в public/ и кронов.
- robots.txt — статичный `public/robots.txt` (НЕ `app/robots.ts` — конфликт со статикой). Одна секция `User-agent: *`, закрыты `/api/` и любые GET-параметры (`Disallow: /*?`). **При смене домена обновить Sitemap/Host в нём вручную** и задать `NEXT_PUBLIC_SITE_URL`.
- `metadataBase` + title template в `app/layout.tsx`; на страницах — `alternates.canonical` на чистый URL; верификация google/yandex из env; иконка — физический файл `public/favicon.svg`.
- Яндекс.Метрика — `components/metrika.tsx` (lazyOnload) по env `NEXT_PUBLIC_YM_ID`, цели через `lib/metrika.ts` (стаб-очередь `ym.a`).
- Структурированные данные (JSON-LD) не используются.

## Env

См. `.env.example`: `NEXT_PUBLIC_SITE_URL` (обязателен в проде — metadataBase/sitemap/canonical), `YANDEX_VERIFICATION`, `GOOGLE_VERIFICATION`, `NEXT_PUBLIC_YM_ID`, `TBANK_TERMINAL_KEY`, `TBANK_PASSWORD`, `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_DATABASE`/`MYSQL_USER`/`MYSQL_PASSWORD` + `MYSQL_TABLE_PREFIX` (платежи и метрики; без них платежи/метрики отключены), `PROXY_TOKEN_SECRET` (обязателен в проде — без него прокси отдаёт 500), `NEXT_PUBLIC_RSY_ID` (без него РСЯ-баннер не рендерится), `RUTUBE_API_PROXY` (только для serverless — см. ниже), `SESSION_SECRET` (iron-session ЛК), `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (письма ЛК; без них письма тихо пропускаются).

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

## Авторизация и ЛК (модель canvaskit, зафиксировано)

- Регистрации как действия НЕТ: юзер создаётся автоматически при первой оплате в `/api/payment` (случайный пароль `crypto.randomBytes(12)`, bcrypt SALT_ROUNDS=12), сессия ставится сразу, пароль приходит welcome-письмом через `after()` (SMTP-ошибки не ломают оплату). Если юзер с таким email уже есть — НЕ логиним (вход только по паролю). Отдельного register-роута нет.
- Сессия — iron-session (`lib/auth/session.ts`), cookie `savetube_session` на 1 год, httpOnly, sameSite lax, secure в проде, секрет `SESSION_SECRET`. Пароли — `lib/auth/password.ts` (bcryptjs). Юзеры — `lib/auth/user-store.ts`, таблица `{prefix}app_users` (НЕ `{prefix}users` — база WordPress-совместимая, там может быть wp_users от WP): id CHAR(36) UUID, email UNIQUE (lower-case), password_hash, created_at; автосоздание как у recurrent-store.
- API (все под `trackRequest`, rate-limit 5/мин на auth-роуты): `POST /api/auth/login` (одинаковый ответ на «нет юзера»/«неверный пароль»), `POST /api/auth/logout`, `GET /api/auth/me` (401 без сессии), `POST /api/auth/forgot-password` (новый случайный пароль в БД + письмо; ответ ВСЕГДА `{ok:true}` — анти-перебор).
- ЛК `/account` — ТОЛЬКО по сессии: нет сессии → формы входа/восстановления; есть → статус подписки, автопродление с картой и «Отвязать карту», история платежей, «Выйти». `/api/account` и `/api/account/unlink` берут email из сессии, без неё — 401. Cookie `user_email` остаётся — её использует download-form для автопроверки подписки, НЕ путать с сессией.
- Отвязка карты: `deleteRecurrent` выполняется всегда, DELETE способа оплаты в ЮKassa — best-effort (при невключённом рекурренте там 405, ошибку игнорируем). Подписка действует до оплаченной даты.
- Письма (`lib/email.ts`, nodemailer, `SMTP_*`): welcome (пароль + ссылка на /account), reset (новый пароль), payment-success (тариф + «активна до»; шлётся из обоих вебхуков и крона продлений только при реальной активации `markPaid` → дублей при повторах вебхука нет, через `after()`, ошибки глушим). Без `SMTP_*` письма тихо пропускаются. На dev (`NODE_ENV !== production`) TLS-проверка SMTP отключена (антивирус MITM), в проде строгая — как в lib/tbank.ts.
- Почта поддержки — `s@save-tube.ru` (`SUPPORT_EMAIL` в `lib/site.ts`).

## Защита от злоупотреблений (зафиксировано)

- Очереди/worker_threads/Redis из старого бэкенда не нужны: задачи get-video-info — in-memory (`lib/tasks.ts`), кеш — in-memory TTL (`lib/cache.ts`, на серверless заменить на Redis с тем же интерфейсом).
- `lib/rate-limit.ts` — скользящее окно по IP + счётчик concurrency. Лимиты: `get-video-info` 10/мин, `get-segments` 20/мин, прокси 16 одновременных стримов на IP (= MAX_THREADS на клиенте; слот освобождается в `finally` стрима).
- Кеши: `get-video-info` 55 мин, `get-segments` (md5) 30 мин — чтобы не дёргать RuTube на каждый запрос.
- Прокси закрыт HMAC-токеном (`lib/proxy-token.ts`, `${exp}.${sig}`, TTL 3ч): выдаёт `get-segments`, клиент шлёт `&t=`. Без валидного токена — 403. Плюс whitelist хостов (см. выше).

## Масштабирование: внешние прокси-ноды

Когда упрётся полоса основного сервера — сегментный трафик выносится на отдельные VPS:

- `proxy-node/server.js` — самодостаточная нода на голом Node.js (ноль зависимостей): та же проверка HMAC-токена (тот же `PROXY_TOKEN_SECRET`!), whitelist хостов, лимит 16 стримов/IP, CORS (`PROXY_NODE_ORIGIN`), `/health`. Логика зеркалит `app/api/proxy/route.ts` — **менять их синхронно**.
- Клиент выбирает ноду в `lib/proxy-nodes.ts` из `NEXT_PUBLIC_PROXY_URLS` (базовые URL через запятую): round-robin, на ретрае — следующая нода (failover автоматический). Список пуст — всё работает через встроенный `/api/proxy`, как сейчас.
- Поднятие ноды: скопировать `proxy-node/` на VPS → `PROXY_TOKEN_SECRET=... PORT=3100 PROXY_NODE_ORIGIN=https://save-tube.ru pm2 start server.js --name proxy-node` → повесить поддомен (nginx/caddy с TLS) → добавить URL в `NEXT_PUBLIC_PROXY_URLS` основного приложения и пересобрать. Без `PROXY_TOKEN_SECRET` нода отвечает всем 403.
- Секреты в репо не коммитить: `.env*`, `data/`. Старый бэкенд (PHP/воркеры/прокси-ноды, с кредами в коде) лежит вне репо — в загрузках пользователя (`Downloads/Telegram Desktop/Архив (2)`, `Архив (3)`).

## Реклама РСЯ

`components/rsy-banner.tsx` — блоки `R-A-{NEXT_PUBLIC_RSY_ID}-{4..8}`, ротация 30с, крестик после 5с, скрыт при ширине <830px. id партнёра 14782353 уже в `.env.example`/`.env.local`.

## Админка метрик (/admin)

- Доступ: email из `ADMIN_EMAILS` + ключ `ADMIN_KEY` (форма на `/admin`); cookie `admin_session` = HMAC-подпись на ADMIN_KEY, 7 дней, httpOnly. **Без ADMIN_KEY админка закрыта полностью.** Логин rate-limit'ится (5/мин по IP). Логика — `lib/admin-auth.ts`, проверка везде через `getAdminEmail()`.
- Сбор: обёртка `trackRequest(route, request, handler)` из `lib/metrics.ts` — стоит на всех API-роутах (включая вебхук и admin-login; новые роуты — оборачивать так же). Замеряет route/ip/status/ms, пишет fire-and-forget.
- Хранилище: `lib/metrics-store.ts` — MySQL, таблица `{MYSQL_TABLE_PREFIX}request_metrics`, автоочистка старше 3 дней раз в час при записи. Без настроенной MySQL запись — no-op, дашборд показывает нули.
- Отдача: `GET /api/admin/metrics?window=15m|1h|6h|24h|3d` — summary, таймсерия по бакетам, топ IP, подозрительные IP (много 429/403 = атаки/абьюз), статистика роутов, live (активные стримы из `getConcurrencySnapshot()` в rate-limit.ts + аптайм).
- Дашборд `app/admin/metrics-dashboard.tsx` — автообновление 30с, SVG-график без внешних зависимостей (recharts специально не тянем). Страница `force-dynamic` + `robots: noindex`, в robots.txt `Disallow: /admin`.

## Отложено (следующие итерации)

- MP3-конвертация (ffmpeg.wasm или серверная), мультиязычность — не было запроса. MP3 упоминается только в текстах (как на проде).
- Настоящий муксинг TS→MP4.
