# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置：编程冒险岛桌面版。

产物：dist/PythonAdventureIsland/PythonAdventureIsland.exe（onedir）
onedir 启动是秒级的；onefile 需要解压 7000+ 个资源文件，慢很多。

用法（在仓库根目录）：
    python scripts/build_exe.py
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

# SPECPATH = 本 spec 文件所在目录 (scripts/)，往上一级就是仓库根目录
REPO = Path(SPECPATH).resolve().parent
BACKEND = REPO / "backend"
STAGE = REPO / "build" / "exe"
WEB = STAGE / "web"
SEED = STAGE / "seed"
ICON = REPO / "build" / "app.ico"

# uvicorn / sqlalchemy 的动态导入，PyInstaller 静态分析看不到，需要显式声明
HIDDEN_IMPORTS = [
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.middleware",
    "uvicorn.middleware.wsgi",
    "websockets",
    "websockets.legacy.server",
    "sqlalchemy.dialects.sqlite",
    "email_validator",
    "aiosqlite",
    "anyio._backends._asyncio",
    "app.desktop",
    "app.core.cache",
    "app.core.database",
]

# passlib 通过插件机制动态加载 handler（pbkdf2_sha256 / bcrypt ...），
# 静态分析看不到，必须整包收进来。
HIDDEN_IMPORTS += collect_submodules("passlib.handlers")
HIDDEN_IMPORTS += collect_submodules("sqlalchemy.dialects")
HIDDEN_IMPORTS += [
    "passlib.handlers.pbkdf2",
    "passlib.handlers.bcrypt",
]

# 开发/测试工具链，打进包里只是白占体积
EXCLUDES = [
    "tkinter",
    "matplotlib",
    "numpy",
    "pandas",
    "PIL",
    "IPython",
    "notebook",
    "jupyter",
    "pytest",
    "_pytest",
    "hypothesis",
    "playwright",
    "setuptools._distutils",
    "sphinx",
    "sqlite3.test",
    "test",
    "unittest",
    "pydoc_data",
]


def _datas():
    entries = []
    if WEB.is_dir():
        entries.append((str(WEB), "web"))
    if SEED.is_dir():
        entries.append((str(SEED), "seed"))
    return entries


a = Analysis(
    [str(BACKEND / "desktop_main.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=_datas(),
    hiddenimports=HIDDEN_IMPORTS,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=EXCLUDES,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PythonAdventureIsland",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ICON) if ICON.is_file() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="PythonAdventureIsland",
)
