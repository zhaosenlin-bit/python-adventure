"""界面层：主菜单、出生点选择、HUD、打字窗口、闯关结算。

所有文字都通过 ``fonts.T()`` 走一遍，没有中文字体时自动退回英文文案。

每个界面都是一组 Entity（``hud`` / ``typing`` / ``menu`` / ``spawn`` / ``result``），
组里的所有元素（文字、按钮、背景板）都挂在该组下面，切换界面时整组一起
显示 / 隐藏，不会互相串位。
"""

from __future__ import annotations

from typing import Callable, Optional

from ursina import Button, Entity, Text, camera, color

from . import config
from .fonts import T, current_font
from .records import Record, best_of_day


def _c(rgb, alpha: float = 1.0):
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
        self.typing = self._build_typing_window()
        self.toast = self._build_toast()
        self.menu = self._build_menu()
        self.spawn = self._build_spawn_panel()
        self.result = self._build_result()
        self.board = self._build_board()

        self.hide_all()

    # ------------------------------------------------------------------ 工具

    def _text(self, text: str, **kwargs) -> Text:
        # 允许调用方指定自己的 parent（分组），没指定时才挂在 root 下
        parent = kwargs.pop("parent", None) or self.root
        entity = Text(text=text, parent=parent, **kwargs)
        _apply_font(entity)
        return entity

    def _button(self, text: str, on_click: Optional[Callable], **kwargs) -> Button:
        # 按钮必须挂在自己的分组下，否则切界面时不会被一起隐藏
        parent = kwargs.pop("parent", None) or self.root
        # Ursina 的 Button 不接受 on_click=None，绑定回调时再传
        if on_click is not None:
            kwargs["on_click"] = on_click
        button = Button(text=text, parent=parent, **kwargs)
        if button.text_entity is not None:
            _apply_font(button.text_entity)
        return button

    def hide_all(self) -> None:
        for group in (
            self.hud,
            self.typing,
            self.toast,
            self.menu,
            self.spawn,
            self.result,
            self.board,
        ):
            group.enabled = False

    # ------------------------------------------------------------------ HUD

    def _build_hud(self) -> Entity:
        group = Entity(parent=self.root)

        # 顶部中间：第 N / M 题
        self.hud_progress = self._text(
            "", origin=(0, 0), y=0.44, scale=1.5, color=_c(config.UI_TEXT), parent=group
        )
        # 顶部右侧：已用时间
        self.hud_timer = self._text(
            "", origin=(0.5, 0), x=0.46, y=0.44, scale=1.0, color=_c(config.UI_DIM), parent=group
        )
        # 顶部左侧：当前关卡
        # 彩蛋计数（挤在关卡下面）
        self.hud_eggs = self._text(
            "", origin=(0.5, 0), x=-0.46, y=0.375, scale=0.9, color=_c(config.UI_ACCENT), parent=group
        )
        self.hud_level = self._text(
            "", origin=(0.5, 0), x=-0.46, y=0.44, scale=1.0, color=_c(config.UI_DIM), parent=group
        )
        # 底部操作提示
        self.hud_hint = self._text(
            "", origin=(0, 0), y=-0.44, scale=0.9, color=_c(config.UI_DIM), parent=group
        )
        # 靠近面板时的提示
        self.hud_prompt = self._text(
            "", origin=(0, 0), y=-0.36, scale=1.1, color=_c(config.UI_ACCENT), parent=group
        )

        return group

    def update_hud(
        self,
        index: int,
        total: int,
        elapsed: float,
        level: int,
        hint: str = "",
        prompt: str = "",
        eggs_found: int = 0,
        eggs_total: int = 0,
    ) -> None:
        self.hud_progress.text = T(f"第 {index} / {total} 题", f"Question {index} / {total}")
        self.hud_timer.text = T(f"用时 {elapsed:.1f}s", f"Time {elapsed:.1f}s")
        self.hud_level.text = T(f"第 {level} 关", f"Level {level}")
        self.hud_eggs.text = T(f"彩蛋 {eggs_found} / {eggs_total}", f"Eggs {eggs_found} / {eggs_total}")
        self.hud_hint.text = hint
        self.hud_prompt.text = prompt

    # ------------------------------------------------------------------ 打字窗口

    def _build_typing_window(self) -> Entity:
        group = Entity(parent=self.root)

        Entity(
            model="quad",
            parent=group,
            scale=(0.92, 0.56),
            color=_c(config.UI_BACKGROUND),
            z=0.1,
        )

        self.typing_title = self._text(
            T("请输入下面这个单词 / 短句", "Type the word or phrase below"),
            origin=(0, 0),
            y=0.21,
            scale=1.1,
            color=_c(config.UI_DIM),
            parent=group,
        )
        # 大字号题目
        self.typing_question = self._text(
            "", origin=(0, 0), y=0.10, scale=2.4, color=_c(config.UI_ACCENT), parent=group
        )
        # 输入框（已输入内容 + 光标）
        self.typing_input = self._text(
            "", origin=(0, 0), y=-0.04, scale=1.8, color=_c(config.UI_TEXT), parent=group
        )
        # 状态提示（答错标红）
        self.typing_status = self._text(
            "", origin=(0, 0), y=-0.13, scale=1.2, color=_c(config.UI_ERROR), parent=group
        )
        # 操作说明
        # 彩蛋换来的提示
        self.typing_eggs = self._text(
            "", origin=(0, 0), y=-0.175, scale=1.0, color=_c(config.UI_ACCENT), parent=group
        )
        self.typing_hint = self._text(
            T("回车提交 · 退格删除 · Esc 关闭", "Enter to submit · Backspace to erase · Esc to close"),
            origin=(0, 0),
            y=-0.22,
            scale=0.9,
            color=_c(config.UI_DIM),
            parent=group,
        )

        return group

    def show_typing(
        self,
        question: str,
        buffer: str,
        wrong: bool = False,
        egg_hint: str = "",
    ) -> None:
        self.typing_eggs.text = egg_hint
        self.typing_question.text = question
        self.typing_input.text = buffer + "|"  # 末尾竖线当光标
        self.typing_input.color = _c(config.UI_ERROR) if wrong else _c(config.UI_TEXT)
        self.typing_status.text = T("再试一次", "Try again") if wrong else ""
        self.typing.enabled = True

    def update_typing_input(self, buffer: str, wrong: bool) -> None:
        self.typing_input.text = buffer + "|"
        self.typing_input.color = _c(config.UI_ERROR) if wrong else _c(config.UI_TEXT)

    def hide_typing(self) -> None:
        self.typing.enabled = False

    # ------------------------------------------------------------------ 提示浮层

    def _build_toast(self) -> Entity:
        """捡到彩蛋 / 踩到弹跳板时弹出来的一句话。"""
        group = Entity(parent=self.root, y=0.33)

        Entity(
            model="quad",
            parent=group,
            scale=(0.7, 0.14),
            color=_c(config.UI_BACKGROUND),
            z=0.1,
        )
        self.toast_title = self._text(
            "", origin=(0, 0), y=0.028, scale=1.25, color=_c(config.UI_ACCENT), parent=group
        )
        self.toast_body = self._text(
            "", origin=(0, 0), y=-0.026, scale=0.9, color=_c(config.UI_TEXT), parent=group
        )

        group.enabled = False
        return group

    def show_toast(self, title: str, body: str = "") -> None:
        self.toast_title.text = title
        self.toast_body.text = body
        self.toast.enabled = True

    def hide_toast(self) -> None:
        self.toast.enabled = False

    # ------------------------------------------------------------------ 主菜单

    def _build_menu(self) -> Entity:
        group = Entity(parent=self.root)

        self.menu_title = self._text(
            T("编程冒险岛 · 3D 打字闯关", "Code Adventure Island · 3D Typing Quest"),
            origin=(0, 0),
            # 留出上方的空间给场景里的 3D 立体标题
            y=0.44,
            scale=1.9,
            color=_c(config.UI_TEXT),
            parent=group,
        )
        self.menu_subtitle = self._text(
            T("探索 → 答题 → 开门 → 下一关", "Explore -> Answer -> Open the door -> Next level"),
            origin=(0, 0),
            y=0.295,
            scale=1.1,
            color=_c(config.UI_DIM),
            parent=group,
        )

        # 主按钮：进入 3D 打字闯关
        self.menu_button = self._button(
            T("3D 打字闯关", "3D Typing Quest"),
            None,
            scale=(0.42, 0.12),
            y=0.04,
            color=_c((0.16, 0.55, 0.52)),
            parent=group,
        )
        # 本机排行榜（战绩存在本机 JSON 存档里）
        self.menu_board = self._button(
            T("本机排行榜", "Local ranking"),
            None,
            scale=(0.3, 0.09),
            x=0.0,
            y=-0.10,
            color=_c((0.20, 0.42, 0.38)),
            parent=group,
        )
        # 继续上一局
        self.menu_continue = self._button(
            T("继续闯关", "Continue quest"),
            None,
            scale=(0.3, 0.09),
            x=-0.32,
            y=-0.10,
            color=_c((0.22, 0.30, 0.45)),
            parent=group,
        )
        self.menu_continue.enabled = False
        # 退出游戏
        self.menu_quit = self._button(
            T("退出游戏", "Quit"),
            None,
            scale=(0.3, 0.09),
            x=0.32,
            y=-0.10,
            color=_c((0.35, 0.22, 0.24)),
            parent=group,
        )

        self.menu_tip = self._text(
            T(
                "每日 20~30 题，跨天自动更新；题目全部来自本地题库，不需要联网。",
                "20~30 questions per day, refreshed daily. Fully offline.",
            ),
            origin=(0, 0),
            y=-0.22,
            scale=0.85,
            color=_c(config.UI_DIM),
            parent=group,
        )

        return group

    def show_menu(self) -> None:
        self.menu.enabled = True

    def hide_menu(self) -> None:
        self.menu.enabled = False

    def set_continue_available(self, available: bool) -> None:
        self.menu_continue.enabled = available

    # ------------------------------------------------------------------ 出生点

    def _build_spawn_panel(self) -> Entity:
        group = Entity(parent=self.root)

        self.spawn_title = self._text(
            T("选择出生点", "Choose a spawn point"),
            origin=(0, 0),
            y=0.40,
            scale=1.8,
            color=_c(config.UI_TEXT),
            parent=group,
        )
        self.spawn_hint = self._text(
            T("点击地面上的光环选择出生点（也可以按 1~4 键）", "Click a glowing ring (or press 1~4)"),
            origin=(0, 0),
            y=0.32,
            scale=1.0,
            color=_c(config.UI_DIM),
            parent=group,
        )
        self.spawn_selected = self._text(
            "",
            origin=(0, 0),
            y=-0.30,
            scale=1.2,
            color=_c(config.UI_ACCENT),
            parent=group,
        )

        self.spawn_confirm = self._button(
            T("确认出发", "Start"),
            None,
            scale=(0.32, 0.1),
            y=-0.40,
            color=_c((0.16, 0.55, 0.52)),
            parent=group,
        )
        self.spawn_confirm.enabled = False

        self.spawn_back = self._button(
            T("返回大厅", "Back to lobby"),
            None,
            scale=(0.28, 0.09),
            x=-0.32,
            y=-0.40,
            color=_c((0.25, 0.25, 0.32)),
            parent=group,
        )

        return group

    def show_spawn(self, selected_name: Optional[str]) -> None:
        self.spawn.enabled = True
        self.set_selected_spawn(selected_name)

    def set_selected_spawn(self, name: Optional[str]) -> None:
        if name:
            self.spawn_selected.text = T(f"已选择：{name}", f"Selected: {name}")
            self.spawn_confirm.enabled = True
        else:
            self.spawn_selected.text = T("尚未选择出生点", "No spawn point selected")
            self.spawn_confirm.enabled = False

    def hide_spawn(self) -> None:
        self.spawn.enabled = False

    # ------------------------------------------------------------------ 结算

    def _build_result(self) -> Entity:
        group = Entity(parent=self.root)

        Entity(
            model="quad", parent=group, scale=(0.78, 0.62), color=_c(config.UI_BACKGROUND), z=0.1
        )

        self.result_title = self._text(
            T("闯关完成", "Quest Complete"),
            origin=(0, 0),
            y=0.20,
            scale=2.4,
            color=_c(config.UI_SUCCESS),
            parent=group,
        )
        self.result_stats = self._text(
            "",
            origin=(0, 0),
            y=0.02,
            scale=1.4,
            color=_c(config.UI_TEXT),
            parent=group,
        )
        self.result_back = self._button(
            T("返回大厅", "Back to lobby"),
            None,
            scale=(0.34, 0.11),
            y=-0.18,
            color=_c((0.16, 0.55, 0.52)),
            parent=group,
        )

        return group

    def show_result(
        self,
        correct: int,
        total: int,
        seconds: float,
        eggs: int = 0,
        records: Optional[list] = None,
    ) -> None:
        accuracy = (correct / total * 100) if total else 0.0
        stats_cn = f"正确 {correct} / {total} 题\n总用时 {seconds:.1f} 秒\n正确率 {accuracy:.0f}%"
        stats_en = f"Correct {correct} / {total}\nTotal time {seconds:.1f}s\nAccuracy {accuracy:.0f}%"
        if eggs:
            stats_cn += f"\n彩蛋 {eggs} 个"
            stats_en += f"\nEggs {eggs}"
        best = best_of_day(records or [])
        if best is not None:
            stats_cn += f"\n今日最佳 {best.accuracy:.0f}%（{best.correct}/{best.total}）"
            stats_en += f"\nBest today {best.accuracy:.0f}% ({best.correct}/{best.total})"
        self.result_stats.text = T(stats_cn, stats_en)
        self.result.enabled = True

    def hide_result(self) -> None:
        self.result.enabled = False

    # ------------------------------------------------------------------ 排行榜

    def _build_board(self) -> Entity:
        group = Entity(parent=self.root)

        Entity(
            model="quad", parent=group, scale=(0.78, 0.62), color=_c(config.UI_BACKGROUND), z=0.1
        )

        self.board_title = self._text(
            T("本机排行榜", "Local Leaderboard"),
            origin=(0, 0),
            y=0.24,
            scale=2.0,
            color=_c(config.UI_SUCCESS),
            parent=group,
        )
        self.board_list = self._text(
            "",
            origin=(0, 0),
            y=0.02,
            scale=1.1,
            color=_c(config.UI_TEXT),
            parent=group,
        )
        self.board_back = self._button(
            T("返回", "Back"),
            None,
            scale=(0.26, 0.09),
            y=-0.24,
            color=_c((0.22, 0.30, 0.45)),
            parent=group,
        )

        return group

    def show_board(self, records: Optional[list[Record]] = None) -> None:
        """把本机战绩画出来（records 要已经排好序）。"""
        rows = list(records or [])
        lines_cn: list[str] = []
        lines_en: list[str] = []

        best = best_of_day(rows)
        if best is None:
            lines_cn.append("今天还没有成绩，先来一局吧")
            lines_en.append("No run today yet - play one!")
        else:
            lines_cn.append(
                f"今日最佳 {best.accuracy:.0f}%（{best.correct}/{best.total} · {best.seconds:.1f} 秒）"
            )
            lines_en.append(
                f"Best today {best.accuracy:.0f}% ({best.correct}/{best.total} - {best.seconds:.1f}s)"
            )

        if rows:
            lines_cn.append("")
            lines_en.append("")
            for index, record in enumerate(rows[:10], 1):
                lines_cn.append(
                    f"{index}. {record.accuracy:.0f}%  {record.correct}/{record.total}"
                    f"  {record.seconds:.1f} 秒  彩蛋 {record.eggs}"
                )
                lines_en.append(
                    f"{index}. {record.accuracy:.0f}%  {record.correct}/{record.total}"
                    f"  {record.seconds:.1f}s  eggs {record.eggs}"
                )
        else:
            lines_cn.append("还没有任何战绩")
            lines_en.append("No records yet")

        self.board_list.text = T("\n".join(lines_cn), "\n".join(lines_en))
        self.board.enabled = True

    def hide_board(self) -> None:
        self.board.enabled = False
