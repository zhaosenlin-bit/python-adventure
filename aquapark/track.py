"""赛道：程序化生成巨型水滑梯，并提供「赛道空间 ↔ 世界空间」的换算。

设计要点
--------

整条滑梯是**程序化生成**的：一条中线加上每一段的「宽度 / 坡度 / 转弯 / 倾斜 /
槽壁高度」，再把横截面沿中线扫掠成实体滑槽。所有网格都是运行时算出来的，
不需要任何外部模型或贴图。

赛道用两套坐标描述：

* **赛道空间** ``(s, lateral, height)``：``s`` 是沿中线的弧长，``lateral`` 是
  偏离中线的横向距离（正数偏右），``height`` 是离滑道面的高度。
* **世界空间**：Panda3D 的 ``Vec3``。

选手、障碍物全部活在赛道空间里，物理因此变得非常干净：转弯时把人往外甩的
离心力、弯道倾斜带来的横向重力、半管槽壁把人推回中间的回复力，都能直接写成
一行公式（见 :mod:`aquapark.physics`）。

截面形状
--------

滑槽的横截面是一个**四分之一圆弧碗**：

    水面（平的） → 圆弧槽壁 → 竖直的槽口

槽壁的解析式是 ``y = wall_h * (1 - sqrt(1 - q²))``，其中 ``q`` 是归一化的
横向位置。这个式子的好处是**表面高度和表面斜率都有闭式解**，所以角色贴壁
时的视觉位置和受力可以完全一致，不会出现「看着站在坡上、物理却在平地上」
的违和感。
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from panda3d.core import Vec3

from . import config

WORLD_UP = Vec3(0, 1, 0)

# 截面顶点的种类（决定顶点颜色）
KIND_WATER = 0
KIND_WALL = 1
KIND_OUTER = 2
KIND_LIP = 3

# 障碍物种类
OBSTACLE_JET = "jet"
OBSTACLE_BOOST = "boost"
OBSTACLE_BUMPER = "bumper"
OBSTACLE_COIN = "coin"



@dataclass
class TrackNode:
    """赛道上的一个采样点。"""

    index: int
    position: Vec3
    forward: Vec3  # 指向下坡方向的单位切向量
    bank: float  # 倾斜角（弧度，正数 = 右侧抬高）
    width: float  # 该处的总宽度
    flat_half: float  # 平坦水面的半宽
    wall_height: float  # 槽壁高度（0 = 开放式滑板）
    curvature_right: float  # 曲率（弧度 / 米，正数 = 向右转）


@dataclass
class TrackSample:
    """沿赛道插值出来的某一瞬间的姿态。"""

    s: float
    position: Vec3
    forward: Vec3
    right: Vec3
    up: Vec3
    width: float
    flat_half: float
    wall_height: float
    curvature_right: float

    @property
    def half_width(self) -> float:
        return self.width * 0.5


@dataclass
class Obstacle:
    """赛道上的一个障碍物 / 收集物。"""

    kind: str
    s: float
    lateral: float
    radius: float
    node_index: int
    taken: bool = False
    extra: Dict[str, float] = field(default_factory=dict)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _lerp_vec(a: Vec3, b: Vec3, t: float) -> Vec3:
    return Vec3(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
    )


def _normalize(v: Vec3) -> Vec3:
    length = v.length()
    if length < 1e-9:
        return Vec3(0, 0, -1)
    return Vec3(v.x / length, v.y / length, v.z / length)


def compute_normals(vertices, triangles) -> List[Tuple[float, float, float]]:
    """算平滑法线（面法线累加到顶点，再归一化）。

    两个坑：

    1. Panda3D 里没有法线的几何体是**点不着灯**的（会渲染成一片死灰色），
       所以程序化网格必须自己算法线。
    2. Panda3D 是**左手坐标系**，正反面判定和右手定则相反：右手定则算出来
       指向观察者的面反而是背面，会被剔除。所以这里把结果取反，
       让法线始终指向「能看见的那一面」，光照才对。
    """
    normals = [[0.0, 0.0, 0.0] for _ in vertices]
    for triangle in triangles:
        i0, i1, i2 = triangle
        ax, ay, az = vertices[i0]
        bx, by, bz = vertices[i1]
        cx, cy, cz = vertices[i2]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        for index in (i0, i1, i2):
            normals[index][0] += nx
            normals[index][1] += ny
            normals[index][2] += nz

    result: List[Tuple[float, float, float]] = []
    for nx, ny, nz in normals:
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        if length < 1e-9:
            result.append((0.0, 1.0, 0.0))
        else:
            result.append((-nx / length, -ny / length, -nz / length))
    return result


class Track:
    """一条生成好的水滑梯。"""

    def __init__(self, seed: Optional[int] = None, segment_count: Optional[int] = None):
        self.seed = seed if seed is not None else random.randrange(1, 2**31)
        self.rng = random.Random(self.seed)
        self.segment_count = segment_count or config.SEGMENT_COUNT
        self.segment_length = config.SEGMENT_LENGTH
        self.length = self.segment_count * self.segment_length

        self.nodes: List[TrackNode] = []
        self.obstacles: List[Obstacle] = []
        # 按节点分桶，方便快速查询附近有哪些障碍物
        self._obstacle_buckets: Dict[int, List[Obstacle]] = {}
        self.open_ranges: List[Tuple[int, int]] = []

        self._build_nodes()
        self._place_obstacles()

    # -------------------------------------------------------------- 生成

    def _build_nodes(self) -> None:
        rng = self.rng
        count = self.segment_count
        length = self.segment_length

        # --- 1. 转弯序列：走一段直道，然后换一个方向，制造「蛇形」而不是「螺旋」
        yaw = 0.0
        turn = 0.0
        target_turn = 0.0
        direction = 1.0
        run_left = 0
        yaws: List[float] = []
        for _index in range(count):
            if run_left <= 0:
                run_left = rng.randint(9, 17)
                direction = -direction if rng.random() < 0.85 else direction
                if rng.random() < config.SHARP_TURN_CHANCE:
                    target_turn = direction * rng.uniform(
                        config.TURN_SHARP_DEG, config.TURN_SHARP_DEG * 1.35
                    )
                else:
                    target_turn = direction * rng.uniform(1.5, config.TURN_SMOOTH_DEG)
            run_left -= 1
            # 平滑过渡到目标转角，避免出现折线
            turn += (target_turn - turn) * 0.22
            yaw += math.radians(turn)
            yaws.append(yaw)

        # --- 2. 坡度：越往下越陡，带一点起伏
        slopes: List[float] = []
        wobble_phase = rng.uniform(0, math.tau)
        for index in range(count):
            ratio = index / max(1, count - 1)
            base = _lerp(config.START_SLOPE_DEG, config.END_SLOPE_DEG, ratio)
            wobble = config.SLOPE_WOBBLE_DEG * math.sin(index * 0.11 + wobble_phase)
            slopes.append(math.radians(max(3.0, base + wobble)))

        # --- 3. 宽度：整体略微收窄，局部有宽窄变化
        widths: List[float] = []
        width_phase = rng.uniform(0, math.tau)
        for index in range(count):
            ratio = index / max(1, count - 1)
            base = _lerp(config.START_WIDTH, 11.8, ratio)
            wave = 1.7 * math.sin(index * 0.083 + width_phase)
            widths.append(max(config.MIN_WIDTH, min(config.MAX_WIDTH, base + wave)))

        # --- 4. 开放式路段（没有槽壁，可以直接飞出去），两端平滑过渡
        openness = self._openness_profile(count)
        walls: List[float] = []
        flats: List[float] = []
        for index in range(count):
            open_ratio = openness[index]
            walls.append(config.WALL_HEIGHT * (1.0 - open_ratio))
            fraction = _lerp(config.FLAT_FRACTION, 1.0, open_ratio)
            flats.append(widths[index] * 0.5 * fraction)

        # --- 5. 积分出中线位置
        positions: List[Vec3] = [Vec3(0, 0, 0)]
        for index in range(count - 1):
            pitch = slopes[index]
            heading = yaws[index]
            forward = Vec3(
                math.sin(heading) * math.cos(pitch),
                -math.sin(pitch),
                -math.cos(heading) * math.cos(pitch),
            )
            positions.append(positions[-1] + forward * length)

        # --- 6. 每个节点的切向量与曲率
        forwards: List[Vec3] = []
        for index in range(count):
            if index == 0:
                tangent = positions[1] - positions[0]
            elif index == count - 1:
                tangent = positions[-1] - positions[-2]
            else:
                tangent = positions[index + 1] - positions[index - 1]
            forwards.append(_normalize(tangent))

        curvatures: List[float] = []
        for index in range(count):
            if index == 0:
                d_yaw = yaws[1] - yaws[0]
            elif index == count - 1:
                d_yaw = yaws[-1] - yaws[-2]
            else:
                d_yaw = yaws[index + 1] - yaws[index - 1]
            curvatures.append(d_yaw / (2.0 * length))

        # --- 7. 组装节点
        max_bank = math.radians(config.MAX_BANK_DEG)
        for index in range(count):
            curvature = curvatures[index]
            # 向右转 → 右侧压低（bank 为负），把人压进弯道
            bank = -config.BANK_GAIN * curvature
            bank = max(-max_bank, min(max_bank, bank))
            self.nodes.append(
                TrackNode(
                    index=index,
                    position=positions[index],
                    forward=forwards[index],
                    bank=bank,
                    width=widths[index],
                    flat_half=flats[index],
                    wall_height=walls[index],
                    curvature_right=curvature,
                )
            )

    def _openness_profile(self, count: int) -> List[float]:
        """算出每一段「开放式程度」（0 = 完整半管，1 = 完全敞开）。"""
        rng = self.rng
        profile = [0.0] * count
        ranges: List[Tuple[int, int]] = []
        candidates = sorted(rng.sample(range(14, max(15, count - 28)), k=max(2, count // 34)))
        for start in candidates:
            span = rng.randint(7, 13)
            end = min(count - 6, start + span)
            if ranges and start - ranges[-1][1] < 14:
                continue
            ranges.append((start, end))
        self.open_ranges = ranges

        ramp = 6  # 过渡用的节点数
        for start, end in ranges:
            for index in range(max(0, start - ramp), min(count, end + ramp)):
                if index < start:
                    ratio = 1.0 - (start - index) / ramp
                elif index >= end:
                    ratio = (index - end + 1) / ramp
                else:
                    ratio = 1.0
                # 平滑一下过渡曲线
                ratio = ratio * ratio * (3.0 - 2.0 * ratio)
                profile[index] = max(profile[index], ratio)
        return profile

    def _place_obstacles(self) -> None:
        """在赛道上布置喷泉、加速带、泡沫障碍和金币。"""
        rng = self.rng
        count = self.segment_count

        def lateral_limit(node: TrackNode) -> float:
            return max(0.0, node.flat_half - 1.1)

        def add(kind: str, node_index: int, lateral: float, radius: float, **extra) -> None:
            node = self.nodes[node_index]
            obstacle = Obstacle(
                kind=kind,
                s=node_index * self.segment_length,
                lateral=lateral,
                radius=radius,
                node_index=node_index,
                extra=extra,
            )
            self.obstacles.append(obstacle)
            self._obstacle_buckets.setdefault(node_index, []).append(obstacle)

        # 水柱喷泉：踩上去被弹到空中（「翱翔」的主要来源）
        for index in range(14, count - 10, config.JET_INTERVAL):
            node = self.nodes[index]
            limit = lateral_limit(node)
            add(
                OBSTACLE_JET,
                index,
                rng.uniform(-limit, limit),
                config.JET_RADIUS,
                height=config.JET_LAUNCH_HEIGHT,
            )

        # 加速带
        for index in range(22, count - 10, config.BOOST_INTERVAL):
            node = self.nodes[index]
            limit = lateral_limit(node)
            add(OBSTACLE_BOOST, index, rng.uniform(-limit, limit), config.BOOST_RADIUS)

        # 泡沫障碍
        for index in range(30, count - 10, config.BUMPER_INTERVAL):
            node = self.nodes[index]
            limit = lateral_limit(node)
            add(OBSTACLE_BUMPER, index, rng.uniform(-limit, limit), config.BUMPER_RADIUS)

        # 金币：沿着赛道撒一路
        for index in range(8, count - 8, config.COIN_INTERVAL):
            node = self.nodes[index]
            limit = lateral_limit(node)
            lateral = rng.uniform(-limit, limit) * rng.uniform(0.15, 1.0)
            add(OBSTACLE_COIN, index, lateral, config.COIN_RADIUS)

    # -------------------------------------------------------------- 查询

    def sample(self, s: float) -> TrackSample:
        """取赛道在弧长 ``s`` 处的姿态（越界会自动夹住）。"""
        s = max(0.0, min(self.length, s))
        raw = s / self.segment_length
        index = int(raw)
        if index >= self.segment_count - 1:
            index = self.segment_count - 2
            frac = 1.0
        else:
            frac = raw - index

        a = self.nodes[index]
        b = self.nodes[index + 1]

        position = _lerp_vec(a.position, b.position, frac)
        forward = _normalize(_lerp_vec(a.forward, b.forward, frac))

        right = _normalize(forward.cross(WORLD_UP))
        up = _normalize(right.cross(forward))

        bank = _lerp(a.bank, b.bank, frac)
        cos_b = math.cos(bank)
        sin_b = math.sin(bank)
        banked_right = _normalize(right * cos_b + up * sin_b)
        banked_up = _normalize(up * cos_b - right * sin_b)

        return TrackSample(
            s=s,
            position=position,
            forward=forward,
            right=banked_right,
            up=banked_up,
            width=_lerp(a.width, b.width, frac),
            flat_half=_lerp(a.flat_half, b.flat_half, frac),
            wall_height=_lerp(a.wall_height, b.wall_height, frac),
            curvature_right=_lerp(a.curvature_right, b.curvature_right, frac),
        )

    def node_at(self, index: int) -> TrackNode:
        return self.nodes[max(0, min(self.segment_count - 1, index))]

    def obstacles_between(self, s0: float, s1: float) -> List[Obstacle]:
        """取一段弧长范围内的所有障碍物。"""
        if s1 < s0:
            s0, s1 = s1, s0
        i0 = max(0, int(s0 / self.segment_length) - 1)
        i1 = min(self.segment_count - 1, int(s1 / self.segment_length) + 1)
        result: List[Obstacle] = []
        for index in range(i0, i1 + 1):
            result.extend(self._obstacle_buckets.get(index, ()))
        return result

    # ------------------------------------------------------- 表面几何

    @staticmethod
    def surface_height(sample: TrackSample, lateral: float) -> float:
        """某个横向位置上的槽面高度（相对于槽底平面）。"""
        distance = abs(lateral)
        flat = sample.flat_half
        edge = sample.half_width
        if distance <= flat or edge <= flat + 1e-4:
            return 0.0
        q = min(1.0, (distance - flat) / (edge - flat))
        return sample.wall_height * (1.0 - math.sqrt(max(0.0, 1.0 - q * q)))

    @staticmethod
    def surface_derivative(sample: TrackSample, lateral: float) -> float:
        """槽面高度对横向位置的导数（用来算「顺着槽壁滑下去」的重力）。"""
        distance = abs(lateral)
        flat = sample.flat_half
        edge = sample.half_width
        if distance <= flat or edge <= flat + 1e-4:
            return 0.0
        if sample.wall_height <= 0.0:
            return 0.0
        ratio = sample.wall_height / (edge - flat)
        q = min(1.0, (distance - flat) / (edge - flat))
        # 槽壁到了最顶端就是一面竖直的墙，斜率趋于无穷；夹一下避免数值爆炸
        slope = ratio * q / math.sqrt(max(1e-4, 1.0 - q * q))
        slope = min(slope, 8.0)
        return slope if lateral > 0 else -slope

    def world_at(self, s: float, lateral: float, height: float = 0.0) -> Vec3:
        """赛道空间 → 世界空间。"""
        sample = self.sample(s)
        surface = self.surface_height(sample, lateral)
        return sample.position + sample.right * lateral + sample.up * (surface + height)

    # -------------------------------------------------------------- 网格

    def _cross_section(self, node: TrackNode) -> List[Tuple[float, float, int]]:
        """算出某个节点的横截面采样点——一条**闭合**轮廓。

        轮廓从左侧外壁顶部出发，绕过外壳底部、右侧槽壁、水面、左侧槽壁，
        再回到起点。整条滑槽因此是**一根管子**：外面是橙色塑料外壳，
        里面是黄色槽壁，槽底是蓝色水面。

        做成单根管子（而不是「外壳 + 水面」两个网格）有两个好处：

        1. 不会出现两个网格之间的接缝 / z-fighting；
        2. 法线方向天然一致，整条滑槽的受光表现统一。
        """
        edge = node.width * 0.5
        flat = node.flat_half
        wall = node.wall_height
        depth = config.FLUME_DEPTH
        lip = 0.45  # 槽口往外挑出的宽度
        span = max(0.0, edge - flat)

        points: List[Tuple[float, float, int]] = []

        # 外壳：左上 → 左下 → 右下 → 右上
        points.append((-(edge + lip), wall, KIND_LIP))
        points.append((-(edge + lip), -depth, KIND_OUTER))
        points.append((edge + lip, -depth, KIND_OUTER))
        points.append((edge + lip, wall, KIND_LIP))
        # 右槽口
        points.append((edge, wall, KIND_LIP))
        # 右槽壁：从槽口一路卷到水面根部
        for step in (0.75, 0.5, 0.25):
            angle = step * math.pi * 0.5
            points.append(
                (flat + span * math.sin(angle), wall * (1.0 - math.cos(angle)), KIND_WALL)
            )
        # 水面（横着铺开，是整个截面里唯一「平」的一段）
        points.append((flat, 0.0, KIND_WATER))
        points.append((flat * 0.55, 0.0, KIND_WATER))
        points.append((0.0, 0.0, KIND_WATER))
        points.append((-flat * 0.55, 0.0, KIND_WATER))
        points.append((-flat, 0.0, KIND_WATER))
        # 左槽壁：从水面根部卷回左槽口
        for step in (0.25, 0.5, 0.75):
            angle = step * math.pi * 0.5
            points.append(
                (-(flat + span * math.sin(angle)), wall * (1.0 - math.cos(angle)), KIND_WALL)
            )
        # 左槽口（再走一步就回到起点的外壁左上，闭合）
        points.append((-edge, wall, KIND_LIP))
        return points

    def build_mesh_data(self) -> Dict[str, List]:
        """算出滑槽的网格数据（整条滑槽 = 一根管子 = 一个网格）。

        顶点颜色区分外壳 / 槽壁 / 水面，贴图沿赛道方向铺开，
        滚动贴图的 v 偏移就能做出「水在往下流」的效果。
        """
        tile = 9.0  # 每 9 个世界单位重复一次贴图

        mesh = self._new_mesh()
        rows: List[List[int]] = []

        for index, node in enumerate(self.nodes):
            section = self._cross_section(node)
            rows.append(
                self._append_row(mesh, node, section, index * self.segment_length, tile)
            )

        # 截面是闭合轮廓，所以条带要首尾相连
        self._append_strip(mesh, rows, closed=True)
        mesh["normals"] = compute_normals(mesh["vertices"], mesh["triangles"])
        return mesh

    @staticmethod
    def _new_mesh() -> Dict[str, List]:
        return {"vertices": [], "triangles": [], "uvs": [], "colors": []}

        """把一个横截面点成一行顶点追加到网格里，返回这一行的顶点下标。"""
    def _append_row(
        self,
        mesh: Dict[str, List],
        node: TrackNode,
        points: List[Tuple[float, float, int]],
        s: float,
        tile: float,
    ) -> List[int]:
        row: List[int] = []
        forward = node.forward
        right = _normalize(forward.cross(WORLD_UP))
        up = _normalize(right.cross(forward))
        cos_b = math.cos(node.bank)
        sin_b = math.sin(node.bank)
        banked_right = _normalize(right * cos_b + up * sin_b)
        banked_up = _normalize(up * cos_b - right * sin_b)

        span = node.width * 0.5 + 0.45  # 贴图 u 方向的半宽
        for lateral, height, kind in points:
            position = node.position + banked_right * lateral + banked_up * height
            mesh["vertices"].append((position.x, position.y, position.z))
            mesh["uvs"].append(((lateral / span) * 0.5 + 0.5, s / tile))
            if kind == KIND_WATER:
                mesh["colors"].append((*config.WATER_COLOR, 1.0))
            elif kind == KIND_WALL:
                mesh["colors"].append((*config.SLIDE_COLOR, 1.0))
            elif kind == KIND_OUTER:
                mesh["colors"].append((*config.SLIDE_OUTER, 1.0))
            else:
                mesh["colors"].append((*config.SLIDE_LIP, 1.0))
            row.append(len(mesh["vertices"]) - 1)
        return row

    @staticmethod
    def _append_strip(
        mesh: Dict[str, List],
        rows: List[List[int]],
        closed: bool = False,
        flip: bool = False,
    ) -> None:
        """把一串「每行点数相同」的顶点行连成三角形条带。

        ``closed=True`` 表示截面是闭合轮廓（最后一个点和第一个点也要连）。
        """
        for index in range(len(rows) - 1):
            a = rows[index]
            b = rows[index + 1]
            count = len(a) if closed else len(a) - 1
            for j in range(count):
                j2 = (j + 1) % len(a)
                if flip:
                    mesh["triangles"].append((a[j], b[j2], a[j2]))
                    mesh["triangles"].append((a[j], b[j], b[j2]))
                else:
                    mesh["triangles"].append((a[j], a[j2], b[j2]))
                    mesh["triangles"].append((a[j], b[j2], b[j]))

    def _node_point(self, node: TrackNode, lateral: float, height: float) -> Vec3:
        """节点局部坐标 → 世界坐标（含倾斜）。"""
        forward = node.forward
        right = _normalize(forward.cross(WORLD_UP))
        up = _normalize(right.cross(forward))
        cos_b = math.cos(node.bank)
        sin_b = math.sin(node.bank)
        banked_right = _normalize(right * cos_b + up * sin_b)
        banked_up = _normalize(up * cos_b - right * sin_b)
        return node.position + banked_right * lateral + banked_up * height

    # -------------------------------------------------------------- 装饰

    def decoration_slots(self) -> Dict[str, List[Tuple[int, float]]]:
        """给出装饰物的摆放位置。

        返回 ``{'arch': [(节点序号, 侧向偏移), ...], 'cloud': [...]}``。
        拱门横跨赛道，飞行员看到它们会更有速度感；云朵在赛道下方飘着，
        负责制造高度和纵深。
        """
        rng = random.Random(self.seed ^ 0x5EED)
        arches: List[Tuple[int, float]] = []
        for index in range(18, self.segment_count - 8, 16):
            arches.append((index, 0.0))

        clouds: List[Tuple[int, float]] = []
        for index in range(6, self.segment_count - 6, 7):
            side = rng.choice((-1, 1))
            offset = rng.uniform(15.0, 36.0)
            clouds.append((index, side * offset))

        return {"arch": arches, "cloud": clouds}
