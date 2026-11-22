param([string] $OutputFolder)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$root = Split-Path -Parent $PSScriptRoot
if (!$OutputFolder) { $OutputFolder = Join-Path $root 'dist' }
$out = New-Item -ItemType Directory -Force -Path $OutputFolder
$scratch = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ('obs-efir-linux-' + [guid]::NewGuid().ToString('N')))
$stage = New-Item -ItemType Directory -Path (Join-Path $scratch.FullName 'package')
$version = '24.17.0'
if ((& node -p 'process.versions.node') -ne $version) { throw "Для сборки нужен Node.js $version." }
$runtime = "node-v$version-linux-x64"
$name = "$runtime.tar.xz"
$base = "https://nodejs.org/dist/v$version/"
$download = Join-Path $scratch.FullName $name
curl.exe -fsSL ($base + $name) -o $download
$sums = curl.exe -fsSL ($base + 'SHASUMS256.txt')
$expected = (($sums | Where-Object { $_.EndsWith("  $name") }) -split ' ')[0]
if ((Get-FileHash -LiteralPath $download).Hash -ne $expected) { throw 'Не совпала контрольная сумма Node.js.' }
tar.exe -xf $download -C $scratch.FullName "$runtime/bin/node" "$runtime/LICENSE"

& (Join-Path $PSScriptRoot 'build-windows.ps1') -OutputFolder $stage.FullName -LinuxExecutable (Join-Path $scratch.FullName "$runtime/bin/node")
Get-ChildItem -LiteralPath (Join-Path $root 'deploy/server') -Force -File | ForEach-Object {
    $content = [IO.File]::ReadAllText($_.FullName).Replace("`r`n", "`n")
    [IO.File]::WriteAllText((Join-Path $stage.FullName $_.Name), $content)
}
Copy-Item -LiteralPath (Join-Path $scratch.FullName "$runtime/LICENSE") -Destination (Join-Path $stage.FullName 'Node.js-LICENSE.txt')

$archive = 'OBS-Efir-Server-Linux-x64.tar.gz'
$target = Join-Path $out.FullName $archive
tar.exe -czf $target -C $stage.FullName .
$hash = (Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant()
"$hash  $archive" | Set-Content -Encoding ascii (Join-Path $out.FullName 'SHA256SUMS-server')
Write-Output $target
