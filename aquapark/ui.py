"""界面层：主菜单、HUD、倒计时、结算页、提示条。

所有文字都通过 ``fonts.T()`` 走一遍，没有中文字体时自动退回英文文案。

每个界面都是一组 Entity（``menu`` / ``hud`` / ``countdown`` / ``result`` /
``toast``），组里的所有元素都挂在该组下面，切换界面时整组一起显示 / 隐藏，
不会互相串位。
"""

from __future__ import annotations

from typing import Callable, Dict, List, Optional, Sequence

from ursina import Button, Entity, Text, Vec2, camera, color, destroy

from . import config
from . import collection, models
from .save import PROFILE
from .fonts import T, current_font


def _c(rgb: Sequence[float], alpha: float = 1.0):
    return color.rgba(rgb[0], rgb[1], rgb[2], alpha)


def _apply_font(text_entity: Text) -> Text:
    """把中文字体套到 Text 上（没有中文字体时保持默认字体）。"""
    font = current_font()
    if font:
        try:
            text_entity.font = font
        except Exception:  # pragma: no cover - 字体加载失败时退回默认字体
            pass
    return text_entity


class UI:
    """所有 2D 界面元素的总控。"""

    def __init__(self) -> None:
        self.root = Entity(parent=camera.ui)

        self.hud = self._build_hud()
        self.menu = self._build_menu()
        self.countdown = self._build_countdown()
        self.result = self._build_result()
        # 收藏卡表要先建好，_build_shop() 往里填
        self.shop_cards: Dict[str, Dict] = {}
        self.shop = self._build_shop()
        self.toast = self._build_toast()

        self.hide_all()

        # 进度条上的选手标记
        self._progress_marks: Dict[int, Entity] = {}
        self._toast_timer = 0.0
        # 收集环节的回调（由 game.py 接管）
        self.on_shop_action = None  # callable(action: str, payload)

    # ------------------------------------------------------------------ 工具

    def _text(self, text: str, **kwargs) -> Text:
        parent = kwargs.pop("parent", None) or self.root
        entity = Text(text=text, parent=parent, **kwargs)
        return _apply_font(entity)

    def _button(
        self,
        text: str,
        on_click: Optional[Callable] = None,
        text_color: Optional[Sequence[float]] = None,
        **kwargs,
    ) -> Button:
        parent = kwargs.pop("parent", None) or self.root
        if on_click is not None:
            kwargs["on_click"] = on_click
        button = Button(text=text, parent=parent, **kwargs)
        if button.text_entity is not None:
            _apply_font(button.text_entity)
            if text_color is not None:
                button.text_entity.color = _c(text_color)
        return button

    def _set_text(self, entity: Text, value: str) -> None:
        """只在文字真的变了时才赋值。

        Ursina 的 Text 每次改内容都会重建网格，HUD 每帧刷一遍会很贵。
        """
        if entity.text != value:
            entity.text = value

    def _panel(self, width: float, height: float, **kwargs) -> Entity:
        return Entity(
            parent=kwargs.pop("parent", None) or self.root,
            model="quad",
            scale=(width, height),
            color=_c(config.UI_PANEL),
            **kwargs,
        )

    def hide_all(self) -> None:
        for group in (self.hud, self.menu, self.countdown, self.result, self.shop, self.toast):
            group.enabled = False

    # ------------------------------------------------------------------ HUD

    def _build_hud(self) -> Entity:
        group = Entity(parent=self.root)

        # 左上：名次 + 速度
        self.rank_text = self._text(
            "", parent=group, origin=(-0.5, 0.5), position=(-0.47, 0.46), size=config.HUD_SIZE * 0.001
        )
        self.speed_text = self._text(
            "", parent=group, origin=(-0.5, 0.5), position=(-0.47, 0.42), size=config.HUD_SMALL_SIZE * 0.001
        )

        # 右上：金币 / 撞飞 / 计时
        self.coins_text = self._text(
            "", parent=group, origin=(0.5, 0.5), position=(0.47, 0.46), size=config.HUD_SIZE * 0.001
        )
        self.kos_text = self._text(
            "", parent=group, origin=(0.5, 0.5), position=(0.47, 0.42), size=config.HUD_SMALL_SIZE * 0.001
        )
        self.time_text = self._text(
            "", parent=group, origin=(0.5, 0.5), position=(0.47, 0.385), size=config.HUD_SMALL_SIZE * 0.001
        )

        # 顶部中间的进度条
        bar_width = 0.44
        Entity(
            parent=group,
            model="quad",
            scale=(bar_width, 0.014),
            position=(0, 0.455),
            color=color.rgba(0, 0, 0, 0.42),
        )
        self.progress_fill = Entity(
            parent=group,
            model="quad",
            scale=(0.001, 0.014),
            position=(0, 0.455),
            color=_c(config.UI_ACCENT),
            origin=(-0.5, 0),
        )
        self.progress_width = bar_width

        # 底部操作提示
        self._text(
            T(
                "← → / A D 转向　·　空格 跳跃　·　S 俯冲　·　鼠标左右移动也能转向",
                "A/D or arrows to steer  ·  SPACE to jump  ·  S to dive  ·  mouse also steers",
            ),
            parent=group,
            origin=(0, 0),
            position=(0, -0.455),
            size=config.HUD_SMALL_SIZE * 0.001,
            color=_c(config.UI_DIM, 0.9),
        )

        return group

    def add_progress_mark(self, racer_id: int, rgb: Sequence[float]) -> None:
        """在进度条上给某个选手加一个标记点。"""
        mark = Entity(
            parent=self.hud,
            model="circle",
            scale=0.022,
            color=_c(rgb),
            position=(0, 0.455),
        )
        self._progress_marks[racer_id] = mark

    def update_hud(
        self,
        rank: int,
        total: int,
        speed: float,
        coins: int,
        kos: int,
        elapsed: float,
        progress: float,
        marks: Dict[int, float],
    ) -> None:
        self._set_text(self.rank_text, T(f"第 {rank} / {total} 名", f"#{rank} / {total}"))
        self._set_text(self.speed_text, T(f"速度 {speed:.0f} m/s", f"{speed:.0f} m/s"))
        self._set_text(self.coins_text, T(f"金币 {coins}", f"Coins {coins}"))
        self._set_text(self.kos_text, T(f"撞飞 {kos}", f"KOs {kos}"))
        minutes = int(elapsed // 60)
        seconds = elapsed % 60
        self._set_text(self.time_text, f"{minutes:02d}:{seconds:05.2f}")

        fill_width = max(0.001, self.progress_width * max(0.0, min(1.0, progress)))
        self.progress_fill.scale_x = fill_width
        self.progress_fill.x = -self.progress_width * 0.5

        for racer_id, ratio in marks.items():
            mark = self._progress_marks.get(racer_id)
            if mark is None:
                continue
            mark.x = -self.progress_width * 0.5 + self.progress_width * max(0.0, min(1.0, ratio))

    # ---------------------------------------------------------------- 主菜单

    def _build_menu(self) -> Entity:
        group = Entity(parent=self.root)

        Entity(
            parent=group,
            model="quad",
            scale=(2.4, 1.5),
            color=color.rgba(0.02, 0.09, 0.18, 0.55),
        )

        self._text(
            "AQUAPARK.IO",
            parent=group,
            origin=(0, 0),
            position=(0, 0.28),
            size=config.TITLE_SIZE * 0.001,
            color=_c(config.UI_ACCENT),
        )
        self._text(
            T("水 乐 园 大 乱 斗", "A Q U A P A R K   D A S H"),
            parent=group,
            origin=(0, 0),
            position=(0, 0.17),
            size=30 * 0.001,
            color=_c(config.UI_TEXT),
        )
        self._text(
            T(
                "谁先冲下水滑梯，谁就是冠军！\n"
                "游泳加速 · 踩水柱腾空 · 空中俯冲把对手撞出水面",
                "Slide down the flume first!\n"
                "Swim, launch off water jets, and dive onto your rivals to knock them out.",
            ),
            parent=group,
            origin=(0, 0),
            position=(0, 0.09),
            size=19 * 0.001,
            color=_c(config.UI_DIM),
            line_height=1.5,
        )

        self.menu_button = self._button(
            T("开 始 比 赛", "S T A R T"),
            parent=group,
            origin=(0, 0),
            position=(0, -0.03),
            scale=(0.3, 0.085),
            color=_c(config.UI_ACCENT),
            text_size=1.0,
            text_color=(0.04, 0.10, 0.16),
        )
        self.collection_button = self._button(
            T("收 集", "S H O P"),
            parent=group,
            origin=(0, 0),
            position=(0.42, -0.03),
            scale=(0.26, 0.085),
            color=color.rgba(1, 1, 1, 0.18),
            text_size=0.8,
            on_click=lambda: self._shop_action("open", None),
        )

        self._text(
            T(
                "操作：鼠标 / WASD / 方向键 / 手柄　·　空格 起跳　·　S 俯冲\n"
                "玩法参考 Poki 上的《Aquapark.io》（Voodoo 制作）",
                "Controls: mouse / WASD / arrows / gamepad  ·  SPACE jump  ·  S dive\n"
                "Gameplay inspired by Aquapark.io on Poki (by Voodoo)",
            ),
            parent=group,
            origin=(0, 0),
            position=(0, -0.15),
            size=15 * 0.001,
            color=color.rgba(config.UI_DIM[0], config.UI_DIM[1], config.UI_DIM[2], 0.75),
            line_height=1.4,
        )

        return group

    # ---------------------------------------------------------------- 倒计时

    def _build_countdown(self) -> Entity:
        group = Entity(parent=self.root)
        self.countdown_text = self._text(
            "",
            parent=group,
            origin=(0, 0),
            size=110 * 0.001,
            color=_c(config.UI_GOLD),
        )
        self.countdown_hint = self._text(
            T("准备出发！", "Get ready!"),
            parent=group,
            origin=(0, 0),
            position=(0, -0.16),
            size=24 * 0.001,
            color=_c(config.UI_TEXT),
        )
        return group

    def set_countdown(self, text: str, scale: float = 1.0) -> None:
        self._set_text(self.countdown_text, text)
        self.countdown_text.scale = scale

    # ---------------------------------------------------------------- 结算

    def _build_result(self) -> Entity:
        group = Entity(parent=self.root)

        Entity(
            parent=group,
            model="quad",
            scale=(1.6, 1.15),
            color=color.rgba(0.02, 0.09, 0.18, 0.72),
        )

        self.result_title = self._text(
            "", parent=group, origin=(0, 0), position=(0, 0.36), size=64 * 0.001
        )
        self.result_detail = self._text(
            "", parent=group, origin=(0, 0), position=(0, 0.15), size=24 * 0.001,
            color=_c(config.UI_TEXT), line_height=1.6,
        )
        self.result_stats = self._text(
            "", parent=group, origin=(0, 0), position=(0, -0.06), size=20 * 0.001,
            color=_c(config.UI_DIM), line_height=1.6,
        )

        self.result_again = self._button(
            T("再 来 一 局", "R A C E  A G A I N"),
            parent=group,
            origin=(0, 0),
            position=(-0.19, -0.4),
            scale=(0.3, 0.075),
            color=_c(config.UI_ACCENT),
            text_size=0.8,
            text_color=(0.04, 0.10, 0.16),
        )
        self.result_collection = self._button(
            T("收 集 品", "S H O P"),
            parent=group,
            origin=(0, 0),
            position=(0, -0.285),
            scale=(0.3, 0.075),
            color=color.rgba(1, 1, 1, 0.18),
            text_size=0.8,
            on_click=lambda: self._shop_action("open", None),
        )
        self.result_menu = self._button(
            T("返 回 主 菜 单", "M A I N  M E N U"),
            parent=group,
            origin=(0, 0),
            position=(0.19, -0.4),
            scale=(0.3, 0.075),
            color=color.rgba(1, 1, 1, 0.22),
            text_size=0.8,
        )
        return group

    def set_result(
        self,
        place: int,
        total: int,
        elapsed: float,
        coins: int,
        kos: int,
    ) -> None:
        titles = {
            1: T("冠 军 ！", "C H A M P I O N !"),
            2: T("亚 军", "S E C O N D"),
            3: T("第 三 名", "T H I R D"),
        }
        self._set_text(self.result_title, titles.get(place, T(f"第 {place} 名", f"#{place}")))
        self.result_title.color = (
            _c(config.UI_GOLD) if place == 1 else _c(config.UI_TEXT)
        )

        minutes = int(elapsed // 60)
        seconds = elapsed % 60
        self._set_text(
            self.result_detail,
            T(
                f"用时 {minutes:02d}:{seconds:05.2f}",
                f"Time {minutes:02d}:{seconds:05.2f}",
            ),
        )
        self._set_text(
            self.result_stats,
            T(
                f"最终名次 {place} / {total}\n收集金币 {coins} 枚　·　撞飞对手 {kos} 人",
                f"Final rank {place} / {total}\nCoins {coins}  ·  Knockouts {kos}",
            ),
        )

    # ---------------------------------------------------------------- 提示条

    # ------------------------------------------------------------ 收集环节

    def _build_shop(self) -> Entity:
        """收集环节：顶部货币栏 + 收藏卡 + 稀有礼包 + 继续。

        坐标用 Ursina 的 UI 空间（整屏约 1.5 x 0.84）。

        两个坑：
        1. **UI 相机朝 -Z 看**，所以越小的 z 越靠前，卡片里的图标 / 文字
           必须给负 z，否则会被按钮自己的模型挡住。
        2. **子实体会继承父级的缩放**。按钮的 scale 只有 0.15，把图标挂在
           按钮下面会被一起缩成一小点，所以卡片内容一律挂在同一层（group），
           用绝对坐标和绝对尺寸。
        """
        from . import textures

        group = Entity(parent=camera.ui)

        # 背景：紫色棋盘格
        background = Entity(
            parent=group,
            model="quad",
            scale=(2.9, 1.7),
            z=0.9,
            color=color.white,
        )
        background.texture = textures.make_texture(
            textures.purple_checker_texture(), filtering="linear"
        )

        # 中间一团柔光
        glow = Entity(
            parent=group,
            model="quad",
            scale=(1.6, 1.2),
            z=0.85,
            color=color.rgba(0.78, 0.38, 0.98, 0.30),
        )
        glow.texture = textures.make_texture(
            textures.soft_circle_texture(), filtering="linear"
        )

        # 顶部货币栏：金币 / 钻石 / 票
        self.shop_currency_texts: Dict[str, Text] = {}
        for index, key in enumerate(("coin", "gem", "ticket")):
            x = (index - 1) * 0.175
            Entity(
                parent=group,
                model="quad",
                scale=(0.17, 0.055),
                position=(x, 0.345, 0),
                color=color.rgba(0.10, 0.07, 0.20, 0.9),
            )
            self._build_currency_icon(group, key, x - 0.052, 0.345, 0.018)
            text = self._text(
                "0",
                parent=group,
                origin=(-0.5, 0),
                position=(x - 0.026, 0.333, -0.01),
                size=0.026,
                color=color.white,
            )
            self.shop_currency_texts[key] = text

        # 左上角：收藏进度
        self.shop_progress_text = self._text(
            "",
            parent=group,
            origin=(-0.5, 0.5),
            position=(-0.72, 0.348, 0),
            size=0.026,
            color=color.rgba(1, 1, 1, 0.85),
        )

        # 收藏卡：3 列 2 行
        card_w, card_h = 0.15, 0.175
        for index, item in enumerate(collection.COLLECTION):
            row, column = divmod(index, 3)
            x = (column - 1) * 0.19
            y = 0.135 - row * 0.20
            button = self._button(
                "",
                parent=group,
                origin=(0, 0),
                position=(x, y, 0),
                scale=(card_w, card_h),
                color=_c(collection.rarity_color(item["rarity"])),
                on_click=lambda i=item["id"]: self._shop_action("equip", i),
            )
            # 卡片下半截的名条
            Entity(
                parent=group,
                model="quad",
                scale=(card_w * 0.96, 0.042),
                position=(x, y - 0.062, -0.015),
                color=color.rgba(1, 1, 1, 0.82),
            )
            icon = collection.build_icon(item["id"])
            icon.parent = group
            icon.position = (x, y + 0.012, -0.02)
            name = self._text(
                item["name"],
                parent=group,
                origin=(0, 0),
                position=(x, y - 0.062, -0.03),
                size=0.02,
                color=color.rgba(0.12, 0.28, 0.55, 1),
            )
            count = self._text(
                "0",
                parent=group,
                origin=(0.5, 0.5),
                position=(x + 0.055, y + 0.058, -0.03),
                size=0.022,
                color=color.white,
            )
            # 左上角的小稀有度标签
            self._text(
                collection.RARITY_NAMES.get(item["rarity"], ""),
                parent=group,
                origin=(0, 0.5),
                position=(x - 0.068, y + 0.062, -0.03),
                size=0.016,
                color=color.rgba(1, 1, 1, 0.75),
            )
            self.shop_cards[item["id"]] = {
                "button": button,
                "name": name,
                "count": count,
            }

        # 稀有礼包
        pack_x, pack_y = 0.0, -0.325
        self.pack_button = self._button(
            "",
            parent=group,
            origin=(0, 0),
            position=(pack_x, pack_y, 0),
            scale=(0.42, 0.085),
            color=color.rgba(0.60, 0.90, 0.12, 1),
            on_click=lambda: self._shop_action("pack", None),
        )
        self._text(
            "+",
            parent=group,
            origin=(0, 0),
            position=(pack_x - 0.175, pack_y, -0.02),
            size=0.05,
            color=color.white,
        )
        self.pack_card = Entity(
            parent=group,
            model="quad",
            scale=(0.10, 0.058),
            position=(pack_x - 0.055, pack_y, -0.015),
            color=color.rgba(0.16, 0.48, 0.92, 1),
        )
        self._text(
            T("稀有\n礼包", "RARE\nPACK"),
            parent=group,
            origin=(0, 0),
            position=(pack_x - 0.055, pack_y, -0.03),
            size=0.015,
            color=color.white,
            line_height=1.1,
        )
        self._text(
            "40",
            parent=group,
            origin=(0, 0),
            position=(pack_x + 0.075, pack_y, -0.03),
            size=0.03,
            color=color.white,
        )
        self._build_currency_icon(group, "gem", pack_x + 0.135, pack_y, 0.016)

        # 继续
        self.shop_continue = self._button(
            T("继 续 游 戏", "C O N T I N U E"),
            parent=group,
            origin=(0, 0),
            position=(0, -0.395, 0),
            scale=(0.28, 0.055),
            color=color.rgba(1, 1, 1, 0.16),
            text_size=0.8,
            on_click=lambda: self._shop_action("continue", None),
        )

        # 开盒演出的图层（默认藏着）
        # z 要比卡片（-0.03）更靠前，否则揭晓的图标会被卡片挡住
        self.reveal = Entity(parent=group, enabled=False, z=-0.2)
        # 揭晓时压暗背景，焦点更清楚
        self.reveal_dim = Entity(
            parent=self.reveal,
            model="quad",
            scale=(3.0, 2.0),
            color=color.rgba(0.05, 0.02, 0.10, 0.0),
            z=0.005,
        )
        # 闪光用 circle 模型：自带柔边贴图，比方块好看
        self.reveal_flash = Entity(
            parent=self.reveal,
            model="circle",
            scale=(0.1, 0.1),
            color=color.rgba(1, 1, 1, 0.75),
            z=0.0,
        )
        self.reveal_ring = Entity(
            parent=self.reveal,
            model="circle",
            scale=(0.34, 0.34),
            color=color.rgba(1, 1, 1, 0.35),
            z=0.01,
        )
        # 图标要在闪光**前面**（z 更小），否则会被半透明的闪光盖住
        self.reveal_icon = Entity(parent=self.reveal, z=-0.02)
        self.reveal_name = self._text(
            "", parent=self.reveal, origin=(0, 0), position=(0, -0.22, -0.03),
            size=0.05, color=color.white,
        )
        self.pack_anim = {"phase": "idle", "t": 0.0, "item": None}
        self.reveal_icon_base = 1.0
        self.reveal_icon_entity = None

        self.refresh_shop()
        return group

    def _build_currency_icon(self, parent, key: str, x: float, y: float, r: float) -> Entity:
        """货币栏里的小图标。"""
        if key == "coin":
            return models.cylinder(
                r,
                r * 0.4,
                parent=parent,
                position=(x, y, -0.01),
                rotation=(90, 0, 0),
                color=color.rgba(1.0, 0.78, 0.16, 1),
            )
        if key == "gem":
            return Entity(
                parent=parent,
                model="sphere",
                scale=(r * 1.5, r * 2.1, r * 1.5),
                position=(x, y, -0.01),
                color=color.rgba(0.98, 0.36, 0.80, 1),
            )
        return Entity(
            parent=parent,
            model="cube",
            scale=(r * 1.7, r * 1.2, r * 0.4),
            position=(x, y, -0.01),
            rotation=(0, 0, 20),
            color=color.rgba(0.30, 0.78, 0.96, 1),
        )

    def open_pack_animation(self, item_id: str) -> None:
        """开始「开盒」演出。"""
        item = collection.get(item_id)
        if item is None:
            return
        # 把抽到的图标装进揭晓层
        for child in list(self.reveal_icon.children):
            destroy(child)
        icon = collection.build_icon(item_id)
        icon.parent = self.reveal_icon
        # 图标自身已经有调校好的缩放，这里记下来，演出时从 0 放大到它
        self.reveal_icon_base = icon.scale.x
        self.reveal_icon_entity = icon   # 真正要缩放的是图标自己，不是容器
        icon.scale = 0.0
        self.reveal_name.text = item["name"]
        self.reveal_ring.color = _c(collection.rarity_color(item["rarity"]), 0.35)
        self.reveal_name.color = color.rgba(1, 1, 1, 1)
        self.reveal.enabled = True
        self.pack_anim = {"phase": "spin", "t": 0.0, "item": item_id}

    def update_shop(self, dt: float) -> None:
        """驱动开盒演出的时间轴。"""
        anim = self.pack_anim
        if anim["phase"] == "idle":
            return

        anim["t"] += dt
        t = anim["t"]

        if anim["phase"] == "spin":
            # 礼包卡放大 + 旋转
            k = min(1.0, t / 0.75)
            spin = t * 900
            self.pack_card.scale = (0.10 + 0.06 * k, 0.058 + 0.03 * k, 1)
            self.pack_card.rotation_z = spin
            self.pack_card.color = color.rgba(0.16, 0.48, 0.92, 1)
            if t >= 0.75:
                anim["phase"] = "reveal"
                anim["t"] = 0.0
                self.pack_card.enabled = False

        elif anim["phase"] == "reveal":
            k = min(1.0, t / 0.55)
            ease = 1 - (1 - k) ** 3
            self.reveal_dim.color = color.rgba(0.05, 0.02, 0.10, 0.55 * ease)
            self.reveal_flash.scale = (0.1 + 0.62 * ease, 0.1 + 0.62 * ease, 1)
            self.reveal_flash.color = color.rgba(1, 1, 1, 0.8 * (1 - k))
            self.reveal_ring.scale = (0.2 + 0.4 * ease, 0.2 + 0.4 * ease, 1)
            self.reveal_ring.color = color.rgba(*collection.rarity_color(collection.get(anim["item"])["rarity"]), 0.45 * (1 - k * 0.5))
            base = self.reveal_icon_base
            entity = self.reveal_icon_entity
            entity.scale = (base * 2.8 * ease, base * 2.8 * ease, base * 2.8 * ease)
            entity.y = 0.02 * (1 - k)
            self.reveal_name.alpha = min(1.0, k * 1.6)
            if t >= 0.55:
                anim["phase"] = "hold"
                anim["t"] = 0.0

        elif anim["phase"] == "hold":
            base = self.reveal_icon_base
            entity = self.reveal_icon_entity
            entity.scale = (base * 2.8, base * 2.8, base * 2.8)
            self.reveal_name.alpha = 1
            if t >= 0.85:
                anim["phase"] = "fade"
                anim["t"] = 0.0

        elif anim["phase"] == "fade":
            k = min(1.0, t / 0.4)
            base = self.reveal_icon_base
            entity = self.reveal_icon_entity
            entity.scale = (base * 2.8 * (1 - k), base * 2.8 * (1 - k), base * 2.8 * (1 - k))
            self.reveal_name.alpha = 1 - k
            self.reveal_ring.color = color.rgba(1, 1, 1, 0)
            self.reveal_dim.color = color.rgba(0.05, 0.02, 0.10, 0.55 * (1 - k))
            if k >= 1.0:
                anim["phase"] = "idle"
                self.reveal.enabled = False
                self.pack_card.enabled = True
                self.pack_card.scale = (0.10, 0.058, 1)
                self.pack_card.rotation_z = 0

    def _shop_action(self, action: str, payload) -> None:
        """收集界面上的操作，转交给 game.py。"""
        if self.on_shop_action:
            self.on_shop_action(action, payload)

    def refresh_shop(self) -> None:
        """把档案里的最新数据刷到界面上。"""
        profile = PROFILE
        self._set_text(self.shop_currency_texts["coin"], str(profile.coins))
        self._set_text(self.shop_currency_texts["gem"], str(profile.gems))
        self._set_text(self.shop_currency_texts["ticket"], str(profile.tickets))
        owned = sum(1 for item_id in collection.BY_ID if profile.count(item_id) > 0)
        self._set_text(
            self.shop_progress_text,
            T(f"收藏进度 {owned} / {len(collection.COLLECTION)}",
              f"Collection {owned} / {len(collection.COLLECTION)}"),
        )
        for item_id, card in self.shop_cards.items():
            item = collection.get(item_id)
            self._set_text(card["count"], str(profile.count(item_id)))
            equipped = profile.equipped == item_id
            card["button"].color = (
                color.rgba(0.45, 0.95, 0.25, 1)
                if equipped
                else _c(collection.rarity_color(item["rarity"]))
            )
            card["name"].color = (
                color.rgba(0.08, 0.22, 0.04, 1)
                if equipped
                else color.rgba(0.12, 0.28, 0.55, 1)
            )

    def _build_toast(self) -> Entity:
        group = Entity(parent=self.root)
        self.toast_text = self._text(
            "",
            parent=group,
            origin=(0, 0),
            position=(0, 0.3),
            size=30 * 0.001,
            color=_c(config.UI_GOLD),
        )
        return group

    def show_toast(self, message: str, duration: float = 1.6) -> None:
        self._set_text(self.toast_text, message)
        self.toast.enabled = True
        self._toast_timer = duration

    def update_toast(self, dt: float) -> None:
        if self._toast_timer > 0.0:
            self._toast_timer -= dt
            if self._toast_timer <= 0.0:
                self.toast.enabled = False
