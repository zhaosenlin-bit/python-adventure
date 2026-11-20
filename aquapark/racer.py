"""选手：玩家和 AI 共用的一套「状态 + 外观」。

玩家和 AI 的差别只有一处：**谁来产生 Controls**。
玩家由键盘 / 鼠标 / 手柄产生，AI 由 :meth:`Racer.ai_controls` 产生，
剩下的物理、外观、碰撞逻辑完全一致。
"""

from __future__ import annotations

import math
import random
from typing import List, Optional, Sequence

from ursina import Entity, Vec3, color, destroy

from . import collection, config, models, physics
from .physics import Controls, RiderState
from .track import Track


def _clamp(value: float, low: float, high: float) -> float:
    return low if value < low else (high if value > high else value)


class Racer:
    """一个参赛选手。"""

    def __init__(
        self,
        index: int,
        name: str,
        rgb: Sequence[float],
        is_player: bool = False,
        parent: Optional[Entity] = None,
    ) -> None:
        self.index = index
        self.name = name
        self.rgb = tuple(rgb)
        self.is_player = is_player
        self.state = RiderState()

        self.entity = models.build_racer(self.rgb, is_player)
        if parent is not None:
            self.entity.parent = parent

        # 成绩
        self.coins = 0
        self.ko_count = 0
        self.place = 0
        self.respawn_timer = 0.0
        self.out = False  # 被淘汰（暂时退出比赛）
        self.finished = False

        # AI 用的随机性
        self.rng = random.Random(1000 + index * 7919)
        self.noise_phase = self.rng.random() * math.tau
        self.ai_jump_cooldown = 0.0
        self.ai_dive_cooldown = 0.0
        self.speed_scale = 1.0  # 橡皮筋算出来的速度倍率
        # 各种效果的冷却（防止同一个障碍物被反复触发）
        self.jet_cooldown = 0.0
        self.boost_cooldown = 0.0
        self.bump_cooldown = 0.0

        # 外观动画用的初始姿势
        self.arm_base = [Vec3(*arm.position) for arm in self.entity.racer_arms]
        self.leg_base = [Vec3(*leg.position) for leg in self.entity.racer_legs]
        self.spin = 0.0
        self.paddle_phase = self.rng.random() * math.tau
        self.equipped_id: Optional[str] = None  # 头顶挂着的收藏品

    # -------------------------------------------------------------- 生命周期

    def spawn(self, track: Track, s: float, lateral: float = 0.0, v_s: float = 0.0) -> None:
        """把选手放回赛道上的某个位置。"""
        self.state.reset(s=s, lateral=lateral, v_s=v_s)
        self.out = False
        self.respawn_timer = 0.0
        self.spin = 0.0
        self.entity.enabled = True
        self.entity.scale = 1.0

    def knockout(self) -> None:
        """被撞出水面：暂时退出比赛，等会儿再回来。"""
        if self.out:
            return
        self.out = True
        self.respawn_timer = (
            config.PLAYER_KO_RESPAWN_DELAY if self.is_player else config.KO_RESPAWN_DELAY
        )
        physics.apply_knockout(self.state)
        self.state.events.clear()

    def update_respawn(self, track: Track, dt: float, leader_s: float) -> bool:
        """处理重生倒计时。返回 True 表示这一帧刚重生。"""
        if not self.out:
            return False
        self.respawn_timer -= dt
        if self.respawn_timer > 0.0:
            self.entity.enabled = False
            return False

        # 回到领先者后面一段距离，给落后者翻盘的机会
        behind = min(track.length - 4.0, max(0.0, leader_s - config.KO_RESPAWN_BACK))
        self.spawn(track, behind, lateral=self.rng.uniform(-2.0, 2.0), v_s=6.0)
        return True

    # -------------------------------------------------------------- AI

    def ai_controls(self, track: Track, player_state: RiderState, dt: float) -> Controls:
        """AI 的输入。

        思路很简单但够用：

        1. 往**弯道内侧**靠（弯道会把人往外甩，AI 得提前往里压）；
        2. 再叠一点随机的横向漂移，避免所有 AI 走同一条线；
        3. 看到喷泉就冲过去借力腾空；看到对手在前面就偶尔俯冲砸下去。
        """
        state = self.state
        controls = Controls()

        sample = track.sample(state.s)
        look_ahead = track.sample(min(track.length, state.s + 20.0))

        # 弯道内侧 + 噪声
        target = look_ahead.curvature_right * 110.0
        target += math.sin(state.s * 0.045 + self.noise_phase) * 2.4
        target += math.sin(elapsed_noise(state.s, self.index)) * 0.8
        limit = max(0.5, sample.flat_half * 0.85)
        target = _clamp(target, -limit, limit)

        error = target - state.lateral
        steer = error * 0.42 - state.v_lateral * 0.26
        controls.steer = _clamp(steer, -1.0, 1.0)

        # 橡皮筋：落后就加速追，领先就稍微放水
        gap = player_state.s - state.s
        if gap > 0:
            scale = 1.0 + _clamp(gap / 160.0, 0.0, 1.0) * config.AI_RUBBER_BAND
        else:
            scale = 1.0 - _clamp(-gap / 200.0, 0.0, 1.0) * config.AI_RUBBER_BAND * 0.55
        self.speed_scale = _clamp(scale, 0.6, 1.5)

        self.ai_jump_cooldown = max(0.0, self.ai_jump_cooldown - dt)
        self.ai_dive_cooldown = max(0.0, self.ai_dive_cooldown - dt)

        # 喷泉在前面就去蹭一下，蹭到就能腾空
        if self.ai_jump_cooldown <= 0.0 and self.rng.random() < config.AI_JUMP_CHANCE:
            controls.jump = True
            self.ai_jump_cooldown = 1.2

        # 俯冲砸人
        if self.ai_dive_cooldown <= 0.0 and state.airborne and gap > 0 and gap < 16.0:
            if self.rng.random() < 0.06:
                controls.dive = True
                self.ai_dive_cooldown = 2.5

        return controls

    # -------------------------------------------------------------- 外观
    def tick_cooldowns(self, dt: float) -> None:
        """冷却计时。"""
        self.jet_cooldown = max(0.0, self.jet_cooldown - dt)
        self.boost_cooldown = max(0.0, self.boost_cooldown - dt)
        self.bump_cooldown = max(0.0, self.bump_cooldown - dt)


    def set_equipped(self, item_id: Optional[str]) -> None:
        """把头顶的金色箭头换成当前装备的收藏品。"""
        if item_id == self.equipped_id:
            return
        self.equipped_id = item_id

        old = getattr(self.entity, "racer_marker", None)
        if old is not None:
            destroy(old)
            self.entity.racer_marker = None

        if item_id:
            icon = collection.build_icon(item_id)
            icon.parent = self.entity
            icon.position = (0, 1.95, 0)
            icon.scale = 2.8
            self.entity.racer_marker = icon
        elif self.is_player:
            # 没有装备时换回金色箭头
            self.entity.racer_marker = models.cone(
                0.34,
                0.55,
                parent=self.entity,
                position=(0, 1.62, 0),
                rotation=(180, 0, 0),
                color=color.rgba(*config.UI_GOLD, 1.0),
            )

        """把状态同步到模型上。"""
    def update_visual(self, track: Track, dt: float, elapsed: float, sample=None) -> None:
        state = self.state
        if sample is None:
            sample = track.sample(state.s)

        position = physics.world_position(track, state, sample)
        self.entity.position = position

        # 朝向前方一小段，同时让身体跟着滑道的倾斜一起歪
        ahead_s = min(track.length, state.s + 3.2)
        target = track.world_at(ahead_s, state.lateral * 0.7, state.height)
        self.entity.look_at(target, up=sample.up)

        # 翻滚：腾空时转圈，俯冲时转得更快
        if state.airborne:
            spin_speed = 420.0 if state.diving else 240.0
            self.spin += spin_speed * dt
        else:
            self.spin *= max(0.0, 1.0 - 8.0 * dt)
        self.entity.racer_tilt.rotation_z = self.spin

        # 划水 / 打腿动画
        speed_factor = _clamp(state.v_s / 18.0, 0.0, 1.6)
        self.paddle_phase += dt * (5.0 + speed_factor * 9.0)
        wave = math.sin(self.paddle_phase)
        for index, arm in enumerate(self.entity.racer_arms):
            base = self.arm_base[index]
            side = 1 if index == 0 else -1
            arm.position = Vec3(
                base.x + side * wave * 0.22,
                base.y + abs(wave) * 0.12,
                base.z + wave * 0.18,
            )
        leg_wave = math.sin(self.paddle_phase + math.pi)
        for index, leg in enumerate(self.entity.racer_legs):
            base = self.leg_base[index]
            leg.position = Vec3(base.x, base.y + abs(leg_wave) * 0.1, base.z + leg_wave * 0.2)

        # 被撞飞时翻滚得更夸张
        if self.out:
            self.entity.racer_tilt.rotation_z += dt * 320.0


def elapsed_noise(s: float, index: int) -> float:
    """给 AI 用的一点点伪随机相位（避免所有 AI 同步摆动）。"""
    return s * 0.013 + index * 1.7
