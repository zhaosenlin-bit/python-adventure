"""本地桌面版启动器。

网站里的「3D 打字闯关」和「水乐园大乱斗」都是 Ursina 写的**桌面程序**
（不是网页），所以后端提供一组接口，让站内的一键按钮能把它们拉起来：

* ``GET  /api/v1/launcher/{game}`` —— 能不能启动？有没有已经在跑？
* ``POST /api/v1/launcher/{game}`` —— 启动游戏窗口

``{game}`` 目前支持：

===============  ======================  ==================================
game             对应的包                跑起来是
===============  ======================  ==================================
``3d-typing``    ``game3d/``            ``python -m game3d.main``
``aquapark``     ``aquapark/``           ``python -m aquapark.main``
===============  ======================  ==================================

安全边界：这个接口会**在本机拉起进程**，所以只允许在非生产环境使用。
线上服务器既没有显示器，也不该被任意网页拉起本地进程，
因此 ``ENVIRONMENT == "production"`` 时一律 403。

两个游戏本体都在仓库根目录里（纯追加的新包），跑起来都是
「本地窗口 + 本地存档」，不联网、不依赖后端数据。
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.config import settings

router = APIRouter()

# backend/app/api/v1/launcher.py
#   parents[0] = app/api/v1
#   parents[1] = app/api
#   parents[2] = app
#   parents[3] = backend
#   parents[4] = 项目根目录
_PROJECT_ROOT = Path(__file__).resolve().parents[4]


# --------------------------------------------------------------------- 游戏表

GAMES: dict[str, dict] = {
    "3d-typing": {
        "label": "3D 打字闯关",
        "package": "game3d",
        "module": "game3d.main",
        # 依赖的模块，用来判断本机有没有装好
        "requires": ("ursina",),
        "requirements_file": "game3d/requirements.txt",
        # 单独打包好的桌面版 exe（找不到就回退到用 Python 直接跑源码）
        "exe_dir": "Game3DTyping",
        "exe_name": "Game3DTyping.exe",
    },
    "aquapark": {
        "label": "水乐园大乱斗",
        "package": "aquapark",
        "module": "aquapark.main",
        # 水乐园还要 numpy + pillow 画程序化贴图
        "requires": ("ursina", "numpy", "PIL"),
        "requirements_file": "aquapark/requirements.txt",
    },
}


def _game_spec(game: str) -> dict:
    """取出某个游戏的配置，不认识就 404。"""
    spec = GAMES.get(game)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"没有这个桌面游戏：{game}")
    return spec


def _game_dir(spec: dict) -> Path:
    return _PROJECT_ROOT / spec["package"]


def _pid_file(spec: dict) -> Path:
    return _game_dir(spec) / f".{spec['package']}.pid"


# --------------------------------------------------------------------- 桌面版 exe
#
# 主程序（PythonAdventureIsland.exe）里没有 ursina / panda3d，
# 所以打包版必须额外带一份 Game3DTyping.exe，「打开本地桌面版」才有东西可启动。


def _exe_roots() -> list[Path]:
    """可能放着桌面版 exe 的目录，按优先级排。"""
    exe_dir = Path(sys.executable).resolve().parent
    roots = [
        exe_dir,  # 打包版：exe 与 Game3DTyping/ 平级
        exe_dir.parent,  # 上一级：dist/Game3DTyping/...
        _PROJECT_ROOT,  # 开发机：仓库根目录
        _PROJECT_ROOT / "dist",  # 开发机：dist/Game3DTyping/...
        _PROJECT_ROOT / "dist" / "PythonAdventureIsland",  # 打包好的岛 + 源码后端
    ]
    unique: list[Path] = []
    for root in roots:
        if root not in unique:
            unique.append(root)
    return unique


def _find_exe(spec: dict) -> Path | None:
    """找打包好的桌面版 exe；没有就返回 None（改用 Python 跑源码）。"""
    exe_dir = spec.get("exe_dir")
    exe_name = spec.get("exe_name")
    if not exe_dir or not exe_name:
        return None

    candidates: list[Path] = []
    configured = os.environ.get("GAME3D_EXE", "").strip()
    if configured:
        candidates.append(Path(configured))
    for root in _exe_roots():
        candidates.append(root / exe_dir / exe_name)

    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def _pid_paths(spec: dict) -> list[Path]:
    """pid 文件可能出现的位置：exe 旁边优先，其次是源码目录。"""
    name = f".{spec['package']}.pid"
    paths: list[Path] = []
    exe = _find_exe(spec)
    if exe is not None:
        paths.append(exe.parent / name)
    paths.append(_game_dir(spec) / name)
    return paths


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


def _read_pid(spec: dict) -> int | None:
    """从 pid 文件里读出上一次启动的游戏进程号。"""
    for path in _pid_paths(spec):
        try:
            pid = int(path.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            continue
        if _pid_alive(pid):
            return pid
    return None


def _interpreter_candidates() -> list[str]:
    """可能装得下依赖的 Python 解释器，按优先级排。"""
    candidates: list[str] = []

    # 1) 显式指定（部署到别的机器时用得上）
    configured = (
        os.environ.get("GAME_PYTHON", "").strip()
        or os.environ.get("GAME3D_PYTHON", "").strip()
    )
    if configured:
        candidates.append(configured)

    # 2) 跑后端的这个解释器（如果它装了依赖）
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


def _has_requirements(interpreter: str, requires: tuple[str, ...]) -> bool:
    """这个解释器能不能 import 齐依赖。"""
    snippet = "import " + ", ".join(requires)
    try:
        result = subprocess.run(
            [interpreter, "-c", snippet],
            capture_output=True,
            timeout=40,
            creationflags=_no_window_flag(),
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


# 解释器探测结果缓存：``import ursina`` 要十几秒，
# 不能每次请求都重新探一遍。
_INTERPRETER_CACHE: dict[tuple[str, ...], tuple[str | None, str]] = {}


def _find_interpreter(spec: dict) -> tuple[str | None, str]:
    """挑一个装齐依赖的解释器，返回 (路径, 说明)。"""
    requires = spec["requires"]
    cached = _INTERPRETER_CACHE.get(requires)
    if cached is not None:
        return cached

    for candidate in _interpreter_candidates():
        if _has_requirements(candidate, requires):
            _INTERPRETER_CACHE[requires] = (candidate, "")
            return _INTERPRETER_CACHE[requires]

    missing = "、".join(requires)
    _INTERPRETER_CACHE[requires] = (
        None,
        f"找不到装有 {missing} 的 Python。请先执行："
        f"pip install -r {spec['requirements_file']}",
    )
    return _INTERPRETER_CACHE[requires]


def _no_window_flag() -> int:
    """Windows 下不要弹出黑框；其它平台返回 0。"""
    if os.name != "nt":
        return 0
    # CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS
    return 0x00000200 | 0x00000008


def _game_available(spec: dict) -> tuple[bool, str]:
    """游戏本体和依赖是否就绪。"""
    # 打包好的桌面版 exe 自带依赖，不用再找解释器
    if _find_exe(spec) is not None:
        return True, ""
    package = spec["package"]
    if not (_game_dir(spec) / "main.py").is_file():
        return False, f"找不到游戏目录：{_game_dir(spec)}"
    interpreter, reason = _find_interpreter(spec)
    if not interpreter:
        return False, reason
    return True, ""


# --------------------------------------------------------------------- 接口


@router.get("/{game}")
async def get_launcher_status(game: str) -> dict:
    """某个桌面游戏能不能启动 / 有没有已经在运行。"""
    if not _is_local_environment():
        raise HTTPException(status_code=403, detail="线上环境不提供本地桌面版启动")

    spec = _game_spec(game)
    pid = _read_pid(spec)
    available, reason = _game_available(spec)
    return {
        "game": game,
        "label": spec["label"],
        "available": available,
        "reason": reason,
        "running": pid is not None,
        "pid": pid,
    }


@router.post("/{game}")
async def launch_game(game: str) -> dict:
    """启动桌面游戏窗口（已经开着就直接返回）。"""
    if not _is_local_environment():
        raise HTTPException(status_code=403, detail="线上环境不提供本地桌面版启动")

    spec = _game_spec(game)
    existing = _read_pid(spec)
    if existing is not None:
        return {
            "game": game,
            "started": False,
            "already_running": True,
            "pid": existing,
        }

    available, reason = _game_available(spec)
    if not available:
        raise HTTPException(status_code=503, detail=reason)

    exe = _find_exe(spec)
    if exe is not None:
        # 打包好的桌面版：直接跑 exe，工作目录放在 exe 旁边（它要读旁边的 _internal）
        command = [str(exe)]
        working_dir = exe.parent
    else:
        interpreter, _ = _find_interpreter(spec)
        if interpreter is None:  # pragma: no cover - _game_available 已经拦过
            raise HTTPException(status_code=503, detail="找不到可用的 Python 解释器")
        command = [interpreter, "-m", spec["module"]]
        working_dir = _PROJECT_ROOT

    try:
        process = subprocess.Popen(
            command,
            cwd=str(working_dir),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=_no_window_flag(),
        )
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"启动失败：{error}") from error

    try:
        path = exe.parent / f".{spec['package']}.pid" if exe is not None else _pid_file(spec)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(process.pid), encoding="utf-8")
    except OSError:
        # pid 文件写不了也不影响游戏本身启动
        pass

    return {
        "game": game,
        "started": True,
        "already_running": False,
        "pid": process.pid,
    }
