@echo off
REM 启动后端。端口读取 .env.local 的 NEXT_PUBLIC_API_PORT（默认 8000）。
REM 独立窗口运行，避免跟着 Codex 会话一起被回收。
chcp 65001 >nul
node "%~dp0start-backend.cjs"
pause
