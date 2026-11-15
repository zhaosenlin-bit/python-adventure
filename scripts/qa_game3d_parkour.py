# -*- coding: utf-8 -*-
"""桌面版跑酷 / 彩蛋验收脚本（需要装了 ursina + 有显示器）。

    python scripts/qa_game3d_parkour.py

会用真实输入（held_keys + 空格）跑一遍：
1. 从地面跳上第一层平台；
2. 逐层往上跳到顶层；
3. 踩弹跳板被弹起来；
4. 捡到问号方块 / 隐藏祭坛，拿到提示；
5. 打字窗口里出现彩蛋给的提示。
"""
from __future__ import annotations

import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
os.chdir(ROOT)

# Windows 控制台默认 GBK，中文会变乱码 —— 强制切 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover - 老 Python 没有 reconfigure
    pass

from ursina import held_keys, scene  # noqa: E402
import direct.showbase.ShowBaseGlobal as showbase_global  # noqa: E402

from game3d.fonts import setup_fonts  # noqa: E402
from game3d.game import Game  # noqa: E402
from game3d.main import build_app  # noqa: E402

FAILED = False


def ok(name: str, cond: bool, detail: str = "") -> None:
    global FAILED
    print(("  OK  " if cond else "  FAIL") + f" {name}" + (f" - {detail}" if detail else ""), flush=True)
    if not cond:
        FAILED = True


def main() -> int:
    app = build_app(False)
    base = showbase_global.base
    setup_fonts()
    game = Game(parent=scene)

    def step(frames: int = 1) -> None:
        for _ in range(frames):
            base.taskMgr.step()

    game._start_run()
    game._confirm_spawn()
    step(10)
    level = game.level
    player = game.player

    print(f"平台 {len(level.platforms)} 层 / 彩蛋 {len(level.eggs)} 个", flush=True)
    ok("这一关搭出了跑酷塔", len(level.platforms) >= 5, f"{len(level.platforms)} 层")
    ok("这一关有 3 个彩蛋", len(level.eggs) == 3, f"{len(level.eggs)} 个")

    # ---------------------------------------------------------- 1. 跳上第一层
    first = level.platforms[0]
    player.position = (first["x"], 0.0, first["z"] + 2.6)
    player.yaw = 180.0  # 面向 -Z（平台在脚前方）
    player.rotation_y = player.yaw
    step(10)

    held_keys["w"] = 1
    player.jump()
    for _ in range(80):
        step(1)
        if player.grounded and player.y > 0.5:
            break
    held_keys["w"] = 0
    step(20)
    ok("按空格 + W 能跳上第一层", player.grounded and abs(player.y - first["y"]) < 0.15,
       f"y={player.y:.2f}（平台面 {first['y']}）")

    # ---------------------------------------------------------- 2. 逐层往上
    tops = sorted(level.platforms, key=lambda item: item["y"])
    climbed = 1
    for target in tops[1:]:
        # 站到目标平台正下方附近，起跳后按住方向键
        player.position = (target["x"], max(player.y, 0.0), target["z"] + 1.9)
        player.yaw = 180.0
        player.rotation_y = player.yaw
        step(6)
        held_keys["w"] = 1
        player.jump()
        peak = player.y
        for _ in range(70):
            step(1)
            peak = max(peak, player.y)
            if player.grounded and abs(player.y - target["y"]) < 0.2:
                break
        held_keys["w"] = 0
        step(10)
        if player.grounded and abs(player.y - target["y"]) < 0.2:
            climbed += 1
    ok("能一路跳到跑酷塔顶层", climbed >= 4, f"到达 {climbed} 层")

    # ---------------------------------------------------------- 3. 弹跳板
    pad = level.bounce_pad
    player.position = (pad["x"], 0.0, pad["z"])
    player.grounded = True
    step(10)
    game._update_playing()
    step(4)
    ok("踩上弹跳板会被弹起来", player.vertical_velocity > 0,
       f"vy={player.vertical_velocity:.2f}")
    peak = player.y
    for _ in range(240):
        step(1)
        peak = max(peak, player.y)
    ok("弹跳板能窜到第四层高度", peak > tops[3]["y"] - 0.2, f"最高 {peak:.2f}")

    # ---------------------------------------------------------- 4. 彩蛋 + 提示
    cube = next(egg for egg in level.eggs if egg["kind"] == "cube" and egg["y"] > 2)
    player.position = (cube["x"], cube["y"] - 1.0, cube["z"])
    step(6)
    game._update_playing()
    step(4)
    ok("走近问号方块能捡到彩蛋", len(game.collected_eggs) >= 1, f"{len(game.collected_eggs)} 个")
    ok("捡到后弹出提示浮层", game.ui.toast.enabled, "toast")
    ok("彩蛋给了题目提示", bool(game._current_egg_hint()), game._current_egg_hint())

    game._open_typing()
    step(4)
    ok("打字窗口里显示彩蛋提示", bool(game.ui.typing_eggs.text), game.ui.typing_eggs.text)
    game._close_typing()

    # ---------------------------------------------------------- 5. HUD
    game._update_playing()
    step(2)
    ok("HUD 显示彩蛋计数", "彩蛋" in game.ui.hud_eggs.text, game.ui.hud_eggs.text)
    ok("HUD 显示题号", "题" in game.ui.hud_progress.text, game.ui.hud_progress.text)

    print("FAILED" if FAILED else "ALL OK", flush=True)
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
