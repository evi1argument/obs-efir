#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
docker compose version >/dev/null

if [[ ! -f .env ]]; then
    read -rp 'Домен для пульта (например obs.example.com): ' domain
    [[ $domain =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]] || { echo 'Нужен корректный домен без https://.' >&2; exit 1; }
    read -rp 'Логин для входа [operator]: ' operator
    operator=${operator:-operator}
    [[ $operator =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Логин должен состоять из букв, цифр, - или _.' >&2; exit 1; }
    echo 'Задай пароль для HTTPS. Caddy покажет bcrypt-хеш.'
    docker run --rm -it caddy:2.11.9-alpine caddy hash-password
    read -rp 'Вставь полученный bcrypt-хеш: ' hash
    [[ $hash =~ ^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$ ]] || { echo 'Нужен bcrypt-хеш, выданный Caddy.' >&2; exit 1; }
    umask 077
    (
        set -o noclobber
        printf "OBS_REMOTE_DOMAIN=%s\nOBS_REMOTE_USER=%s\nOBS_REMOTE_PASSWORD_HASH='%s'\nOBS_REMOTE_TUNNEL_PORT=18787\nOBS_REMOTE_PC_PORT=8787\n" "$domain" "$operator" "$hash" > .env
    )
fi

docker compose config --quiet
docker compose up -d
docker compose ps
echo 'Шлюз запущен. Для доступа к OBS включи обратный SSH-туннель на Windows.'
