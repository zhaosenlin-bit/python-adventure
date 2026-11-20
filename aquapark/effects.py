"""特效：水花、飞溅、速度尾迹。

用的是一个**固定容量的粒子池**：粒子实体一开始就全部建好，之后只是
反复启用 / 禁用和改位置，不会每帧新建销毁实体——在 Panda3D 里新建实体的
开销很大，跑一局下来会明显掉帧。
"""

from __future__ import annotations

import math
import random
from typing import List, Optional, Sequence

from ursina import Entity, Vec3, color

from . import config


class Particle:
    """一个可复用的粒子。"""

    __slots__ = ("entity", "velocity", "life", "max_life", "size", "gravity", "spin")

    def __init__(self, entity: Entity) -> None:
        self.entity = entity
        self.velocity = Vec3(0, 0, 0)
        self.life = 0.0
        self.max_life = 1.0
        self.size = 0.3
        self.gravity = 22.0
        self.spin = 0.0


class Effects:
    """所有水花 / 飞溅效果的总控。"""

    def __init__(self, parent: Optional[Entity] = None, capacity: int = 160) -> None:
        self.root = Entity(parent=parent)
        self.rng = random.Random(4242)
        self.particles: List[Particle] = []

        for _ in range(capacity):
            entity = Entity(
                parent=self.root,
                model="sphere",
                scale=0.3,
                color=color.rgba(0.85, 0.96, 1.0, 1.0),
                enabled=False,
            )
            self.particles.append(Particle(entity))

        # 水花圆环：落地 / 被撞飞时扩散的一圈涟漪
        self.alive = 0  # 当前活着的粒子数（为 0 时可以整段跳过更新）
        self.rings: List[dict] = []
        for _ in range(10):
            entity = Entity(
                parent=self.root,
                model="sphere",
                scale=0.2,
                color=color.rgba(1.0, 1.0, 1.0, 1.0),
                enabled=False,
            )
            self.rings.append({"entity": entity, "life": 0.0, "max_life": 0.5, "size": 1.0})

    # ---------------------------------------------------------------- 发射

    def _take(self) -> Optional[Particle]:
        for particle in self.particles:
            if particle.life <= 0.0:
                return particle
        return None

    def emit(
        self,
        position: Vec3,
        velocity: Vec3,
        life: float = 0.6,
        size: float = 0.3,
        tint: Optional[Sequence[float]] = None,
        gravity: float = 22.0,
    ) -> None:
        """发射一个粒子。"""
        particle = self._take()
        if particle is None:
            return
        particle.entity.enabled = True
        particle.entity.position = position
        particle.entity.scale = size
        if tint is not None:
            particle.entity.color = color.rgba(tint[0], tint[1], tint[2], 1.0)
        particle.velocity = velocity
        particle.life = life
        particle.max_life = life
        particle.size = size
        particle.gravity = gravity
        self.alive += 1

    def splash(self, position: Vec3, power: float = 1.0, count: int = 10) -> None:
        """落水 / 被撞时炸开一团水花。"""
        for _ in range(count):
            angle = self.rng.random() * math.tau
            speed = self.rng.uniform(2.0, 7.0) * power
            velocity = Vec3(
                math.cos(angle) * speed * 0.7,
                self.rng.uniform(3.0, 8.0) * power,
                math.sin(angle) * speed * 0.7,
            )
            self.emit(
                position,
                velocity,
                life=self.rng.uniform(0.35, 0.75),
                size=self.rng.uniform(0.16, 0.36) * power,
            )

    def spray(self, position: Vec3, forward: Vec3, speed: float) -> None:
        """选手滑行时身后拖出的水雾。"""
        if speed < 8.0:
            return
        for _ in range(2):
            offset = Vec3(
                self.rng.uniform(-0.5, 0.5),
                self.rng.uniform(0.1, 0.5),
                self.rng.uniform(-0.5, 0.5),
            )
            velocity = forward * -self.rng.uniform(1.5, 4.5) + Vec3(
                self.rng.uniform(-1.2, 1.2),
                self.rng.uniform(1.2, 3.4),
                self.rng.uniform(-1.2, 1.2),
            )
            self.emit(
                position + offset,
                velocity,
                life=self.rng.uniform(0.25, 0.5),
                size=self.rng.uniform(0.12, 0.26),
            )

    def ring(self, position: Vec3, size: float = 2.4, life: float = 0.5) -> None:
        """扩散的涟漪圈。"""
        for ring in self.rings:
            if ring["life"] <= 0.0:
                ring["entity"].enabled = True
                ring["entity"].position = position
                ring["entity"].scale = 0.2
                ring["life"] = life
                ring["max_life"] = life
                ring["size"] = size
                return

    def burst(self, position: Vec3, tint: Sequence[float], count: int = 14) -> None:
        """被撞出水面时的彩色冲击。"""
        for _ in range(count):
            angle = self.rng.random() * math.tau
            speed = self.rng.uniform(3.0, 9.0)
            velocity = Vec3(
                math.cos(angle) * speed,
                self.rng.uniform(4.0, 10.0),
                math.sin(angle) * speed,
            )
            self.emit(
                position,
                velocity,
                life=self.rng.uniform(0.4, 0.9),
                size=self.rng.uniform(0.2, 0.45),
                tint=tint,
            )

    # ---------------------------------------------------------------- 更新

    def update(self, dt: float) -> None:
        if self.alive <= 0:
            return  # 没有活粒子时整段跳过，省掉每帧几百次遍历

        for particle in self.particles:
            if particle.life <= 0.0:
                continue
            particle.life -= dt
            if particle.life <= 0.0:
                particle.entity.enabled = False
                self.alive -= 1
                continue
            particle.velocity.y -= particle.gravity * dt
            particle.entity.position += particle.velocity * dt
            # 用缩小代替淡出，省掉透明排序的开销
            ratio = max(0.0, particle.life / particle.max_life)
            particle.entity.scale = particle.size * (0.35 + 0.65 * ratio)

        for ring in self.rings:
            if ring["life"] <= 0.0:
                continue
            ring["life"] -= dt
            if ring["life"] <= 0.0:
                ring["entity"].enabled = False
                continue
            ratio = 1.0 - ring["life"] / ring["max_life"]
            scale = 0.2 + ring["size"] * ratio
            ring["entity"].scale = (scale, scale * 0.18, scale)

    def clear(self) -> None:
        for particle in self.particles:
            particle.life = 0.0
            particle.entity.enabled = False
        for ring in self.rings:
            ring["life"] = 0.0
            ring["entity"].enabled = False
        self.alive = 0
