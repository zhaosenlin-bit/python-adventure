"""本地桌面版启动器。

网站里的「3D 打字闯关」是 Ursina 写的**桌面程序**（不是网页），
所以后端提供两个接口，让主界面的一键按钮能把它拉起来：

* ``GET  /api/v1/launcher/3d-typing`` —— 能不能启动？有没有已经在跑？
* ``POST /api/v1/launcher/3d-typing`` —— 启动游戏窗口

安全边界：这个接口会**在本机拉起进程**，所以只允许在非生产环境使用。
线上服务器既没有显示器，也不该被任意网页拉起本地进程，
因此 ``ENVIRONMENT == "production"`` 时一律 403。

游戏本体在仓库根目录的 ``game3d/`` 里（纯追加的新包），
跑起来是 ``python -m game3d.main``。
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.config import settings

router = APIRouter()

# game3d/main.py 相对于本文件的路径：backend/app/api/v1/launcher.py
#   parents[0] = app/api/v1
#   parents[1] = app/api
#   parents[2] = app
#   parents[3] = backend
#   parents[4] = 项目根目录
_PROJECT_ROOT = Path(__file__).resolve().parents[4]
_GAME_DIR = _PROJECT_ROOT / "game3d"
_PID_FILE = _GAME_DIR / ".game3d.pid"


# --------------------------------------------------------------------- 工具


def _is_local_environment() -> bool:
    """线上（production）不允许拉起本地进程。"""
    return settings.ENVIRONMENT.lower() != "production"


def _pid_alive(pid: int) -> bool:
    """判断一个 pid 是否还活着（跨平台）。"""
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            # PROCESS_QUERY_LIMITED_INFORMATION
            handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
            if not handle:
                return False
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        except Exception:  # pragma: no cover - 不同 Windows 版本 API 差异
            return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _read_pid() -> int | None:
    """从 pid 文件里读出上一次启动的游戏进程号。"""
    try:
        pid = int(_PID_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    return pid if _pid_alive(pid) else None


def _interpreter_candidates() -> list[str]:
    """可能装得下 ursina 的 Python 解释器，按优先级排。"""
    candidates: list[str] = []

    # 1) 显式指定（部署到别的机器时用得上）
    configured = os.environ.get("GAME3D_PYTHON", "").strip()
    if configured:
        candidates.append(configured)

    # 2) 跑后端的这个解释器（如果它装了 ursina）
    candidates.append(sys.executable)

    # 3) PATH 上的 python
    for name in ("python", "python3"):
        found = _which(name)
        if found:
            candidates.append(found)

    # 去重并保持顺序
    unique: list[str] = []
    for item in candidates:
        if item and item not in unique:
            unique.append(item)
    return unique


def _which(name: str) -> str | None:
    from shutil import which

    return which(name)


def _has_ursina(interpreter: str) -> bool:
    """这个解释器能不能 import ursina。"""
    try:
        result = subprocess.run(
            [interpreter, "-c", "import ursina"],
            capture_output=True,
            timeout=25,
            creationflags=_no_window_flag(),
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


# 解释器探测结果缓存：``import ursina`` 要十几秒，
# 不能每次请求都重新探一遍。
_INTERPRETER_CACHE: tuple[str | None, str] | None = None


def _find_interpreter() -> tuple[str | None, str]:
    """挑一个装了 ursina 的解释器，返回 (路径, 说明)。"""
    global _INTERPRETER_CACHE
    if _INTERPRETER_CACHE is not None:
        return _INTERPRETER_CACHE

    for candidate in _interpreter_candidates():
        if _has_ursina(candidate):
            _INTERPRETER_CACHE = (candidate, "")
            return _INTERPRETER_CACHE

    _INTERPRETER_CACHE = (
        None,
        "找不到装有 ursina 的 Python。请先执行："
        "pip install -r game3d/requirements.txt",
    )
    return _INTERPRETER_CACHE


def _no_window_flag() -> int:
    """Windows 下不要弹出黑框；其它平台返回 0。"""
    if os.name != "nt":
        return 0
    # CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS
    return 0x00000200 | 0x00000008


def _game_available() -> tuple[bool, str]:
    """游戏本体和依赖是否就绪。"""
    if not (_GAME_DIR / "main.py").is_file():
        return False, f"找不到游戏目录：{_GAME_DIR}"
    interpreter, reason = _find_interpreter()
    if not interpreter:
        return False, reason
    return True, ""


# --------------------------------------------------------------------- 接口


@router.get("/3d-typing")
async def get_3d_typing_status() -> dict:
    """3D 打字闯关能不能启动 / 有没有已经在运行。"""
    if not _is_local_environment():
        raise HTTPException(status_code=403, detail="线上环境不提供本地桌面版启动")

    pid = _read_pid()
    available, reason = _game_available()
    return {
        "available": available,
        "reason": reason,
        "running": pid is not None,
        "pid": pid,
    }


@router.post("/3d-typing")
async def launch_3d_typing() -> dict:
    """启动 3D 打字闯关的桌面窗口（已经开着就直接返回）。"""
    if not _is_local_environment():
        raise HTTPException(status_code=403, detail="线上环境不提供本地桌面版启动")

    existing = _read_pid()
    if existing is not None:
        return {"started": False, "already_running": True, "pid": existing}

    available, reason = _game_available()
    if not available:
        raise HTTPException(status_code=503, detail=reason)

    interpreter, _ = _find_interpreter()
    if interpreter is None:  # pragma: no cover - _game_available 已经拦过
        raise HTTPException(status_code=503, detail="找不到可用的 Python 解释器")

    try:
        process = subprocess.Popen(
            [interpreter, "-m", "game3d.main"],
            cwd=str(_PROJECT_ROOT),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=_no_window_flag(),
        )
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"启动失败：{error}") from error

    try:
        _PID_FILE.parent.mkdir(parents=True, exist_ok=True)
        _PID_FILE.write_text(str(process.pid), encoding="utf-8")
    except OSError:
        # pid 文件写不了也不影响游戏本身启动
        pass

    return {"started": True, "already_running": False, "pid": process.pid}
