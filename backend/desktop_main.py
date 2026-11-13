"""桌面版（exe）启动器。

被 PyInstaller 打包成 exe 后的入口。职责：

1. 找一个**可写**的数据目录（便携模式用 exe 同级的 ``data/``，否则用 %APPDATA%）。
   数据库、密钥、日志都放这里 —— 打包后的临时解压目录每次运行都会被清掉。
2. 首次运行时把随包携带的、已经灌好内容的数据库模板复制过去。
3. 选一个空闲端口（优先 8000），把端口写进环境变量。
4. 启动 FastAPI（它同时托管前端静态站点），并自动打开浏览器。

配置文件：``<数据目录>/config.json``，可以放 MiniMax / DeepSeek 之类的可选 key，例如::

    {
      "MINIMAX_API_KEY": "sk-...",
      "MINIMAX_TTS_ENDPOINT": "https://api.minimaxi.com/v1/t2a_v2",
      "DEEPSEEK_API_KEY": "sk-..."
    }
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

APP_NAME = "PythonAdventureIsland"

# 允许通过 config.json 覆盖的环境变量
ALLOWED_CONFIG_KEYS = {
    "MINIMAX_API_KEY",
    "MINIMAX_GROUP_ID",
    "MINIMAX_TTS_ENDPOINT",
    "MINIMAX_TTS_MODEL",
    "MINIMAX_TTS_VOICE",
    "QWEN_API_KEY",
    "DASHSCOPE_API_KEY",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_API_URL",
    "DEEPSEEK_MODEL",
}

# 端口候选，按顺序试
PORT_CANDIDATES = (8000, 8001, 8002, 8123, 8765)


def force_utf8_console() -> None:
    """Windows 控制台默认代码页是 GBK，中文输出会糊成乱码。

    这里把控制台切到 UTF-8，并重配 stdout/stderr 的编码。
    """
    if os.name == "nt":
        try:
            import ctypes

            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
            ctypes.windll.kernel32.SetConsoleCP(65001)
        except Exception:
            pass

    for stream in (sys.stdout, sys.stderr):
        try:
            # line_buffering：重定向到文件时 stdout 是全缓冲的，
            # 不加的话启动横幅会一直卡在缓冲区里看不到。
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:
            pass


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_dir() -> Path:
    """exe 所在目录（打包后）或 backend 目录（源码运行）。"""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def resource_dir() -> Path:
    """只读资源目录：打包后是 PyInstaller 的临时解压目录。"""
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", app_dir()))
    return app_dir()


def resolve_data_dir() -> Path:
    """找一个可写的数据目录。优先便携模式（exe 同级 data/）。"""
    portable = app_dir() / "data"
    try:
        portable.mkdir(parents=True, exist_ok=True)
        probe = portable / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return portable
    except Exception:
        pass

    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    target = Path(base) / APP_NAME / "data"
    target.mkdir(parents=True, exist_ok=True)
    return target


def pick_port() -> int:
    for port in PORT_CANDIDATES:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def apply_config_file(data_dir: Path) -> None:
    """读取 <数据目录>/config.json，把允许的键写进环境变量。

    首次运行时会把随包携带的模板复制过来（如果打包时带了密钥的话）。
    """
    config_path = data_dir / "config.json"
    if not config_path.is_file():
        template = resource_dir() / "seed" / "desktop-config.json"
        if template.is_file():
            shutil.copy2(template, config_path)
            print(f"[ok] 已写入配置文件: {config_path}")
        else:
            return
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[!] config.json 解析失败，已忽略: {exc}")
        return
    if not isinstance(payload, dict):
        return
    applied = 0
    for key, value in payload.items():
        if key in ALLOWED_CONFIG_KEYS and isinstance(value, str) and value.strip():
            os.environ[key] = value.strip()
            applied += 1
    if applied:
        print(f"[ok] 已从 config.json 加载 {applied} 项配置")


def ensure_secret_key(data_dir: Path) -> str:
    """密钥要能跨重启稳定存在，token 才不会一关就失效。"""
    key_path = data_dir / "secret.key"
    if key_path.is_file():
        value = key_path.read_text(encoding="utf-8").strip()
        if value:
            return value
    import secrets

    value = secrets.token_urlsafe(48)
    key_path.write_text(value, encoding="utf-8")
    try:
        key_path.chmod(0o600)
    except Exception:
        pass
    return value


def prepare_database(data_dir: Path) -> Path:
    """首次运行时把随包的模板数据库复制到数据目录。"""
    db_path = data_dir / "code_adventure.db"
    template = resource_dir() / "seed" / "code_adventure.db"
    if not db_path.exists():
        if template.is_file():
            shutil.copy2(template, db_path)
            print(f"[ok] 已初始化数据库: {db_path}")
        else:
            print(f"[!] 找不到数据库模板，将创建空库: {template}")
    return db_path


def prepare_environment(data_dir: Path, port: int) -> None:
    db_path = prepare_database(data_dir)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ["ENVIRONMENT"] = "development"
    os.environ["DEBUG"] = "false"
    os.environ["SECRET_KEY"] = ensure_secret_key(data_dir)
    os.environ["CORS_ORIGINS"] = f"http://127.0.0.1:{port},http://localhost:{port}"
    os.environ.setdefault("TYPING_DATA_DIR", str(data_dir / "typing"))
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    # 桌面版没有 Redis，缓存退化成进程内内存；单进程下没有区别
    os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/0")


def main() -> int:
    force_utf8_console()
    data_dir = resolve_data_dir()
    print("=" * 60)
    print("  编程冒险岛 · 桌面版")
    print("=" * 60)
    print(f"  数据目录: {data_dir}")

    port = pick_port()
    apply_config_file(data_dir)
    prepare_environment(data_dir, port)

    sys.path.insert(0, str(Path(__file__).resolve().parent))

    from app.desktop import mount_frontend
    from app.main import app

    web_root = resource_dir() / "web"
    mount_frontend(app, web_root, api_port=port)

    url = f"http://127.0.0.1:{port}/"
    print(f"  游戏地址: {url}")
    print("  关闭这个窗口即退出游戏。")
    print("=" * 60)

    def _open_browser() -> None:
        if os.environ.get("CODE_ADVENTURE_NO_BROWSER") == "1":
            return
        time.sleep(1.5)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=_open_browser, daemon=True).start()

    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n已退出。")
        raise SystemExit(0)
