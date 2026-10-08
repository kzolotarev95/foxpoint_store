param(
    [string]$Server = '64.112.127.235',
    [string]$SshUser = 'root',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[A-Za-z0-9.-]+$' -or $SshUser -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid SSH address.' }
$redirectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$redirectHelper = Join-Path $redirectRoot 'scripts/configure-backup-nginx.mjs'
$redirectFiles = @($redirectHelper, (Join-Path $redirectRoot 'deploy/nginx/foxpoint.conf'), (Join-Path $redirectRoot 'deploy/nginx/foxpoint-tls.conf'), (Join-Path $redirectRoot 'deploy/scripts/fix-backup-redirect.sh'))
foreach ($redirectFile in $redirectFiles) { if (!(Test-Path -LiteralPath $redirectFile -PathType Leaf)) { throw "Missing $redirectFile" } }
foreach ($redirectTool in @('node', 'ssh', 'scp')) { Get-Command $redirectTool -ErrorAction Stop | Out-Null }
& node --check $redirectHelper
if ($LASTEXITCODE -ne 0) { throw 'Nginx configuration helper syntax error.' }
$redirectHash = (Get-FileHash -LiteralPath $redirectHelper -Algorithm SHA256).Hash.ToLowerInvariant()
if ($PrepareOnly) {
    Write-Output "Prepared Nginx-only redirect fix: $($redirectFiles.Count) files"
    Write-Output "SHA256: $redirectHash"
    return
}
$redirectTarget = "$SshUser@$Server"
Write-Host "Uploading local Nginx redirect fix to $Server. GitHub will not be changed."
$redirectRemoteOutput = & ssh $redirectTarget 'umask 077; mktemp -d /var/tmp/foxpoint-redirect-fix.XXXXXXXX'
if ($LASTEXITCODE -ne 0) { throw 'SSH connection failed.' }
$redirectRemote = ($redirectRemoteOutput | Select-Object -Last 1).Trim()
if ($redirectRemote -notmatch '^/var/tmp/foxpoint-redirect-fix\.[A-Za-z0-9]+$') { throw 'Unexpected upload directory returned by VPS.' }
& scp @redirectFiles "${redirectTarget}:$redirectRemote/"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed; the VPS configuration was not changed.' }
$redirectCommand = "set -eu; printf '%s  %s\n' '$redirectHash' '$redirectRemote/configure-backup-nginx.mjs' | sha256sum -c -; sed -i 's/\r$//' '$redirectRemote/fix-backup-redirect.sh'; "
if ($SshUser -ne 'root') { $redirectCommand += 'sudo ' }
$redirectCommand += "bash '$redirectRemote/fix-backup-redirect.sh' '$redirectRemote'"
& ssh -t $redirectTarget $redirectCommand
if ($LASTEXITCODE -ne 0) { throw 'Nginx fix failed. Read the VPS output; the configuration backup path is printed on success.' }
Write-Host 'Done. Open https://foxpoint.cc/admin/backups?redirect-fix=1'
