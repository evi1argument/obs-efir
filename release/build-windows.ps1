param([string] $OutputFolder, [string] $LinuxExecutable)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (!$OutputFolder) { $OutputFolder = Join-Path $root 'dist' }
$app = Join-Path $root 'Пульт OBS'
$out = New-Item -ItemType Directory -Force -Path $OutputFolder
$scratch = Join-Path $env:TEMP ('obs-efir-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
if ((& node -p "process.platform + ' ' + process.arch") -ne 'win32 x64') { throw 'Нужен Node.js x64 на Windows.' }

$entry = Join-Path $scratch 'app.cjs'
$blob = Join-Path $scratch 'app.blob'
$config = Join-Path $scratch 'sea.json'
$banner = 'const __OBS_ENTRY_URL__ = require("node:url").pathToFileURL(process.execPath).href;'
& npx.cmd --yes esbuild@0.28.2 (Join-Path $app 'server.mjs') --bundle --platform=node --target=node24 --format=cjs --minify-syntax --minify-whitespace "--define:import.meta.url=__OBS_ENTRY_URL__" "--outfile=$entry"
if ($LASTEXITCODE -ne 0) { throw 'Ошибка сборки приложения.' }
[IO.File]::WriteAllText($entry, $banner + "`n" + [IO.File]::ReadAllText($entry))
& node --check $entry
if ($LASTEXITCODE -ne 0) { throw 'Ошибка проверки сборки.' }

$assets = [ordered]@{}
foreach ($file in Get-ChildItem -File (Join-Path $app 'public')) { $assets['public/' + $file.Name] = $file.FullName }
foreach ($file in 'spotify.ps1','SpotifyVolume.cs') { $assets[$file] = Join-Path $app $file }
[ordered]@{
    main = $entry
    output = $blob
    assets = $assets
    disableExperimentalSEAWarning = $true
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $config -Encoding utf8NoBOM
& node --experimental-sea-config $config
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить исполняемый файл.' }

$exe = Join-Path $out.FullName 'OBS-Efir.exe'
$runtime = (Get-Command node.exe).Source
if ($LinuxExecutable) {
    $exe = Join-Path $out.FullName 'obs-efir-linux-x64'
    $runtime = $LinuxExecutable
}
Copy-Item -LiteralPath $runtime -Destination $exe -Force
& npx.cmd --yes postject@1.0.0-alpha.6 $exe NODE_SEA_BLOB $blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw 'Не удалось упаковать приложение.' }

Write-Output $exe
