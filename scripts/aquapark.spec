# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置：水乐园大乱斗（Ursina 桌面版）。

产物：dist/AquaparkIO/AquaparkIO.exe（onedir）

用法（在仓库根目录）::

    python scripts/build_aquapark_exe.py

为什么要单独打一个 exe：
主程序（PythonAdventureIsland.exe）里没有 ursina / panda3d，
所以打包版里的「启动本地桌面游戏」按钮跑不起水乐园。
和 3D 打字闯关一样，单独打一份 exe，两个程序互不依赖，谁都不用装 Python。
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

# SPECPATH = 本 spec 文件所在目录 (scripts/)，往上一级就是仓库根目录
REPO = Path(SPECPATH).resolve().parent
ICON = REPO / "aquapark" / "assets" / "aquapark.ico"

# panda3d 的 dll / pyd 全都躺在包目录里，而且是运行时 LoadLibrary 加载的，
# PyInstaller 的静态分析看不见，必须显式收进来（漏一个就起不来窗口）。
BINARIES = collect_dynamic_libs("panda3d")

# panda3d 的模型 / 字体资源，以及 ursina 自带的模型、贴图、着色器
DATAS = collect_data_files("panda3d") + collect_data_files("ursina")

# panda3d 的子模块（core / direct / egg / physics ...）和 ursina 的模块
# 都是动态导入的，静态分析同样看不见。
HIDDEN_IMPORTS = collect_submodules("panda3d") + collect_submodules("ursina") + [
    "aquapark",
    "aquapark.collection",
    "aquapark.config",
    "aquapark.effects",
    "aquapark.fonts",
    "aquapark.game",
    "aquapark.main",
    "aquapark.models",
    "aquapark.physics",
    "aquapark.racer",
    "aquapark.save",
    "aquapark.textures",
    "aquapark.track",
    "aquapark.ui",
    # 运行时生成水面流纹要 numpy
    "numpy",
    "PIL",
    "PIL.Image",
]

# 开发 / 测试工具链，打进包里只是白占体积
EXCLUDES = [
    "tkinter",
    "matplotlib",
    "pandas",
    "IPython",
    "notebook",
    "jupyter",
    "pytest",
    "_pytest",
    "hypothesis",
    "playwright",
    "setuptools._distutils",
    "sphinx",
    "pydoc_data",
    "test",
]


a = Analysis(
    [str(REPO / "scripts" / "aquapark_entry.py")],
    pathex=[str(REPO)],
    binaries=BINARIES,
    datas=DATAS,
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
    name="AquaparkIO",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # 窗口模式：不弹黑色控制台框
    console=False,
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
    name="AquaparkIO",
)
