param(
    [switch] $Start
)

$ErrorActionPreference = 'Stop'
git pull --ff-only
if ($Start) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'obs-remote.ps1') -Command start
} else {
    Write-Host 'Updated. Run .\install.ps1 -Command start to launch OBS Remote.'
}
