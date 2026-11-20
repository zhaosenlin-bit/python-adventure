"""收集品：定义 + 程序化图标。

这个游戏的「收集环节」里，玩家会打捞到各种水上乐园的小物件：
遮阳伞、粉珊瑚、金币堆、海星、章鱼、魔术师……每样都有稀有度，
凑够数量还能开「稀有礼包」抽新的。

图标全部用基本几何体拼出来，和赛道、角色一样是程序化生成的。
"""

from __future__ import annotations

import math

from typing import Dict, List, Optional

from ursina import Entity, color

from . import models

# 稀有度配色（卡片边框 / 名字颜色）
RARITY_COLORS: Dict[str, tuple] = {
    "common": (0.24, 0.66, 0.96),
    "rare": (0.60, 0.38, 0.98),
    "epic": (1.00, 0.72, 0.18),
}
RARITY_NAMES: Dict[str, str] = {
    "common": "普通",
    "rare": "稀有",
    "epic": "史诗",
}
RARITY_WEIGHT: Dict[str, float] = {
    "common": 0.0,
    "rare": 0.72,
    "epic": 0.28,
}

# 收藏品清单（顺序 = 界面里的排列顺序）
COLLECTION: List[Dict] = [
    {"id": "parasol", "name": "遮阳伞", "en": "Parasol", "rarity": "common"},
    {"id": "coral", "name": "粉珊瑚", "en": "Pink coral", "rarity": "common"},
    {"id": "coins", "name": "金币堆", "en": "Gold coins", "rarity": "common"},
    {"id": "starfish", "name": "海星", "en": "Starfish", "rarity": "rare"},
    {"id": "octopus", "name": "章鱼", "en": "Octopus", "rarity": "rare"},
    {"id": "magician", "name": "魔术师", "en": "Magician", "rarity": "epic"},
]

BY_ID: Dict[str, Dict] = {item["id"]: item for item in COLLECTION}


def get(item_id: str) -> Optional[Dict]:
    return BY_ID.get(item_id)


def name_of(item_id: str) -> str:
    item = BY_ID.get(item_id)
    return item["name"] if item else item_id


def rarity_color(rarity: str) -> tuple:
    return RARITY_COLORS.get(rarity, RARITY_COLORS["common"])


# ---------------------------------------------------------------- 图标


# 每个图标单独调一下缩放和上下偏移：它们的高矮胖瘦差很多，
# 统一缩放的话有的会撑破卡片、有的会缩成一个点。
_ICON_TUNE = {
    "parasol": (0.45, 0.080),
    "coral": (0.48, -0.030),
    "coins": (0.46, -0.030),
    "starfish": (0.37, 0.000),
    "octopus": (0.48, -0.020),
    "magician": (0.28, -0.070),
}


def build_icon(item_id: str, scale: float = 1.0) -> Entity:
    """用基本几何体拼出某个收藏品的图标。

    缩放和垂直偏移按 ``_ICON_TUNE`` 逐个调过。
    """
    root = Entity()
    builder = _BUILDERS.get(item_id, _build_coral)
    builder(root, 1.0)
    tune_scale, tune_y = _ICON_TUNE.get(item_id, (0.4, 0.0))
    root.scale = tune_scale * scale
    # 上下偏移作用在部件上，这样调用方摆位置时图标就是居中的
    for child in root.children:
        child.y += tune_y
    return root


def _build_parasol(root: Entity, s: float) -> None:
    """遮阳伞：伞面 + 伞杆。"""
    models.cone(
        0.105,
        0.09,
        parent=root,
        position=(0, 0.035, 0),
        rotation=(180, 0, 0),
        color=color.rgba(0.20, 0.62, 0.96, 1),
    )
    models.cone(
        0.062,
        0.075,
        parent=root,
        position=(0, 0.042, 0),
        rotation=(180, 0, 0),
        color=color.rgba(0.98, 0.98, 1.0, 1),
    )
    models.cylinder(
        0.011,
        0.17,
        parent=root,
        position=(0, -0.115, 0),
        color=color.rgba(0.85, 0.62, 0.36, 1),
    )


def _build_coral(root: Entity, s: float) -> None:
    """粉珊瑚：一簇粉色小球。"""
    blobs = ((0, 0, 0, 0.062), (0.06, 0.03, 0.02, 0.05), (-0.05, 0.02, -0.03, 0.048),
             (0.015, 0.07, -0.03, 0.04))
    for x, y, z, r in blobs:
        Entity(
            parent=root,
            model="sphere",
            scale=(r * 2, r * 1.7, r * 2),
            position=(x, y, z),
            color=color.rgba(0.98, 0.42, 0.66, 1),
        )


def _build_coins(root: Entity, s: float) -> None:
    """金币堆：几摞金币。"""
    stacks = ((-0.06, 0.012, 0.0, 3), (0.02, 0.012, 0.03, 4), (0.07, 0.012, -0.04, 2))
    for x, y, z, count in stacks:
        for i in range(count):
            models.cylinder(
                0.05,
                0.014,
                parent=root,
                position=(x, y + i * 0.016, z),
                # 转 90 度让币面正对镜头，否则侧面看是一条线
                rotation=(90, 0, 0),
                color=color.rgba(1.0, 0.80, 0.16, 1),
            )


def _build_starfish(root: Entity, s: float) -> None:
    """海星：五根放射的小方块。"""

    for i in range(5):
        angle = i / 5.0 * math.tau
        Entity(
            parent=root,
            model="cube",
            scale=(0.105, 0.035, 0.058),
            position=(math.cos(angle) * 0.052, math.sin(angle) * 0.052, 0),
            rotation=(0, 0, math.degrees(angle)),
            color=color.rgba(1.0, 0.55, 0.20, 1),
        )
    Entity(
        parent=root,
        model="sphere",
        scale=(0.075, 0.04, 0.075),
        color=color.rgba(1.0, 0.68, 0.28, 1),
    )


def _build_octopus(root: Entity, s: float) -> None:
    """章鱼：脑袋 + 触手 + 眼睛。"""
    Entity(
        parent=root,
        model="sphere",
        scale=(0.135, 0.125, 0.135),
        position=(0, 0.03, 0),
        color=color.rgba(0.78, 0.36, 0.92, 1),
    )
    for i in range(6):
        angle = i / 6.0 * math.tau
        Entity(
            parent=root,
            model="sphere",
            scale=(0.062, 0.05, 0.125),
            position=(math.cos(angle) * 0.095, -0.062, math.sin(angle) * 0.095),
            rotation=(0, math.degrees(angle), 0),
            color=color.rgba(0.68, 0.28, 0.86, 1),
        )
    for side in (-1, 1):
        Entity(
            parent=root,
            model="sphere",
            scale=(0.068, 0.072, 0.045),
            position=(side * 0.036, 0.045, -0.072),
            color=color.rgba(1, 1, 1, 1),
        )
        Entity(
            parent=root,
            model="sphere",
            scale=(0.034, 0.038, 0.022),
            position=(side * 0.036, 0.045, -0.098),
            color=color.rgba(0.1, 0.1, 0.16, 1),
        )


def _build_magician(root: Entity, s: float) -> None:
    """魔术师：礼帽 + 西装 + 领结。"""
    Entity(
        parent=root,
        model="cube",
        scale=(0.13, 0.17, 0.1),
        position=(0, -0.03, 0),
        color=color.rgba(0.13, 0.13, 0.18, 1),
    )
    Entity(
        parent=root,
        model="cube",
        scale=(0.055, 0.12, 0.02),
        position=(0, -0.03, -0.052),
        color=color.rgba(0.96, 0.96, 0.98, 1),
    )
    Entity(
        parent=root,
        model="sphere",
        scale=(0.115, 0.115, 0.115),
        position=(0, 0.085, 0),
        color=color.rgba(0.98, 0.78, 0.72, 1),
    )
    models.cylinder(
        0.075,
        0.055,
        parent=root,
        position=(0, 0.13, 0),
        color=color.rgba(0.16, 0.16, 0.22, 1),
    )
    models.cylinder(
        0.048,
        0.07,
        parent=root,
        position=(0, 0.185, 0),
        color=color.rgba(0.16, 0.16, 0.22, 1),
    )
    Entity(
        parent=root,
        model="cube",
        scale=(0.055, 0.04, 0.03),
        position=(0, 0.005, -0.062),
        rotation=(0, 0, 45),
        color=color.rgba(0.95, 0.25, 0.30, 1),
    )


_BUILDERS = {
    "parasol": _build_parasol,
    "coral": _build_coral,
    "coins": _build_coins,
    "starfish": _build_starfish,
    "octopus": _build_octopus,
    "magician": _build_magician,
}
