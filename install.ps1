param(
    [ValidateSet('menu','install','start','doctor','tunnel')]
    [string] $Command = 'menu'
)

$ErrorActionPreference = 'Stop'
$cli = Join-Path $PSScriptRoot 'obs-remote.ps1'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Run this script from the obs-efir repository.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -Command $Command
exit $LASTEXITCODE
