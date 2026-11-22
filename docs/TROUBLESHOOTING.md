# Диагностика

## Пульт не запускается на Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\obs-remote.ps1 doctor
```

Проверь, что установлен Node.js 24 или новее, OBS запущен, а WebSocket включён с аутентификацией. Пульт не запускает эфир и запись самостоятельно.

## Телефон не подключается по Wi-Fi

Компьютер и телефон должны быть в одной сети. Разреши Node.js в брандмауэре Windows и используй адрес, показанный на `/pair`. Для проверки сначала открой пульт на самом компьютере.

## Облачный адрес не открывается

Проверь DNS, TCP 80/443 и статус Caddy:

```bash
docker compose -f deploy/server/compose.yaml -f deploy/server/compose.cloud.yaml -f deploy/server/compose.source.yaml ps
docker compose -f deploy/server/compose.yaml -f deploy/server/compose.cloud.yaml -f deploy/server/compose.source.yaml logs caddy
```

## Сайт открывается, но OBS недоступен

Проверь, что SSH-туннель запущен на компьютере с OBS, порт совпадает с настройками OBS WebSocket, а пароль в `.env` введён правильно. Порт OBS не должен быть открыт в интернет.
