"""3D 打字闯关 · 启动入口。

在项目根目录（``python-adventure``）下运行::

    python -m game3d.main              # 窗口模式 1280x720
    python -m game3d.main --fullscreen # 全屏

也可以直接跑脚本（会自动把包根目录加进 sys.path）::

    python game3d/main.py
"""

from __future__ import annotations

import sys

from ursina import Ursina, scene, window

try:  # 正常以 ``python -m game3d.main`` 启动
    from . import config
    from .fonts import setup_fonts
    from .game import Game
except ImportError:  # pragma: no cover - 直接 ``python game3d/main.py`` 启动
    import os

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from game3d import config
    from game3d.fonts import setup_fonts
    from game3d.game import Game


def build_app(fullscreen: bool = False) -> Ursina:
    """创建 Ursina 窗口。"""
    app = Ursina(
        title=config.APP_TITLE,
        borderless=config.WINDOW_BORDERLESS,
        fullscreen=fullscreen,
        size=config.WINDOW_SIZE,
        vsync=config.VSYNC,
        development_mode=False,
    )
    # development_mode=False 时 Ursina 会强制全屏，这里按需要切回窗口模式
    if not fullscreen:
        window.fullscreen = False
        window.center_on_screen()
    return app


def main(argv: list[str] | None = None) -> int:
    """游戏主入口。"""
    argv = list(sys.argv[1:] if argv is None else argv)
    fullscreen = "--fullscreen" in argv

    app = build_app(fullscreen=fullscreen)

    # 字体要在任何 Text 实体创建之前初始化（没有中文字体时自动切英文文案）
    setup_fonts()

    # Game 继承自 Entity，引擎会自动调用它的 update() / input() / text_input()
    game = Game(parent=scene)

    app.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
