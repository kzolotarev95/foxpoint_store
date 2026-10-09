param(
    [string]$Server = '64.112.127.235',
    [string]$SshUser = 'root',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[A-Za-z0-9.-]+$' -or $SshUser -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid SSH address.' }
$fixRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$fixStage = Join-Path $fixRoot ('.codex-temp/vps-transfer-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$fixArchive = Join-Path $fixStage 'fix.tar.gz'
$fixList = Join-Path $fixStage 'files.txt'
foreach ($fixTool in @('git', 'ssh', 'scp', 'tar')) { Get-Command $fixTool -ErrorAction Stop | Out-Null }
New-Item -ItemType Directory -Path $fixStage -Force | Out-Null

# Include the local application sources; private register data is sent only to the user's VPS.
$fixTracked = & git -C $fixRoot ls-files
if ($LASTEXITCODE -ne 0) { throw 'Could not read repository files.' }
$fixNew = & git -C $fixRoot ls-files --others --exclude-standard -- apps/api/src apps/web scripts deploy docs
if ($LASTEXITCODE -ne 0) { throw 'Could not read new source files.' }
$fixFiles = @(@($fixTracked) + @($fixNew) + @('scripts/data/foxpoint-client-database.json') | Sort-Object -Unique | Where-Object {
    $_ -notmatch '^\.env($|\.)' -and $_ -notmatch '(^|/)(node_modules|\.next|dist|\.git|\.codex-temp)/' -and
    (Test-Path -LiteralPath (Join-Path $fixRoot $_) -PathType Leaf)
})
foreach ($fixRequired in @('package-lock.json', 'scripts/data/foxpoint-client-database.json', 'deploy/scripts/apply-local-fix.sh', 'deploy/scripts/rollback-local-fix.sh', 'scripts/run-with-env.mjs')) {
    if ($fixRequired -notin $fixFiles) { throw "Missing required local file: $fixRequired" }
}
[IO.File]::WriteAllLines($fixList, $fixFiles, [Text.UTF8Encoding]::new($false))
& tar -czf $fixArchive -C $fixRoot -T $fixList
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the source archive.' }
$fixHash = (Get-FileHash -LiteralPath $fixArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($PrepareOnly) {
    Write-Output "Prepared $($fixFiles.Count) source files: $fixArchive"
    Write-Output "SHA256: $fixHash"
    return
}
$fixTarget = "$SshUser@$Server"
Write-Host "Uploading the local fix to $Server. GitHub will not be changed."
$fixRemoteOutput = & ssh $fixTarget 'umask 077; mktemp -d /var/tmp/foxpoint-local-fix.XXXXXXXX'
if ($LASTEXITCODE -ne 0) { throw 'SSH connection failed.' }
$fixRemote = ($fixRemoteOutput | Select-Object -Last 1).Trim()
if ($fixRemote -notmatch '^/var/tmp/foxpoint-local-fix\.[A-Za-z0-9]+$') { throw 'Unexpected upload directory returned by VPS.' }
& scp $fixArchive "${fixTarget}:$fixRemote/fix.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed; the VPS application was not changed.' }
$fixRemoteCommand = "set -eu; printf '%s  %s\n' '$fixHash' '$fixRemote/fix.tar.gz' | sha256sum -c -; mkdir '$fixRemote/source'; tar -xzf '$fixRemote/fix.tar.gz' -C '$fixRemote/source'; find '$fixRemote/source/deploy/scripts' -name '*.sh' -exec sed -i 's/\r$//' {} +; "
if ($SshUser -eq 'root') {
    $fixRemoteCommand += "bash '$fixRemote/source/deploy/scripts/apply-local-fix.sh' '$fixRemote/source'"
} else {
    $fixRemoteCommand += "sudo bash '$fixRemote/source/deploy/scripts/apply-local-fix.sh' '$fixRemote/source'"
}
& ssh -t $fixTarget $fixRemoteCommand
if ($LASTEXITCODE -ne 0) { throw 'Deployment failed. Read the VPS output for the backup and restoration result.' }
Write-Host "Done. Open your admin panel: Navigation -> Database."
