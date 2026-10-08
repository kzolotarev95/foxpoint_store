$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path -Parent $PSScriptRoot
$previewNode = (Get-Command node -ErrorAction Stop).Source
$previewState = Join-Path $previewRoot '.codex-temp'
$previewSocket = Join-Path $previewState 'local-db-runtime/node_modules/@electric-sql/pglite-socket/dist/scripts/server.js'
$previewApi = Join-Path $previewRoot 'apps/api/dist/server.js'
$previewNext = Join-Path $previewRoot 'node_modules/next/dist/bin/next'

foreach ($previewPath in @($previewApi, $previewNext)) {
    if (!(Test-Path -LiteralPath $previewPath)) { throw "Не найден $previewPath. Подготовьте локальную сборку по docs/CLIENT_DATABASE_LOCAL.md." }
}
New-Item -ItemType Directory -Path $previewState -Force | Out-Null

# These values belong only to the processes launched by this script.
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/postgres?schema=public&connection_limit=1&pgbouncer=true'
$previewPostgresConfig = Join-Path $previewState 'preview-postgres.json'
if (Test-Path -LiteralPath $previewPostgresConfig) {
    $previewPostgres = Get-Content -LiteralPath $previewPostgresConfig -Raw | ConvertFrom-Json
    $previewPgDirectory = [IO.Path]::GetFullPath((Join-Path $previewRoot $previewPostgres.binaryDirectory))
    if (!$previewPgDirectory.StartsWith($previewRoot + [IO.Path]::DirectorySeparatorChar) -or ([uri]$previewPostgres.databaseUrl).Host -ne '127.0.0.1') { throw 'Invalid local PostgreSQL configuration.' }
    $env:DATABASE_URL = $previewPostgres.databaseUrl
    $env:FOXPOINT_PG_BIN = $previewPgDirectory
    if (!(Get-NetTCPConnection -State Listen -LocalPort $previewPostgres.port -ErrorAction SilentlyContinue)) {
        & (Join-Path $previewPgDirectory 'pg_ctl.exe') start -D (Join-Path $previewRoot $previewPostgres.dataDirectory) -l (Join-Path $previewState 'postgres-runtime/server.log') -o "-h 127.0.0.1 -p $($previewPostgres.port)" -w
        if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL did not start.' }
    }
}
$env:API_HOST = '127.0.0.1'
$env:API_PORT = '4000'
$env:API_BASE_URL = 'http://127.0.0.1:4000'
$env:NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:3000'

function Start-PreviewProcess([int]$Port, [string]$Name, [string[]]$Arguments, [string]$Directory) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        Write-Host "$Name`: порт $Port уже занят; новый процесс не запущен."
        return
    }
    $previewProcess = Start-Process -FilePath $previewNode -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $previewState "$Name.log") -RedirectStandardError (Join-Path $previewState "$Name.error.log")
    $previewProcess.Id | Set-Content -LiteralPath (Join-Path $previewState "$Name.pid")
    for ($previewAttempt = 0; $previewAttempt -lt 30; $previewAttempt++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { return }
        $previewProcess.Refresh()
        if ($previewProcess.HasExited) { throw "$Name завершился. Проверьте .codex-temp/$Name.error.log" }
    }
    throw "$Name не открыл порт $Port. Проверьте .codex-temp/$Name.log"
}

if (!(Test-Path -LiteralPath $previewPostgresConfig)) {
    if (!(Test-Path -LiteralPath $previewSocket)) { throw 'Локальная БД preview не подготовлена.' }
    Start-PreviewProcess 55432 'preview-db' @("`"$previewSocket`"", "--db=`"$(Join-Path $previewState 'local-postgres')`"", '--port=55432', '--host=127.0.0.1', '--max-connections=1') $previewRoot
}
Start-PreviewProcess 4000 'preview-api' @("`"$previewApi`"") $previewRoot
Start-PreviewProcess 3000 'preview-web' @("`"$previewNext`"", 'start', '--hostname', '127.0.0.1', '--port', '3000') (Join-Path $previewRoot 'apps/web')
Write-Host 'Локальная админка: http://127.0.0.1:3000/admin (admin / admin)'
