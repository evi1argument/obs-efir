# Установка OBS Remote

OBS Remote состоит из двух частей:

| Часть | Где работает | Назначение |
| --- | --- | --- |
| Пульт | Windows рядом с OBS Studio | Сцены, источники, звук, предпросмотр и интеграции OBS |
| Шлюз | Linux VPS, только при удалённом доступе | HTTPS, вход пользователя и обратный SSH-туннель |

Для управления по домашнему Wi-Fi шлюз не нужен.

## Windows

Склонируй один репозиторий и запусти меню установки:

```powershell
git clone https://github.com/evi1argument/obs-efir.git
cd obs-efir
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Меню проверит Node.js, Python, FFmpeg, OpenSSH и OBS Studio. После установки выбери `start`. Затем открой на компьютере страницу:

```text
http://127.0.0.1:8787/pair
```

Телефон должен быть в той же Wi-Fi сети. В OBS заранее включи **Инструменты → Настройки сервера WebSocket**, аутентификацию и задай пароль.

## Linux VPS

На VPS должны быть DNS-запись домена и SSH-доступ. Для HTTPS нужны TCP-порты 80 и 443. Выполни:

```bash
git clone https://github.com/evi1argument/obs-efir.git
cd obs-efir
sudo bash install.sh cloud
```

Установщик проверит Docker Compose, создаст закрытый `.env`, спросит домен, логин сайта, пароль сайта и пароль OBS WebSocket, затем запустит панель и Caddy.

После этого оставь SSH-туннель открытым на компьютере с OBS:

```powershell
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -R 127.0.0.1:14455:127.0.0.1:4455 obs-tunnel@YOUR_SERVER
```

Замени `obs-tunnel@YOUR_SERVER` на своего SSH-пользователя и адрес VPS. Введи HTTPS-домен в телефоне, затем логин и пароль сайта и код пульта из `.env` на VPS.

Подробная схема, ограничения SSH и проверка доступа описаны в [CLOUD.md](./CLOUD.md). Безопасность и уровни авторизации — в [SECURITY.md](../SECURITY.md).
