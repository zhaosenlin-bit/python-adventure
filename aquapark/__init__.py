"""Aquapark.io 复刻 · 水乐园大乱斗

一个独立运行的 Python 桌面小游戏，玩法参考 Poki 上的《Aquapark.io》（Voodoo 制作）：

    从巨型水滑梯顶部出发，和 AI 选手同场竞速
    —— 游泳加速、踩水柱腾空、在空中俯冲把对手撞出水面淘汰
    —— 谁先冲到底，谁就是冠军

* 引擎：Python + `Ursina <https://www.ursinaengine.org/>`_（底层是 Panda3D / OpenGL）
* 完全离线运行，**不联网、不依赖后端、不依赖外部模型或贴图**
  （滑梯、角色、水花全部是程序化生成）
* 与同仓库的 Next.js + FastAPI 主工程**完全解耦**：本目录是纯追加的新包，
  原有代码一行未改
"""

__all__ = ["config", "track", "physics", "racer", "effects", "ui", "game"]
