# Облачный доступ

```text
Телефон
  → HTTPS + логин/пароль сайта + код пульта
  → Caddy на VPS
  → 127.0.0.1:14455 на VPS
  → обратный SSH-туннель
  → 127.0.0.1:4455 на Windows
  → OBS WebSocket
```

В облачном режиме используются три независимых уровня:

1. Caddy Basic Auth защищает HTTPS-сайт логином и паролем.
2. OBS Remote проверяет отдельный 12-символьный код пульта.
3. OBS WebSocket проверяет пароль OBS через SSH-туннель.

Порты 8787, 14455 и 4455 не открывай в интернет. Снаружи нужны только 80/443 для Caddy и SSH для туннеля.

## Ограничение SSH-пользователя

Для отдельного пользователя `obs-tunnel` на VPS можно добавить в `sshd_config`:

```text
Match User obs-tunnel
    AllowTcpForwarding remote
    GatewayPorts no
    PermitListen 127.0.0.1:14455
    PermitTTY no
    MaxSessions 0
```

Проверь конфигурацию командой `sshd -t` и перечитай конфигурацию SSH после изменения.

## Проверка

```bash
cd ~/obs-efir
docker compose -f deploy/server/compose.yaml -f deploy/server/compose.cloud.yaml -f deploy/server/compose.source.yaml ps
curl -fsS -o /dev/null http://127.0.0.1:14455/
```

Если HTTPS открывается, но OBS недоступен, проверь открытый SSH-туннель, порт OBS и пароль WebSocket. Страница `/pair` через облачный домен намеренно недоступна: код берётся на компьютере с OBS или из закрытого `.env` VPS.
