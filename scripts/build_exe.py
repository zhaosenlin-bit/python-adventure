#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把整个项目打包成一个 Windows 桌面 exe。

流程
----
1. **前端静态化**：``next build --output export``，产出纯静态站点。
   - 需要临时把 ``app/api/typing/[...path]/route.ts`` 移开：Next 的静态导出
     不允许存在 API 路由。桌面版里 ``/api/typing/*`` 由 FastAPI 直接提供
     （后端本来就有一整套等价的接口），所以移开不影响功能。
   - 顺带把 ``public/sounds.rar`` 排除掉（它是 sounds/ 的压缩副本，
     线上部署脚本也会删它），能省 26MB。
2. **准备数据库模板**：新建一个干净的库，跑一遍 seed_all 灌内容，
   再建一个 ``demo / 123456`` 账号，让打包出来的 exe 开箱即用。
3. **PyInstaller**：把后端 + 静态站点 + 数据库模板打成一个 exe。

用法::

    python scripts/build_exe.py                 # 全流程
    python scripts/build_exe.py --skip-frontend # 只重打后端（前端没改时用）
    python scripts/build_exe.py --skip-seed     # 复用上次的数据库模板
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = REPO / "backend"
BUILD = REPO / "build"
STAGE = BUILD / "exe"
WEB = STAGE / "web"
SEED = STAGE / "seed"
DIST = REPO / "dist"
VENV_PY = BACKEND / ".venv" / "Scripts" / "python.exe"


def banner(text: str) -> None:
    print()
    print("=" * 64)
    print(f"  {text}")
    print("=" * 64)


def run(cmd: list[str], cwd: Path, env: dict | None = None) -> int:
    merged = {**os.environ, **(env or {})}
    print("  $ " + " ".join(str(c) for c in cmd))
    return subprocess.run([str(c) for c in cmd], cwd=str(cwd), env=merged).returncode


# ---------------------------------------------------------------------------
# 1. 前端静态化
# ---------------------------------------------------------------------------

def build_frontend() -> None:
    banner("1/4  构建前端静态站点")

    route = BACKEND.parent / "app" / "api" / "typing" / "[...path]" / "route.ts"
    backup = route.with_suffix(".ts.bak")
    next_dir = REPO / ".next"

    if next_dir.exists():
        shutil.rmtree(next_dir, ignore_errors=True)
        print("  已清空 .next")

    moved = False
    if route.exists():
        route.rename(backup)
        moved = True
        print("  已临时移开 app/api/typing 路由（静态导出不支持 API 路由）")

    try:
        code = run(
            ["node", REPO / "node_modules" / "next" / "dist" / "bin" / "next", "build"],
            cwd=REPO,
            env={
                "NEXT_OUTPUT_EXPORT": "1",
                "BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA": "true",
                "BROWSERSLIST_IGNORE_OLD_DATA": "true",
            },
        )
    finally:
        if moved and backup.exists():
            backup.rename(route)
            print("  已还原 app/api/typing 路由")

    if code != 0:
        raise SystemExit("前端构建失败")

    out = REPO / "out"
    if not (out / "index.html").is_file():
        raise SystemExit("没有生成 out/index.html，静态导出异常")

    if WEB.exists():
        shutil.rmtree(WEB, ignore_errors=True)
    WEB.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(out, WEB)

    # sounds.rar 是 sounds/ 的压缩副本，线上部署也会删
    rar = WEB / "sounds.rar"
    if rar.is_file():
        rar.unlink()
        print("  已排除 sounds.rar")

    size = sum(p.stat().st_size for p in WEB.rglob("*") if p.is_file()) / 1024 / 1024
    print(f"  静态站点就绪: {WEB}  ({size:.1f} MB)")


# ---------------------------------------------------------------------------
# 2. 数据库模板
# ---------------------------------------------------------------------------

def build_seed_db() -> None:
    banner("2/4  准备数据库模板")

    if SEED.exists():
        shutil.rmtree(SEED, ignore_errors=True)
    SEED.mkdir(parents=True, exist_ok=True)
    db_path = SEED / "code_adventure.db"

    env = {
        "DATABASE_URL": f"sqlite:///{db_path.as_posix()}",
        "ENVIRONMENT": "development",
        "DEBUG": "false",
        "SECRET_KEY": "desktop-build-template-secret-key-not-used-in-production",
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
    }

    if run([VENV_PY, "init_db_quick.py"], cwd=BACKEND, env=env) != 0:
        raise SystemExit("建表失败")
    if run([VENV_PY, "seed_all.py"], cwd=BACKEND, env=env) != 0:
        raise SystemExit("内容灌入失败")

    # 建一个开箱即用的测试账号
    create_demo_user(db_path)
    write_desktop_config()
    print(f"  数据库模板就绪: {db_path}  ({db_path.stat().st_size / 1024 / 1024:.1f} MB)")


SECRET_ENV_KEYS = {
    "MINIMAX_API_KEY",
    "MINIMAX_GROUP_ID",
    "MINIMAX_TTS_ENDPOINT",
    "MINIMAX_TTS_MODEL",
    "MINIMAX_TTS_VOICE",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_API_URL",
    "DEEPSEEK_MODEL",
}


def write_desktop_config() -> None:
    """把 backend/.env 里的可选 key 抽出来，随包带走。

    exe 首次启动时会把它复制到数据目录的 config.json，用户可以随时改。
    """
    env_path = BACKEND / ".env"
    if not env_path.is_file():
        print("  没有 backend/.env，跳过打包可选密钥")
        return

    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key in SECRET_ENV_KEYS and value:
            values[key] = value

    if not values:
        print("  backend/.env 里没有可打包的可选密钥")
        return

    target = SEED / "desktop-config.json"
    target.write_text(json.dumps(values, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  已打包 {len(values)} 项可选密钥到 desktop-config.json")


def create_demo_user(db_path: Path) -> None:
    script = """
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath('desktop_main.py')))
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.user import User

db = SessionLocal()
try:
    if not db.query(User).filter(User.username == 'demo').first():
        # 满级：区域是按等级解锁的（新手村 lv1 → 编程圣地 lv50），
        # 打包版本给的是「能逛全图」的演示账号。
        db.add(User(username='demo', email='demo@example.com',
                   password_hash=get_password_hash('123456'),
                   level=50, experience=3000, coins=500))
        db.commit()
        print('  已创建测试账号 demo / 123456')
finally:
    db.close()
"""
    tmp = BACKEND / "_build_demo_user.py"
    tmp.write_text(script, encoding="utf-8")
    try:
        run(
            [VENV_PY, tmp.name],
            cwd=BACKEND,
            env={
                "DATABASE_URL": f"sqlite:///{db_path.as_posix()}",
                "ENVIRONMENT": "development",
                "SECRET_KEY": "desktop-build-template-secret-key-not-used-in-production",
                "PYTHONUTF8": "1",
            },
        )
    finally:
        tmp.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# 3. 图标
# ---------------------------------------------------------------------------

def build_icon() -> None:
    """把 logo11.png 包成 .ico（Vista 以后允许 ICO 里直接放 PNG）。"""
    banner("3/4  生成 exe 图标")
    source = REPO / "logo11.png"
    target = BUILD / "app.ico"
    target.parent.mkdir(parents=True, exist_ok=True)

    if not source.is_file():
        print(f"  找不到 {source.name}，跳过图标")
        return

    png = source.read_bytes()
    # PNG 尺寸从 IHDR 里取
    width, height = struct.unpack(">II", png[16:24])
    # ICO 里存的是 0 表示 256
    entry_w = 0 if width >= 256 else width
    entry_h = 0 if height >= 256 else height

    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack(
        "<BBBBHHII",
        entry_w, entry_h, 0, 0, 1, 32, len(png), 6 + 16,
    )
    target.write_bytes(header + entry + png)
    print(f"  图标就绪: {target}  ({width}x{height})")


# ---------------------------------------------------------------------------
# 4. PyInstaller
# ---------------------------------------------------------------------------

def run_pyinstaller() -> None:
    banner("4/4  PyInstaller 打包")
    if DIST.exists():
        shutil.rmtree(DIST, ignore_errors=True)

    code = run(
        [
            VENV_PY, "-m", "PyInstaller",
            "--noconfirm",
            "--clean",
            "--distpath", str(DIST),
            "--workpath", str(BUILD / "pyinstaller"),
            str(REPO / "scripts" / "python_adventure.spec"),
        ],
        cwd=REPO,
    )
    if code != 0:
        raise SystemExit("PyInstaller 打包失败")

    exe = DIST / "PythonAdventureIsland" / "PythonAdventureIsland.exe"
    if not exe.is_file():
        raise SystemExit(f"没有生成 exe: {exe}")

    total = sum(p.stat().st_size for p in exe.parent.rglob("*") if p.is_file())
    print()
    print(f"  产物: {exe}")
    print(f"  总大小: {total / 1024 / 1024:.1f} MB")


def make_zip() -> None:
    """打一个分发用的 zip。

    里面大部分是 mp3/png 这类已经压缩过的素材，再用 deflate 压一遍
    基本压不动，所以用 ZIP_STORED —— 快很多，体积也差不多。
    """
    import zipfile

    source = DIST / "PythonAdventureIsland"
    target = DIST / "PythonAdventureIsland-win-x64.zip"
    print(f"  正在打包 {target.name} ...")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                zf.write(path, Path(source.name) / path.relative_to(source))
    print(f"  完成: {target}  ({target.stat().st_size / 1024 / 1024:.1f} MB)")


def main() -> int:
    parser = argparse.ArgumentParser(description="打包 Windows 桌面版 exe")
    parser.add_argument("--skip-frontend", action="store_true", help="复用上次的静态站点")
    parser.add_argument("--skip-seed", action="store_true", help="复用上次的数据库模板")
    args = parser.parse_args()

    started = time.time()
    if not args.skip_frontend:
        build_frontend()
    else:
        print("  (跳过前端构建)")

    if not args.skip_seed:
        build_seed_db()
    else:
        print("  (跳过数据库模板)")

    build_icon()
    run_pyinstaller()
    make_zip()

    print()
    print(f"  ✅ 全部完成，用时 {time.time() - started:.0f}s")
    print(f"  双击 {DIST / 'PythonAdventureIsland' / 'PythonAdventureIsland.exe'} 即可运行")
    print("  数据目录: exe 同级的 data/（不可写时自动改用 %APPDATA%）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
