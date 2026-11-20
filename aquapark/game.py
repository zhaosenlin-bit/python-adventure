"""游戏主流程（状态机）。

状态流转：

    主菜单 --「开始比赛」--> 倒计时 3-2-1-GO --> 比赛
        比赛 --冲过终点--> 结算页 --「再来一局」--> 倒计时
                          --「返回主菜单」--> 主菜单

本文件负责把所有零件拼起来：赛道实体、障碍物、选手、镜头、特效、HUD，
以及比赛规则（撞飞对手、收集金币、判定名次）。
"""

from __future__ import annotations
import os

import math
import random
from typing import Dict, List

from ursina import (
    AmbientLight,
    DirectionalLight,
    Entity,
    Mesh,
    Vec3,
    application,
    camera,
    color,
    held_keys,
    mouse,
    scene,
    time,
    window,
)

from . import collection, config, effects, models, physics, textures, ui
from .save import PROFILE
from .fonts import T
from .physics import Controls
from .racer import Racer
from .track import (
    OBSTACLE_BOOST,
    OBSTACLE_BUMPER,
    OBSTACLE_COIN,
    OBSTACLE_JET,
    Track,
)

STATE_MENU = "menu"
STATE_COUNTDOWN = "countdown"
STATE_RACING = "racing"
STATE_RESULT = "result"
STATE_SHOP = "shop"  # 收集环节（货币 / 收藏 / 抽卡）

COUNTDOWN_STEP = 0.85
COUNTDOWN_SEQUENCE = ("3", "2", "1", "GO!")

# 稀有礼包的价格（钻石）
PACK_COST = 40


def _clamp(value: float, low: float, high: float) -> float:
    return low if value < low else (high if value > high else value)


class Game(Entity):
    """Aquapark.io 复刻的完整游戏逻辑。"""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)

        self.ui = ui.UI()
        self.effects = effects.Effects()
        self.rng = random.Random(2024)

        self.track = Track()
        self.obstacle_entities: Dict[int, Entity] = {}
        self.decoration_entities: List[Entity] = []

        self._build_lights()
        self._build_track()
        self._build_obstacles()
        self._build_decorations()

        # 选手：第一个是玩家
        self.racers: List[Racer] = []
        for index in range(config.RIVAL_COUNT + 1):
            is_player = index == 0
            self.racers.append(
                Racer(
                    index=index,
                    name=config.RACER_NAMES[index % len(config.RACER_NAMES)],
                    rgb=config.RACER_COLORS[index % len(config.RACER_COLORS)],
                    is_player=is_player,
                )
            )
        self.player = self.racers[0]
        for racer_entity in self.racers:
            self.ui.add_progress_mark(racer_entity.index, racer_entity.rgb)

        # 比赛状态
        self.state = STATE_MENU
        self.race_time = 0.0
        self.countdown_timer = 0.0
        self.countdown_step = 0
        self.place = 1
        self.flow_offset = 0.0
        self.menu_angle = 0.0
        self.camera_position = Vec3(0, 8, 14)
        self.camera_look = Vec3(0, 0, 0)
        self.shake = 0.0
        self.result_delay = 0.0

        # 输入状态
        self.keys_jump = False
        self.keys_dive = False
        self.mouse_recent = 0.0
        self.mouse_used = False
        self.mouse_anchor_x = 0.0
        self.keyboard_priority = 0.0
        self.prev_gamepad_a = False
        self.prev_gamepad_b = False
        self.mouse_last = (mouse.x, mouse.y)

        # QA 钩子：设 AQUAPARK_QA_SHOT=文件名（可选 AQUAPARK_QA_SHOT_DELAY 秒），
        # 游戏会在那一刻自己存一张截图。打包成 exe 之后没法像开发时那样往窗口里
        # 塞代码，用它来验证「冻结后的 exe 确实渲染出了东西」。
        self._qa_shot_name = os.environ.get("AQUAPARK_QA_SHOT") or None
        self._qa_shot_delay = float(os.environ.get("AQUAPARK_QA_SHOT_DELAY", "8"))
        self._qa_shot_time = 0.0
        self._qa_open_shop = os.environ.get("AQUAPARK_QA_SHOP") == "1"

        self._place_racers()
        self._update_camera_menu(0.0)
        self._goto_menu()
        # 收集环节的按钮回调交给游戏状态机处理
        self.ui.on_shop_action = self._on_shop_action

    # -------------------------------------------------------------- 建场景

    def _build_lights(self) -> None:
        """晴天水乐园的布光：一个环境光 + 一盏偏暖的主光。"""
        scene.fog_color = color.rgba(*config.FOG_COLOR, 1.0)
        scene.fog_density = config.FOG_DENSITY
        try:
            window.color = color.rgba(*config.BACKGROUND_COLOR, 1.0)
        except Exception:  # pragma: no cover - 不同版本的 Ursina 接口差异
            pass

        # 环境光负责底色，主光负责立体感
        AmbientLight(color=color.rgba(0.80, 0.84, 0.92, 1.0))
        sun = DirectionalLight(color=color.rgba(1.0, 0.97, 0.88, 1.0))
        # 主光从右前上方照下来
        sun.rotation = (48, 28, 0)

    def _build_track(self) -> None:
        """把赛道数据变成真正的 3D 网格。"""
        data = self.track.build_mesh_data()
        # 整条滑槽 = 一根管子 = 一个网格（水面也在里面）
        flume_texture = textures.make_texture(textures.water_texture(), filtering="mipmap")
        flume = Entity(
            model=Mesh(
                vertices=data["vertices"],
                triangles=data["triangles"],
                uvs=data["uvs"],
                colors=data["colors"],
                normals=data["normals"],
            )
        )
        flume.texture = flume_texture
        # 滑槽是闭合管子，玩家在里面、菜单镜头在外面，所以两面都要能看见
        flume.model.setTwoSided(True)

        self.flume_entity = flume

        # 起跑门和终点线
        checker = textures.make_texture(textures.checker_texture(), filtering="mipmap")

        start = models.build_start_gate(checker)
        start.position = self.track.world_at(2.0, 0.0, 0.0)
        start.look_at(self.track.world_at(8.0, 0.0, 0.0), up=self.track.sample(2.0).up)

        finish = models.build_finish_gate(checker)
        finish.position = self.track.world_at(self.track.length - 1.0, 0.0, 0.0)
        finish.look_at(
            self.track.world_at(self.track.length + 6.0, 0.0, 0.0),
            up=self.track.sample(self.track.length - 1.0).up,
        )

        # 终点的水池
        pool = models.cylinder(
            17.0,
            0.6,
            position=self.track.world_at(self.track.length + 10.0, 0.0, -1.2),
            color=color.rgba(*config.WATER_COLOR, 1.0),
        )

        self.gate_entities = [start, finish, pool]

    def _build_obstacles(self) -> None:
        """给每个障碍物造一个外观实体。"""
        for obstacle in self.track.obstacles:
            if obstacle.kind == OBSTACLE_JET:
                entity = models.build_jet()
                height = 0.0
            elif obstacle.kind == OBSTACLE_BOOST:
                entity = models.build_boost()
                height = 0.0
            elif obstacle.kind == OBSTACLE_BUMPER:
                entity = models.build_bumper()
                height = 0.0
            else:
                entity = models.build_coin()
                height = config.COIN_HEIGHT

            position = self.track.world_at(obstacle.s, obstacle.lateral, height)
            entity.position = position
            ahead = self.track.world_at(obstacle.s + 4.0, obstacle.lateral, height)
            entity.look_at(ahead, up=self.track.sample(obstacle.s).up)
            self.obstacle_entities[id(obstacle)] = entity

    def _build_decorations(self) -> None:
        """拱门、云朵、棕榈树。"""
        banner_texture = textures.make_texture(textures.banner_texture(), filtering="mipmap")
        slots = self.track.decoration_slots()

        for index, _offset in slots["arch"]:
            arch = models.build_arch(banner_texture)
            arch.position = self.track.world_at(index * self.track.segment_length, 0.0, 0.0)
            arch.look_at(
                self.track.world_at((index + 2) * self.track.segment_length, 0.0, 0.0),
                up=self.track.sample(index * self.track.segment_length).up,
            )
            self.decoration_entities.append(arch)

        for index, offset in slots["cloud"]:
            cloud = models.build_cloud()
            node = self.track.node_at(index)
            sample = self.track.sample(index * self.track.segment_length)
            cloud.position = (
                node.position
                + sample.right * offset
                + Vec3(0, -12.0 - self.rng.uniform(0, 8.0), 0)
            )
            cloud.scale = self.rng.uniform(1.4, 3.0)
            self.decoration_entities.append(cloud)

        # 赛道两侧的棕榈树
        for index in range(8, self.track.segment_count - 4, 9):
            node = self.track.node_at(index)
            sample = self.track.sample(index * self.track.segment_length)
            side = 1 if index % 2 == 0 else -1
            palm = models.build_palm()
            palm.position = (
                node.position + sample.right * side * (node.width * 0.5 + 4.5) + sample.up * -1.6
            )
            self.decoration_entities.append(palm)

    # -------------------------------------------------------------- 选手布置

    def _place_racers(self) -> None:
        """把所有选手摆到起跑线上。"""
        for index, racer_entity in enumerate(self.racers):
            row = index // 3
            column = index % 3
            lateral = (column - 1) * 2.6 + (row - 0.5) * 1.2
            racer_entity.spawn(self.track, s=0.0, lateral=lateral, v_s=0.0)
            racer_entity.coins = 0
            racer_entity.ko_count = 0
            racer_entity.place = 0
            racer_entity.finished = False
            racer_entity.speed_scale = 1.0

    # -------------------------------------------------------------- 状态切换

    def _goto_menu(self) -> None:
        self.state = STATE_MENU
        self.ui.hide_all()
        self.ui.menu.enabled = True
        self.player.set_equipped(PROFILE.equipped)

    def _goto_countdown(self) -> None:
        self.state = STATE_COUNTDOWN
        self.race_time = 0.0
        self.countdown_timer = 0.0
        self.countdown_step = 0
        self.place = 1
        self.result_delay = 0.0
        self.mouse_anchor_x = mouse.x

        self._place_racers()
        self.effects.clear()
        for obstacle in self.track.obstacles:
            obstacle.taken = False

        self.ui.hide_all()
        self.ui.hud.enabled = True
        self.ui.countdown.enabled = True

    def _goto_racing(self) -> None:
        self.state = STATE_RACING
        self.ui.countdown.enabled = False

    def _goto_result(self) -> None:
        self._grant_rewards()
        self.state = STATE_RESULT
        self.ui.hide_all()
        self.ui.result.enabled = True
        self.ui.set_result(
            place=self.place,
            total=len(self.racers),
            elapsed=self.race_time,
            coins=self.player.coins,
            kos=self.player.ko_count,
        )

    # -------------------------------------------------------------- 输入
    # -------------------------------------------------------- 收集环节
    def _update_shop(self, dt: float) -> None:
        """收集环节：比赛暂停，选手保持待机动作。"""
        for racer_entity in self.racers:
            racer_entity.update_visual(self.track, dt, self.race_time)


    def _grant_rewards(self) -> None:
        """一局结束，把赚到的货币和收藏品记进档案。"""
        profile = PROFILE
        profile.coins += self.player.coins + 50
        profile.tickets += 1
        if self.place <= 3:
            profile.gems += 1
        profile.gems += self.player.ko_count
        if self.player.coins > 0:
            profile.add("coins", self.player.coins)
        profile.save()

    def _goto_shop(self) -> None:
        """进入收集环节。"""
        self.state = STATE_SHOP
        self.ui.hide_all()
        self.ui.shop.enabled = True
        self.ui.refresh_shop()
        self.player.set_equipped(PROFILE.equipped)

    def _on_shop_action(self, action: str, payload) -> None:
        """收集界面上的操作。"""
        if action == "open":
            self._goto_shop()
        elif action == "continue":
            self._goto_menu()
        elif action == "equip":
            if PROFILE.count(payload) <= 0:
                self.ui.show_toast(
                    T("还没收集到这件哦", "You don't own this one yet")
                )
                return
            PROFILE.equip(payload)
            self.ui.refresh_shop()
            self.player.set_equipped(PROFILE.equipped)
        elif action == "pack":
            self._open_pack()

    def _open_pack(self) -> None:
        """开一个稀有礼包：扣钻石，按稀有度抽一件收藏品。"""
        profile = PROFILE
        if profile.gems < PACK_COST:
            self.ui.show_toast(
                T(
                    f"钻石不够啦，还差 {PACK_COST - profile.gems} 颗",
                    f"Need {PACK_COST - profile.gems} more gems",
                )
            )
            return

        profile.gems -= PACK_COST
        roll = self.rng.random()
        rarity = "epic" if roll < collection.RARITY_WEIGHT["epic"] else "rare"
        candidates = [
            item for item in collection.COLLECTION if item["rarity"] == rarity
        ]
        item = self.rng.choice(candidates)
        profile.add(item["id"], 1)
        profile.packs_opened += 1
        profile.save()
        self.ui.refresh_shop()
        # 开盒演出：礼包卡转起来 → 闪白 → 抽到的收藏品揭晓
        self.ui.open_pack_animation(item["id"])


    def input(self, key: str) -> None:
        if key == "space":
            self.keys_jump = True
        elif key in ("w", "up arrow"):
            self.keys_jump = True
        elif key in ("s", "down arrow"):
            self.keys_dive = True
        elif key == "escape":
            if self.state in (STATE_RACING, STATE_COUNTDOWN):
                self._goto_menu()

    def _player_controls(self) -> Controls:
        """把键盘 / 鼠标 / 手柄汇总成一份 Controls。"""
        controls = Controls()

        steer = 0.0
        if held_keys.get("d") or held_keys.get("right arrow"):
            steer += 1.0
        if held_keys.get("a") or held_keys.get("left arrow"):
            steer -= 1.0

        # 手柄左摇杆
        stick = held_keys.get("gamepad left stick x", 0.0)
        if isinstance(stick, (int, float)) and abs(stick) > 0.12:
            steer += _clamp(stick, -1.0, 1.0)

        if abs(steer) > 0.01:
            # 键盘优先：按了方向键就不再听鼠标的
            self.keyboard_priority = 0.35
        else:
            self.keyboard_priority = max(0.0, self.keyboard_priority - 0.016)
            if self.mouse_used and self.keyboard_priority <= 0.0:
                steer += _clamp((mouse.x - self.mouse_anchor_x) * 2.6, -1.0, 1.0)

        controls.steer = _clamp(steer, -1.0, 1.0)

        if self.keys_jump:
            controls.jump = True
            self.keys_jump = False
        if self.keys_dive:
            controls.dive = True
            self.keys_dive = False

        # 手柄按键（边沿触发）
        gamepad_a = bool(held_keys.get("gamepad a"))
        if gamepad_a and not self.prev_gamepad_a:
            controls.jump = True
        self.prev_gamepad_a = gamepad_a

        gamepad_b = bool(held_keys.get("gamepad b"))
        if gamepad_b and not self.prev_gamepad_b:
            controls.dive = True
        self.prev_gamepad_b = gamepad_b

        return controls

    # -------------------------------------------------------------- 主循环

    def update(self) -> None:
        dt = min(time.dt, 1.0 / 20.0)
        if dt <= 0.0:
            return

        # 鼠标活动检测
        if (
            abs(mouse.x - self.mouse_last[0]) > 0.001
            or abs(mouse.y - self.mouse_last[1]) > 0.001
        ):
            self.mouse_recent = 0.6
            self.mouse_used = True
            self.mouse_last = (mouse.x, mouse.y)
        else:
            self.mouse_recent = max(0.0, self.mouse_recent - dt)

        self._scroll_water(dt)
        self._update_qa_shot(dt)
        self._animate_obstacles(dt)
        self.effects.update(dt)
        self.ui.update_toast(dt)
        self.ui.update_shop(dt)

        if self.state == STATE_MENU:
            self._update_menu(dt)
        elif self.state == STATE_COUNTDOWN:
            self._update_countdown(dt)
        elif self.state == STATE_RACING:
            self._update_racing(dt)
        elif self.state == STATE_RESULT:
            self._update_result(dt)
        elif self.state == STATE_SHOP:
            self._update_shop(dt)

    # -------------------------------------------------------------- 各状态

    def _update_menu(self, dt: float) -> None:
        self._update_camera_menu(dt)
        # 菜单里也让选手站在起跑线上做待机动作
        for racer_entity in self.racers:
            racer_entity.update_visual(self.track, dt, 0.0)

    def _update_countdown(self, dt: float) -> None:
        if self.countdown_step < len(COUNTDOWN_SEQUENCE):
            if self.countdown_timer <= 0.0:
                label = COUNTDOWN_SEQUENCE[self.countdown_step]
                self.countdown_step += 1
                self.countdown_timer = COUNTDOWN_STEP
                self.ui.set_countdown(label)
                if label == "GO!":
                    self.ui.show_toast(T("出发！", "GO!"), 0.9)
            else:
                self.countdown_timer -= dt

            # 数字弹出的小动画
            pulse = 1.0 + 0.08 * math.sin(self.countdown_timer * 12.0)
            self.ui.countdown_text.scale = pulse
        else:
            self.countdown_timer -= dt
            if self.countdown_timer <= 0.0:
                self._goto_racing()

        self._update_camera_racing(dt, focus=self.player)
        for racer_entity in self.racers:
            racer_entity.update_visual(self.track, dt, 0.0)

    def _update_racing(self, dt: float) -> None:
        self.race_time += dt

        player_controls = self._player_controls()

        for racer_entity in self.racers:
            state = racer_entity.state
            racer_entity.tick_cooldowns(dt)

            if racer_entity.out:
                if racer_entity.update_respawn(self.track, dt, self._leader_s()):
                    self.effects.splash(
                        physics.world_position(self.track, racer_entity.state),
                        power=1.2,
                        count=12,
                    )
                racer_entity.update_visual(self.track, dt, self.race_time)
                continue

            if racer_entity.is_player:
                controls = player_controls
                speed_scale = 1.0
            else:
                controls = racer_entity.ai_controls(self.track, self.player.state, dt)
                speed_scale = racer_entity.speed_scale

            physics.step(state, self.track, controls, dt, speed_scale=speed_scale)

            if "finish" in state.events:
                state.finish_time = self.race_time
                racer_entity.finished = True

            sample = self.track.sample(state.s)
            self._handle_obstacles(racer_entity, dt)
            self._consume_events(racer_entity)
            racer_entity.update_visual(self.track, dt, self.race_time, sample)

            # 身后的水雾
            if state.v_s > 6.0 and not state.airborne:
                position = physics.world_position(self.track, state, sample)
                self.effects.spray(position, sample.forward, state.v_s)

        self._handle_racer_collisions(dt)
        self._update_rank()
        self._update_camera_racing(dt, focus=self.player)
        self._update_hud()

        if self.player.state.finished:
            self.result_delay += dt
            if self.result_delay > 1.4:
                self._goto_result()
        else:
            self.result_delay = 0.0

    def _update_result(self, dt: float) -> None:
        # 结算页镜头绕着终点慢慢转
        self.result_delay += dt
        angle = self.result_delay * 0.5
        target = self.track.world_at(self.track.length - 4.0, 0.0, 0.0)
        self.camera_position = target + Vec3(
            math.cos(angle) * 24.0, 13.0, math.sin(angle) * 24.0
        )
        camera.position = self.camera_position
        camera.look_at(target + Vec3(0, 2.0, 0), up=Vec3(0, 1, 0))

        for racer_entity in self.racers:
            racer_entity.update_visual(self.track, dt, self.race_time)

    # -------------------------------------------------------------- 障碍物

    def _animate_obstacles(self, dt: float) -> None:
        """喷泉转起来、金币转起来。"""
        now = time.time()
        for obstacle in self.track.obstacles:
            entity = self.obstacle_entities.get(id(obstacle))
            if entity is None:
                continue
            if obstacle.kind == OBSTACLE_JET:
                spinner = getattr(entity, "jet_spinner", None)
                if spinner is not None:
                    spinner.rotation_y += 260.0 * dt
                column = getattr(entity, "jet_column", None)
                if column is not None:
                    column.scale_y = 1.9 + math.sin(now * 7.0 + obstacle.s) * 0.35
            elif obstacle.kind == OBSTACLE_COIN:
                if obstacle.taken:
                    entity.enabled = False
                    continue
                disc = getattr(entity, "coin_disc", None)
                if disc is not None:
                    disc.rotation_y += 180.0 * dt

    def _handle_obstacles(self, racer_entity: Racer, dt: float) -> None:
        """检查选手和障碍物的接触。"""
        state = racer_entity.state
        if state.finished:
            return

        nearby = self.track.obstacles_between(state.s - 3.0, state.s + 3.0)
        for obstacle in nearby:
            ds = obstacle.s - state.s
            dl = obstacle.lateral - state.lateral
            distance = math.sqrt(ds * ds + dl * dl)
            reach = obstacle.radius + config.PLAYER_RADIUS

            if obstacle.kind == OBSTACLE_COIN:
                if not obstacle.taken and distance < reach and abs(state.height) < 4.0:
                    obstacle.taken = True
                    entity = self.obstacle_entities.get(id(obstacle))
                    if entity is not None:
                        entity.enabled = False
                    if racer_entity.is_player:
                        racer_entity.coins += 1
                        self.effects.emit(
                            physics.world_position(self.track, state),
                            Vec3(0, 4.0, 0),
                            life=0.5,
                            size=0.3,
                            tint=config.COIN_COLOR,
                        )
                continue

            if distance >= reach:
                continue

            if obstacle.kind == OBSTACLE_JET:
                if racer_entity.jet_cooldown <= 0.0:
                    racer_entity.jet_cooldown = 0.7
                    physics.apply_launch(state)
                    position = physics.world_position(self.track, state)
                    self.effects.splash(position, power=1.4, count=14)
                    self.effects.ring(position, size=3.0)
                    if racer_entity.is_player:
                        self.shake = max(self.shake, 0.18)
            elif obstacle.kind == OBSTACLE_BOOST:
                if racer_entity.boost_cooldown <= 0.0:
                    racer_entity.boost_cooldown = 1.2
                    physics.apply_boost(state)
                    if racer_entity.is_player:
                        self.effects.emit(
                            physics.world_position(self.track, state),
                            Vec3(0, 5.0, 0),
                            life=0.5,
                            size=0.36,
                            tint=config.BOOST_COLOR,
                        )
            elif obstacle.kind == OBSTACLE_BUMPER:
                if racer_entity.bump_cooldown <= 0.0:
                    racer_entity.bump_cooldown = 0.6
                    push = 9.0 if dl >= 0 else -9.0
                    physics.apply_bump(state, push)
                    position = physics.world_position(self.track, state)
                    self.effects.splash(position, power=1.0, count=8)
                    if racer_entity.is_player:
                        self.shake = max(self.shake, 0.22)

    def _consume_events(self, racer_entity: Racer) -> None:
        """把物理层产生的事件翻译成特效。"""
        state = racer_entity.state
        for event in state.events:
            if event == "land":
                position = physics.world_position(self.track, state)
                self.effects.splash(position, power=1.0, count=8)
                self.effects.ring(position, size=2.2)
            elif event == "wall":
                position = physics.world_position(self.track, state)
                self.effects.splash(position, power=0.7, count=5)
                if racer_entity.is_player:
                    self.shake = max(self.shake, 0.14)
        state.events.clear()

    # -------------------------------------------------------------- 对手互撞

    def _handle_racer_collisions(self, dt: float) -> None:
        """选手之间互相碰撞：俯冲砸中 = 把对方撞出水面。"""
        racers = self.racers
        for i in range(len(racers)):
            first = racers[i]
            if first.out or first.state.finished:
                continue
            for j in range(i + 1, len(racers)):
                second = racers[j]
                if second.out or second.state.finished:
                    continue

                a = first.state
                b = second.state
                ds = a.s - b.s
                dl = a.lateral - b.lateral
                dh = a.height - b.height
                distance = math.sqrt(ds * ds + dl * dl + dh * dh)
                if distance > 2.1:
                    continue

                relative_speed = abs(a.v_s - b.v_s)
                a_diving = physics.is_diving(a) and a.height > b.height
                b_diving = physics.is_diving(b) and b.height > a.height

                if a_diving and relative_speed >= config.KO_MIN_RELATIVE_SPEED:
                    self._knock_out(second, first, relative_speed)
                elif b_diving and relative_speed >= config.KO_MIN_RELATIVE_SPEED:
                    self._knock_out(first, second, relative_speed)
                else:
                    # 平撞：两个人都被弹开一点
                    push = 6.0 if dl >= 0 else -6.0
                    a.v_lateral += push
                    b.v_lateral -= push
                    a.v_s *= 0.97
                    b.v_s *= 0.97

    def _knock_out(self, victim: Racer, attacker: Racer, relative_speed: float) -> None:
        """把对手撞出水面。"""
        victim.knockout()
        position = physics.world_position(self.track, victim.state)
        self.effects.burst(position, victim.rgb, count=16)
        self.effects.splash(position, power=1.6, count=16)
        self.effects.ring(position, size=3.4)

        if attacker.is_player:
            attacker.ko_count += 1  # 撞飞对手的成绩算在攻击者头上
            attacker.state.v_s *= config.KO_SPEED_LOSS
            self.shake = max(self.shake, 0.3)
            self.ui.show_toast(T(f"把 {victim.name} 撞出水面了！", f"Knocked out {victim.name}!"), 1.4)
        elif victim.is_player:
            self.shake = max(self.shake, 0.35)
            self.ui.show_toast(T("你被撞飞了！", "You got knocked out!"), 1.4)

    # -------------------------------------------------------------- 名次 / HUD

    def _leader_s(self) -> float:
        return max(racer_entity.state.s for racer_entity in self.racers)

    def _rank_of(self, target: Racer) -> int:
        """目标选手当前排第几（1 = 第一）。"""
        rank = 1
        for other in self.racers:
            if other is target or other.out:
                continue
            if other.state.finished and not target.state.finished:
                rank += 1
            elif other.state.finished and target.state.finished:
                if other.state.finish_time < target.state.finish_time:
                    rank += 1
            elif not other.state.finished and not target.state.finished:
                if other.state.s > target.state.s:
                    rank += 1
        return rank

    def _update_rank(self) -> None:
        self.place = self._rank_of(self.player)
        for racer_entity in self.racers:
            racer_entity.place = self._rank_of(racer_entity)

    def _update_hud(self) -> None:
        state = self.player.state
        marks = {
            racer_entity.index: _clamp(
                racer_entity.state.s / max(1.0, self.track.length), 0.0, 1.0
            )
            for racer_entity in self.racers
            if not racer_entity.out
        }
        self.ui.update_hud(
            rank=self.place,
            total=len(self.racers),
            speed=state.v_s,
            coins=self.player.coins,
            kos=self.player.ko_count,
            elapsed=self.race_time,
            progress=_clamp(state.s / max(1.0, self.track.length), 0.0, 1.0),
            marks=marks,
        )

    # -------------------------------------------------------------- 镜头

    def _update_camera_menu(self, dt: float) -> None:
        """主菜单：镜头绕着起点慢慢转。"""
        self.menu_angle += dt * 0.16
        # 绕着起点慢慢转，始终从斜上方俯拍整条滑槽
        # 镜头固定在起跑线的「上游」空地，慢慢左右摇：
        # 这样既能看到整条滑槽一路滑下去，也不会被别处的赛道挡住
        start = self.track.nodes[0]
        sample = self.track.sample(0.0)
        target = (
            start.position
            - sample.forward * 27.0
            + sample.up * 12.5
            + sample.right * (math.sin(self.menu_angle) * 9.0)
        )
        look = self.track.world_at(34.0, 0.0, 0.0)
        self.camera_position = target
        self.camera_look = look
        camera.position = target
        camera.look_at(look, up=sample.up)

    def _update_camera_racing(self, dt: float, focus: Racer) -> None:
        """比赛镜头：跟在选手后上方，始终顺着滑道方向。"""
        state = focus.state
        sample = self.track.sample(state.s)

        back_s = max(0.0, state.s - config.CAMERA_BACK)
        target_pos = self.track.world_at(back_s, state.lateral * 0.35, 0.0)
        target_pos = target_pos + sample.up * (config.CAMERA_HEIGHT + state.height * 0.45)

        look_s = min(self.track.length, state.s + config.CAMERA_LOOK_AHEAD)
        target_look = self.track.world_at(look_s, state.lateral * 0.5, 0.0)
        target_look = target_look + sample.up * 1.4

        blend = _clamp(config.CAMERA_SMOOTH * dt, 0.0, 1.0)
        self.camera_position = self.camera_position + (target_pos - self.camera_position) * blend
        self.camera_look = self.camera_look + (target_look - self.camera_look) * blend

        # 速度感：越快视角越广
        speed_ratio = _clamp(state.v_s / config.MAX_SPEED, 0.0, 1.0)
        camera.fov = config.CAMERA_FOV + (config.CAMERA_FOV_FAST - config.CAMERA_FOV) * speed_ratio

        # 撞击时的镜头抖动
        if self.shake > 0.0:
            self.shake = max(0.0, self.shake - dt * 1.6)
            amount = self.shake * 1.4
            self.camera_position = self.camera_position + Vec3(
                self.rng.uniform(-amount, amount),
                self.rng.uniform(-amount, amount),
                self.rng.uniform(-amount, amount),
            )

        camera.position = self.camera_position
        camera.look_at(self.camera_look, up=sample.up)

    # -------------------------------------------------------------- 水面流动

    def _scroll_water(self, dt: float) -> None:
        """滚动水面贴图，做出「水在往下流」的效果。"""
        self.flow_offset -= dt * 1.6
        try:
            self.flume_entity.texture_offset = (0.0, self.flow_offset)
        except Exception:  # pragma: no cover - 没有贴图时忽略
            pass

    # -------------------------------------------------------------- 按钮回调

    def on_start(self) -> None:
        self._goto_countdown()

    def on_restart(self) -> None:
        self._goto_countdown()

    def on_menu(self) -> None:
        self._goto_menu()
    def _update_qa_shot(self, dt: float) -> None:
        """到点就自动存一张截图（见 __init__ 里关于环境变量的说明）。"""
        if not self._qa_shot_name:
            return
        self._qa_shot_time += dt
        # 截图抓的是上一帧的画面，所以商店要提前打开、留几帧让它渲染出来
        if self._qa_open_shop and self._qa_shot_time >= self._qa_shot_delay * 0.4:
            self._qa_open_shop = False
            self._goto_shop()
            # QA：直接播一次开盒演出（不碰玩家档案）
            if os.environ.get("AQUAPARK_QA_PACK") == "1":
                self.ui.open_pack_animation("octopus")
        if self._qa_shot_time < self._qa_shot_delay:
            return
        name = self._qa_shot_name
        self._qa_shot_name = None
        try:
            from panda3d.core import Filename

            application.base.win.saveScreenshot(Filename(name))
            print("QA 截图已保存:", name)
        except Exception as exc:  # pragma: no cover - 仅用于调试
            print("QA 截图失败:", exc)

