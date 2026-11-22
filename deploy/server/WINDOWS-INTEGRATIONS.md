# Локальные интеграции Windows

Для компьютера, где уже есть папка пульта и Node.js 24, запуск по домашней сети выполняется командой:

```powershell
& '.\Пульт OBS\start-local.ps1'
```

Открой `http://127.0.0.1:8787/pair` на ПК. Страница покажет адрес и код для телефона в той же Wi-Fi сети.

Чтобы подключить этот компьютер к облачной панели со Spotify, загрузкой медиа и видеопредпросмотром, задай отдельный случайный 12-символьный код из заглавных латинских букв и цифр 2–9. Сохрани его на VPS как `OBS_REMOTE_BRIDGE_CODE` и задай `OBS_REMOTE_BRIDGE_PORT=18787` в `.env`. Повтори `bash install.sh cloud`.

На ПК с OBS запусти локальные интеграции в PowerShell:

```powershell
$env:OBS_REMOTE_PUBLIC_ORIGIN = 'https://obs.example.com'
$env:OBS_REMOTE_PAIR_CODE = 'ВСТАВЬ_ОТДЕЛЬНЫЙ_КОД'
& '.\Пульт OBS\start-local.ps1' -LoopbackOnly
```

Запусти `connect-obs.ps1 -Gateway obs-tunnel@vps.example.com -DesktopBridge` в другом окне PowerShell. Если ограничивал порты в `sshd_config`, добавь `127.0.0.1:18787` вторым значением `PermitListen`. Для захвата видео используй OBS Virtual Camera и FFmpeg для Windows с DirectShow и libx264.
