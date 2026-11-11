<#
.SYNOPSIS
    停止 start-dev.ps1 启动的后端 / 前端服务。

.EXAMPLE
    .\stop-dev.ps1
#>
$ErrorActionPreference = 'SilentlyContinue'

foreach ($port in 8000, 3000) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) {
        Write-Host "[i] 端口 $port 没有服务在跑"
        continue
    }
    $proc = [System.Diagnostics.Process]::GetProcessById($conn.OwningProcess)
    $proc.Kill()
    $proc.WaitForExit(5000) | Out-Null
    Write-Host "[ok] 已停止端口 $port 的服务 (pid $($conn.OwningProcess))" -ForegroundColor Green
}
