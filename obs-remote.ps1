param(
    [ValidateSet('menu','install','start','doctor','tunnel')]
    [string] $Command = 'menu',
    [string] $Gateway,
    [ValidateRange(1,65535)] [int] $ObsPort = 4455
)
$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot 'Пульт OBS'

function Find-Node {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($node) { return $node.Source }
    $path = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $path) { return $path }
    return $null
}
function Install-Dependencies {
    $node = Find-Node
    if (-not $node) {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Нужен winget (App Installer) или Node.js 24: https://nodejs.org/' }
        Write-Host 'Устанавливаю Node.js через winget…'
        & winget.exe install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить Node.js.' }
        $node = Find-Node
    }
    if (-not $node) { throw 'Node.js не найден. Открой новый терминал и повтори установку.' }
    $major = & $node -p 'Number(process.versions.node.split(".")[0])'
    if ($LASTEXITCODE -ne 0 -or [int]$major -lt 24) { throw 'Для пульта нужен Node.js версии 24 или новее.' }
    if (-not (Get-Command python.exe -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Для QR и видео установи Python 3 и повтори установку.' }
        Write-Host 'Устанавливаю Python через winget…'
        & winget.exe install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить Python.' }
        $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    }
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) { throw 'Python не найден в PATH. Открой новый терминал и повтори установку.' }
    & $python.Source -c 'import cv2, imageio_ffmpeg'
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Устанавливаю зависимости QR и видео в профиль пользователя…'
        & $python.Source -m pip install --user opencv-python imageio-ffmpeg
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить Python-зависимости.' }
    }
    $obsExe = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'
    if (-not (Test-Path $obsExe)) {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { Write-Host 'OBS Studio не найден в стандартной папке. При необходимости установи его: https://obsproject.com/' }
        else {
            $answer = Read-Host 'OBS не найден в стандартной папке. Установить OBS Studio через winget? [Y/n]'
            if ($answer -notmatch '^[Nn]') {
                & winget.exe install --id OBSProject.OBSStudio --exact --accept-package-agreements --accept-source-agreements
                if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить OBS Studio.' }
            }
        }
    }
    Write-Host 'Зависимости пульта готовы. В OBS включи WebSocket с паролем.'
}
function Show-Doctor {
    $node = Find-Node
    if ($node) { & $node --version } else { Write-Host 'Node.js: не найден' }
    if (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) { Write-Host 'FFmpeg: найден' } else { Write-Host 'FFmpeg: не найден в PATH (возможен резервный предпросмотр)' }
    if (Get-Command ssh.exe -ErrorAction SilentlyContinue) { Write-Host 'OpenSSH: найден' } else { Write-Host 'OpenSSH: не найден; нужен для облачного режима' }
    $config = Join-Path $env:APPDATA 'obs-studio\plugin_config\obs-websocket\config.json'
    if (Test-Path $config) { Write-Host 'Настройки OBS WebSocket: найдены' } else { Write-Host 'Настройки OBS WebSocket: не найдены; включи сервер в OBS' }
}
if ($Command -eq 'menu') {
    Write-Host "`nOBS Remote`n1. Установить зависимости`n2. Запустить локально`n3. Проверить окружение`n4. Подключить облачный сервер"
    $choice = Read-Host 'Выбери действие'
    $Command = switch ($choice) { '1' {'install'} '2' {'start'} '3' {'doctor'} '4' {'tunnel'} default { throw 'Неизвестный пункт меню.' } }
}
switch ($Command) {
    'install' { Install-Dependencies }
    'doctor' { Show-Doctor }
    'start' {
        if (-not (Find-Node)) { Install-Dependencies }
        Write-Host 'Открой http://127.0.0.1:8787/pair на компьютере с OBS.'
        & (Find-Node) (Join-Path $app 'server.mjs')
        exit $LASTEXITCODE
    }
    'tunnel' {
        if (-not $Gateway) { $Gateway = Read-Host 'SSH-пользователь и адрес сервера (user@host)' }
        & (Join-Path $PSScriptRoot 'deploy/server/connect-obs.ps1') -Gateway $Gateway -ObsPort $ObsPort
        exit $LASTEXITCODE
    }
}
