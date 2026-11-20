"""Aquapark.io 复刻 · 全局配置

所有可调参数集中在这里，方便统一修改。
纯常量模块，不依赖 Ursina，方便在无图形环境下被单元测试导入。
"""

from __future__ import annotations

import math

# ---------------------------------------------------------------- 窗口 / 渲染

APP_TITLE = "Aquapark.io · 水乐园大乱斗"
WINDOW_SIZE = (1280, 720)
WINDOW_BORDERLESS = False
VSYNC = True

# 天空 / 雾
BACKGROUND_COLOR = (0.42, 0.78, 0.94)
FOG_COLOR = (0.62, 0.85, 0.95)
FOG_DENSITY = 0.0045

CAMERA_FOV = 66
CAMERA_FOV_FAST = 84  # 高速时拉大视场，做出速度感
# 镜头相对玩家的后退距离 / 抬高高度 / 注视点的前瞻距离
CAMERA_BACK = 13.5
CAMERA_HEIGHT = 9.5
CAMERA_LOOK_AHEAD = 8.0
CAMERA_SMOOTH = 6.5  # 位置插值速度（越大越硬，越小越飘）

# ---------------------------------------------------------------- 赛道

SEGMENT_LENGTH = 6.0
SEGMENT_COUNT = 124
TRACK_LENGTH = SEGMENT_LENGTH * SEGMENT_COUNT

# 坡度：起点缓，越往下越陡
START_SLOPE_DEG = 8.0
END_SLOPE_DEG = 29.0
SLOPE_WOBBLE_DEG = 3.0

# 赛道宽度
START_WIDTH = 11.5
MIN_WIDTH = 8.0
MAX_WIDTH = 13.0

# 半管（U 型槽）高度；0 表示那一段是开放式滑板，可以直接飞出去
WALL_HEIGHT = 2.7
# 截面中「平坦水面」占整体宽度的比例，剩下的部分向上卷成槽壁
FLAT_FRACTION = 0.62
# 滑槽外壳厚度（从槽口往下挤出的实体厚度）
FLUME_DEPTH = 1.8

# 弯道倾斜：正数 = 右侧抬高（人被推向左边，也就是往弯内侧压）
BANK_GAIN = 3.2
MAX_BANK_DEG = 33.0

# 转弯强度（弧度 / 米）
TURN_SMOOTH_DEG = 3.5  # 平缓弯的单段转角
TURN_SHARP_DEG = 9.0  # 急弯的单段转角
# 出现「急弯段」的概率（每个检查点）
SHARP_TURN_CHANCE = 0.28

# 赛道装饰
DECOR_TREE_CHANCE = 0.34
DECOR_FLAG_CHANCE = 0.16
DECOR_FLOAT_CHANCE = 0.2

# ---------------------------------------------------------------- 玩家 / 选手

RIVAL_COUNT = 5  # AI 对手数量（加上玩家一共 6 个选手）

GRAVITY = 34.0  # 重力加速度（游戏单位 / 秒²）

# 沿赛道方向
TRACK_FRICTION = 0.40  # 线性阻力
TRACK_DRAG = 0.0035  # 二次阻力
PADDLE_ACCEL = 3.2  # 一直往前「扑腾」的推进力，保证不会停住
MAX_SPEED = 31.0
BOOST_SPEED = 42.0
BOOST_TIME = 1.1

# 横向
STEER_ACCEL = 31.0
LATERAL_DAMP = 3.5
# 离心力系数（乘 v² * 曲率）。实测：0.5 时急弯需要认真打方向但不至于失控
CENTRIFUGAL = 0.5
WALL_BOUNCE = 0.30  # 撞到槽壁的横向反弹
WALL_SPEED_LOSS = 0.93  # 撞到槽壁掉速

# 垂直
JUMP_SPEED = 12.5  # 普通起跳的初速度
JET_LAUNCH_SPEED = 20.5  # 踩中水柱喷泉被弹起的高度
DIVE_SPEED = -30.0  # 空中俯冲的速度
AIR_DRAG = 0.06
LAND_SPEED_LOSS = 0.965  # 落地轻微掉速
DIVE_LAND_SPEED_LOSS = 0.995  # 俯冲落地几乎不掉速

# 撞击对手
BUMP_SPEED_LOSS = 0.90  # 平撞双方掉速
KO_SPEED_LOSS = 0.86  # 撞飞别人之后自己也会减速
KO_MIN_RELATIVE_SPEED = 9.0  # 撞飞对手需要的相对速度下限

# 被撞飞 / 出局
KO_RESPAWN_DELAY = 3.4  # 对手被淘汰后多久回到赛道
KO_RESPAWN_BACK = 34.0  # 复活时落后领先者多少米
PLAYER_KO_RESPAWN_DELAY = 1.9  # 玩家被撞飞后的重生时间

# AI 水平
AI_ACCEL_BONUS = 0.0  # AI 沿赛道的额外加速度
AI_SPEED_JITTER = 0.22  # AI 速度随机性
AI_RUBBER_BAND = 0.30  # 橡皮筋强度（落后时追赶，领先时放水）
AI_JUMP_CHANCE = 0.02  # 每帧随机起跳概率

# ---------------------------------------------------------------- 障碍物

# 水柱喷泉：踩上去被弹到空中（这是「翱翔」的主要来源）
JET_INTERVAL = 9  # 每隔多少个赛道节点放一个
JET_RADIUS = 1.5
JET_LAUNCH_HEIGHT = 2.2  # 喷泉中心离滑道面的高度

# 加速带
BOOST_INTERVAL = 14
BOOST_RADIUS = 2.2

# 泡沫障碍：撞上会减速并被弹开
BUMPER_INTERVAL = 11
BUMPER_RADIUS = 1.9

# 金币
COIN_INTERVAL = 4
COIN_RADIUS = 1.0
COIN_HEIGHT = 1.0

# 障碍物与玩家的碰撞半径
PLAYER_RADIUS = 0.95

# ---------------------------------------------------------------- 配色

WATER_COLOR = (0.10, 0.60, 0.88)
WATER_DARK = (0.06, 0.45, 0.68)
SLIDE_COLOR = (0.98, 0.78, 0.16)  # 滑槽内壁的黄色塑料
SLIDE_OUTER = (0.92, 0.45, 0.13)  # 外壳橙色
SLIDE_LIP = (1.0, 0.96, 0.88)  # 槽口白边
SUPPORT_COLOR = (0.86, 0.86, 0.9)

COIN_COLOR = (1.0, 0.85, 0.2)
BOOST_COLOR = (0.35, 1.0, 0.72)
BUMPER_COLOR = (1.0, 0.45, 0.72)
JET_COLOR = (0.55, 0.85, 1.0)

# 选手配色（玩家是第一个）
RACER_COLORS = [
    (0.16, 0.78, 1.0),  # 玩家：泳池蓝
    (1.0, 0.38, 0.42),  # 红
    (0.55, 0.9, 0.3),  # 绿
    (1.0, 0.72, 0.18),  # 橙
    (0.72, 0.45, 1.0),  # 紫
    (0.25, 0.95, 0.85),  # 青
]
RACER_NAMES = ["你", "小柚", "阿浪", "米拉", "大牛", "豆豆"]

# ---------------------------------------------------------------- UI

UI_ACCENT = (0.24, 0.86, 1.0)
UI_WARNING = (1.0, 0.42, 0.42)
UI_GOLD = (1.0, 0.84, 0.28)
UI_TEXT = (1.0, 1.0, 1.0)
UI_DIM = (0.78, 0.86, 0.92)
UI_PANEL = (0.05, 0.16, 0.26, 0.82)

# 比赛中 HUD 用的字号（像素）
HUD_SIZE = 34
HUD_SMALL_SIZE = 24
TITLE_SIZE = 96
