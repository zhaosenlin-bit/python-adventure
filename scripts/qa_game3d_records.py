# -*- coding: utf-8 -*-
"""桌面版「本地存档 + 排行榜」验收脚本（需要装了 ursina + 有显示器）。

    python scripts/qa_game3d_records.py

跑一遍真实流程：
1. 打完一局 -> 结算页把战绩写进本机 JSON 存档；
2. 再打一局 -> 排行榜按「正确率降序 + 用时升序」重排；
3. 大厅里打开「本机排行榜」-> 榜单面板有内容、能返回；
4. 存档文件损坏 -> 自动退回「还没有战绩」，不崩。
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
os.chdir(ROOT)

# Windows 控制台默认 GBK，中文会变乱码 —— 强制切 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover - 老 Python 没有 reconfigure
    pass

from ursina import scene  # noqa: E402
import direct.showbase.ShowBaseGlobal as showbase_global  # noqa: E402

from game3d import records as records_module  # noqa: E402
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

    # 存档写到临时目录，别污染仓库
    tmp_dir = tempfile.mkdtemp(prefix="game3d_records_")
    save_file = Path(tmp_dir) / records_module.RECORDS_NAME
    records_module.records_path = lambda: save_file  # type: ignore[assignment]

    game = Game(parent=scene)

    def step(frames: int = 1) -> None:
        for _ in range(frames):
            base.taskMgr.step()

    # ---------------------------------------------------------- 1. 第一局
    game._start_run()
    total = len(game.questions)
    ok("当天题目已经生成", total >= 20, f"{total} 题")
    game.correct = 5
    game.total_time = 42.0
    game.collected_eggs = {"a", "b"}
    game._goto_result()
    step(4)

    ok("结算页弹出", game.ui.result.enabled)
    ok("结算页显示正确数", "5" in game.ui.result_stats.text, game.ui.result_stats.text.replace("\n", " / "))
    ok("结算页显示彩蛋数", "2" in game.ui.result_stats.text)
    ok("存档文件已写盘", save_file.is_file(), str(save_file))
    stored = records_module.load_records()
    ok("存档里有 1 条战绩", len(stored) == 1, f"{len(stored)} 条")
    ok("存档记的是今天", stored and stored[0].date == records_module.today_str(), stored[0].date if stored else "-")
    ok("存档记了彩蛋数", stored and stored[0].eggs == 2, str(stored[0].eggs if stored else "-"))

    # ---------------------------------------------------------- 2. 第二局（更好）
    game._start_run()
    game.correct = total
    game.total_time = 30.0
    game.collected_eggs = {"a", "b", "c"}
    game._goto_result()
    step(4)

    stored = records_module.load_records()
    ok("存档里有 2 条战绩", len(stored) == 2, f"{len(stored)} 条")
    ok("排行榜把更好的排前面", stored[0].correct == total, f"{stored[0].correct}/{stored[0].total}")
    ok("结算页显示今日最佳", "最佳" in game.ui.result_stats.text or "Best" in game.ui.result_stats.text,
       game.ui.result_stats.text.replace("\n", " / "))

    # ---------------------------------------------------------- 3. 大厅排行榜
    game._goto_menu()
    step(2)
    ok("大厅有「本机排行榜」按钮", game.ui.menu_board.enabled)
    game._show_board()
    step(4)
    ok("排行榜面板打开", game.ui.board.enabled)
    ok("排行榜列出了战绩", "0" in game.ui.board_list.text or "1" in game.ui.board_list.text,
       game.ui.board_list.text.replace("\n", " / ")[:120])
    ok("排行榜显示今日最佳", "最佳" in game.ui.board_list.text or "Best" in game.ui.board_list.text)
    game._hide_board()
    step(4)
    ok("点返回能回到大厅", (not game.ui.board.enabled) and game.ui.menu.enabled)

    # ---------------------------------------------------------- 4. 存档坏了也不崩
    save_file.write_text("{ broken json", encoding="utf-8")
    ok("存档损坏时退回空列表", records_module.load_records() == [])
    game._show_board()
    step(4)
    ok("存档损坏时排行榜照样打开", game.ui.board.enabled)
    ok("存档损坏时显示空榜单", "没有" in game.ui.board_list.text or "No records" in game.ui.board_list.text,
       game.ui.board_list.text.replace("\n", " / ")[:80])

    # ---------------------------------------------------------- 5. 存档是合法 JSON
    save_file.write_text(json.dumps([{"date": "20260101", "correct": 1, "total": 2}]), encoding="utf-8")
    ok("合法 JSON 能读回来", len(records_module.load_records()) == 1)

    print("FAILED" if FAILED else "ALL OK", flush=True)
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
