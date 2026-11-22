param(
    [ValidateSet('state','open','play','pause','next','previous','volume')]
    [string] $Action = 'state',
    [string] $Link,
    [ValidateRange(0,100)]
    [int] $Volume
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

if ($Action -eq 'open') {
    if ($Link) {
        if ($Link -cnotmatch '^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]{22}$') { throw 'Invalid Spotify URI' }
        Start-Process -FilePath $Link
    } else {
        $spotifyPath = Join-Path $env:APPDATA 'Spotify/Spotify.exe'
        if (Test-Path -LiteralPath $spotifyPath -PathType Leaf) {
            Start-Process -FilePath $spotifyPath
        } else {
            Start-Process -FilePath 'spotify:'
        }
    }
    '{"ok":true}'
    exit
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
if ($Action -in @('state','volume')) {
    Add-Type -Path (Join-Path $PSScriptRoot 'SpotifyVolume.cs')
    $pcVolume = if ($Action -eq 'volume') { [SpotifyVolume]::ReadOrSet($Volume) } else { [SpotifyVolume]::ReadOrSet(-1) }
    if ($Action -eq 'volume') {
        @{ ok = $null -ne $pcVolume; volume = $pcVolume } | ConvertTo-Json -Compress
        exit
    }
}
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Receive-WinRt($Operation, [type] $ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (!$task.Wait(3000)) { throw 'Windows media control did not respond' }
    $task.Result
}

$manager = Receive-WinRt ($managerType::RequestAsync()) $managerType
$session = $manager.GetSessions() | Where-Object {
    $_.SourceAppUserModelId -match '^(Spotify(?:\.exe)?|SpotifyAB\.SpotifyMusic_[a-z0-9]+!Spotify|.+[\\/]Spotify\.exe)$'
} | Select-Object -First 1

if (!$session) {
    @{ available = $false; running = [bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue); volume = $pcVolume } | ConvertTo-Json -Compress
    exit
}

if ($Action -ne 'state') {
    $operation = switch ($Action) {
        'play' { $session.TryPlayAsync() }
        'pause' { $session.TryPauseAsync() }
        'next' { $session.TrySkipNextAsync() }
        'previous' { $session.TrySkipPreviousAsync() }
    }
    @{ available = $true; ok = (Receive-WinRt $operation ([bool])) } | ConvertTo-Json -Compress
    exit
}

$playback = $session.GetPlaybackInfo()
$media = Receive-WinRt ($session.TryGetMediaPropertiesAsync()) $propertiesType
@{
    available = $true
    running = $true
    volume = $pcVolume
    playing = $playback.PlaybackStatus.ToString() -eq 'Playing'
    title = [string]$media.Title
    artist = [string]$media.Artist
    play = $playback.Controls.IsPlayEnabled
    pause = $playback.Controls.IsPauseEnabled
    previous = $playback.Controls.IsPreviousEnabled
    next = $playback.Controls.IsNextEnabled
} | ConvertTo-Json -Compress

