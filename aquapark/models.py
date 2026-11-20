"""程序化模型。

滑槽、角色、水柱喷泉、加速带…… 全部由基本几何体和自建网格拼出来，
不依赖任何外部模型文件。

注意：Ursina 自带的字符串模型只有 ``cube`` / ``sphere`` / ``icosphere`` /
``plane`` / ``quad`` / ``circle`` 这几个，``cylinder`` 和 ``cone`` **不是**
内置模型，所以这里自己生成网格（:func:`cylinder_mesh` / :func:`cone_mesh`）。

角色面朝 **+Z**（Ursina 的 ``Entity.forward`` 方向），脚底在原点，
这样 ``look_at()`` 一下就能对准赛道方向。
"""

from __future__ import annotations

import math
from typing import Dict, List, Sequence, Tuple

from ursina import Entity, Mesh, color

from . import config
from .track import compute_normals

# 角色配色
SKIN_COLOR = (0.98, 0.80, 0.66)
GOGGLE_COLOR = (0.16, 0.22, 0.32)
RING_COLOR = (1.0, 1.0, 1.0)


# ---------------------------------------------------------------- 基础网格


def _empty_mesh() -> Dict[str, List]:
    return {"vertices": [], "triangles": [], "uvs": [], "normals": []}


def _finish(mesh: Dict[str, List]) -> Dict[str, List]:
    """补上法线。没有法线的几何体在 Panda3D 里点不着灯。"""
    mesh["normals"] = compute_normals(mesh["vertices"], mesh["triangles"])
    return mesh


def cylinder_mesh(radius: float = 0.5, height: float = 1.0, segments: int = 14) -> Dict[str, List]:
    """圆柱网格：底面在 y=0，顶面在 y=height（和 Ursina 的 Cylinder 一致）。"""
    mesh = _empty_mesh()
    vertices = mesh["vertices"]
    uvs = mesh["uvs"]
    triangles = mesh["triangles"]

    # 侧面
    for i in range(segments):
        angle = i / segments * math.tau
        vertices.append((math.cos(angle) * radius, 0.0, math.sin(angle) * radius))
        uvs.append((i / segments, 0.0))
        angle = i / segments * math.tau
        x, z = math.cos(angle) * radius, math.sin(angle) * radius
        vertices.append((x, 0.0, z))
        uvs.append((i / segments, 0.0))
        vertices.append((x, height, z))
        uvs.append((i / segments, 1.0))
    for i in range(segments):
        nxt = (i + 1) % segments
        a0, a1 = 2 * i, 2 * i + 1
        b0, b1 = 2 * nxt, 2 * nxt + 1
        # Panda3D 是左手坐标系：右手定则的法线要朝内，外表面才是正面
        triangles.append((a0, b0, a1))
        triangles.append((a1, b0, b1))

    # 顶面
    top_center = len(vertices)
    vertices.append((0.0, height, 0.0))
    uvs.append((0.5, 0.5))
    for i in range(segments):
        angle = i / segments * math.tau
        vertices.append((math.cos(angle) * radius, height, math.sin(angle) * radius))
        uvs.append((0.5 + 0.5 * math.cos(angle), 0.5 + 0.5 * math.sin(angle)))
    for i in range(segments):
        triangles.append((top_center, top_center + 1 + i, top_center + 1 + (i + 1) % segments))

    # 底面
    bottom_center = len(vertices)
    vertices.append((0.0, 0.0, 0.0))
    uvs.append((0.5, 0.5))
    for i in range(segments):
        angle = i / segments * math.tau
        vertices.append((math.cos(angle) * radius, 0.0, math.sin(angle) * radius))
        uvs.append((0.5 + 0.5 * math.cos(angle), 0.5 + 0.5 * math.sin(angle)))
    for i in range(segments):
        triangles.append((bottom_center, bottom_center + 1 + (i + 1) % segments, bottom_center + 1 + i))

    return _finish(mesh)


def cone_mesh(radius: float = 0.5, height: float = 1.0, segments: int = 12) -> Dict[str, List]:
    """圆锥网格：底面在 y=0，顶点在 y=height。"""
    mesh = _empty_mesh()
    vertices = mesh["vertices"]
    uvs = mesh["uvs"]
    triangles = mesh["triangles"]

    for i in range(segments):
        # 先把顶点放完，再连三角形（顺序：底圈 → 顶点 → 底面）
        angle = i / segments * math.tau
        vertices.append((math.cos(angle) * radius, 0.0, math.sin(angle) * radius))
        uvs.append((i / segments, 0.0))
    apex = len(vertices)
    vertices.append((0.0, height, 0.0))
    uvs.append((0.5, 1.0))
    for i in range(segments):
        triangles.append((i, (i + 1) % segments, apex))

    center = len(vertices)
    vertices.append((0.0, 0.0, 0.0))
    uvs.append((0.5, 0.5))
    for i in range(segments):
        triangles.append((center, i, (i + 1) % segments))

    return _finish(mesh)


def torus_mesh(
    major_radius: float,
    minor_radius: float,
    major_segments: int = 18,
    minor_segments: int = 8,
) -> Dict[str, List]:
    """圆环（泳圈）网格。"""
    mesh = _empty_mesh()
    vertices = mesh["vertices"]
    uvs = mesh["uvs"]
    triangles = mesh["triangles"]

    for i in range(major_segments):
        u = i / major_segments * math.tau
        cos_u, sin_u = math.cos(u), math.sin(u)
        for j in range(minor_segments):
            v = j / minor_segments * math.tau
            cos_v, sin_v = math.cos(v), math.sin(v)
            ring = major_radius + minor_radius * cos_v
            vertices.append((ring * cos_u, minor_radius * sin_v, ring * sin_u))
            uvs.append((i / major_segments, j / minor_segments))

    for i in range(major_segments):
        i_next = (i + 1) % major_segments
        for j in range(minor_segments):
            j_next = (j + 1) % minor_segments
            a = i * minor_segments + j
            b = i_next * minor_segments + j
            c = i_next * minor_segments + j_next
            d = i * minor_segments + j_next
            triangles.append((a, b, c))
            triangles.append((a, c, d))

    return _finish(mesh)


def build_mesh_entity(data: Dict[str, List], parent=None, **kwargs) -> Entity:
    """把网格数据包成一个 Entity。"""
    mesh = Mesh(
        vertices=data["vertices"],
        triangles=data["triangles"],
        uvs=data.get("uvs"),
        normals=data.get("normals"),
    )
    mesh.setTwoSided(True)  # 两面都渲染，避免从背面看穿帮
    if parent is not None:
        kwargs["parent"] = parent
    return Entity(model=mesh, **kwargs)


def cylinder(radius: float, height: float, **kwargs) -> Entity:
    """快捷方式：造一个圆柱实体。"""
    return build_mesh_entity(cylinder_mesh(radius, height), **kwargs)


def cone(radius: float, height: float, **kwargs) -> Entity:
    """快捷方式：造一个圆锥实体。"""
    return build_mesh_entity(cone_mesh(radius, height), **kwargs)


# ---------------------------------------------------------------- 角色


def build_racer(racer_rgb: Sequence[float], is_player: bool = False) -> Entity:
    """造一个游泳选手：身体 + 泳圈 + 脑袋 + 胳膊 + 泳镜。

    角色是「趴着滑」的姿势：身体横着，脑袋朝前，胳膊在两侧划水。
    """
    root = Entity()
    # 翻滚组：腾空 / 被撞飞的时候整块身体绕自身轴转
    tilt = Entity(parent=root)
    skin = color.rgba(*SKIN_COLOR, 1.0)
    suit = color.rgba(*racer_rgb, 1.0)

    # 身体（趴着的姿态，纵向拉长）
    body = Entity(
        parent=tilt,
        model="sphere",
        scale=(0.86, 0.62, 1.22),
        position=(0, 0.52, 0.0),
        color=suit,
    )
    # 屁股 / 腿
    tail = Entity(
        parent=tilt,
        model="sphere",
        scale=(0.66, 0.5, 0.66),
        position=(0, 0.46, -0.92),
        color=suit,
    )
    # 泳圈
    ring = build_mesh_entity(torus_mesh(0.72, 0.2), parent=tilt)
    ring.position = (0, 0.46, -0.06)
    ring.scale = (1.0, 1.0, 0.82)
    ring.color = color.rgba(*RING_COLOR, 1.0)

    # 脑袋
    head = Entity(
        parent=tilt,
        model="sphere",
        scale=0.62,
        position=(0, 0.72, 0.78),
        color=skin,
    )
    # 泳镜
    goggles = Entity(
        parent=tilt,
        model="sphere",
        scale=(0.62, 0.3, 0.42),
        position=(0, 0.8, 1.02),
        color=color.rgba(*GOGGLE_COLOR, 1.0),
    )
    # 胳膊
    arms: List[Entity] = []
    for side in (-1, 1):
        arm = Entity(
            parent=tilt,
            model="sphere",
            scale=(0.27, 0.25, 0.3),
            position=(side * 0.58, 0.58, 0.42),
            color=skin,
        )
        arms.append(arm)

    # 腿
    legs: List[Entity] = []
    for side in (-1, 1):
        leg = Entity(
            parent=tilt,
            model="sphere",
            scale=(0.3, 0.22, 0.42),
            position=(side * 0.26, 0.34, -1.12),
            color=skin,
        )
        legs.append(leg)

    # 玩家头顶加一个小箭头，方便在人群里找到自己
    marker = None
    if is_player:
        marker = cone(
            0.34,
            0.55,
            parent=root,
            position=(0, 1.62, 0),
            rotation=(180, 0, 0),
            color=color.rgba(*config.UI_GOLD, 1.0),
        )

    root.racer_body = body
    root.scale = 1.2  # 让角色在宽滑槽里更醒目
    root.racer_tilt = tilt
    root.racer_ring = ring
    root.racer_head = head
    root.racer_arms = arms
    root.racer_legs = legs
    root.racer_marker = marker
    return root


# ---------------------------------------------------------------- 障碍物


def build_jet() -> Entity:
    """水柱喷泉：底座 + 转动的喷头 + 一道水柱。"""
    root = Entity()
    cylinder(
        0.85,
        0.26,
        parent=root,
        color=color.rgba(*config.JET_COLOR, 1.0),
    )
    spinner = Entity(parent=root, position=(0, 0.42, 0))
    for side in (-1, 1):
        Entity(
            parent=spinner,
            model="cube",
            scale=(1.5, 0.12, 0.16),
            position=(side * 0.62, 0, 0),
            color=color.rgba(*config.BOOST_COLOR, 1.0),
        )
    jet = cylinder(
        0.45,
        1.9,
        parent=root,
        position=(0, 0.2, 0),
        color=color.rgba(0.78, 0.94, 1.0, 1.0),
    )
    Entity(
        parent=root,
        model="sphere",
        scale=(0.85, 0.5, 0.85),
        position=(0, 2.05, 0),
        color=color.rgba(0.92, 0.99, 1.0, 1.0),
    )
    root.jet_spinner = spinner
    root.jet_column = jet
    return root


def build_boost() -> Entity:
    """加速带：地上的一块发光箭头板。"""
    root = Entity()
    pad = Entity(
        parent=root,
        model="cube",
        scale=(3.0, 0.12, 3.0),
        position=(0, 0.06, 0),
        color=color.rgba(*config.BOOST_COLOR, 1.0),
    )
    for offset in (-0.7, 0.0, 0.7):
        Entity(
            parent=root,
            model="cube",
            scale=(0.28, 0.06, 1.1),
            position=(0, 0.14, offset),
            color=color.rgba(1.0, 1.0, 1.0, 1.0),
        )
    root.boost_pad = pad
    return root


def build_bumper() -> Entity:
    """泡沫障碍：横在赛道上的软垫。"""
    root = Entity()
    Entity(
        parent=root,
        model="cube",
        scale=(3.9, 1.7, 1.9),
        position=(0, 0.85, 0),
        color=color.rgba(*config.BUMPER_COLOR, 1.0),
    )
    Entity(
        parent=root,
        model="cube",
        scale=(4.15, 1.9, 2.15),
        position=(0, 0.95, 0),
        color=color.rgba(1.0, 1.0, 1.0, 1.0),
    )
    return root


def build_coin() -> Entity:
    """金币：会转的亮片。"""
    root = Entity()
    disc = Entity(
        parent=root,
        model="sphere",
        scale=(0.78, 0.78, 0.16),
        color=color.rgba(*config.COIN_COLOR, 1.0),
    )
    Entity(
        parent=root,
        model="sphere",
        scale=(0.4, 0.4, 0.2),
        color=color.rgba(1.0, 0.97, 0.7, 1.0),
    )
    root.coin_disc = disc
    return root


# ---------------------------------------------------------------- 场景装饰


def build_arch(banner_texture=None) -> Entity:
    """横跨赛道的拱门。"""
    root = Entity()
    for side in (-1, 1):
        cylinder(
            0.34,
            5.4,
            parent=root,
            position=(side * 6.4, 0, 0),
            color=color.rgba(1.0, 1.0, 1.0, 1.0),
        )
    banner = Entity(
        parent=root,
        model="cube",
        scale=(13.2, 1.5, 0.16),
        position=(0, 5.0, 0),
        color=color.rgba(1.0, 1.0, 1.0, 1.0),
    )
    if banner_texture is not None:
        banner.texture = banner_texture
    root.arch_banner = banner
    return root


def build_cloud() -> Entity:
    """一朵云：几个压扁的球拼起来。"""
    root = Entity()
    blobs = (
        (0, 0, 0, 1.0),
        (1.3, -0.2, 0.3, 0.72),
        (-1.2, -0.15, -0.2, 0.66),
        (0.4, 0.35, -0.6, 0.58),
    )
    for x, y, z, scale in blobs:
        Entity(
            parent=root,
            model="sphere",
            scale=(scale * 2.2, scale * 1.1, scale * 1.8),
            position=(x, y, z),
            color=color.rgba(1.0, 1.0, 1.0, 1.0),
        )
    return root


def build_palm() -> Entity:
    """棕榈树：树干 + 几片叶子。"""
    root = Entity()
    cylinder(
        0.32,
        4.2,
        parent=root,
        color=color.rgba(0.55, 0.38, 0.22, 1.0),
    )
    for index in range(7):
        angle = index / 7.0 * math.tau
        Entity(
            parent=root,
            model="cube",
            scale=(2.2, 0.1, 0.5),
            position=(math.cos(angle) * 1.05, 4.15, math.sin(angle) * 1.05),
            rotation=(0, math.degrees(angle), 34),
            color=color.rgba(0.25, 0.72, 0.32, 1.0),
        )
    return root


def build_start_gate(checker=None) -> Entity:
    """起跑门：一道黑白格横幅。"""
    root = Entity()
    for side in (-1, 1):
        cylinder(
            0.36,
            6.0,
            parent=root,
            position=(side * 6.6, 0, 0),
            color=color.rgba(1.0, 1.0, 1.0, 1.0),
        )
    banner = Entity(
        parent=root,
        model="cube",
        scale=(13.4, 1.6, 0.16),
        position=(0, 5.6, 0),
        color=color.rgba(1.0, 1.0, 1.0, 1.0),
    )
    if checker is not None:
        banner.texture = checker
    return root


def build_finish_gate(checker=None) -> Entity:
    """终点线：一道黑白格横幅 + 两侧的彩柱。"""
    root = Entity()
    for side in (-1, 1):
        cylinder(
            0.42,
            7.0,
            parent=root,
            position=(side * 7.0, 0, 0),
            color=color.rgba(*config.UI_GOLD, 1.0),
        )
    banner = Entity(
        parent=root,
        model="cube",
        scale=(14.2, 1.9, 0.18),
        position=(0, 6.2, 0),
        color=color.rgba(1.0, 1.0, 1.0, 1.0),
    )
    if checker is not None:
        banner.texture = checker
    return root
