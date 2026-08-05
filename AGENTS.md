<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Save-Tube — сервис скачивания видео с RuTube

Next.js 16 + React 19, App Router, Tailwind v4, lucide-react, алиас `@/`. Только ru-язык.

## Как работает скачивание (не ломать без причины)

Вся логика — в нашем приложении, сторонние сервисы не используются, кроме публичного API и CDN RuTube:

1. `lib/rutube.ts` — парсинг ссылки (`/video/{id}/`, `/shorts/{id}/`, id = 32 hex), метаданные (`https://rutube.ru/api/video/{id}/`), master-плейлист (`https://rutube.ru/api/play/options/{id}/?pver=v2` → `video_balancer.default`; в `/api/video/{id}/` поля `video_balancer` НЕТ). Master m3u8 дублирует каждое качество на 2 CDN (rtbcdn.ru + rutube.ru) — дедупликация по RESOLUTION, второй URL = fallback. Media m3u8 содержит ОТНОСИТЕЛЬНЫЕ пути `*.ts`.
2. API-роуты синхронные (`app/api/get-video-info`, `app/api/get-segments`) — никаких task_id/поллинга, это ограничение прошлого бэкенда.
3. `app/api/proxy?url=` — ОБЯЗАТЕЛЕН: CDN RuTube не отдаёт `Access-Control-Allow-Origin`, браузер сегменты напрямую не скачает. Whitelist хостов: `*.rutube.ru`, `*.rtbcdn.ru` (не расширять без необходимости).
4. Клиент (`components/download-form.tsx`): пул воркеров (по умолчанию 2 потока, число читается из ref на лету), 3 ретрая с backoff на сегмент, склейка Blob → файл `{title}-{quality}.mp4` (контейнер реально MPEG-TS — проигрыватели его едят; настоящий муксинг в MP4 — отложенная задача).

## SEO-решения (зафиксированы, не откатывать)

- Sitemap — ТОЛЬКО `app/sitemap.ts` (MetadataRoute, `revalidate = 3600`). Никаких файлов в public/ и кронов.
- robots.txt — статичный `public/robots.txt` (НЕ `app/robots.ts` — конфликт со статикой). Одна секция `User-agent: *`, закрыты `/api/` и любые GET-параметры (`Disallow: /*?`). **При смене домена обновить Sitemap/Host в нём вручную** и задать `NEXT_PUBLIC_SITE_URL`.
- `metadataBase` + title template в `app/layout.tsx`; на страницах — `alternates.canonical` на чистый URL; верификация google/yandex из env; иконка — физический файл `public/favicon.svg`.
- Яндекс.Метрика — `components/metrika.tsx` (lazyOnload) по env `NEXT_PUBLIC_YM_ID`, цели через `lib/metrika.ts` (стаб-очередь `ym.a`).
- Структурированные данные (JSON-LD) не используются.

## Env

См. `.env.example`: `NEXT_PUBLIC_SITE_URL` (обязателен в проде — metadataBase/sitemap/canonical), `YANDEX_VERIFICATION`, `GOOGLE_VERIFICATION`, `NEXT_PUBLIC_YM_ID`, `TBANK_TERMINAL_KEY`, `TBANK_PASSWORD`, `PROXY_TOKEN_SECRET` (обязателен в проде — без него прокси отдаёт 500), `NEXT_PUBLIC_RSY_ID` (без него РСЯ-баннер не рендерится).

## Платежи T-Bank (не ломать без причины)

- Тарифы в `lib/rates.ts`: 7д/39₽, 30д/99₽, 365д/299₽ — как на проде, менять только осознанно.
- `lib/tbank.ts` — подпись: скалярные поля + `Password`, сортировка ключей case-insensitive, конкатенация значений, sha256. `Init` с чеком 54-ФЗ (УСН доход, `DATA.PaymentMethod=QR:true`), `GetState` для перепроверки.
- Вебхук `app/api/payment/notification`: проверка подписи → `CONFIRMED` → перепроверка через `GetState` (защита от подделки) → идемпотентный `markPaid`. Ответ банку строго `"OK"`/`"ERROR"` (ERROR = банк пришлёт повтор).
- Хранилище `lib/payments-store.ts` — SQLite (`data/payments.db`, better-sqlite3, WAL, globalThis-синглтон).
- Фронт: `components/premium-modal.tsx` (тарифы → email → `GET /api/payment` → редирект на `PaymentURL`; поллинг `/api/payment/status` 5с×25; экраны оплаты/проверки «я уже купил»). Cookie `user_email` на 365д ставит status-эндпоинт, `download-form` автопроверяет подписку по ней. Модалка перемонтируется по `key` — так обходится линт-правило set-state-in-effect, не «чинить».
- `?success`/`?error` (SuccessURL/FailURL банка) открывают модалку через setTimeout — тоже осознанный обход линта.

## Защита от злоупотреблений (зафиксировано)

- Модель синхронная (без task_id/очереди/worker_threads) — воркеры и Redis из старого бэкенда не нужны: нечего ставить в очередь, кеш заменён in-memory TTL (`lib/cache.ts`, на серверless заменить на Redis с тем же интерфейсом).
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
- Хранилище: `lib/metrics-store.ts` — SQLite `data/metrics.db`, таблица `request_metrics`, автоочистка старше 3 дней раз в час при записи.
- Отдача: `GET /api/admin/metrics?window=15m|1h|6h|24h|3d` — summary, таймсерия по бакетам, топ IP, подозрительные IP (много 429/403 = атаки/абьюз), статистика роутов, live (активные стримы из `getConcurrencySnapshot()` в rate-limit.ts + аптайм).
- Дашборд `app/admin/metrics-dashboard.tsx` — автообновление 30с, SVG-график без внешних зависимостей (recharts специально не тянем). Страница `force-dynamic` + `robots: noindex`, в robots.txt `Disallow: /admin`.

## Отложено (следующие итерации)

- MP3-конвертация (ffmpeg.wasm или серверная), мультиязычность — не было запроса. MP3 упоминается только в текстах (как на проде).
- Настоящий муксинг TS→MP4.
