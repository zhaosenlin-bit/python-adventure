"""3D 打字闯关 · 全局配置

所有可调参数集中在这里，方便统一修改。
纯常量模块，不依赖 Ursina，方便在无图形环境下被单元测试导入。
"""

from __future__ import annotations

# ---------------------------------------------------------------- 窗口 / 渲染

APP_TITLE = "编程冒险岛 · 3D 打字闯关"
WINDOW_SIZE = (1280, 720)
WINDOW_BORDERLESS = False
VSYNC = True

# 第一人称视野角度
CAMERA_FOV = 90
# 鼠标灵敏度（越大转头越快）
MOUSE_SENSITIVITY = 40

# 镜头模式：第一人称 / 第三人称（游戏中按 V 切换）
CAMERA_MODE_FIRST = "first"
CAMERA_MODE_THIRD = "third"
# 第三人称：摄像机相对玩家的后退距离 / 抬高高度
THIRD_PERSON_DISTANCE = 6.4
THIRD_PERSON_HEIGHT = 2.75
# 第三人称俯仰跟随系数（0 = 不跟随鼠标，1 = 完全跟随）
THIRD_PERSON_PITCH_FACTOR = 0.35
# 第三人称固定俯角（略微俯视角色）
THIRD_PERSON_BASE_PITCH = 8.0

# ---------------------------------------------------------------- 玩家

PLAYER_SPEED = 5.5
PLAYER_HEIGHT = 2.0
PLAYER_EYE = 1.7
PLAYER_GRAVITY = 1.0
PLAYER_JUMP_HEIGHT = 2.0
# 面板触发距离：走到这么近就自动弹出打字窗口
PANEL_TRIGGER_DISTANCE = 3.4
# 门口触发区：走进去就进入下一关
DOOR_TRIGGER_DISTANCE = 1.6

# ---------------------------------------------------------------- 关卡

WALL_HEIGHT = 6.0
WALL_THICKNESS = 1.0
DOOR_WIDTH = 3.2
DOOR_HEIGHT = 4.2
# 门打开动画时长（秒）
DOOR_OPEN_DURATION = 1.8
# 面板上下浮动的幅度与速度
PANEL_FLOAT_AMPLITUDE = 0.22
PANEL_FLOAT_SPEED = 1.6

# ---------------------------------------------------------------- 场景氛围

FOG_COLOR = (0.08, 0.07, 0.10)
FOG_DENSITY = 0.022
# 环境光（亮度已经乘进颜色里，见 lighting.py）
AMBIENT_LIGHT_COLOR = (0.17, 0.17, 0.22)
AMBIENT_LIGHT_INTENSITY = 1.0
# 房间中央的暖色主光
WARM_LIGHT_COLOR = (1.0, 0.90, 0.74)
WARM_LIGHT_BRIGHTNESS = 0.21
WARM_LIGHT_RANGE = 34.0
# 面板附近的暖光
PANEL_LIGHT_COLOR = (1.0, 0.93, 0.80)
PANEL_LIGHT_BRIGHTNESS = 0.22
PANEL_LIGHT_RANGE = 20.0
# 面板自己发出的青色光
PANEL_GLOW_BRIGHTNESS = 0.21
PANEL_GLOW_RANGE = 14.0
# 门打开后亮起的灯
DOOR_LIGHT_BRIGHTNESS = 1.0

FLOOR_COLOR = (0.16, 0.15, 0.19)
WALL_COLOR = (0.26, 0.24, 0.30)
PILLAR_COLOR = (0.21, 0.20, 0.26)
CEILING_COLOR = (0.12, 0.11, 0.15)

PANEL_COLOR = (0.25, 0.95, 0.85)
PANEL_SOLVED_COLOR = (0.35, 1.0, 0.45)
DOOR_COLOR = (0.42, 0.36, 0.52)
DOOR_OPEN_LIGHT_COLOR = (0.55, 1.0, 0.75)
# 面板上「打字」两个字的缩放（面板宽 3.4，文字高度约 1.1 个单位）
PANEL_TEXT_SCALE = 44.0

# ---------------------------------------------------------------- 菜单 / 出生点场景的固定镜头

# 主菜单：站在方尖碑前看向它
MENU_CAMERA_POSITION = (0.0, 3.0, -13.5)
MENU_CAMERA_ROTATION = (7.0, 0.0, 0.0)
# 出生点选择：俯视四个光环
SPAWN_CAMERA_POSITION = (0.0, 16.5, -19.0)
SPAWN_CAMERA_ROTATION = (33.0, 0.0, 0.0)

SPAWN_POINTS = [
    {"name": "晨曦码头", "position": (-9, 0, 8), "color": (0.45, 0.85, 1.0)},
    {"name": "苔藓回廊", "position": (9, 0, 8), "color": (0.55, 1.0, 0.65)},
    {"name": "星砂露台", "position": (-9, 0, -8), "color": (0.85, 0.6, 1.0)},
    {"name": "熔岩前厅", "position": (9, 0, -8), "color": (1.0, 0.7, 0.4)},
]

# ---------------------------------------------------------------- 每日题库

MIN_QUESTIONS_PER_DAY = 20
MAX_QUESTIONS_PER_DAY = 30
# 日期字符串格式，作为每日随机种子
DATE_SEED_FORMAT = "%Y%m%d"

# ---------------------------------------------------------------- 配色（UI）

UI_BACKGROUND = (0.06, 0.06, 0.09, 0.88)
UI_ACCENT = (0.30, 0.92, 0.85)
UI_ERROR = (1.0, 0.35, 0.35)
UI_SUCCESS = (0.35, 1.0, 0.5)
UI_TEXT = (0.94, 0.95, 1.0)
UI_DIM = (0.62, 0.64, 0.72)
