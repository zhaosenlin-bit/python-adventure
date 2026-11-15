"""彩蛋与跑酷塔布局的单元测试。

这一层是纯 Python 逻辑，**不需要 Ursina / 显卡**，所以在任何机器上都能跑：

    python -m pytest game3d/tests -q          # 有 pytest 时
    python game3d/tests/test_eggs.py          # 没装 pytest 时直接跑
"""

from __future__ import annotations

import os
import sys

# 允许直接 `python game3d/tests/test_eggs.py` 运行
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from game3d import config, eggs  # noqa: E402


def _jump_apex() -> float:
    """一次跳跃能达到的最高点。"""
    return config.PLAYER_JUMP_VELOCITY ** 2 / (2 * config.PLAYER_GRAVITY_ACCEL)


def _bounce_apex() -> float:
    """弹跳板能达到的最高点。"""
    return config.BOUNCE_PAD_FORCE ** 2 / (2 * config.PLAYER_GRAVITY_ACCEL)


def test_egg_text_is_stable_for_the_same_seed() -> None:
    """同一个 (日期, 关卡, 编号) 永远得到同一句 —— 当天固定。"""
    first = eggs.pick_egg_text(20261115, 0, 1, eggs.EGG_KIND_CUBE)
    second = eggs.pick_egg_text(20261115, 0, 1, eggs.EGG_KIND_CUBE)
    assert first == second


def test_egg_text_changes_across_days() -> None:
    """跨天自动换新（不会永远同一句）。"""
    picked = {eggs.pick_egg_text(20261101 + day, 0, 0, eggs.EGG_KIND_CUBE)[0] for day in range(30)}
    assert len(picked) > 1, "30 天里文案一次都没变"


def test_egg_text_comes_from_the_right_pool() -> None:
    """普通方块和祭坛各用各的文案池。"""
    for egg_id in range(5):
        cube_zh, _ = eggs.pick_egg_text(20261115, 2, egg_id, eggs.EGG_KIND_CUBE)
        altar_zh, _ = eggs.pick_egg_text(20261115, 2, egg_id, eggs.EGG_KIND_ALTAR)
        assert cube_zh in eggs.EGG_TEXTS
        assert altar_zh in eggs.ALTAR_TEXTS


def test_egg_text_has_chinese_and_english() -> None:
    """中英文两套文案都要有，不能一边缺。"""
    assert len(eggs.EGG_TEXTS) == len(eggs.EGG_TEXTS_EN)
    assert len(eggs.ALTAR_TEXTS) == len(eggs.ALTAR_TEXTS_EN)
    assert len(eggs.EGG_TEXTS) >= 10
    assert len(eggs.ALTAR_TEXTS) >= 5


def test_cube_egg_hint_reveals_first_character() -> None:
    """普通彩蛋只透露第一个字符。"""
    zh, en = eggs.egg_hint("volcano", eggs.EGG_KIND_CUBE)
    assert "v" in zh
    assert "v" in en


def test_altar_egg_hint_reveals_half() -> None:
    """祭坛彩蛋透露一半。"""
    zh, en = eggs.egg_hint("volcano", eggs.EGG_KIND_ALTAR)
    assert "volc" in zh
    assert "volc" in en


def test_egg_hint_handles_empty_target() -> None:
    """题目为空时不要崩。"""
    assert eggs.egg_hint("", eggs.EGG_KIND_CUBE) == ("", "")
    assert eggs.egg_hint("   ", eggs.EGG_KIND_ALTAR) == ("", "")


def test_parkour_layout_has_platforms_and_eggs() -> None:
    """跑酷塔至少 5 层，彩蛋 3 个（2 个问号 + 1 个祭坛）。"""
    layout = eggs.parkour_layout(0, 26.0, 30.0)
    assert len(layout["platforms"]) >= 5
    assert len(layout["eggs"]) == 3
    assert sum(1 for egg in layout["eggs"] if egg["kind"] == eggs.EGG_KIND_ALTAR) == 1
    assert "pad" in layout


def test_parkour_levels_are_jumpable() -> None:
    """层高差不能超过一次跳跃能达到的高度。"""
    layout = eggs.parkour_layout(0, 26.0, 30.0)
    tops = sorted(platform["y"] for platform in layout["platforms"])
    gaps = [b - a for a, b in zip(tops, tops[1:])]
    for gap in gaps:
        assert gap <= _jump_apex() + 0.01, f"层高差 {gap} 跳不上去（最高只能到 {_jump_apex():.2f}）"


def test_bounce_pad_can_reach_the_fourth_platform() -> None:
    """弹跳板要能把玩家直接送到第四层附近。"""
    layout = eggs.parkour_layout(0, 26.0, 30.0)
    tops = sorted(platform["y"] for platform in layout["platforms"])
    assert _bounce_apex() >= tops[3] - 0.1, "弹跳板够不到第四层"


def test_parkour_stays_inside_the_room() -> None:
    """塔和彩蛋都要在房间范围内，不能卡进墙里。"""
    width, depth = 30.0, 34.0
    layout = eggs.parkour_layout(3, width, depth)
    for platform in layout["platforms"]:
        assert abs(platform["x"]) < width / 2 - 1.0
        assert abs(platform["z"]) < depth / 2 - 1.0
    for egg in layout["eggs"]:
        assert abs(egg["x"]) < width / 2
        assert abs(egg["z"]) < depth / 2
    pad = layout["pad"]
    assert abs(pad["x"]) < width / 2
    assert abs(pad["z"]) < depth / 2


def test_parkour_layout_is_deterministic() -> None:
    """同一关的布局每次都一样。"""
    first = eggs.parkour_layout(2, 26.0, 30.0)
    second = eggs.parkour_layout(2, 26.0, 30.0)
    assert first["platforms"] == second["platforms"]
    assert first["eggs"] == second["eggs"]


def test_nearest_egg_skips_collected_ones() -> None:
    """已经捡走的彩蛋不再被选中。"""
    items = [
        {"id": 0, "kind": "cube", "x": 0.0, "y": 0.0, "z": 0.0, "collected": False},
        {"id": 1, "kind": "cube", "x": 0.5, "y": 0.0, "z": 0.0, "collected": False},
    ]
    found = eggs.nearest_egg(items, (0.0, 0.0, 0.0), 2.0)
    assert found is not None and found["id"] == 0
    items[0]["collected"] = True
    found = eggs.nearest_egg(items, (0.0, 0.0, 0.0), 2.0)
    assert found is not None and found["id"] == 1
    items[1]["collected"] = True
    assert eggs.nearest_egg(items, (0.0, 0.0, 0.0), 2.0) is None


def test_egg_keys_are_unique_across_levels() -> None:
    """每一关都有编号相同的彩蛋，统计时不能撞车。"""
    first = eggs.egg_key("cube", 0, 0)
    second = eggs.egg_key("cube", 0, 1)
    assert first != second


def test_nearest_egg_respects_radius() -> None:
    """太远了不捡。"""
    items = [{"id": 0, "kind": "cube", "x": 10.0, "y": 0.0, "z": 0.0}]
    assert eggs.nearest_egg(items, (0.0, 0.0, 0.0), 2.0) is None


if __name__ == "__main__":  # 手动运行
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    # Windows 控制台默认 GBK，中文会变乱码 —— 强制切 UTF-8
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover - 老 Python 没有 reconfigure
        pass
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS  {test.__name__}")
        except AssertionError as error:
            failed += 1
            print(f"FAIL  {test.__name__}: {error}")
    print(f"\n{len(tests) - failed}/{len(tests)} 通过")
    raise SystemExit(1 if failed else 0)

