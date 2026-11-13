@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo   编程冒险岛 · 一键启动
echo ========================================
echo.

REM ---- 选择 Python 解释器：优先使用后端虚拟环境 ----
set "PY=python"
if exist "backend\.venv\Scripts\python.exe" (
  set "PY=backend\.venv\Scripts\python.exe"
  echo [OK] 使用虚拟环境解释器: backend\.venv
) else (
  echo [WARN] 未找到 backend\.venv，将使用系统 Python。
  echo        请先在 backend 目录执行: python -m venv .venv  然后  .venv\Scripts\pip install -r requirements.txt
)
echo.

REM ---- UTF-8 模式，避免控制台打印 emoji 报 GBK 编码错误 ----
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo 1. 初始化数据库（首次运行会自动建表）...
pushd backend
"%PY%" init_db_quick.py
popd
echo.

echo 2. 启动后端服务器...
pushd backend
start "Backend Server" cmd /k "\"%PY%\" -m uvicorn app.main:app --reload --port 8000"
popd
echo    后端已启动在 http://localhost:8000
echo.

timeout /t 3 /nobreak >nul

echo 3. 启动前端...
start "Frontend Server" cmd /k "npm run dev"
echo    前端已启动在 http://localhost:3000
echo.

echo ========================================
echo   ✅ 启动完成！
echo ========================================
echo.
echo 测试账号: demo
echo 密码: 123456
echo.
echo 请在浏览器打开: http://localhost:3000
echo.
echo 按任意键关闭此窗口...
pause >nul
