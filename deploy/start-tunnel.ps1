param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*$')]
    [string] $Gateway,
    [ValidateRange(1,65535)]
    [int] $SshPort = 22,
    [ValidateRange(1024,65535)]
    [int] $TunnelPort = 18787,
    [ValidateRange(1,65535)]
    [int] $LocalPort = 8787,
    [string] $IdentityFile
)

$ErrorActionPreference = 'Stop'
$sshArguments = @(
    '-N', '-T', '-p', $SshPort,
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-R', "127.0.0.1:${TunnelPort}:127.0.0.1:${LocalPort}"
)
if ($IdentityFile) { $sshArguments += @('-i', $IdentityFile) }
& ssh @sshArguments $Gateway
exit $LASTEXITCODE
