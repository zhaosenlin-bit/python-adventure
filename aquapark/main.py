"""Aquapark.io 复刻 · 启动入口。

在项目根目录（python-adventure/）下运行::

    python -m aquapark.main              # 窗口模式 1280x720
    python -m aquapark.main --fullscreen # 全屏

也可以直接跑脚本（会自动把包根目录加进 sys.path）::

    python aquapark/main.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from ursina import Ursina, scene, window
from ursina import application

# Ursina 默认把「脚本所在目录」当资源目录，每次加载内置模型都会去递归扫描一遍。
# 那个目录里如果有失效的临时子目录，扫描会直接抛异常，所以指到本包目录。
application.asset_folder = Path(__file__).parent

try:  # 正常以 ``python -m aquapark.main`` 启动
    from . import config
    from .fonts import setup_fonts
    from .game import Game
except ImportError:  # pragma: no cover - 直接 ``python aquapark/main.py`` 启动
    import os

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from aquapark import config
    from aquapark.fonts import setup_fonts
    from aquapark.game import Game


def _icon_path() -> str:
    """窗口图标（打包时由 build_aquapark_exe.py 生成）。"""
    icon = Path(__file__).parent / "assets" / "aquapark.ico"
    return str(icon) if icon.is_file() else "textures/ursina.ico"


def build_app(fullscreen: bool = False) -> Ursina:
    """创建 Ursina 窗口。"""
    app = Ursina(
        title=config.APP_TITLE,
        icon=_icon_path(),
        borderless=config.WINDOW_BORDERLESS,
        fullscreen=fullscreen,
        size=config.WINDOW_SIZE,
        vsync=config.VSYNC,
        development_mode=False,
        show_ursina_splash=False,
    )
    # development_mode=False 时 Ursina 会强制全屏，这里按需要切回窗口模式
    if not fullscreen:
        window.fullscreen = False
        window.center_on_screen()
    return app


def main(argv: list | None = None) -> int:
    """游戏主入口。"""
    argv = list(sys.argv[1:] if argv is None else argv)
    fullscreen = "--fullscreen" in argv

    app = build_app(fullscreen)

    # 字体要在任何 Text 实体创建之前初始化（没有中文字体时自动切英文文案）
    setup_fonts()

    game = Game(parent=scene)

    # 把按钮接到游戏状态机上
    game.ui.menu_button.on_click = game.on_start
    game.ui.result_again.on_click = game.on_restart
    game.ui.result_menu.on_click = game.on_menu

    app.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
