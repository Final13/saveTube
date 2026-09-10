# CI/CD (GitHub Actions → VPS 157.22.192.87, юзер save-tube)

- Деплой по push в main: `.github/workflows/deploy.yml`. **Сборка в GitHub-раннере** (на VPS 3.7 ГБ RAM `next build` → OOM): `.env` из секрета `ENV_FILE` ДО build (NEXT_PUBLIC_* вшиваются) → `npm install` (НЕ `npm ci`: локфайл с Windows неполон — падает на wasm32 `@emnapi/*`) → `npm run build` → `npm prune --omit=dev` → tar → scp → распаковка в `/var/www/save-tube/data/savetube` + линковка public + `pm2 startOrReload ecosystem.config.js` (процесс `savetube`, порт 3000). После ребута VPS — `@reboot pm2 resurrect` (крон юзера) + `pm2 save` в деплое.
- **Node 22 — юзерспейсная**: `/var/www/save-tube/data/opt/node22` (симлинк → `node-v22.23.2-linux-x64`). Системная Node 20 НЕ подходит (undici@8 >= 22.19, билд падает на `markAsUncloneable`). PATH к ней — в workflow и ecosystem (`interpreter`). Root/sudo нет.
- Статика: `public/` симлинкуется в `/var/www/save-tube/data/www/save-tube.ru` — отдаёт nginx; остальное — proxy на `127.0.0.1:3000`.
- `script_stop` в ssh-action@v1 удалён — в скрипте `set -e` явно. Секреты: `SSH_PRIVATE_KEY` (ed25519, `~/.ssh/savetube_deploy_ed25519`), `ENV_FILE` (продовый .env; REDIS_URL локальный).
- **После инцидента 2026-09-10:** в `ENV_FILE` старый пароль MySQL, пока владелец не обновит секрет — деплой откатит креды и уронит сайт.
- Дамп БД в ТГ: `.github/workflows/backup.yml` (см. AGENTS.md «Бэкапы БД»).
