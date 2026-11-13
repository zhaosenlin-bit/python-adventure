# 3D 打字闯关（Ursina 桌面版）

> **网页版已经上线**：浏览器直接玩（Next.js + three.js）。启动开发服务器后复制这一行：
>
> ```text
> http://localhost:3000/typing-3d
> ```
> 本目录是**桌面版附加选项**，适合喜欢大屏 + 纯离线的人，两版玩法一致。

「编程冒险岛」里的**纯本地桌面版 3D 打字闯关**模式，玩法参考 Poki 的《The Pillar》：

```
探索 → 答题 → 开门 → 进入下一关
```

* 引擎：Python + [Ursina](https://www.ursinaengine.org/)（底层是 Panda3D / OpenGL）
* 完全离线运行，**不联网、不依赖后端、不依赖外部模型或贴图**（所有场景都用 Cube / Plane 拼）
* 与原有 Next.js + FastAPI 主工程**完全解耦**：本目录是纯追加的新包，原有代码一行未改

---

## 1. 安装

需要 Python 3.10+（推荐 3.10 / 3.11）。

```powershell
# 在项目根目录（python-adventure/）执行
pip install -r game3d/requirements.txt
```

等价于直接装：

```powershell
pip install ursina==7.0.0
```

> `ursina` 会自动带上 `panda3d`（Windows / macOS / Linux 都有对应 wheel），不需要单独装。
> 如果 pip 下载慢，可以加国内镜像：`pip install -r game3d/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`

## 2. 运行

```powershell
cd python-adventure

python -m game3d.main                # 窗口模式 1280x720
python -m game3d.main --fullscreen   # 全屏
```

也可以直接跑脚本（会自动把包根目录加进 `sys.path`）：

```powershell
python game3d/main.py
```

启动后进入**大厅（主菜单）**，点击「**3D 打字闯关**」即可开始。

### 从网站主界面启动

网页版的暂停界面里有个「**打开本地桌面版（Ursina）**」按钮，走后端的本地启动器接口，
把桌面窗口直接拉起来：

| 接口 | 作用 |
| --- | --- |
| `GET /api/v1/launcher/3d-typing` | 能不能启动 / 有没有已经在跑 |
| `POST /api/v1/launcher/3d-typing` | 启动游戏窗口（已经在跑就直接返回 pid） |

接口实现在 `backend/app/api/v1/launcher.py`，前端按钮在 `components/typing3d/Typing3DGame.tsx`。
出于安全考虑，接口只在**非生产环境**开放（`ENVIRONMENT=production` 时返回 403）——
线上服务器没有显示器，也不该被任意网页拉起本地进程。

启动器会自动挑一个装了 ursina 的 Python：先看环境变量 `GAME3D_PYTHON`，
再用后端自己的解释器，最后退回 PATH 上的 `python`。

### 自检（不打开窗口）

```powershell
python -m game3d.questions     # 打印当天的题量、难度分布、题目样例
```

---

## 3. 玩法与操作

| 阶段 | 操作 |
| --- | --- |
| 大厅 | 点击「3D 打字闯关」按钮 |
| 选择出生点 | 点击地面上的发光光环，或按 `1` ~ `4`，再点「确认出发」 |
| 探索 | `W` / `A` / `S` / `D` 移动，鼠标转视角，`V` 切换第一 / 第三人称，`Esc` 回大厅 |
| 答题 | 走到发光的「打字」面板前会自动弹出打字窗口（也可以按 `E` 或直接点击面板） |
| 打字 | 直接敲键盘输入，**回车提交**，`退格` 删除，`Esc` 关闭窗口 |
| 判定 | 答对 → 面板变绿 + 门缓缓打开；答错 → 输入框标红并提示「再试一次」 |
| 下一关 | 走进打开的门即切换到下一关（关卡越来越复杂，玩法一致） |
| 结算 | 打完当天最后一道题弹出「闯关完成」：正确数 / 总用时 / 正确率，「返回大厅」 |

### 每日题库

* 每天 **20 ~ 30 道**题，用系统日期 `YYYYMMDD` 作为随机种子 —— **当天固定，跨天自动换新**
* 内置 **210 个**英文单词 / 短句，分「简单 / 中等 / 困难」三档，当天题目**不重复**
* 难度按关卡顺序由易到难
* 顶部 HUD 常驻显示「第 N / M 题」

---

## 4. 文件结构

```text
game3d/
├── __init__.py            # 包说明（刻意不 import Ursina，方便纯逻辑单测）
├── main.py                # 启动入口：建窗口 → 初始化字体 → 创建 Game → app.run()
├── config.py              # 所有可调参数（窗口/镜头/玩家/关卡/灯光/配色/题库规则）
├── fonts.py               # 中文字体解析：找系统字体 → 注册进 Panda3D model-path → 验证可加载
├── lighting.py            # 点光源 / 环境光封装（Ursina 的 Light 没有 brightness，必须自己乘进颜色）
├── player.py              # 第一/第三人称控制器：WASD + 鼠标视角 + 重力 + 射线碰撞
├── level.py               # 关卡生成：房间 / 柱子 / 面板 / 门 / 走廊，随关卡数变复杂
├── game.py                # 主状态机：大厅 → 出生点 → 关卡 → 打字 → 结算
├── ui.py                  # 全部 2D 界面：大厅、HUD、打字窗口、出生点、结算页
├── questions.py           # 每日题库（纯 Python，不依赖 Ursina）
├── requirements.txt       # ursina==7.0.0
├── tests/
│   └── test_questions.py  # 题库单元测试（纯逻辑，不需要显卡）
└── README.md              # 本文件
```

---

## 5. 功能 → 代码对照表

| 需求 | 对应代码 |
| --- | --- |
| 主界面按钮「3D 打字闯关」 | `ui.py::_build_menu()` 里的 `menu_button`；点击回调在 `game.py::Game.__init__` 绑定到 `_start_run()` |
| 进入后先出现出生点选择界面 | `game.py::_goto_spawn()` → `_build_spawn_scene()`；界面在 `ui.py::_build_spawn_panel()` |
| 3~4 个出生点（带名称 + 地面光环） | `config.py::SPAWN_POINTS`（4 个点，含名称和颜色）；光环 / 光柱 / 名字在 `game.py::_build_spawn_scene()` 里生成 |
| 选中出生点 + 「确认出发」 | `game.py::_select_spawn()` / `_confirm_spawn()`；按钮 `ui.py::spawn_confirm` |
| 每关都是 3D 房间（墙 / 地 / 门） | `level.py::Level._build_room()`，全部由 `Entity(model="cube"/"plane")` 拼出 |
| 关卡逐渐变复杂 | `level.py::Level.__init__()` 里的 `room_width / room_depth / pillar_count / has_inner_wall / has_alcove` 随关卡序号增长；`_build_obstacles()` 落地 |
| 显眼的面板（发光 + 「打字」字样 + 上下浮动） | `level.py::_build_panel()`：发光面板 + 光晕 + `Text("打字")`；浮动动画在 `Level.update()` 里改 `panel_root.y` |
| 远处就能看见面板 | 面板 `unlit=True` + `lighting.point_light()`（`level.py::_build_panel()` 末尾的青色补光） |
| WASD 走近面板 | `player.py::PlayerController.update()`；触发距离 `config.PANEL_TRIGGER_DISTANCE` |
| 靠近自动弹窗 / 点击面板弹窗 | `game.py::_update_playing()` 自动触发；`game.py::_on_panel_click()` 处理点击（`level.py::_build_panel()` 里给面板绑 `on_click`） |
| 打字窗口（大字号题目 + 输入框 + 回车提交） | `ui.py::_build_typing_window()` / `show_typing()`；回车在 `game.py::Game.input()` 里判 `key == "enter"` → `_submit()` |
| 打对 → 面板变绿 | `game.py::_submit()` → `level.py::Level.solve_panel()`（换成 `PANEL_SOLVED_COLOR`） |
| 打对 → 门发光并缓缓打开 | `game.py::_submit()` → `level.py::Level.open_door()`；动画在 `Level.update()` 里把门轴 `rotation_y` 从 0 平滑转到 −95°（1.8 秒），同时用 `lighting.set_light_color()` 点亮门灯 |
| 打错 → 输入框标红 + 「再试一次」 | `game.py::_submit()` 的 else 分支 → `ui.py::show_typing(..., wrong=True)` |
| 走进打开的门 → 下一关 | `game.py::_update_playing()` 判断 `level.distance_to_exit(...)`，触发 `_next_level()` → `_build_level()` |
| 闯关完成结算页 | `game.py::_goto_result()` → `ui.py::show_result()`（正确数 / 总用时 / 正确率）+「返回大厅」按钮 |
| 第一 / 第三人称镜头 | `player.py` 维护 `yaw / pitch`；`game.py::_update_camera()` 每帧摆位；`V` 键在 `_toggle_camera()` 里切换 |
| 雾效 + 暖色灯光 | `game.py::_apply_fog()`（`scene.fog_density` + 背景色跟着雾色）+ `level.py::_build_environment()` 的暖色主光 / 面板暖光 |
| 门打开是动画不是消失 | 门是真实实体，只旋转门轴 `Level.door_hinge.rotation_y`，全程可见 |
| 每日 20~30 题、跨天换新 | `questions.py::daily_questions()`：种子 = `daily_seed()`（`YYYYMMDD`） |
| 内置 ≥200 个词、三档难度 | `questions.py::EASY_WORDS / MEDIUM_WORDS / MEDIUM_PHRASES / HARD_WORDS / HARD_PHRASES`（共 210 条），分档在 `TIER_POOLS` |
| 当天不重复 | `questions.py::daily_questions()` 里的 `used: set` 去重 |
| 顶部「第 N / M 题」 | `ui.py::update_hud()` → `ui.hud_progress` |
| 网站主界面的「3D 打字闯关」按钮 | `app/page.tsx::handleOpen3DTyping()` → `backend/app/api/v1/launcher.py` 的 `POST /api/v1/launcher/3d-typing`（用 `subprocess.Popen` 拉起 `python -m game3d.main`） |
| 中文能正常显示 | `fonts.py::setup_fonts()` 找系统中文字体并注册进 Panda3D `model-path`，找不到就自动切英文文案（`fonts.py::T()`） |

---

## 6. 常见问题

**Q：窗口打开了但中文是方块 / 空白？**
A：`fonts.py` 会自动在 `C:\Windows\Fonts`（macOS / Linux 对应目录）里找微软雅黑、黑体、
苹方、Noto CJK 等字体。只要系统装了任一中文字体就能正常显示；找不到时游戏会自动切成英文
文案，不会崩。

**Q：启动时报 `No module named ursina`？**
A：先执行 `pip install -r game3d/requirements.txt`。

**Q：窗口一闪就没了 / 驱动报错？**
A：Ursina 需要 OpenGL 3.3+。可以先跑 `python -m game3d.questions` 验证 Python 侧没问题，
再检查显卡驱动；虚拟机里可以尝试 `set WINGET_USE_DIRECTX` 之类的兼容方案。

**Q：一天只能玩一套题？**
A：题目由日期种子决定，当天固定是设计如此（可重复练习）；第二天自动换新。

---

## 7. 测试

题库逻辑是纯 Python，不需要显卡，可以直接跑：

```powershell
python -m pytest game3d/tests -q
```

（需要 `pip install pytest`；没有 pytest 时也可以直接 `python game3d/tests/test_questions.py` 运行。）
