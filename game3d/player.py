"""第一人称 / 第三人称控制器。

自己实现（而不是直接用 Ursina 自带的 FirstPersonController 预制体），
主要是为了能随时冻结移动、单独控制鼠标锁定状态，方便和打字窗口切换。
移动与碰撞沿用 Ursina 预制体里那套成熟的射线检测方案。

摄像机本身**不**挂在玩家实体下面，而是由 ``Game`` 持有一个独立的挂台（rig），
本类只维护 ``yaw`` / ``pitch`` 两个角度。这样换关卡销毁玩家实体时，
摄像机不会被连带销毁（Ursina 销毁父节点会连子节点一起销毁）。
"""

from __future__ import annotations

from ursina import (
    Entity,
    Vec2,
    Vec3,
    camera,
    clamp,
    color,
    destroy,
    mouse,
    raycast,
    scene,
    time,
)

from . import config


class PlayerController(Entity):
    """WASD 移动 + 鼠标转视角 + 重力 + 射线碰撞。"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        self.speed = config.PLAYER_SPEED
        self.height = config.PLAYER_HEIGHT
        self.gravity = config.PLAYER_GRAVITY_ACCEL
        self.jump_velocity = config.PLAYER_JUMP_VELOCITY
        self.mouse_sensitivity = Vec2(config.MOUSE_SENSITIVITY, config.MOUSE_SENSITIVITY)

        self.can_move = True
        self.grounded = False
        self.air_time = 0.0
        # 竖直速度（单位 / 秒）：跳跃、下落、弹跳板共用这一条通道
        self.vertical_velocity = 0.0
        self.direction = Vec3(0, 0, 0)
        self.ignore_list = [self]
        self.traverse_target = scene

        # 视角角度（度）：yaw 水平转头，pitch 上下抬头
        # 摄像机每帧由 Game 读取这两个值来摆放
        self.yaw = 0.0
        self.pitch = 0.0

        # 准星
        self.crosshair = Entity(
            parent=camera.ui,
            model="quad",
            color=color.rgba(1, 1, 1, 0.55),
            # camera.ui 自带 20 倍缩放，所以这里的数值要比想象中小很多
            scale=0.0007,
            rotation_z=45,
        )

        # 第三人称时显示的角色（纯几何体拼的）
        # 没有碰撞体，所以不会挡住玩家自己的移动射线
        self.avatar = Entity(
            parent=self,
            model="cube",
            scale=(0.72, 1.15, 0.5),
            y=0.95,
            color=color.rgba(0.42, 0.72, 1.0, 1.0),
            enabled=False,
        )
        Entity(
            parent=self.avatar,
            model="cube",
            scale=(0.44, 0.44, 0.44),
            y=0.82,
            color=color.rgba(0.96, 0.88, 0.76, 1.0),
        )

        for key, value in kwargs.items():
            setattr(self, key, value)

    # ------------------------------------------------------------------ 输入

    def set_mouse_locked(self, locked: bool) -> None:
        mouse.locked = locked
        self.crosshair.enabled = locked

    def freeze(self) -> None:
        """冻结移动（打字窗口打开时）。"""
        self.can_move = False
        self.direction = Vec3(0, 0, 0)

    def unfreeze(self) -> None:
        self.can_move = True

    def on_destroy(self) -> None:
        """玩家实体被销毁时，顺手把准星收掉（准星不在玩家子树里）。"""
        try:
            destroy(self.crosshair)
        except Exception:  # pragma: no cover - 销毁顺序异常时忽略
            pass

    def input(self, key: str) -> None:
        if key == "space" and self.can_move and self.grounded:
            self.jump()

    # ------------------------------------------------------------------ 物理

    def jump(self) -> None:
        """起跳：给一个向上的初速度（最高点 = v² / 2g）。"""
        self.grounded = False
        self.vertical_velocity = self.jump_velocity
        self.air_time = 0.0

    def bounce(self, force: float) -> None:
        """被弹跳板弹起（比普通跳跃更高）。"""
        self.grounded = False
        self.vertical_velocity = max(self.vertical_velocity, force)
        self.air_time = 0.0

    def update(self) -> None:
        # 视角：水平转 yaw，垂直转 pitch
        self.yaw += mouse.velocity[0] * self.mouse_sensitivity[1]
        self.pitch = clamp(
            self.pitch - mouse.velocity[1] * self.mouse_sensitivity[0], -90, 90
        )
        self.rotation_y = self.yaw

        if not self.can_move:
            self.direction = Vec3(0, 0, 0)
            self._apply_gravity()
            return

        # 移动方向（相对朝向）
        self.direction = Vec3(
            self.forward * (self._key("w") - self._key("s"))
            + self.right * (self._key("d") - self._key("a"))
        ).normalized()

        feet_ray = raycast(
            self.position + Vec3(0, 0.5, 0),
            self.direction,
            traverse_target=self.traverse_target,
            ignore=self.ignore_list,
            distance=0.6,
            debug=False,
        )
        head_ray = raycast(
            self.position + Vec3(0, self.height - 0.1, 0),
            self.direction,
            traverse_target=self.traverse_target,
            ignore=self.ignore_list,
            distance=0.6,
            debug=False,
        )
        if not feet_ray.hit and not head_ray.hit:
            move_amount = self.direction * time.dt * self.speed
            # 分轴检测，避免卡进墙里
            probe = self.position + Vec3(0, 1, 0)
            if raycast(probe, Vec3(1, 0, 0), distance=0.6, traverse_target=self.traverse_target, ignore=self.ignore_list).hit:
                move_amount[0] = min(move_amount[0], 0)
            if raycast(probe, Vec3(-1, 0, 0), distance=0.6, traverse_target=self.traverse_target, ignore=self.ignore_list).hit:
                move_amount[0] = max(move_amount[0], 0)
            if raycast(probe, Vec3(0, 0, 1), distance=0.6, traverse_target=self.traverse_target, ignore=self.ignore_list).hit:
                move_amount[2] = min(move_amount[2], 0)
            if raycast(probe, Vec3(0, 0, -1), distance=0.6, traverse_target=self.traverse_target, ignore=self.ignore_list).hit:
                move_amount[2] = max(move_amount[2], 0)
            self.position += move_amount

        self._apply_gravity()

    def _apply_gravity(self) -> None:
        """竖直运动：重力积分 + 落地判定。

        脚下单独打一条向下的射线来找支撑面 —— 从头顶打会被上方的平台挡住，
        站在跑酷塔底下就会被误判成悬空。
        """
        if not self.gravity:
            return

        foot_ray = raycast(
            self.world_position + (0, 0.12, 0),
            self.down,
            traverse_target=self.traverse_target,
            ignore=self.ignore_list,
            distance=self.height + 0.6,
        )
        support_y = None
        if foot_ray.hit and foot_ray.world_normal.y > 0.7:
            support_y = foot_ray.world_point[1]

        # 站在平地上：保持不动
        if self.grounded and support_y is not None and abs(support_y - self.y) <= 0.06:
            self.vertical_velocity = 0.0
            return

        # 矮台阶：直接踩上去
        if (
            self.grounded
            and support_y is not None
            and 0 < support_y - self.y <= config.PLAYER_STEP_UP
        ):
            self.y = support_y
            self.vertical_velocity = 0.0
            return

        # 空中：重力积分
        self.grounded = False
        self.air_time += time.dt
        self.vertical_velocity = max(-30.0, self.vertical_velocity - self.gravity * time.dt)
        previous_y = self.y
        self.y += self.vertical_velocity * time.dt

        # 落到支撑面上：只有「本来就在它上面」才吸附，避免穿模后被吸上去
        if (
            self.vertical_velocity <= 0
            and support_y is not None
            and previous_y >= support_y - 0.02
            and self.y <= support_y
        ):
            self.y = support_y
            self.vertical_velocity = 0.0
            self.grounded = True
            self.air_time = 0.0

    # ------------------------------------------------------------------ 工具

    @staticmethod
    def _key(name: str) -> int:
        from ursina import held_keys

        return held_keys[name]
