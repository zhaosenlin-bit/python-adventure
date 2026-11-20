"""赛道空间物理：选手在滑道上的运动。

为什么用「赛道空间」
-------------------

如果直接在世界空间做刚体物理，滑道会变成一堆需要碰撞体拼起来的三角形，
而「弯道把人甩出去」「槽壁把人推回来」这类手感也几乎调不出来。

这里改成让选手活在一组简化坐标里：

======================  ==========================================
``s``                   沿滑道中线的弧长（米）
``v_s``                 沿滑道的速度
``lateral`` / ``v_lateral``  横向位置与横向速度（正数偏右）
``height`` / ``v_height``    离滑道面的高度与垂直速度
======================  ==========================================

世界的复杂度被压缩进三个「赛道属性」里：

* ``forward`` —— 决定重力沿滑道方向的分量（越陡滑得越快）；
* ``curvature_right`` —— 决定离心力（转弯时把人甩向外侧）；
* ``bank`` + 槽面斜率 —— 决定横向重力（弯道倾斜把人压向弯内侧，
  槽壁则把人推回水槽中间）。

这样每一条受力都能写成一行公式，手感调节也只动几个常数。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from panda3d.core import Vec3

from . import config
from .track import Track, TrackSample

GRAVITY_VECTOR = Vec3(0, -config.GRAVITY, 0)


@dataclass
class Controls:
    """一帧的输入。"""

    steer: float = 0.0  # -1（左）~ +1（右）
    jump: bool = False  # 请求起跳
    dive: bool = False  # 请求俯冲（空中）/ 压低身体（地面）


@dataclass
class RiderState:
    """一个选手在赛道上的完整状态。"""

    s: float = 0.0
    v_s: float = 0.0
    lateral: float = 0.0
    v_lateral: float = 0.0
    height: float = 0.0
    v_height: float = 0.0

    airborne: bool = False
    diving: bool = False
    wall_contact: bool = False  # 上一帧是不是已经贴着槽壁了
    boosting: float = 0.0  # 剩余加速时间
    stunned: float = 0.0  # 剩余眩晕时间
    finished: bool = False
    finish_time: float = 0.0
    out_of_track: bool = False  # 飞出滑道（掉下去）

    # 每帧被外部写入的「事件」标记，由 game.py 消费
    events: list = field(default_factory=list)

    @property
    def speed(self) -> float:
        return self.v_s

    def reset(self, s: float = 0.0, lateral: float = 0.0, v_s: float = 0.0) -> None:
        """把状态复位到赛道的某个位置（重生用）。"""
        self.s = s
        self.v_s = v_s
        self.lateral = lateral
        self.v_lateral = 0.0
        self.height = 0.0
        self.v_height = 0.0
        self.airborne = False
        self.diving = False
        self.wall_contact = False
        self.boosting = 0.0
        self.stunned = 0.0
        self.finished = False
        self.out_of_track = False


def lateral_gravity(track: Track, sample: TrackSample, lateral: float) -> float:
    """重力在横向（左右）上的分量。

    重力沿滑道横截面切向的分量，就是「顺着槽壁往下滑」的那股力：
    平的槽底上是 0，弯道上因为整条滑槽倾斜了，所以不为 0，
    越靠近槽壁越大（会把你往水槽中间拽）。
    """
    slope = track.surface_derivative(sample, lateral)
    tangent = sample.right + sample.up * slope
    length = tangent.length()
    if length < 1e-6:
        return 0.0
    tangent = Vec3(tangent.x / length, tangent.y / length, tangent.z / length)
    return GRAVITY_VECTOR.dot(tangent)


def step(
    state: RiderState,
    track: Track,
    controls: Controls,
    dt: float,
    speed_scale: float = 1.0,
) -> None:
    """推进一个选手一帧。"""
    if state.finished:
        # 冲过终点线之后继续往前滑一段，速度快速衰减
        state.v_s = max(0.0, state.v_s - state.v_s * 2.2 * dt)
        state.s = min(track.length + 30.0, state.s + state.v_s * dt)
        return

    if dt <= 0.0:
        return

    sample = track.sample(state.s)

    # ---------------------------------------------------- 沿滑道方向
    gravity_along = -config.GRAVITY * sample.forward.y  # 下坡为正
    accel = gravity_along + config.PADDLE_ACCEL * speed_scale
    accel -= config.TRACK_FRICTION * state.v_s
    accel -= config.TRACK_DRAG * state.v_s * state.v_s

    if state.boosting > 0.0:
        state.boosting = max(0.0, state.boosting - dt)
        accel += 26.0
    if state.stunned > 0.0:
        state.stunned = max(0.0, state.stunned - dt)
        accel *= 0.25

    state.v_s += accel * dt
    top_speed = config.BOOST_SPEED if state.boosting > 0.0 else config.MAX_SPEED
    state.v_s = max(0.0, min(state.v_s, top_speed))
    state.s += state.v_s * dt

    # ---------------------------------------------------- 横向
    a_lat = lateral_gravity(track, sample, state.lateral)
    a_lat += config.STEER_ACCEL * controls.steer
    a_lat -= config.LATERAL_DAMP * state.v_lateral
    # 离心力：弯道把人甩向外侧（曲率为正 = 向右转 = 往左甩）
    a_lat -= sample.curvature_right * state.v_s * state.v_s * config.CENTRIFUGAL

    state.v_lateral += a_lat * dt
    state.lateral += state.v_lateral * dt

    limit = sample.half_width
    if abs(state.lateral) > limit:
        state.lateral = math.copysign(limit, state.lateral)
        bounce = config.WALL_BOUNCE if state.airborne else config.WALL_BOUNCE * 0.6
        # 已经贴着槽壁滑行时**不重复扣速度**——否则会被每帧 0.93 磨到停住
        if not state.wall_contact:
            state.v_s *= config.WALL_SPEED_LOSS
            state.events.append("wall")
        state.v_lateral = -state.v_lateral * bounce
        state.wall_contact = True
    else:
        state.wall_contact = False

    # ---------------------------------------------------- 垂直
    if state.airborne:
        state.v_height -= config.GRAVITY * dt
        state.height += state.v_height * dt

        if controls.dive and not state.diving:
            state.diving = True
            state.v_height = config.DIVE_SPEED
            state.events.append("dive")

        if state.height <= 0.0:
            state.height = 0.0
            state.airborne = False
            landing_loss = (
                config.DIVE_LAND_SPEED_LOSS if state.diving else config.LAND_SPEED_LOSS
            )
            state.v_s *= landing_loss
            state.diving = False
            state.events.append("land")
    else:
        if controls.jump:
            state.airborne = True
            state.v_height = config.JUMP_SPEED
            state.height = 0.001
            state.events.append("jump")
        elif controls.dive:
            # 地面俯冲：压低身体、贴着水面冲一小段
            state.v_s *= 1.015

    # 空中轻微空气阻力
    if state.airborne:
        state.v_s -= config.AIR_DRAG * state.v_s * dt

    # ---------------------------------------------------- 终点
    if state.s >= track.length and not state.finished:
        state.finished = True
        state.events.append("finish")


def world_position(track: Track, state: RiderState, sample=None) -> Vec3:
    """选手在世界空间里的位置（脚底）。

    ``sample`` 可以由调用方传进来复用（同一帧里反复采样很费）。
    """
    if sample is None:
        sample = track.sample(state.s)
    surface = track.surface_height(sample, state.lateral)
    return sample.position + sample.right * state.lateral + sample.up * (surface + state.height)


def world_heading(track: Track, state: RiderState) -> Vec3:
    """选手面朝的方向（沿滑道向前）。"""
    return track.sample(state.s).forward


def lateral_offset_between(a: RiderState, b: RiderState) -> float:
    """两个选手之间的横向距离（用来判断是否撞上了）。"""
    return a.lateral - b.lateral


def longitudinal_gap(a: RiderState, b: RiderState) -> float:
    """两个选手之间的纵向距离（正值 = a 在 b 前面）。"""
    return a.s - b.s


def is_diving(state: RiderState) -> bool:
    """是否正在俯冲（俯冲撞人 = 把对手撞出水面）。"""
    return state.airborne and state.v_height < -6.0


def apply_launch(state: RiderState, speed: float = config.JET_LAUNCH_SPEED) -> None:
    """被水柱喷泉弹到空中。"""
    state.airborne = True
    state.diving = False
    state.v_height = max(state.v_height, speed)
    state.height = max(state.height, 0.05)
    state.events.append("launch")


def apply_boost(state: RiderState, duration: float = config.BOOST_TIME) -> None:
    """踩上加速带。"""
    state.boosting = max(state.boosting, duration)
    state.events.append("boost")


def apply_bump(state: RiderState, push: float) -> None:
    """被撞到：横向被推开，并掉一点速度。"""
    state.v_lateral += push
    state.v_s *= config.BUMP_SPEED_LOSS
    state.events.append("bump")


def apply_knockout(state: RiderState) -> None:
    """被撞出水面：短暂失控，然后会重生。"""
    state.stunned = 1.2
    state.v_s *= 0.55
    state.events.append("knockout")
