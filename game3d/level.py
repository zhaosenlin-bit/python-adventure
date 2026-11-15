"""3D 关卡生成。

一个关卡 = 一个封闭房间 + 一块打字面板 + 一扇通往下一关的门。
所有模型都由 Cube / Plane 拼出来，不依赖任何外部模型或贴图。

关卡序号越大，房间越大、柱子越多、路线越绕，玩法保持一致。
"""

from __future__ import annotations

import math
import random
from typing import Optional

from ursina import (
    Entity,
    Text,
    Vec3,
    color,
    destroy,
    scene,
)

from . import config, eggs, lighting
from .fonts import T, current_font


def _c(rgb, alpha: float = 1.0):
    """把 (r, g, b) 元组转成 Ursina 颜色。"""
    return color.rgba(rgb[0], rgb[1], rgb[2], alpha)


class Level:
    """一关的场景。

    对外暴露：
    - ``spawn_position``  玩家出生点
    - ``panel``          打字面板实体
    - ``door_hinge``     门轴（动画旋转它）
    - ``door_opened``    门是否已经打开
    - ``exit_position``  门后的传送点（玩家走进去就进下一关）
    """

    def __init__(self, index: int, question_text: str):
        self.index = index
        self.question_text = question_text
        self.rng = random.Random(90210 + index * 7919)

        self.entities: list[Entity] = []
        self.door_opened = False
        self.door_progress = 0.0
        self.panel_solved = False
        self._time = 0.0
        self._panel_base_y = 2.15

        # 关卡复杂度
        self.room_width = 26.0 + min(index, 10) * 1.6
        self.room_depth = 30.0 + min(index, 10) * 1.8
        self.pillar_count = min(index // 2, 7)
        self.has_inner_wall = index >= 2
        self.has_alcove = index >= 4

        self.spawn_position = Vec3(0, 0, -self.room_depth / 2 + 4)
        self.exit_position = Vec3(0, 0, self.room_depth / 2 + 7.5)

        self.panel: Optional[Entity] = None
        # 跑酷塔 + 彩蛋（和网页版同一套玩法）
        self.platforms: list[dict] = []
        self.eggs: list[dict] = []
        self.bounce_pad: Optional[dict] = None
        self.panel_root: Optional[Entity] = None
        self.door_hinge: Optional[Entity] = None
        self.door_light: Optional[Entity] = None
        self._door_hinge_start = 0.0

    # ------------------------------------------------------------------ 构建

    def _keep(self, entity: Entity) -> Entity:
        self.entities.append(entity)
        return entity

    def build(self) -> "Level":
        """把整个关卡搭出来。"""
        self._build_environment()
        self._build_room()
        self._build_obstacles()
        self._build_panel()
        self._build_door()
        self._build_parkour()
        self._build_corridor()
        return self

    def _build_environment(self) -> None:
        """雾效 + 暖色灯光，营造探索氛围。"""
        scene.fog_color = _c(config.FOG_COLOR)
        scene.fog_density = config.FOG_DENSITY

        self._keep(
            lighting.ambient_light(
                config.AMBIENT_LIGHT_COLOR,
                brightness=config.AMBIENT_LIGHT_INTENSITY,
            )
        )
        # 房间中央的暖色主光
        self._keep(
            lighting.point_light(
                config.WARM_LIGHT_COLOR,
                brightness=config.WARM_LIGHT_BRIGHTNESS,
                radius=config.WARM_LIGHT_RANGE,
                position=(0, 5.5, -self.room_depth / 6),
            )
        )
        # 面板附近的暖光，方便远处看见
        self._keep(
            lighting.point_light(
                config.PANEL_LIGHT_COLOR,
                brightness=config.PANEL_LIGHT_BRIGHTNESS,
                radius=config.PANEL_LIGHT_RANGE,
                position=(0, 3.2, self.room_depth / 2 - 4),
            )
        )

    def _build_room(self) -> None:
        w, d = self.room_width, self.room_depth
        half_w, half_d = w / 2, d / 2
        t = config.WALL_THICKNESS
        h = config.WALL_HEIGHT

        # 地面
        self._keep(
            Entity(
                model="plane",
                scale=(w, 1, d),
                color=_c(config.FLOOR_COLOR),
                collider="box",
            )
        )
        # 天花板
        self._keep(
            Entity(
                model="cube",
                scale=(w + t, 0.4, d + t),
                y=h,
                color=_c(config.CEILING_COLOR),
            )
        )
        # 左右墙
        for sign in (-1, 1):
            self._keep(
                Entity(
                    model="cube",
                    scale=(t, h, d + t * 2),
                    x=sign * (half_w + t / 2),
                    y=h / 2,
                    color=_c(config.WALL_COLOR),
                    collider="box",
                )
            )
        # 后墙（玩家出生的一侧）
        self._keep(
            Entity(
                model="cube",
                scale=(w + t * 2, h, t),
                z=-(half_d + t / 2),
                y=h / 2,
                color=_c(config.WALL_COLOR),
                collider="box",
            )
        )
        # 前墙：留出门洞
        door_w = config.DOOR_WIDTH
        door_h = config.DOOR_HEIGHT
        # 侧段要伸进侧墙一点，否则它的端面和侧墙内表面共面，会出现闪纹
        side_w = (w + t - door_w) / 2
        for sign in (-1, 1):
            self._keep(
                Entity(
                    model="cube",
                    scale=(side_w, h, t),
                    x=sign * (door_w / 2 + side_w / 2),
                    z=half_d + t / 2,
                    y=h / 2,
                    color=_c(config.WALL_COLOR),
                    collider="box",
                )
            )
        # 门洞上方
        self._keep(
            Entity(
                model="cube",
                scale=(door_w, h - door_h, t),
                z=half_d + t / 2,
                y=door_h + (h - door_h) / 2,
                color=_c(config.WALL_COLOR),
                collider="box",
            )
        )

    def _build_obstacles(self) -> None:
        """柱子 + 内墙 + 壁龛，让后面的关卡更绕。"""
        w, d = self.room_width, self.room_depth

        for i in range(self.pillar_count):
            px = self.rng.uniform(-w / 2 + 3, w / 2 - 3)
            pz = self.rng.uniform(-d / 2 + 6, d / 2 - 8)
            if abs(pz - (d / 2 - 4)) < 5:  # 别挡住面板
                pz -= 5
            size = self.rng.uniform(1.6, 2.8)
            self._keep(
                Entity(
                    model="cube",
                    scale=(size, config.WALL_HEIGHT, size),
                    position=(px, config.WALL_HEIGHT / 2, pz),
                    color=_c(config.PILLAR_COLOR),
                    collider="box",
                )
            )

        if self.has_inner_wall:
            # 一道带缺口的内墙，必须绕行
            gap_x = self.rng.choice([-1, 1]) * self.rng.uniform(w * 0.22, w * 0.34)
            gap_w = 4.0
            z = -d / 2 + d * 0.18
            seg_w = (w - gap_w) / 2
            for sign in (-1, 1):
                self._keep(
                    Entity(
                        model="cube",
                        scale=(seg_w, config.WALL_HEIGHT, 0.8),
                        x=sign * (gap_w / 2 + seg_w / 2),
                        z=z,
                        y=config.WALL_HEIGHT / 2,
                        color=_c(config.PILLAR_COLOR),
                        collider="box",
                    )
                )
            # 缺口上方补一段短墙，视觉上像门框
            self._keep(
                Entity(
                    model="cube",
                    scale=(gap_w, config.WALL_HEIGHT - 4.0, 0.8),
                    x=gap_x if abs(gap_x) > 0.01 else 0,
                    z=z,
                    y=4.0 + (config.WALL_HEIGHT - 4.0) / 2,
                    color=_c(config.PILLAR_COLOR),
                    collider="box",
                )
            )

        if self.has_alcove:
            # 两侧壁龛，纯装饰 + 藏光源
            for sign in (-1, 1):
                ax = sign * (w / 2 - 1.2)
                az = self.rng.uniform(-d * 0.15, d * 0.2)
                self._keep(
                    Entity(
                        model="cube",
                        scale=(2.4, 3.0, 5.0),
                        position=(ax, 1.5, az),
                        color=_c((0.19, 0.18, 0.24)),
                        collider="box",
                    )
                )
                self._keep(
                    lighting.point_light(
                        (0.6, 0.75, 1.0),
                        brightness=0.35,
                        radius=12.0,
                        position=(ax - sign * 1.0, 2.4, az),
                    )
                )

    def _build_panel(self) -> None:
        """远处就能看见的发光面板（带「打字」字样、微微上下浮动）。"""
        z = self.room_depth / 2 - 4.5

        # 基座
        self._keep(
            Entity(
                model="cube",
                scale=(2.6, 1.0, 2.2),
                position=(0, 0.5, z),
                color=_c((0.22, 0.21, 0.27)),
                collider="box",
            )
        )

        # 面板的「挂点」：面板本体、光晕、文字都挂在它下面，一起上下浮动
        panel_root = Entity(position=(0, self._panel_base_y, z))
        self._keep(panel_root)
        self.panel_root = panel_root

        # 面板本体（unlit 让它自己发光）
        panel = Entity(
            model="cube",
            scale=(3.4, 2.2, 0.3),
            parent=panel_root,
            color=_c(config.PANEL_COLOR),
            unlit=True,
            # 面板有碰撞体：既能被鼠标点中，也会挡住玩家（不会穿模）
            collider="box",
        )
        self._keep(panel)
        self.panel = panel

        # 外圈光晕
        self._keep(
            Entity(
                model="cube",
                scale=(4.3, 3.1, 0.12),
                parent=panel_root,
                position=(0, 0, 0.14),
                color=_c(config.PANEL_COLOR, 0.18),
                unlit=True,
            )
        )

        # 面板上的「打字」两个字（贴在面板正面，朝向玩家）
        label = Text(
            text=T("打字", "TYPE"),
            parent=panel_root,
            origin=(0, 0),
            # 稍微浮在面板前面一点，避免和面板面片产生深度冲突
            position=(0, 0, -0.32),
            scale=config.PANEL_TEXT_SCALE,
            color=color.white,
            # 和面板一样不受灯光影响，远处也能看清
            unlit=True,
        )
        font = current_font()
        if font:
            label.font = font
        # Panda3D 的文字正面朝 -Z，所以不旋转就能正对玩家（转 180 度反而会被背面剔除）
        try:
            label.setTwoSided(True)  # 走到面板背面也不会突然消失
        except Exception:  # pragma: no cover
            pass
        self._keep(label)

        # 面板自身的一点光，让周围地面被照亮
        self._keep(
            lighting.point_light(
                config.PANEL_COLOR,
                brightness=config.PANEL_GLOW_BRIGHTNESS,
                radius=config.PANEL_GLOW_RANGE,
                position=(0, self._panel_base_y, z - 1.2),
            )
        )

    def _build_door(self) -> None:
        """前墙上的门；用门轴旋转来打开。"""
        z = self.room_depth / 2 + config.WALL_THICKNESS / 2
        door_w = config.DOOR_WIDTH
        door_h = config.DOOR_HEIGHT

        # 门轴略微外移，打开时门扇完全让开门洞，不会挡住玩家
        hinge = Entity(position=(-(door_w / 2 + 0.25), 0, z))
        self._keep(hinge)
        self.door_hinge = hinge

        door = Entity(
            model="cube",
            scale=(door_w, door_h, 0.45),
            position=(door_w / 2, door_h / 2, 0),
            parent=hinge,
            color=_c(config.DOOR_COLOR),
            collider="box",
        )
        self._keep(door)

        # 门上的发光条
        stripe = Entity(
            model="cube",
            scale=(door_w * 0.7, 0.35, 0.12),
            position=(door_w / 2, door_h * 0.55, -0.3),
            parent=hinge,
            color=_c(config.PANEL_COLOR),
            unlit=True,
        )
        self._keep(stripe)

        # 门上方的一盏灯，答对之后点亮（初始亮度为 0）
        self.door_light = lighting.point_light(
            config.DOOR_OPEN_LIGHT_COLOR,
            brightness=0.0,
            radius=20.0,
            position=(0, door_h * 0.7, self.room_depth / 2 + 1.0),
        )
        self._keep(self.door_light)

    def _build_corridor(self) -> None:
        """门后的短走廊，尽头是下一关的传送点。"""
        z0 = self.room_depth / 2
        length = 7.0
        w = config.DOOR_WIDTH + 1.6

        self._keep(
            Entity(
                model="plane",
                scale=(w, 1, length),
                position=(0, 0, z0 + length / 2),
                color=_c((0.14, 0.13, 0.17)),
                collider="box",
            )
        )
        for sign in (-1, 1):
            self._keep(
                Entity(
                    model="cube",
                    # 侧墙要从前墙内部开始，否则端面和前墙内壁共面会闪烁
                    scale=(0.6, config.WALL_HEIGHT, length - config.WALL_THICKNESS / 2),
                    position=(
                        sign * (w / 2),
                        config.WALL_HEIGHT / 2,
                        z0 + config.WALL_THICKNESS / 2 + (length - config.WALL_THICKNESS / 2) / 2,
                    ),
                    color=_c((0.20, 0.19, 0.25)),
                    collider="box",
                )
            )
        self._keep(
            Entity(
                model="cube",
                scale=(w, 0.4, length - config.WALL_THICKNESS / 2),
                position=(
                    0,
                    config.WALL_HEIGHT,
                    z0 + config.WALL_THICKNESS / 2 + (length - config.WALL_THICKNESS / 2) / 2,
                ),
                color=_c(config.CEILING_COLOR),
            )
        )
        # 走廊尽头发光的门：告诉玩家「往这边走」
        self._keep(
            Entity(
                model="cube",
                scale=(w, config.WALL_HEIGHT, 0.2),
                position=(0, config.WALL_HEIGHT / 2, z0 + length - 0.1),
                color=_c(config.DOOR_OPEN_LIGHT_COLOR, 0.28),
                unlit=True,
            )
        )
        self._keep(
            lighting.point_light(
                config.DOOR_OPEN_LIGHT_COLOR,
                brightness=0.5,
                radius=16.0,
                position=(0, 2.4, z0 + length / 2),
            )
        )
        # 传送点就在门洞正后方：玩家走进打开的门即进入下一关
        self.exit_position = Vec3(0, 0, z0 + 1.4)

    def _build_parkour(self) -> None:
        """跑酷塔 + 弹跳板 + 彩蛋。

        塔在房间左后方，离出生点不远但不挡去面板的路；每层左右交错，
        只能靠跳上去 —— 顶端是祭坛平台。
        """
        layout = eggs.parkour_layout(
            self.index,
            self.room_width,
            self.room_depth,
            platform_size=config.PARKOUR_PLATFORM_SIZE,
            platform_thickness=config.PARKOUR_PLATFORM_THICKNESS,
            spacing=config.PARKOUR_SPACING,
        )

        for spec in layout["platforms"]:
            top = spec["y"]
            thickness = spec["height"]
            platform = self._keep(
                Entity(
                    model="cube",
                    scale=(spec["width"], thickness, spec["depth"]),
                    position=(spec["x"], top - thickness / 2, spec["z"]),
                    color=_c(config.PARKOUR_PLATFORM_COLOR),
                    collider="box",
                )
            )
            self.platforms.append({**spec, "entity": platform})
            # 顶面的发光条，雾里也能看清这一层
            self._keep(
                Entity(
                    model="cube",
                    scale=(spec["width"] * 0.82, 0.06, spec["depth"] * 0.82),
                    position=(spec["x"], top + 0.04, spec["z"]),
                    color=_c(config.PARKOUR_EDGE_COLOR, 0.55),
                    unlit=True,
                )
            )

        # 弹跳板：踩上去会被弹起来，可以直接窜到第四层
        pad = layout["pad"]
        pad_entity = self._keep(
            Entity(
                model="cube",
                scale=(pad["radius"] * 1.9, 0.18, pad["radius"] * 1.9),
                position=(pad["x"], 0.09, pad["z"]),
                color=_c(config.BOUNCE_PAD_COLOR),
                unlit=True,
            )
        )
        self._keep(
            lighting.point_light(
                config.BOUNCE_PAD_COLOR,
                brightness=0.45,
                radius=12.0,
                position=(pad["x"], 1.2, pad["z"]),
            )
        )
        self.bounce_pad = {**pad, "entity": pad_entity, "y": 0.18}

        # 彩蛋
        for spec in layout["eggs"]:
            entity = self._build_egg(spec)
            self.eggs.append(
                {**spec, "entity": entity, "collected": False, "base_y": spec["y"], "level": self.index}
            )

    def _build_egg(self, spec) -> Entity:
        """做一个彩蛋实体：普通问号方块 / 祭坛。返回会动的根节点。"""
        root = Entity(position=(spec["x"], spec["y"], spec["z"]))
        self._keep(root)

        if spec["kind"] == eggs.EGG_KIND_ALTAR:
            # 祭坛：紫色核心 + 四颗环绕的小方块
            core = Entity(
                model="cube",
                scale=(1.15, 1.15, 1.15),
                parent=root,
                color=_c(config.EGG_ALTAR_COLOR),
                unlit=True,
            )
            self._keep(core)
            root.egg_spinner = core
            chips = []
            for _ in range(4):
                chip = Entity(
                    model="cube",
                    scale=(0.32, 0.32, 0.32),
                    parent=root,
                    color=_c(config.EGG_ALTAR_COLOR, 0.85),
                    unlit=True,
                )
                self._keep(chip)
                chips.append(chip)
            root.egg_orbit = chips
            self._keep(
                lighting.point_light(
                    config.EGG_ALTAR_COLOR,
                    brightness=0.55,
                    radius=14.0,
                    position=(spec["x"], spec["y"], spec["z"]),
                )
            )
            return root

        # 普通问号方块：金色方块自转，四面各挂一个问号
        cube = Entity(
            model="cube",
            scale=(0.92, 0.92, 0.92),
            parent=root,
            color=_c(config.EGG_COLOR),
            unlit=True,
        )
        self._keep(cube)
        root.egg_spinner = cube
        font = current_font()
        for index in range(4):
            angle = index * math.pi / 2
            label = Text(
                text="?",
                parent=root,
                origin=(0, 0),
                position=(math.sin(angle) * 0.48, 0, -math.cos(angle) * 0.48),
                # 文字正面朝 -Z，绕 Y 转 -angle 之后正好朝外
                rotation=(0, -math.degrees(angle), 0),
                scale=22.0,
                color=color.rgba(0.16, 0.12, 0.03, 1.0),
                unlit=True,
            )
            if font:
                label.font = font
            try:
                label.setTwoSided(True)
            except Exception:  # pragma: no cover
                pass
            self._keep(label)
        self._keep(
            lighting.point_light(
                config.EGG_COLOR,
                brightness=0.4,
                radius=10.0,
                position=(spec["x"], spec["y"], spec["z"]),
            )
        )
        return root

    # ------------------------------------------------------------------ 逻辑

    def open_door(self) -> None:
        """打开门（动画在 update 里推进）。"""
        if self.door_opened:
            return
        self.door_opened = True
        if self.door_hinge is not None:
            self._door_hinge_start = self.door_hinge.rotation_y

    def solve_panel(self) -> None:
        """面板变绿。"""
        self.panel_solved = True
        if self.panel is not None:
            self.panel.color = _c(config.PANEL_SOLVED_COLOR)

    def update(self, dt: float) -> None:
        """面板浮动 + 门动画。"""
        self._time += dt

        # 面板（连同「打字」两个字）上下浮动
        if self.panel_root is not None:
            offset = math.sin(self._time * config.PANEL_FLOAT_SPEED) * config.PANEL_FLOAT_AMPLITUDE
            self.panel_root.y = self._panel_base_y + offset

        # 彩蛋：上下浮动 + 自转（祭坛的小方块会绕着核心转）
        for egg in self.eggs:
            if egg.get("collected"):
                continue
            entity = egg.get("entity")
            if entity is None:
                continue
            bob = math.sin(self._time * config.EGG_FLOAT_SPEED + egg["id"]) * 0.22
            entity.y = egg["base_y"] + bob
            spinner = getattr(entity, "egg_spinner", None)
            if spinner is not None:
                spinner.rotation_y += dt * config.EGG_SPIN_SPEED
            chips = getattr(entity, "egg_orbit", None)
            if chips:
                for index, chip in enumerate(chips):
                    angle = self._time * config.EGG_FLOAT_SPEED + index / len(chips) * math.tau
                    chip.x = math.sin(angle) * 1.15
                    chip.z = -math.cos(angle) * 1.15

        # 门缓缓打开
        if self.door_opened and self.door_hinge is not None:
            self.door_progress = min(1.0, self.door_progress + dt / config.DOOR_OPEN_DURATION)
            eased = self.door_progress * self.door_progress * (3 - 2 * self.door_progress)
            # 负角度 = 往走廊方向开（朝 +Z），门扇不会挡住玩家的进门口
            self.door_hinge.rotation_y = self._door_hinge_start + eased * -95
            if self.door_light is not None:
                lighting.set_light_color(
                    self.door_light,
                    config.DOOR_OPEN_LIGHT_COLOR,
                    brightness=eased * config.DOOR_LIGHT_BRIGHTNESS,
                )

    def distance_to_panel(self, position) -> float:
        if self.panel is None:
            return 1e9
        return (self.panel.world_position - position).length()

    def distance_to_exit(self, position) -> float:
        return (self.exit_position - position).length()

    def collect_egg_near(self, position) -> Optional[dict]:
        """捡起离玩家最近、且还没被捡走的彩蛋。捡到就返回它。"""
        for egg in self.eggs:
            if egg.get("collected"):
                continue
            dx = egg["x"] - position[0]
            dy = egg["y"] - position[1]
            dz = egg["z"] - position[2]
            if math.sqrt(dx * dx + dy * dy + dz * dz) > config.EGG_PICKUP_RADIUS:
                continue
            egg["collected"] = True
            entity = egg.get("entity")
            if entity is not None:
                try:
                    destroy(entity)
                except Exception:  # pragma: no cover - 销毁顺序异常时忽略
                    pass
            return egg
        return None

    def on_bounce_pad(self, position) -> bool:
        """玩家是不是正踩在弹跳板上。"""
        pad = self.bounce_pad
        if pad is None:
            return False
        dx = position[0] - pad["x"]
        dz = position[2] - pad["z"]
        if dx * dx + dz * dz > pad["radius"] ** 2:
            return False
        return abs(position[1] - pad["y"]) < 0.6

    def destroy(self) -> None:
        """销毁这一关的所有实体。"""
        for entity in list(self.entities):
            try:
                destroy(entity)
            except Exception:  # pragma: no cover - 销毁顺序异常时忽略
                pass
        self.entities.clear()
        self.panel = None
        self.panel_root = None
        self.eggs = []
        self.platforms = []
        self.bounce_pad = None
        self.door_hinge = None
        self.door_light = None
