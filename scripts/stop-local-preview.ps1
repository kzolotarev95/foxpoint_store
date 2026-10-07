$ErrorActionPreference = 'Stop'
$previewRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
foreach ($previewName in @('preview-web', 'preview-api', 'preview-db')) {
    $previewPidPath = Join-Path $previewRoot ".codex-temp/$previewName.pid"
    if (!(Test-Path -LiteralPath $previewPidPath)) { continue }
    $previewProcessId = [int](Get-Content -LiteralPath $previewPidPath)
    $previewProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $previewProcessId"
    if (!$previewProcess) { continue }
    if ($previewProcess.Name -ne 'node.exe' -or !$previewProcess.CommandLine.Contains($previewRoot)) {
        throw "Процесс $previewProcessId не подтверждён как локальный preview. Остановка отменена."
    }
    Stop-Process -Id $previewProcessId
    Write-Host "$previewName остановлен."
}
