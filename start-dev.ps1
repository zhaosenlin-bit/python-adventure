<#
.SYNOPSIS
    后台启动前后端服务（Windows）。

.DESCRIPTION
    和 start-all.bat 的区别：这个脚本不会弹出可见窗口，服务在后台跑，
    日志写到 backend-dev.log / frontend-dev.log。

    用 Start-Process + cmd.exe 创建独立进程，脱离当前 PowerShell 会话。

.EXAMPLE
    .\start-dev.ps1
    .\start-dev.ps1 -BackendOnly
#>
param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backendDir = Join-Path $root 'backend'
$pyExe = Join-Path $backendDir '.venv\Scripts\python.exe'
$nodeExe = (Get-Command node).Source
$nextBin = Join-Path $root 'node_modules\next\dist\bin\next'

if (-not (Test-Path $pyExe)) {
    Write-Host "[x] 找不到后端虚拟环境: $pyExe" -ForegroundColor Red
    Write-Host "    先执行: cd backend; python -m venv .venv; .venv\Scripts\pip install -r requirements.txt" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $nextBin)) {
    Write-Host "[x] 找不到前端依赖，先执行 npm install" -ForegroundColor Red
    exit 1
}

function Start-Detached {
    param([string]$CommandLine, [string]$WorkingDirectory)
    # 用 cmd.exe 作为宿主：命令里的 `>` `&&` 由 cmd 解析，PowerShell 自己处理容易踩坑。
    #
    # 这里刻意不用 Win32_Process (WMI)：在部分 Windows 环境下，WMI 创建的 uvicorn
    # 进程会在几秒内自行退出，日志里只剩一段启动横幅，看起来像“服务已启动”但
    # 端口其实没人监听。Start-Process 起的是独立进程，实测稳定存活。
    $proc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', $CommandLine `
        -WorkingDirectory $WorkingDirectory `
        -PassThru `
        -WindowStyle Hidden
    return $proc.Id
}

if (-not $FrontendOnly) {
    $cmd = "cmd.exe /c cd /d `"$backendDir`" && set `"PYTHONUTF8=1`" && set `"PYTHONIOENCODING=utf-8`" && `"$pyExe`" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > `"$root\backend-dev.log`" 2> `"$root\backend-dev.err.log`""
    $pid1 = Start-Detached -CommandLine $cmd -WorkingDirectory $backendDir
    Write-Host "[ok] 后端已启动 (pid $pid1)  -> http://localhost:8000" -ForegroundColor Green
}

if (-not $BackendOnly) {
    $cmd = "cmd.exe /c cd /d `"$root`" && `"$nodeExe`" `"$nextBin`" dev > `"$root\frontend-dev.log`" 2> `"$root\frontend-dev.err.log`""
    $pid2 = Start-Detached -CommandLine $cmd -WorkingDirectory $root
    Write-Host "[ok] 前端已启动 (pid $pid2)  -> http://localhost:3000" -ForegroundColor Green
}

Write-Host ''
Write-Host '等待服务就绪...'
# Get-NetTCPConnection 在这台机器上经常报不出监听端口，改成直接发 HTTP 请求探测。
function Test-Port {
    param([int]$Port, [string]$Path)
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port$Path" -UseBasicParsing -TimeoutSec 3
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch {
        return $false
    }
}

$backendUp = $false
$frontendUp = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (-not $backendUp)  { $backendUp  = Test-Port -Port 8000 -Path '/health' }
    if (-not $frontendUp) { $frontendUp = Test-Port -Port 3000 -Path '/' }
    if ($backendUp -and $frontendUp) { break }
}

if ($backendUp) {
    Write-Host "[ok] 后端 http://localhost:8000 已就绪" -ForegroundColor Green
} else {
    Write-Host "[!] 后端 http://localhost:8000 未就绪，检查 backend-dev.err.log" -ForegroundColor Yellow
}
if ($frontendUp) {
    Write-Host "[ok] 前端 http://localhost:3000 已就绪" -ForegroundColor Green
} else {
    Write-Host "[!] 前端 http://localhost:3000 未就绪，检查 frontend-dev.err.log" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '日志: backend-dev.log / backend-dev.err.log / frontend-dev.log / frontend-dev.err.log'
Write-Host '停止服务: .\stop-dev.ps1'
