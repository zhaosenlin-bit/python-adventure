#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 3D 打字闯关（Ursina 桌面版）打包成独立 exe。

流程：

1. 用 ``scripts/game3d.spec`` 跑 PyInstaller，产出
   ``dist/Game3DTyping/Game3DTyping.exe``；
2. 压成 ``dist/Game3DTyping-win-x64.zip``，方便发给别人；
3. 如果主程序（``dist/PythonAdventureIsland/``）已经打好了，就把桌面版
   一起拷进去 —— 这样「Python 冒险岛」里点「打开本地桌面版」就能直接用。

用法（在仓库根目录）::

    python scripts/build_game3d_exe.py

注意：打包需要装了 ursina 的 Python（``import ursina`` 能过就行）。
本脚本的输出刻意只用 ASCII 字符 —— Windows 的 GBK 控制台打印 emoji 会抛
UnicodeEncodeError，之前的打包脚本就在最后一步栽在这上面。
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DIST = REPO / "dist"
BUILD = REPO / "build"
GAME_DIR = DIST / "Game3DTyping"
ISLAND_DIR = DIST / "PythonAdventureIsland"
ZIP_PATH = DIST / "Game3DTyping-win-x64.zip"


def log(message: str) -> None:
    print(message, flush=True)


def run_pyinstaller() -> None:
    log("[1/3] Running PyInstaller for the Ursina typing quest ...")
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--distpath",
        str(DIST),
        "--workpath",
        str(BUILD / "pyinstaller_game3d"),
        str(REPO / "scripts" / "game3d.spec"),
    ]
    result = subprocess.run(command, cwd=str(REPO))
    if result.returncode != 0:
        raise SystemExit(f"PyInstaller failed with exit code {result.returncode}")


def make_zip() -> None:
    log("[2/3] Zipping ...")
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(GAME_DIR.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(DIST))
    size_mb = ZIP_PATH.stat().st_size / 1024 / 1024
    log(f"    zip: {ZIP_PATH} ({size_mb:.1f} MB)")


def copy_into_island() -> None:
    log("[3/3] Copying into the island build (if it exists) ...")
    if not ISLAND_DIR.is_dir():
        log("    island build not found, skipped")
        return
    target = ISLAND_DIR / "Game3DTyping"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(GAME_DIR, target)
    log(f"    copied to {target}")


def main() -> int:
    started = time.time()
    log("==================================================")
    log("  Build 3D typing quest desktop exe (Ursina)")
    log("==================================================")
    try:
        import ursina  # noqa: F401
    except Exception:
        log("ERROR: this Python cannot import ursina.")
        log("       Install it first: pip install -r game3d/requirements.txt")
        return 1

    run_pyinstaller()
    exe_path = GAME_DIR / "Game3DTyping.exe"
    if not exe_path.is_file():
        log(f"ERROR: {exe_path} was not produced")
        return 1
    size_mb = exe_path.stat().st_size / 1024 / 1024
    log(f"    exe: {exe_path} ({size_mb:.1f} MB)")

    make_zip()
    copy_into_island()
    log(f"Done in {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
