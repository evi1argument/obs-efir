# Обновление и удаление

## Обновление

В каталоге репозитория на VPS:

```bash
sudo bash update.sh cloud
```

Команда обновляет файлы только через fast-forward и пересобирает контейнеры. `.env` сохраняется. Не запускай обновление поверх незакоммиченных изменений.

На Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\update.ps1
```

После обновления запусти `.install.ps1 -Command start`, если пульт ещё не запущен.

## Удаление

Остановить контейнеры и сохранить настройки:

```bash
sudo bash uninstall.sh cloud
```

Скрипт не удаляет `.env` и Docker volumes. В них находятся настройки доступа и сертификаты Caddy. Удаляй их вручную только после проверки:

```bash
rm -f deploy/server/.env
docker volume ls
```
