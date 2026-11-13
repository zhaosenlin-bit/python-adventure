"""3D 打字闯关 · Ursina 子包。

这是一个完全独立的 3D 打字闯关游戏，玩法参考 Poki 的《The Pillar》：

    探索 → 答题 → 开门 → 进入下一关

不依赖 Next.js 前端，也不依赖 FastAPI 后端，纯本地运行、不联网。

启动方式（在项目根目录 ``python-adventure`` 下）::

    python -m game3d.main

本文件刻意不导入 Ursina，这样 ``game3d.questions``（每日题库）这类纯逻辑
模块可以在没有图形环境的机器上被单元测试直接导入。
"""

__all__ = ["config", "fonts", "game", "level", "player", "questions", "ui"]
__version__ = "1.0.0"
