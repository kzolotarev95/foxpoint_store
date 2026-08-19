# Установка FoxPoint на VPS

Инструкция рассчитана на Ubuntu 24.04 LTS и домен вида `panel.example.com`.

## 1. Что понадобится

- VPS с Ubuntu 24.04 LTS
- домен, направленный на IP сервера
- доступ по SSH под пользователем с `sudo`
- установленный Docker Hub / GitHub доступ для клонирования репозитория

## 2. Подготовка сервера

Подключаемся по SSH:

```bash
ssh root@SERVER_IP
```

Создаём отдельного пользователя:

```bash
adduser foxpoint
usermod -aG sudo foxpoint
usermod -aG docker foxpoint
```

Если пользователя `docker` ещё нет, сначала ставим Docker.

## 3. Установка Docker и Compose

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
```

Проверяем:

```bash
docker --version
docker compose version
```

## 4. Клонирование проекта

Переходим под рабочего пользователя:

```bash
su - foxpoint
```

Клонируем проект:

```bash
git clone https://github.com/kzolotarev95/foxpoint_store.git
cd foxpoint_store
```

## 5. Настройка переменных окружения

Создаём production `.env`:

```bash
cp .env.example .env
nano .env
```

Минимально нужно заменить:

```env
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=4000
API_BASE_URL=https://panel.example.com/api

NEXT_PUBLIC_APP_URL=https://panel.example.com
NEXT_PUBLIC_API_URL=https://panel.example.com
NEXT_PUBLIC_TG_BOT_URL=https://t.me/your_bot
NEXT_PUBLIC_TG_CHANNEL_URL=https://t.me/your_channel

DATABASE_URL=postgresql://foxpoint:STRONG_DB_PASSWORD@postgres:5432/foxpoint?schema=public

TG_BOT_URL=https://t.me/your_bot
TG_CHANNEL_URL=https://t.me/your_channel
SUPPORT_CONTACT=@your_support
```

Важно:

- `NEXT_PUBLIC_API_URL` лучше указывать как внешний домен, если фронт будет ходить через nginx.
- пароль в `DATABASE_URL` должен отличаться от дефолтного.

## 6. Первый запуск контейнеров

Если меняли пароль БД в `.env`, открой:

```bash
nano docker-compose.yml
```

И замени в `postgres.environment` и `api.environment.DATABASE_URL` дефолтный пароль `foxpoint` на свой.

Дальше запуск:

```bash
docker compose build
docker compose up -d
```

Проверка:

```bash
docker compose ps
docker compose logs api --tail=100
docker compose logs web --tail=100
```

Проверяем health:

```bash
curl http://127.0.0.1:4000/health
```

## 7. Миграция Prisma

Сейчас в проекте есть схема и генерация клиента. После добавления реальных миграций запускай:

```bash
docker compose exec api npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

Если на первом этапе нужно просто протолкнуть схему без миграций:

```bash
docker compose exec api npx prisma db push --schema packages/db/prisma/schema.prisma
```

## 8. Nginx перед приложением

Ставим nginx:

```bash
sudo apt install -y nginx
```

Создаём конфиг:

```bash
sudo nano /etc/nginx/sites-available/foxpoint
```

Содержимое:

```nginx
server {
    server_name panel.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:4000/health;
        proxy_set_header Host $host;
    }
}
```

Включаем сайт:

```bash
sudo ln -s /etc/nginx/sites-available/foxpoint /etc/nginx/sites-enabled/foxpoint
sudo nginx -t
sudo systemctl reload nginx
```

## 9. HTTPS через Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d panel.example.com
```

После выпуска сертификата проверь:

```bash
curl -I https://panel.example.com
curl https://panel.example.com/health
```

## 10. Автозапуск после перезагрузки

Docker сам стартует как сервис. Для проекта удобнее настроить systemd-юнит:

```bash
sudo nano /etc/systemd/system/foxpoint-compose.service
```

```ini
[Unit]
Description=FoxPoint Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/foxpoint/foxpoint_store
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Дальше:

```bash
sudo systemctl daemon-reload
sudo systemctl enable foxpoint-compose
sudo systemctl start foxpoint-compose
```

## 11. Обновление проекта

Когда будешь выкатывать новые изменения:

```bash
cd /home/foxpoint/foxpoint_store
git pull
docker compose build
docker compose up -d
```

Если появятся Prisma migration:

```bash
docker compose exec api npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

## 12. Что стоит сделать следующим

- убрать дефолтные пароли из `docker-compose.yml`
- вынести production-переменные в отдельный `.env.production`
- добавить настоящие Prisma migrations
- подключить бэкаповку Postgres
- добавить мониторинг и ротацию логов

