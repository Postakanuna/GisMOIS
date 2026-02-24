# Инструкция по развёртыванию ГИС МО "Инженерные сети" на сервере is.arki.mosreg.ru

## Оглавление

1. [Требования к серверу](#1-требования-к-серверу)
2. [Подготовка сервера](#2-подготовка-сервера)
3. [Установка необходимого ПО](#3-установка-необходимого-по)
4. [Загрузка проекта на сервер](#4-загрузка-проекта-на-сервер)
5. [Настройка базы данных PostgreSQL](#5-настройка-базы-данных-postgresql)
6. [Настройка переменных окружения](#6-настройка-переменных-окружения)
7. [Сборка приложения](#7-сборка-приложения)
8. [Настройка автозапуска (systemd)](#8-настройка-автозапуска-systemd)
9. [Настройка Nginx (обратный прокси)](#9-настройка-nginx-обратный-прокси)
10. [Настройка SSL-сертификата](#10-настройка-ssl-сертификата)
11. [Создание первого администратора](#11-создание-первого-администратора)
12. [Проверка работоспособности](#12-проверка-работоспособности)
13. [Обновление приложения](#13-обновление-приложения)
14. [Альтернатива: развёртывание через Docker](#14-альтернатива-развёртывание-через-docker)
15. [Мониторинг и обслуживание](#15-мониторинг-и-обслуживание)
16. [Устранение неполадок](#16-устранение-неполадок)

---

## 1. Требования к серверу

| Параметр | Минимум | Рекомендуется |
|----------|---------|---------------|
| ОС | Ubuntu 22.04 / Debian 12 / CentOS 8+ | Ubuntu 22.04 LTS |
| CPU | 2 ядра | 4 ядра |
| RAM | 4 ГБ | 8 ГБ |
| Диск | 20 ГБ SSD | 50 ГБ SSD |
| Сеть | Доступ к интернету, открыты порты 80 и 443 | Статический IP |

Также необходимо:
- Доступ по SSH (root или пользователь с sudo)
- Доменное имя `is.arki.mosreg.ru` должно указывать (DNS A-запись) на IP-адрес сервера

---

## 2. Подготовка сервера

Подключитесь к серверу по SSH:

```bash
ssh user@IP_АДРЕС_СЕРВЕРА
```

Обновите систему:

```bash
sudo apt update && sudo apt upgrade -y
```

Установите базовые утилиты:

```bash
sudo apt install -y curl wget git build-essential
```

Создайте отдельного пользователя для приложения (если ещё нет):

```bash
sudo adduser gismo
sudo usermod -aG sudo gismo
```

---

## 3. Установка необходимого ПО

### 3.1. Node.js 20.x

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Проверка:
```bash
node --version   # Должно быть v20.x.x
npm --version    # Должно быть 10.x.x
```

### 3.2. PostgreSQL 16

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update
sudo apt install -y postgresql-16
```

Проверка:
```bash
sudo systemctl status postgresql
# Должно показать "active (running)"
```

### 3.3. Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 3.4. PM2 (менеджер процессов — необязательно, альтернатива systemd)

```bash
sudo npm install -g pm2
```

---

## 4. Загрузка проекта на сервер

### Вариант A: Через Git (рекомендуется)

```bash
sudo mkdir -p /opt/gismo
sudo chown gismo:gismo /opt/gismo
su - gismo
cd /opt/gismo
git clone АДРЕС_ВАШЕГО_РЕПОЗИТОРИЯ .
```

### Вариант B: Через SCP/SFTP (загрузка архива)

На локальном компьютере запакуйте проект (без node_modules):

```bash
# На локальном компьютере
tar --exclude='node_modules' --exclude='.git' --exclude='dist' -czf gismo.tar.gz .
```

Скопируйте на сервер:

```bash
scp gismo.tar.gz user@IP_АДРЕС_СЕРВЕРА:/opt/gismo/
```

На сервере распакуйте:

```bash
cd /opt/gismo
tar -xzf gismo.tar.gz
rm gismo.tar.gz
```

---

## 5. Настройка базы данных PostgreSQL

### 5.1. Создание пользователя и базы данных

```bash
sudo -u postgres psql
```

В консоли PostgreSQL выполните:

```sql
-- Создание пользователя (замените НАДЁЖНЫЙ_ПАРОЛЬ на свой пароль)
CREATE USER gismo_user WITH PASSWORD 'НАДЁЖНЫЙ_ПАРОЛЬ';

-- Создание базы данных
CREATE DATABASE gismo OWNER gismo_user;

-- Предоставление прав
GRANT ALL PRIVILEGES ON DATABASE gismo TO gismo_user;

-- Выход
\q
```

### 5.2. Инициализация схемы базы данных

```bash
cd /opt/gismo

# Установите зависимости (необходимо для db:push)
npm ci

# Установите переменную DATABASE_URL для инициализации
export DATABASE_URL="postgresql://gismo_user:НАДЁЖНЫЙ_ПАРОЛЬ@localhost:5432/gismo"

# Примените схему базы данных
npm run db:push
```

Вы должны увидеть сообщения о создании таблиц. Если появляются ошибки — проверьте правильность пароля и имени базы данных.

---

## 6. Настройка переменных окружения

Создайте файл `.env` в директории проекта:

```bash
sudo nano /opt/gismo/.env
```

Содержимое файла:

```env
# === ОБЯЗАТЕЛЬНЫЕ ===

# Подключение к базе данных
DATABASE_URL=postgresql://gismo_user:НАДЁЖНЫЙ_ПАРОЛЬ@localhost:5432/gismo

# Секретный ключ для сессий (сгенерируйте случайную строку)
SESSION_SECRET=СГЕНЕРИРУЙТЕ_СЛУЧАЙНУЮ_СТРОКУ_МИНИМУМ_64_СИМВОЛА

# Режим работы
NODE_ENV=production
PORT=5000

# === ОПЦИОНАЛЬНЫЕ (подключайте по мере необходимости) ===

# ZuluServer (WMS/WFS сервер)
# ZULU_USERNAME=ваш_логин
# ZULU_PASSWORD=ваш_пароль

# Яндекс Геокодер
# YANDEX_GEOCODER_API_KEY=ваш_ключ

# DaData (геокодирование с ФИАС)
# DADATA_API_KEY=ваш_ключ

# OpenAI (для AI-ассистента и расчёта параметров)
# OPENAI_API_KEY=ваш_ключ

# Yandex Studio (альтернативный AI-провайдер)
# YANDEX_FOLDER_ID=ваш_id
# YANDEX_STUDIO_API_KEY=ваш_ключ
```

Сгенерировать SESSION_SECRET можно командой:

```bash
openssl rand -hex 32
```

Установите права доступа на файл (только владелец может читать):

```bash
chmod 600 /opt/gismo/.env
```

---

## 7. Сборка приложения

```bash
cd /opt/gismo

# Установка зависимостей (если не сделано на шаге 5)
npm ci

# Сборка production-версии
npm run build
```

После успешной сборки появится директория `dist/` с файлами:
- `dist/index.cjs` — серверная часть
- `dist/public/` — клиентская часть (статические файлы)

Проверьте, что сборка прошла успешно:

```bash
ls -la dist/
# Должен быть файл index.cjs и папка public
```

---

## 8. Настройка автозапуска (systemd)

### Вариант A: systemd (рекомендуется для продакшена)

Создайте файл сервиса:

```bash
sudo nano /etc/systemd/system/gismo.service
```

Содержимое:

```ini
[Unit]
Description=GIS MO Inzhenernye Seti
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=gismo
Group=gismo
WorkingDirectory=/opt/gismo
EnvironmentFile=/opt/gismo/.env
ExecStart=/usr/bin/node /opt/gismo/dist/index.cjs
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gismo

# Безопасность
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/gismo

# Лимиты
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Активируйте и запустите сервис:

```bash
# Перечитать конфигурацию systemd
sudo systemctl daemon-reload

# Включить автозапуск при загрузке системы
sudo systemctl enable gismo

# Запустить приложение
sudo systemctl start gismo

# Проверить статус
sudo systemctl status gismo
```

Должно показать `active (running)`.

Просмотр логов:

```bash
# Последние 50 строк
sudo journalctl -u gismo -n 50

# Логи в реальном времени
sudo journalctl -u gismo -f
```

### Вариант B: PM2 (альтернатива)

```bash
cd /opt/gismo
pm2 start dist/index.cjs --name gismo --env production
pm2 save
pm2 startup
```

---

## 9. Настройка Nginx (обратный прокси)

Nginx принимает запросы из интернета на порты 80/443 и перенаправляет их приложению на порт 5000.

Создайте конфигурацию:

```bash
sudo nano /etc/nginx/sites-available/gismo
```

Содержимое:

```nginx
server {
    listen 80;
    server_name is.arki.mosreg.ru;

    # Максимальный размер загружаемых файлов (шейп-файлы, XLSX)
    client_max_body_size 100M;

    # Логи
    access_log /var/log/nginx/gismo_access.log;
    error_log /var/log/nginx/gismo_error.log;

    # Проксирование всех запросов к приложению
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        # Поддержка WebSocket (для живых обновлений)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Передача оригинальных заголовков
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Таймауты (увеличены для тяжёлых GIS-операций)
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    # Кэширование статических файлов
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Активируйте конфигурацию:

```bash
# Создать символическую ссылку
sudo ln -s /etc/nginx/sites-available/gismo /etc/nginx/sites-enabled/

# Удалить стандартную конфигурацию (если не нужна)
sudo rm -f /etc/nginx/sites-enabled/default

# Проверить конфигурацию на ошибки
sudo nginx -t

# Перезагрузить Nginx
sudo systemctl reload nginx
```

---

## 10. Настройка SSL-сертификата

### Вариант A: Let's Encrypt (бесплатный сертификат)

> Для этого варианта домен `is.arki.mosreg.ru` должен быть публично доступен из интернета.

```bash
# Установка Certbot
sudo apt install -y certbot python3-certbot-nginx

# Получение и установка сертификата
sudo certbot --nginx -d is.arki.mosreg.ru
```

Certbot автоматически:
- Получит сертификат
- Настроит Nginx для HTTPS
- Добавит автоматическое обновление в cron

Проверить автообновление:

```bash
sudo certbot renew --dry-run
```

### Вариант B: Корпоративный сертификат

Если у организации есть свой SSL-сертификат:

1. Скопируйте файлы сертификата на сервер:

```bash
sudo mkdir -p /etc/nginx/ssl
sudo cp your_certificate.crt /etc/nginx/ssl/gismo.crt
sudo cp your_private.key /etc/nginx/ssl/gismo.key
sudo chmod 600 /etc/nginx/ssl/gismo.key
```

2. Обновите конфигурацию Nginx (`/etc/nginx/sites-available/gismo`):

```nginx
# Перенаправление HTTP → HTTPS
server {
    listen 80;
    server_name is.arki.mosreg.ru;
    return 301 https://$server_name$request_uri;
}

# HTTPS-сервер
server {
    listen 443 ssl http2;
    server_name is.arki.mosreg.ru;

    ssl_certificate /etc/nginx/ssl/gismo.crt;
    ssl_certificate_key /etc/nginx/ssl/gismo.key;

    # Рекомендуемые настройки SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    client_max_body_size 100M;

    access_log /var/log/nginx/gismo_access.log;
    error_log /var/log/nginx/gismo_error.log;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

3. Перезагрузите Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 11. Создание первого администратора

После успешного запуска приложения создайте учётную запись администратора:

```bash
cd /opt/gismo

# Загрузить переменные окружения
export $(cat .env | grep -v '^#' | xargs)

# Создать администратора
npx tsx scripts/init-admin.ts -- --username=admin --password=ВашНадёжныйПароль123
```

Сохраните логин и пароль в надёжном месте. Эта команда сработает только один раз — для создания самого первого администратора. Дополнительных пользователей создавайте через веб-интерфейс.

---

## 12. Проверка работоспособности

### 12.1. Проверка сервиса

```bash
# Статус приложения
sudo systemctl status gismo

# Проверка порта 5000
curl -s http://localhost:5000/api/health
# Должен вернуть ответ (например, {"status":"ok"})
```

### 12.2. Проверка Nginx

```bash
# Проверка через домен
curl -I http://is.arki.mosreg.ru
# Должен вернуть HTTP/1.1 200 OK (или 301 → HTTPS)
```

### 12.3. Проверка в браузере

Откройте в браузере:

```
https://is.arki.mosreg.ru
```

Вы должны увидеть страницу входа в систему. Войдите с логином и паролем администратора, созданного на шаге 11.

---

## 13. Обновление приложения

При выходе новой версии выполните:

```bash
cd /opt/gismo

# 1. Остановить приложение
sudo systemctl stop gismo

# 2. Загрузить обновления
git pull origin main
# Или загрузите новый архив и распакуйте

# 3. Установить зависимости
npm ci

# 4. Применить миграции базы данных
export $(cat .env | grep -v '^#' | xargs)
npm run db:push

# 5. Пересобрать приложение
npm run build

# 6. Запустить приложение
sudo systemctl start gismo

# 7. Проверить статус
sudo systemctl status gismo
```

---

## 14. Альтернатива: развёртывание через Docker

Если на сервере установлен Docker и Docker Compose, можно использовать упрощённый способ.

### 14.1. Установка Docker

```bash
# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Установка Docker Compose
sudo apt install -y docker-compose-plugin

# Добавить пользователя в группу docker
sudo usermod -aG docker gismo
```

### 14.2. Настройка

```bash
cd /opt/gismo

# Создать файл переменных окружения
nano .env
```

Минимальное содержимое `.env` для Docker:

```env
SESSION_SECRET=СГЕНЕРИРУЙТЕ_СЛУЧАЙНУЮ_СТРОКУ_МИНИМУМ_64_СИМВОЛА
```

> База данных будет создана автоматически Docker Compose (пользователь: postgres, пароль: postgres, база: gis_mo).

### 14.3. Запуск

```bash
# Сборка и запуск
docker compose up -d --build

# Проверка статуса контейнеров
docker compose ps

# Просмотр логов
docker compose logs -f app
```

### 14.4. Создание администратора (Docker)

```bash
docker compose exec app npx tsx scripts/init-admin.ts -- --username=admin --password=ВашНадёжныйПароль123
```

### 14.5. Применение миграций (Docker)

```bash
docker compose exec app npm run db:push
```

### 14.6. Nginx для Docker

Конфигурация Nginx остаётся такой же, как в шаге 9 — приложение работает на порту 5000.

### 14.7. Обновление (Docker)

```bash
cd /opt/gismo
git pull origin main
docker compose up -d --build
```

---

## 15. Мониторинг и обслуживание

### Полезные команды

| Действие | Команда |
|----------|---------|
| Статус приложения | `sudo systemctl status gismo` |
| Перезапуск | `sudo systemctl restart gismo` |
| Остановка | `sudo systemctl stop gismo` |
| Логи (последние 100 строк) | `sudo journalctl -u gismo -n 100` |
| Логи в реальном времени | `sudo journalctl -u gismo -f` |
| Статус Nginx | `sudo systemctl status nginx` |
| Логи Nginx (ошибки) | `sudo tail -f /var/log/nginx/gismo_error.log` |
| Логи Nginx (доступ) | `sudo tail -f /var/log/nginx/gismo_access.log` |
| Статус PostgreSQL | `sudo systemctl status postgresql` |
| Подключение к БД | `sudo -u postgres psql -d gismo` |
| Размер базы данных | `sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('gismo'));"` |

### Автоматическое резервное копирование БД

Создайте скрипт `/opt/gismo/backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/opt/gismo/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Создание дампа
sudo -u postgres pg_dump gismo > "$BACKUP_DIR/gismo_$TIMESTAMP.sql"

# Удалить бэкапы старше 30 дней
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete

echo "Backup created: gismo_$TIMESTAMP.sql"
```

Добавьте в cron для ежедневного выполнения:

```bash
chmod +x /opt/gismo/backup.sh
sudo crontab -e
```

Добавьте строку:

```
0 3 * * * /opt/gismo/backup.sh >> /var/log/gismo-backup.log 2>&1
```

Бэкап будет создаваться каждый день в 3:00 ночи.

---

## 16. Устранение неполадок

### Приложение не запускается

```bash
# Проверьте логи
sudo journalctl -u gismo -n 50 --no-pager

# Частые причины:
# 1. Неправильный DATABASE_URL — проверьте .env
# 2. PostgreSQL не запущен — sudo systemctl start postgresql
# 3. Порт 5000 занят — sudo lsof -i :5000
# 4. Нет файла dist/index.cjs — выполните npm run build
```

### Сайт не открывается по домену

```bash
# Проверьте DNS
nslookup is.arki.mosreg.ru
# IP должен совпадать с IP сервера

# Проверьте Nginx
sudo nginx -t
sudo systemctl status nginx

# Проверьте, отвечает ли приложение локально
curl http://localhost:5000

# Проверьте файрвол
sudo ufw status
# Порты 80 и 443 должны быть открыты:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### Ошибка 502 Bad Gateway

Значит Nginx работает, но не может подключиться к приложению:

```bash
# Проверьте, запущено ли приложение
sudo systemctl status gismo

# Проверьте порт
sudo ss -tlnp | grep 5000

# Перезапустите приложение
sudo systemctl restart gismo
```

### Ошибка подключения к базе данных

```bash
# Проверьте статус PostgreSQL
sudo systemctl status postgresql

# Проверьте подключение
sudo -u postgres psql -d gismo -c "SELECT 1;"

# Проверьте DATABASE_URL в .env
cat /opt/gismo/.env | grep DATABASE_URL
```

### Загрузка файлов не работает (413 Request Entity Too Large)

Увеличьте `client_max_body_size` в конфигурации Nginx:

```nginx
client_max_body_size 200M;
```

Затем: `sudo systemctl reload nginx`

### Нехватка памяти

```bash
# Проверьте использование памяти
free -h

# Создайте swap-файл (если нет)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Добавьте в /etc/fstab для постоянного использования
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Краткая шпаргалка

```
Путь к приложению:      /opt/gismo/
Конфигурация:           /opt/gismo/.env
Логи приложения:        sudo journalctl -u gismo -f
Конфигурация Nginx:     /etc/nginx/sites-available/gismo
Логи Nginx:             /var/log/nginx/gismo_error.log
Бэкапы БД:             /opt/gismo/backups/
SSL-сертификаты:        /etc/nginx/ssl/ или /etc/letsencrypt/

Управление:
  sudo systemctl start gismo      — запуск
  sudo systemctl stop gismo       — остановка
  sudo systemctl restart gismo    — перезапуск
  sudo systemctl status gismo     — статус
```
