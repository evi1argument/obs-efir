param(
    [ValidateRange(1024,65535)]
    [int] $Port = 8787,
    [switch] $LoopbackOnly
)

$ErrorActionPreference = 'Stop'
$env:OBS_REMOTE_PORT = [string]$Port
if ($LoopbackOnly) { $env:OBS_REMOTE_LOOPBACK_ONLY = '1' }
Write-Host "Код и адрес пульта: http://127.0.0.1:$Port/pair"
& node (Join-Path $PSScriptRoot 'server.mjs')
exit $LASTEXITCODE
