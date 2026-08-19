# Установка FoxPoint на VPS без Docker

Инструкция рассчитана на Ubuntu 24.04 LTS. Прод-схема теперь простая: `Node.js + PostgreSQL + Nginx + systemd`, без Docker.

## 1. Что понадобится

- VPS с Ubuntu 24.04 LTS
- минимум 20 GB SSD, лучше 25 GB
- домен вида `panel.example.com`, если нужен HTTPS
- SSH-доступ под `root` или пользователем с `sudo`

## 2. Быстрый старт

Обычный запуск теперь интерактивный: скрипт сам спросит домен или IP.

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/install-vps.sh?v=$(date +%s)" | sudo bash
```

Если домен уже указывает на сервер и не хочешь отвечать на вопросы вручную:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/install-vps.sh?v=$(date +%s)" | sudo APP_DOMAIN=panel.example.com CERTBOT_EMAIL=you@example.com bash
```

Скрипт сам:

- установит Node.js 20, PostgreSQL, Nginx и Certbot
- клонирует проект в `/opt/foxpoint_store`
- спросит публичный адрес: домен или IP
- создаст `.env`
- создаст БД и пользователя PostgreSQL
- выполнит `npm ci`, `prisma generate`, `prisma db push`, `npm run build`
- настроит `systemd`-сервисы `foxpoint-api` и `foxpoint-web`
- подключит `nginx`

## 3. Что получится после установки

- Web локально: `http://127.0.0.1:3000`
- API локально: `http://127.0.0.1:4000/health`
- Проект: `/opt/foxpoint_store`
- Сервисы:
  - `foxpoint-api`
  - `foxpoint-web`

Проверка:

```bash
systemctl status foxpoint-api foxpoint-web
curl http://127.0.0.1:4000/health
```

## 4. Настройка переменных окружения

Файл окружения находится здесь:

```bash
nano /opt/foxpoint_store/.env
```

Самые важные поля:

```env
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=4000
API_BASE_URL=http://127.0.0.1:4000

NEXT_PUBLIC_APP_URL=https://panel.example.com
NEXT_PUBLIC_API_URL=https://panel.example.com/api
NEXT_PUBLIC_TG_BOT_URL=https://t.me/your_bot
NEXT_PUBLIC_TG_CHANNEL_URL=https://t.me/your_channel

DATABASE_URL=postgresql://foxpoint:strong_password@127.0.0.1:5432/foxpoint?schema=public

TG_BOT_URL=https://t.me/your_bot
TG_CHANNEL_URL=https://t.me/your_channel
SUPPORT_CONTACT=@your_support
```

Если меняешь публичные `NEXT_PUBLIC_*` значения, потом перезапусти обновление:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/update-vps.sh?v=$(date +%s)" | sudo bash
```

## 5. Подключение HTTPS позже

Если сначала поднимал по IP, а домен подключил потом, просто заново запусти install-скрипт и укажи домен в вопросе скрипта:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/install-vps.sh?v=$(date +%s)" | sudo bash
```

Или сразу без вопросов:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/install-vps.sh?v=$(date +%s)" | sudo APP_DOMAIN=panel.example.com CERTBOT_EMAIL=you@example.com bash
```

Перед этим проверь, что A-запись домена уже указывает на IP сервера.

## 6. Обновление проекта

Обычное обновление:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/update-vps.sh?v=$(date +%s)" | sudo bash
```

Скрипт:

- подтянет свежий `main`
- переустановит зависимости через `npm ci`
- пересоберёт проект
- обновит Prisma schema через `db push`
- перезапустит `foxpoint-api` и `foxpoint-web`

## 7. Удаление

Только удалить сервисы и конфиг Nginx:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/uninstall-vps.sh?v=$(date +%s)" | sudo bash
```

Удалить ещё и проект:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/uninstall-vps.sh?v=$(date +%s)" | sudo PURGE_APP=1 bash
```

Удалить проект вместе с БД:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/uninstall-vps.sh?v=$(date +%s)" | sudo PURGE_APP=1 PURGE_DB=1 bash
```

## 8. Полезные команды

Логи API:

```bash
journalctl -u foxpoint-api -n 100 --no-pager
```

Логи Web:

```bash
journalctl -u foxpoint-web -n 100 --no-pager
```

Проверка Nginx:

```bash
nginx -t
systemctl reload nginx
```

Проверка PostgreSQL:

```bash
sudo -u postgres psql -l
```

## 9. Шаблоны в репозитории

- `deploy/nginx/foxpoint.conf`
- `deploy/systemd/foxpoint-api.service`
- `deploy/systemd/foxpoint-web.service`
- `install-vps.sh`
- `update-vps.sh`
- `uninstall-vps.sh`
