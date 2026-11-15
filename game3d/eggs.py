"""彩蛋文案 + 跑酷塔布局（纯逻辑，不依赖 Ursina，可以直接单测）。

玩法和网页版（``lib/typing3d/eggs.ts``）保持一致：

- 空中问号方块（``cube``）：跳起来就能捡，给一个小提示 —— 揭示题目的第一个字符；
- 跑酷路线顶端的隐藏祭坛（``altar``）：得先一路跳上去，给大提示 —— 揭示题目一半。

文案按「当天日期 + 关卡 + 彩蛋编号」取，同一天固定、跨天换新。
本模块只出数据和文案，不碰任何实体，方便直接写单元测试。
"""

from __future__ import annotations

import math
import random
from typing import Optional

# --------------------------------------------------------------------- 文案

# 空中问号方块里的话：短、轻、不剧透
EGG_TEXTS = [
    "这个问号比你想象的更早就在这儿了。",
    "跳得高一点，好东西都在上面。",
    "别急着答题，先把这条路线走一遍。",
    "墙上有前辈留下的划痕，说这里曾经是食堂。",
    "你踩的这一块地板，是上个版本留下的。",
    "据说这关的柱子会自己换位置，其实不会。",
    "有人在这里练了三年打字，只为了不被门卡住。",
    "祭坛在顶上。想看的话，得跳得比别人高。",
    "找彩蛋不加分，但心情会好很多。",
    "这里的光是暖色的，所以让人想站一会儿。",
    "提示：你比你想的更接近答案。",
    "这一关的雾是昨天那场雨留下的。",
    "如果你是第一次玩，恭喜你发现了这里。",
    "别担心，掉下去也摔不疼。",
    "每个关卡都藏了一句话，今天这句是给你的。",
    "你走路的样子像在赶稿，其实是在闯关。",
    "门后面还有门，别怕，只是下一关。",
    "这条路线是给愿意多按两下空格的人准备的。",
]

EGG_TEXTS_EN = [
    "This question mark has been here longer than you think.",
    "Jump a little higher, the good stuff is up there.",
    "Don't answer yet, walk this route first.",
    "Someone scratched these walls. This used to be the canteen.",
    "This floor tile is left over from the previous version.",
    "They say the pillars move on their own. They don't.",
    "Someone practised typing here for three years, just to beat the door.",
    "The altar is on top. You have to jump higher than most.",
    "Eggs don't score. They just make the day nicer.",
    "The light here is warm, so people like to stand still.",
    "Hint: you are closer to the answer than you think.",
    "The fog in this level is left over from yesterday's rain.",
    "First time here? Congratulations, you found this.",
    "Don't worry, falling here doesn't hurt.",
    "Every level hides one line. Today's line is for you.",
    "You walk like you're rushing a draft. You're actually playing.",
    "There's a door behind the door. It's fine, it's the next level.",
    "This route is for people willing to press space a few more times.",
]

# 祭坛上的隐藏台词：一关只有一句，比较郑重
ALTAR_TEXTS = [
    "「打字不是为了快，是为了把想法留在手边。」",
    "「你走过的每一关，都是自己敲出来的。」",
    "「最高的地方没有奖品，只有风景。」",
    "「先跳，再想。」",
    "「认真的人运气都不会太差。」",
    "「把键盘当成乐器，你就是演奏者。」",
    "「门一直都在，只是要有人愿意答对问题。」",
    "「恭喜你看到了这里，这句话没别人看见过。」",
]

ALTAR_TEXTS_EN = [
    "\"Typing isn't about speed. It's about keeping the thought close.\"",
    "\"Every level you cleared, you typed yourself.\"",
    "\"There's no prize up here. Only the view.\"",
    "\"Jump first. Think later.\"",
    "\"Careful people are rarely short on luck.\"",
    "\"Treat the keyboard as an instrument. You are the player.\"",
    "\"The door was always there. Someone just had to answer right.\"",
    "\"You made it up here. Nobody else has seen this line.\"",
]

EGG_KIND_CUBE = "cube"
EGG_KIND_ALTAR = "altar"


# --------------------------------------------------------------------- 选文案


def pick_egg_text(seed: int, level_index: int, egg_id: int, kind: str) -> tuple[str, str]:
    """按种子挑一句彩蛋文案，返回 ``(中文, 英文)``。

    同一个 ``(seed, level_index, egg_id)`` 永远得到同一句 —— 当天固定、跨天换新。
    """
    if kind == EGG_KIND_ALTAR:
        pool, pool_en = ALTAR_TEXTS, ALTAR_TEXTS_EN
    else:
        pool, pool_en = EGG_TEXTS, EGG_TEXTS_EN
    rng = random.Random((seed + level_index * 7919 + egg_id * 104729) & 0xFFFFFFFF)
    index = rng.randrange(len(pool))
    return pool[index], pool_en[index]


def egg_hint(target: str, kind: str) -> tuple[str, str]:
    """彩蛋给的提示，返回 ``(中文, 英文)``。

    - ``cube``：只透露第一个字符；
    - ``altar``：透露一半（多给几个字符）。
    """
    text = (target or "").strip()
    if not text:
        return "", ""
    if kind == EGG_KIND_ALTAR:
        half = max(2, math.ceil(len(text) / 2))
        return (
            f"题目前半句是「{text[:half]}」",
            f"The first half is \"{text[:half]}\"",
        )
    return (
        f"题目的第一个字符是「{text[:1]}」",
        f"The first character is \"{text[:1]}\"",
    )


# --------------------------------------------------------------------- 跑酷塔


def parkour_layout(
    level_index: int,
    room_width: float,
    room_depth: float,
    platform_size: float = 2.8,
    platform_thickness: float = 0.45,
    spacing: float = 1.25,
) -> dict:
    """算出这一关的跑酷塔、弹跳板和彩蛋位置。

    纯数据（不创建任何实体），所以可以在没有显卡的环境里直接单测。
    返回::

        {
            "platforms": [{"x", "y"(顶面), "z", "width", "depth", "height"}, ...],
            "pad": {"x", "z", "radius"},
            "eggs": [{"id", "kind", "x", "y", "z"}, ...],
        }

    塔放在房间左后方，离出生点不远但不挡去面板的路；每一层左右交错，
    只能靠跳上去 —— 顶端是祭坛平台。
    """
    rng = random.Random(1337 + level_index * 31)
    base_x = -room_width / 2 + 4.6
    base_z = -room_depth / 2 + 7.2

    platforms = []
    egg_specs = []

    # 底部四块小平台 + 顶部一块大祭坛平台
    offsets = [
        (0.75, 0.55),
        (-0.70, -0.60),
        (0.70, 0.50),
        (-0.65, -0.45),
    ]
    for index, (dx, dz) in enumerate(offsets):
        top = 0.95 + spacing * index
        platforms.append(
            {
                "x": base_x + dx,
                "y": top,
                "z": base_z + dz,
                "width": platform_size,
                "depth": platform_size,
                "height": platform_thickness,
                "kind": "platform",
            }
        )
        # 第 2 层上方飘一个问号方块，跳上去就能捡
        if index == 1:
            egg_specs.append(
                {
                    "id": 0,
                    "kind": EGG_KIND_CUBE,
                    "x": base_x + dx,
                    "y": top + 1.15,
                    "z": base_z + dz,
                }
            )

    altar_top = 0.95 + spacing * len(offsets)
    platforms.append(
        {
            "x": base_x + 0.05,
            "y": altar_top,
            "z": base_z + 0.05,
            "width": platform_size + 1.2,
            "depth": platform_size + 1.2,
            "height": platform_thickness + 0.15,
            "kind": "altar",
        }
    )
    # 祭坛彩蛋在顶端平台正中间
    egg_specs.append(
        {
            "id": 1,
            "kind": EGG_KIND_ALTAR,
            "x": base_x + 0.05,
            "y": altar_top + 1.15,
            "z": base_z + 0.05,
        }
    )

    # 角落里的第二个问号方块：不用跳，走过去就能捡
    egg_specs.append(
        {
            "id": 2,
            "kind": EGG_KIND_CUBE,
            "x": room_width / 2 - 3.6 + rng.uniform(-0.6, 0.6),
            "y": 1.05,
            "z": -room_depth / 2 + 6.0 + rng.uniform(-0.6, 0.6),
        }
    )

    # 弹跳板：踩上去会被弹起来，可以直接跳到第四层
    pad = {
        "x": base_x - 0.1,
        "z": base_z - 2.6,
        "radius": 1.15,
    }

    return {"platforms": platforms, "pad": pad, "eggs": egg_specs}


def egg_key(kind: str, egg_id: int, level_index: int = 0) -> str:
    """彩蛋的唯一标识（跨关卡统计用）。"""
    # 关卡号也要算进去：每一关都有编号相同的问号方块和祭坛
    return f"{level_index}#{kind}#{egg_id}"


def nearest_egg(
    eggs: list[dict],
    position,
    radius: float,
    collected: Optional[set] = None,
) -> Optional[dict]:
    """找出离 ``position`` 最近、且还没被捡走的彩蛋。

    ``eggs`` 里每项至少要有 ``x`` / ``y`` / ``z`` / ``id`` / ``kind``。
    """
    best = None
    best_distance = radius
    for egg in eggs:
        if egg.get("collected"):
            continue
        if collected is not None and egg_key(
            egg.get("kind", EGG_KIND_CUBE),
            egg.get("id", 0),
            egg.get("level", 0),
        ) in collected:
            continue
        dx = egg["x"] - position[0]
        dy = egg["y"] - position[1]
        dz = egg["z"] - position[2]
        distance = math.sqrt(dx * dx + dy * dy + dz * dz)
        if distance <= best_distance:
            best_distance = distance
            best = egg
    return best
