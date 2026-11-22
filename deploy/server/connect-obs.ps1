param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*$')]
    [string] $Gateway,
    [ValidateRange(1,65535)]
    [int] $ObsPort = 4455,
    [ValidateRange(1,65535)]
    [int] $SshPort = 22,
    [string] $IdentityFile,
    [switch] $DesktopBridge
)

$ErrorActionPreference = 'Stop'
$sshArguments = @(
    '-NT', '-p', $SshPort,
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-R', "127.0.0.1:14455:127.0.0.1:$ObsPort"
)
if ($DesktopBridge) { $sshArguments += @('-R', '127.0.0.1:18787:127.0.0.1:8787') }
if ($IdentityFile) { $sshArguments += @('-i', $IdentityFile) }
& ssh @sshArguments $Gateway
exit $LASTEXITCODE
