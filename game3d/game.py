"""游戏主流程（状态机）。

状态流转：

    主菜单 --「3D 打字闯关」--> 出生点选择 --「确认出发」--> 关卡 1
        关卡 N --答对--> 开门 --走进门--> 关卡 N+1
        最后一关答对 --> 闯关完成（结算页） --「返回大厅」--> 主菜单
"""

from __future__ import annotations

import math
import time as time_module
from typing import Optional

from ursina import (
    Entity,
    Text,
    Vec3,
    application,
    camera,
    color,
    destroy,
    mouse,
    scene,
    time,
    window,
)

from . import config
from . import eggs
from . import lighting
from .fonts import T, current_font
from .level import Level
from .player import PlayerController
from .questions import Question, daily_questions, daily_seed
from .ui import UI

STATE_MENU = "menu"
STATE_SPAWN = "spawn"
STATE_PLAYING = "playing"
STATE_TYPING = "typing"
STATE_RESULT = "result"


def _c(rgb, alpha: float = 1.0):
    return color.rgba(rgb[0], rgb[1], rgb[2], alpha)


def _world_text_scale(distance: float, pixel_height: float) -> float:
    """算世界空间文字该用多大的 scale，让它在屏幕上看起来约 pixel_height 像素高。

    Ursina 的 Text 一行文字的高度是 ``Text.size``（0.025）个单位。
    """
    visible_width = 2.0 * distance * math.tan(math.radians(config.CAMERA_FOV) / 2.0)
    aspect = config.WINDOW_SIZE[0] / config.WINDOW_SIZE[1]
    visible_height = visible_width / aspect
    world_height = visible_height * pixel_height / config.WINDOW_SIZE[1]
    return max(1.0, world_height / Text.size)


def _face_camera(position) -> tuple:
    """算一个 rotation，让文字面朝出生点视角的相机。

    Panda3D 的文字正面本来就朝 -Z（绕 Y 转 180 度反而会被背面剔除），
    所以只要让这个正面法线指向相机即可。
    """
    cam = Vec3(*config.SPAWN_CAMERA_POSITION)
    to_camera = cam - Vec3(*position)
    if to_camera.length() < 1e-6:
        return (0, 0, 0)
    n = to_camera.normalized()
    # Panda3D 的文字正面朝 -Z：绕 Y 转 h 度、再绕 X 转 p 度后法线是
    # (-sin h·cos p, sin p, -cos h·cos p)，令它指向相机即可
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, n.y))))
    yaw = math.degrees(math.atan2(-n.x, -n.z))
    return (pitch, yaw, 0)


class Game(Entity):
    """3D 打字闯关的完整游戏逻辑。"""

    # 继承自 Entity：引擎每帧自动调用 update()，并把按键 / 字符输入分发到
    # input() / text_input()。摄像机挂台也由本类持有，换关卡时不会被连带销毁。
    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.ui = UI()

        # 摄像机挂台：独立于玩家实体，玩家被销毁时摄像机不会被连带销毁
        self.camera_rig = Entity(parent=scene)
        camera.parent = self.camera_rig
        camera.position = (0, 0, 0)
        camera.rotation = (0, 0, 0)
        camera.fov = config.CAMERA_FOV
        self.camera_mode = config.CAMERA_MODE_FIRST

        self.state = STATE_MENU
        self.questions: list[Question] = daily_questions()
        # 当天的随机种子（彩蛋文案按它选，当天固定）
        self.seed = daily_seed()
        # 捡到的彩蛋（跨关卡累计）
        self.collected_eggs: set[str] = set()
        # 彩蛋换来的题目提示（打字窗口里显示）
        self.egg_hints: list[str] = []
        # 提示浮层的剩余显示时间
        self._toast_timer = 0.0
        # 弹跳板：踩过一次要离开才会再弹
        self._pad_armed = True

        # 进度
        self.level_index = 0
        self.correct = 0
        self.total_time = 0.0
        self.question_started_at = 0.0
        self.run_started_at = 0.0
        self.run_active = False
        self.selected_spawn: Optional[int] = None
        self.spawn_choice = config.SPAWN_POINTS[0]

        # 打字状态
        self.buffer = ""
        self.wrong = False
        # 走到面板前是否自动弹打字窗口（按 Esc 关掉后需要先走开才会再弹）
        self.auto_open_armed = True

        # 场景对象
        self.level: Optional[Level] = None
        self.player: Optional[PlayerController] = None
        self.scene_entities: list[Entity] = []
        self.spawn_markers: list[Entity] = []

        self._time = 0.0
        self._obelisk: Optional[Entity] = None

        # 按钮回调
        self.ui.menu_button.on_click = self._start_run
        self.ui.menu_continue.on_click = self._resume_run
        self.ui.menu_quit.on_click = self._quit
        self.ui.spawn_confirm.on_click = self._confirm_spawn
        self.ui.spawn_back.on_click = self._goto_menu
        self.ui.result_back.on_click = self._goto_menu

        self._build_menu_scene()
        self._goto_menu()

    # ------------------------------------------------------------------ 场景

    def _keep(self, entity: Entity) -> Entity:
        self.scene_entities.append(entity)
        return entity

    def _clear_scene(self) -> None:
        for entity in list(self.scene_entities):
            try:
                destroy(entity)
            except Exception:  # pragma: no cover
                pass
        self.scene_entities.clear()
        self.spawn_markers.clear()
        self._obelisk = None

        if self.level is not None:
            self.level.destroy()
            self.level = None
        if self.player is not None:
            try:
                destroy(self.player)
            except Exception:  # pragma: no cover
                pass
            self.player = None

    def _apply_fog(self) -> None:
        scene.fog_color = _c(config.FOG_COLOR)
        scene.fog_density = config.FOG_DENSITY
        # 背景色跟着雾色走，远处才不会露出一块白板
        try:
            window.color = _c(config.FOG_COLOR)
        except Exception:  # pragma: no cover - 无窗口环境（单元测试）时忽略
            pass

    def _set_static_camera(self, position, rotation) -> None:
        """菜单 / 出生点场景用的固定镜头（不跟随玩家）。"""
        self.camera_rig.position = position
        self.camera_rig.rotation = rotation
        camera.position = (0, 0, 0)
        camera.rotation = (0, 0, 0)

    def _build_menu_scene(self) -> None:
        """主菜单背景：一个暗色广场 + 发光方尖碑。"""
        self._clear_scene()
        self._apply_fog()
        self._set_static_camera(config.MENU_CAMERA_POSITION, config.MENU_CAMERA_ROTATION)

        self._keep(
            lighting.ambient_light(
                config.AMBIENT_LIGHT_COLOR,
                brightness=config.AMBIENT_LIGHT_INTENSITY,
            )
        )
        self._keep(
            Entity(model="plane", scale=(60, 1, 60), color=_c((0.10, 0.10, 0.14)), collider="box")
        )
        # 方尖碑
        obelisk = Entity(
            model="cube",
            scale=(2.4, 7.0, 2.4),
            y=3.5,
            color=_c((0.36, 0.35, 0.45)),
            collider="box",
        )
        self._keep(obelisk)
        self._obelisk = obelisk

        # 碑身上的发光条
        self._keep(
            Entity(
                model="cube",
                scale=(5.5, 1.25, 0.16),
                position=(0, 3.9, -1.28),
                color=_c((0.16, 0.62, 0.58)),
                unlit=True,
            )
        )

        title = Text(
            text=T("编程冒险岛", "Code Adventure"),
            origin=(0, 0),
            position=(0, 3.9, -1.45),
            scale=_world_text_scale(12.05, 46),
            color=color.white,
            # 不受灯光影响，标题在暗场景里也始终清晰
            unlit=True,
            parent=scene,
        )
        font = current_font()
        if font:
            try:
                title.font = font
            except Exception:  # pragma: no cover
                pass
        # 文字正面朝 -Z，摄像机就在 -Z 方向，所以不用旋转就是正对的
        # 登记进 scene_entities，换场景时一起销毁，免得漏到关卡里
        self._keep(title)

        # 四周的柱子
        # 正面补一盏暖光，把方尖碑正面和立体标题照亮
        self._keep(
            lighting.point_light(
                (1.0, 0.90, 0.72),
                brightness=0.36,
                radius=24.0,
                position=(0, 5.4, -7.5),
            )
        )
        # 环绕方尖碑的柱子（半径要比镜头到原点的距离大，不然会挡住碑）
        for i in range(8):
            angle = i / 8 * math.tau
            self._keep(
                Entity(
                    model="cube",
                    scale=(1.2, 5.0, 1.2),
                    position=(math.cos(angle) * 17, 2.5, math.sin(angle) * 17),
                    color=_c((0.16, 0.15, 0.20)),
                    collider="box",
                )
            )
            self._keep(
                lighting.point_light(
                    (1.0, 0.72, 0.45),
                    brightness=0.45,
                    position=(math.cos(angle) * 17, 4.2, math.sin(angle) * 17),
                    radius=16.0,
                )
            )
        self._keep(
            lighting.point_light(
                (0.4, 0.9, 0.85),
                brightness=0.4,
                radius=26.0,
                position=(0, 8.4, 0),
            )
        )

    def _build_spawn_scene(self) -> None:
        """出生点选择场景：地面上四个发光光环。"""
        self._clear_scene()
        self._apply_fog()
        # 出生点场景要用俯视镜头（否则会沿用主菜单的固定镜头）
        self._set_static_camera(config.SPAWN_CAMERA_POSITION, config.SPAWN_CAMERA_ROTATION)

        self._keep(
            lighting.ambient_light(
                config.AMBIENT_LIGHT_COLOR,
                brightness=config.AMBIENT_LIGHT_INTENSITY,
            )
        )
        self._keep(
            Entity(model="plane", scale=(60, 1, 60), color=_c((0.11, 0.11, 0.15)), collider="box")
        )

        for index, point in enumerate(config.SPAWN_POINTS):
            pos = point["position"]
            ring_color = _c(point["color"])

            # 光环：一圈小方块
            for i in range(20):
                angle = i / 20 * math.tau
                cube = Entity(
                    model="cube",
                    scale=(0.34, 0.12, 0.34),
                    position=(pos[0] + math.cos(angle) * 1.9, 0.06, pos[2] + math.sin(angle) * 1.9),
                    color=ring_color,
                    unlit=True,
                    collider="box",
                )
                cube.spawn_index = index
                cube.on_click = self._make_spawn_click(index)
                self._keep(cube)
                self.spawn_markers.append(cube)

            # 中央的光柱
            beam = Entity(
                model="cube",
                scale=(0.5, 4.0, 0.5),
                position=(pos[0], 2.0, pos[2]),
                color=_c(point["color"], 0.35),
                unlit=True,
                collider="box",
            )
            beam.spawn_index = index
            beam.on_click = self._make_spawn_click(index)
            self._keep(beam)
            self.spawn_markers.append(beam)

            self._keep(
                lighting.point_light(
                    point["color"],
                    brightness=0.5,
                    radius=18.0,
                    position=(pos[0], 2.4, pos[2]),
                )
            )

            # 名字
            label = Text(
                text=point["name"],
                origin=(0, 0),
                position=(pos[0], 4.9, pos[2]),
                scale=_world_text_scale(
                    (Vec3(pos[0], 4.9, pos[2]) - Vec3(*config.SPAWN_CAMERA_POSITION)).length(),
                    30,
                ),
                rotation=_face_camera((pos[0], 4.9, pos[2])),
                parent=scene,
                color=color.white,
                # 名字要始终看得清，所以不受灯光影响
                unlit=True,
            )
            font = current_font()
            if font:
                try:
                    label.font = font
                except Exception:  # pragma: no cover
                    pass
            self._keep(label)

        # 中央平台
        self._keep(
            Entity(
                model="cube",
                scale=(6, 0.4, 6),
                y=-0.2,
                color=_c((0.18, 0.17, 0.22)),
                collider="box",
            )
        )

    # ------------------------------------------------------------------ 状态

    def _goto_menu(self) -> None:
        self.state = STATE_MENU
        self._clear_scene()
        self._build_menu_scene()
        self.ui.hide_all()
        self.ui.show_menu()
        self.ui.set_continue_available(self.run_active)
        if self.player is not None:
            self.player.set_mouse_locked(False)
        mouse.locked = False

    def _start_run(self) -> None:
        """从主菜单开始新的一局。"""
        self.questions = daily_questions()
        self.level_index = 0
        self.correct = 0
        self.total_time = 0.0
        self.run_started_at = time_module.time()
        self.run_active = True
        self.collected_eggs = set()
        self.egg_hints = []
        self._pad_armed = True
        self.selected_spawn = None
        self._goto_spawn()

    def _resume_run(self) -> None:
        """继续上一局：回到当前这一关（场景会重新搭一遍）。"""
        if not self.run_active:
            self._start_run()
            return
        self._build_level(self.level_index)

    def _goto_spawn(self) -> None:
        self.state = STATE_SPAWN
        self._build_spawn_scene()
        self.ui.hide_all()
        self.ui.show_spawn(None)
        mouse.locked = False

    def _make_spawn_click(self, index: int):
        """生成一个「点击某个出生点」的回调，绑到光环 / 光柱上。"""

        def _click() -> None:
            self._select_spawn(index)

        return _click

    def _select_spawn(self, index: int) -> None:
        if not (0 <= index < len(config.SPAWN_POINTS)):
            return
        self.selected_spawn = index
        self.spawn_choice = config.SPAWN_POINTS[index]
        self.ui.set_selected_spawn(self.spawn_choice["name"])
        # 选中的光环更亮一点
        for marker in self.spawn_markers:
            if getattr(marker, "spawn_index", -1) == index:
                marker.color = _c(self.spawn_choice["color"])
            else:
                marker.color = marker.color.tint(-0.45)

    def _confirm_spawn(self) -> None:
        if self.selected_spawn is None:
            self._select_spawn(0)
        self._build_level(0)

    def _build_level(self, index: int) -> None:
        """搭建第 index 关。"""

        # 先把菜单 / 出生点场景清掉，否则上一块场景的道具会漏到关卡里
        self._clear_scene()

        question = self.questions[index]
        level = Level(index, question.text).build()

        # 点击面板也会弹出打字窗口（鼠标锁定时就是「看着面板点一下」）
        if level.panel is not None:
            level.panel.on_click = self._on_panel_click

        # 出生点按玩家选择做偏移
        spawn_x = self.spawn_choice["position"][0] * 0.6
        level.spawn_position = Vec3(spawn_x, 0, -level.room_depth / 2 + 4)
        self.level = level

        self.player = PlayerController(position=level.spawn_position)
        self.player.set_mouse_locked(True)

        self.question_started_at = time_module.time()
        self.buffer = ""
        self.wrong = False

        self.state = STATE_PLAYING
        self.ui.hide_all()
        self.ui.hud.enabled = True

    def _open_typing(self) -> None:
        question = self.questions[self.level_index]
        self.state = STATE_TYPING
        self.buffer = ""
        self.wrong = False
        self.auto_open_armed = False
        if self.player is not None:
            self.player.freeze()
            self.player.set_mouse_locked(False)
        self.ui.show_typing(question.text, "", egg_hint=self._current_egg_hint())
        self.ui.hide_toast()
        mouse.locked = False

    def _close_typing(self) -> None:
        self.state = STATE_PLAYING
        # 手动关掉窗口后不会立刻再弹，走远了再回来才会重新触发
        self.auto_open_armed = False
        self.ui.hide_typing()
        self.ui.hud.enabled = True
        if self.player is not None:
            self.player.unfreeze()
            self.player.set_mouse_locked(True)

    def _submit(self) -> None:
        question = self.questions[self.level_index]
        typed = self.buffer.strip()
        expected = question.answer.strip()

        if typed.lower() == expected.lower():
            # 答对：面板变绿、门缓缓打开
            self.correct += 1
            self.total_time += time_module.time() - self.question_started_at
            if self.level is not None:
                self.level.solve_panel()
                self.level.open_door()
            self.ui.hide_typing()
            self.ui.hud.enabled = True
            self.state = STATE_PLAYING
            if self.player is not None:
                self.player.unfreeze()
                self.player.set_mouse_locked(True)

            if self.level_index >= len(self.questions) - 1:
                self._goto_result()
        else:
            # 答错：输入框标红，提示「再试一次」
            self.wrong = True
            self.ui.show_typing(
                question.text,
                self.buffer,
                wrong=True,
                egg_hint=self._current_egg_hint(),
            )

    def _current_egg_hint(self) -> str:
        """打字窗口里显示的彩蛋提示（最近捡到的那条）。"""
        return self.egg_hints[-1] if self.egg_hints else ""

    def _collect_egg(self, egg: dict) -> None:
        """捡到彩蛋：记一笔、弹一句话、给当前题目一个提示。"""
        key = eggs.egg_key(egg["kind"], egg["id"], self.level_index)
        if key in self.collected_eggs:
            return
        self.collected_eggs.add(key)

        # 关卡数和题目数一一对应；越界时兜底用最后一道题
        question_index = min(self.level_index, len(self.questions) - 1)
        question = self.questions[question_index]
        text_zh, text_en = eggs.pick_egg_text(
            self.seed, self.level_index, egg["id"], egg["kind"]
        )
        hint_zh, hint_en = eggs.egg_hint(question.text, egg["kind"])
        if hint_zh:
            self.egg_hints.append(T(hint_zh, hint_en))

        if egg["kind"] == eggs.EGG_KIND_ALTAR:
            title = T("找到隐藏祭坛", "Hidden altar found")
        else:
            title = T("找到彩蛋", "Easter egg found")
        self.ui.show_toast(title, T(text_zh, text_en))
        self._toast_timer = 4.0

    def _next_level(self) -> None:
        self.level_index += 1
        if self.level_index >= len(self.questions):
            self._goto_result()
            return
        self._build_level(self.level_index)

    def _goto_result(self) -> None:
        self.state = STATE_RESULT
        self.run_active = False
        self.ui.hide_all()
        self.ui.show_result(self.correct, len(self.questions), self.total_time)
        if self.player is not None:
            self.player.freeze()
            self.player.set_mouse_locked(False)
        mouse.locked = False

    def _quit(self) -> None:
        application.quit()

    # ------------------------------------------------------------------ 输入

    def text_input(self, char: str) -> None:
        """逐字符输入（字母 / 数字 / 空格都走这里）。"""
        if self.state == STATE_TYPING:
            if len(self.buffer) < 64:
                self.buffer += char
                self.ui.update_typing_input(self.buffer, self.wrong)
            return

        if self.state == STATE_PLAYING:
            if char.lower() == "e":
                self._try_open_typing()
            return

        if self.state == STATE_SPAWN:
            if char in "1234":
                self._select_spawn(int(char) - 1)

    def input(self, key: str) -> None:
        """功能键（回车 / 退格 / Esc 等）。"""
        if self.state == STATE_TYPING:
            if key == "enter":
                self._submit()
            elif key == "backspace":
                self.buffer = self.buffer[:-1]
                self.wrong = False
                self.ui.update_typing_input(self.buffer, False)
                self.ui.typing_status.text = ""
            elif key == "escape":
                self._close_typing()
            return

        if self.state == STATE_PLAYING:
            if key == "escape":
                self._goto_menu()
            elif key == "v":
                self._toggle_camera()

    def _try_open_typing(self) -> None:
        """靠近面板（或按 E / 点击面板）时打开打字窗口。"""
        if self.state != STATE_PLAYING:
            return
        if self.level is None or self.player is None:
            return
        if self.level.panel_solved:
            return
        distance = self.level.distance_to_panel(self.player.world_position)
        if distance <= config.PANEL_TRIGGER_DISTANCE:
            self._open_typing()

    def _on_panel_click(self) -> None:
        """玩家点了发光面板 -> 直接打开打字窗口。"""
        self._try_open_typing()

    # ------------------------------------------------------------------ 每帧

    def update(self) -> None:
        self._time += time.dt
        self._update_camera()

        # 提示浮层：几秒后自动消失
        if self._toast_timer > 0:
            self._toast_timer -= time.dt
            if self._toast_timer <= 0:
                self.ui.hide_toast()

        # 关卡动画一直跑（面板浮动 / 开门），结算页背后门也会继续打开
        if self.level is not None:
            self.level.update(time.dt)

        if self.state == STATE_PLAYING and self.level is not None and self.player is not None:
            self._update_playing()
        elif self.state == STATE_MENU and self._obelisk is not None:
            # 方尖碑上下浮动，菜单也有点生气
            self._obelisk.rotation_y += time.dt * 12

    def _update_camera(self) -> None:
        """每帧把摄像机摆到玩家身上：第一人称贴着视线，第三人称跟在身后。"""
        if self.player is None:
            return

        rig = self.camera_rig
        rig.position = self.player.position
        rig.rotation = (0, self.player.rotation_y, 0)

        if self.camera_mode == config.CAMERA_MODE_THIRD:
            # 第三人称：摄像机在玩家身后（局部 -Z 是背后），略微俯视
            camera.position = (
                0,
                config.THIRD_PERSON_HEIGHT,
                -config.THIRD_PERSON_DISTANCE,
            )
            camera.rotation_x = (
                config.THIRD_PERSON_BASE_PITCH
                + self.player.pitch * config.THIRD_PERSON_PITCH_FACTOR
            )
            camera.rotation_y = 0
            # 第三人称才显示角色本体
            if getattr(self.player, "avatar", None) is not None:
                self.player.avatar.enabled = True
        else:
            # 第一人称：摄像机就在眼睛高度，视线完全跟随鼠标
            camera.position = (0, config.PLAYER_EYE, 0)
            camera.rotation_x = self.player.pitch
            camera.rotation_y = 0
            if getattr(self.player, "avatar", None) is not None:
                self.player.avatar.enabled = False

    def _toggle_camera(self) -> None:
        """V 键：第一人称 / 第三人称切换。"""
        if self.camera_mode == config.CAMERA_MODE_FIRST:
            self.camera_mode = config.CAMERA_MODE_THIRD
        else:
            self.camera_mode = config.CAMERA_MODE_FIRST
        self._update_camera()

    def _update_playing(self) -> None:
        level = self.level
        player = self.player
        question = self.questions[self.level_index]

        distance = level.distance_to_panel(player.world_position)

        # 彩蛋：走近就捡
        egg = level.collect_egg_near(player.world_position)
        if egg is not None:
            self._collect_egg(egg)

        # 弹跳板：踩上去被弹起来（离开之后才会再弹）
        on_pad = level.on_bounce_pad(player.world_position)
        if on_pad and player.grounded and self._pad_armed:
            self._pad_armed = False
            player.bounce(config.BOUNCE_PAD_FORCE)
            self.ui.show_toast(
                T("弹跳板！", "Bounce pad!"),
                T("这一下能直接窜上第四层", "Straight to the fourth platform"),
            )
            self._toast_timer = 2.5
        elif not on_pad:
            self._pad_armed = True

        # 走远了就重新「上膛」，回到面板前才会再次自动弹窗
        if distance > config.PANEL_TRIGGER_DISTANCE + 1.5:
            self.auto_open_armed = True

        if level.panel_solved:
            prompt = T("门已打开，走进去进入下一关", "Door open - walk through it")
        elif distance <= config.PANEL_TRIGGER_DISTANCE:
            prompt = T("按 E 或点击面板开始打字", "Press E or click the panel to type")
            # 走到面板附近就自动弹出打字窗口
            if self.auto_open_armed:
                self.auto_open_armed = False
                self._open_typing()
                return
        else:
            prompt = ""

        mode_label = (
            T("第三人称", "third person")
            if self.camera_mode == config.CAMERA_MODE_THIRD
            else T("第一人称", "first person")
        )
        hint = T(
            f"WASD 移动 · 鼠标转视角 · V 切换镜头（{mode_label}）· 走到发光的「打字」面板前",
            f"WASD move - mouse look - V toggles camera ({mode_label}) - reach the glowing TYPE panel",
        )

        self.ui.update_hud(
            index=self.level_index + 1,
            total=len(self.questions),
            elapsed=self.total_time + (time_module.time() - self.question_started_at),
            level=self.level_index + 1,
            hint=hint,
            prompt=prompt,
            eggs_found=len(self.collected_eggs),
            eggs_total=len(self.questions) * max(len(level.eggs), 1),
        )

        # 走进门里 -> 下一关
        if level.door_opened and level.distance_to_exit(player.world_position) <= config.DOOR_TRIGGER_DISTANCE:
            self._next_level()
