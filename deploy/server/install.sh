#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
mode=${1:-}
if [[ -z $mode ]]; then
    printf '\nOBS Remote\n1. Облачный сервер (HTTPS)\n2. Локальный сервер (только этот компьютер)\n'
    read -rp 'Выбери режим [1/2]: ' choice
    case "$choice" in 1) mode=cloud ;; 2) mode=local ;; *) echo 'Неизвестный пункт.' >&2; exit 1 ;; esac
fi
case "$mode" in cloud|local) ;; *) echo 'Использование: bash install.sh [cloud|local]' >&2; exit 1 ;; esac
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    if [[ -r /etc/os-release ]] && command -v apt-get >/dev/null 2>&1; then
        echo 'Устанавливаю Docker и Compose из репозиториев системы (Debian/Ubuntu).'
        if [[ $EUID -eq 0 ]]; then elevate=(); elif command -v sudo >/dev/null 2>&1; then elevate=(sudo); else echo 'Нужен root или sudo.' >&2; exit 1; fi
        "${elevate[@]}" apt-get update
        if ! "${elevate[@]}" apt-get install -y docker.io docker-compose-v2; then
            echo 'Не удалось установить Docker и плагин Compose из репозитория системы. Установи их по https://docs.docker.com/engine/install/ и повтори запуск.' >&2
            exit 1
        fi
    else
        echo 'Установи Docker Engine и плагин Docker Compose: https://docs.docker.com/engine/install/' >&2
        exit 1
    fi
fi
docker compose version >/dev/null || { echo 'Не найден плагин Docker Compose.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker недоступен: запусти службу и предоставь текущему пользователю доступ к Docker.' >&2; exit 1; }
case "$mode" in
    cloud) compose=(docker compose -f compose.yaml -f compose.cloud.yaml) ;;
    local) compose=(docker compose -f compose.yaml) ;;
    *) echo 'Использование: bash install.sh [cloud|local]' >&2; exit 1 ;;
esac
if [[ ! -f obs-efir-linux-x64 && -f ../../Пульт\ OBS/server.mjs ]]; then
    compose+=(-f compose.source.yaml)
elif [[ ! -f obs-efir-linux-x64 ]]; then
    echo 'Не найден серверный бинарник или исходники. Используй полный архив или репозиторий.' >&2
    exit 1
fi
"${compose[@]}" version >/dev/null

if [[ ! -e .env ]]; then
    origin=http://127.0.0.1:8787
    domain=
    operator=operator
    hash=
    if [[ $mode == cloud ]]; then
        read -rp 'Домен пульта: ' domain
        [[ $domain =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || { echo 'Введи домен строчными буквами, без https://.' >&2; exit 1; }
        origin="https://$domain"
        read -rp 'Логин для входа [operator]: ' operator
        operator=${operator:-operator}
        [[ $operator =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Логин может содержать латинские буквы, цифры, - и _.' >&2; exit 1; }
        echo 'Задай пароль для сайта. Caddy выведет bcrypt-хеш.'
        docker run --rm -it caddy:2.11.9-alpine caddy hash-password
        read -rp 'Вставь bcrypt-хеш: ' hash
        [[ $hash =~ ^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$ ]] || { echo 'Вставь хеш, выданный Caddy.' >&2; exit 1; }
    fi
    read -rsp 'Пароль OBS WebSocket: ' obsPassword
    printf '\n'
    [[ -n $obsPassword ]] || { echo 'Включи аутентификацию WebSocket в OBS и введи пароль.' >&2; exit 1; }
    code=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n' | tr 'abcdef01' 'ABCDEFZK')
    encodedPassword=$(printf '%s' "$obsPassword" | base64 | tr -d '\n')
    umask 077
    (
        set -o noclobber
        printf "OBS_REMOTE_PUBLIC_ORIGIN=%s\nOBS_REMOTE_PAIR_CODE=%s\nOBS_REMOTE_WS_PORT=14455\nOBS_REMOTE_WS_PASSWORD_B64=%s\nOBS_REMOTE_DOMAIN=%s\nOBS_REMOTE_USER=%s\nOBS_REMOTE_PASSWORD_HASH='%s'\n" "$origin" "$code" "$encodedPassword" "$domain" "$operator" "$hash" > .env
    )
    printf 'Код входа в пульт: %s\n' "$code"
fi

if [[ $mode == local ]] && ! grep -qx 'OBS_REMOTE_PUBLIC_ORIGIN=http://127.0.0.1:8787' .env; then
    echo 'Для локального режима распакуй пакет в отдельную папку.' >&2
    exit 1
fi
if [[ $mode == cloud ]] && ! grep -q '^OBS_REMOTE_PUBLIC_ORIGIN=https://' .env; then
    echo 'Существующий .env относится к другому режиму. Используй отдельную папку.' >&2
    exit 1
fi
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build
"${compose[@]}" ps
