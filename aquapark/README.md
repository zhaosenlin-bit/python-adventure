# Aquapark.io 复刻 · 水乐园大乱斗

在「编程冒险岛」项目里新增的一个**纯本地桌面版**竞速小游戏，玩法参考 Poki 上的
《Aquapark.io》（Voodoo 制作）：

> 谁先滑下水滑梯谁就是冠军！游泳加速、踩水柱腾空，空中俯冲把对手**撞出水面**淘汰。

* 引擎：Python + [Ursina](https://www.ursinaengine.org/)（底层是 Panda3D / OpenGL）
* 完全离线运行，**不联网、不依赖后端、不依赖外部模型或贴图**
  （滑梯、角色、水柱喷泉、贴图全部是运行时程序化生成的）
* 与同仓库的 Next.js + FastAPI 主工程**完全解耦**：本目录是纯追加的新包，
  原有代码一行未改

---

## 1. 安装

需要 Python 3.10+。

```powershell
# 在项目根目录（python-adventure/）执行
pip install -r aquapark/requirements.txt
```

等价于直接装：

```powershell
pip install ursina==7.0.0 numpy pillow
```

> `ursina` 会自动带上 `panda3d`（Windows / macOS / Linux 都有对应 wheel），不需要单独装。
> 如果 pip 下载慢，可以加国内镜像：`pip install -r aquapark/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`

---

## 2. 运行

```powershell
cd python-adventure

python -m aquapark.main              # 窗口模式 1280x720
python -m aquapark.main --fullscreen # 全屏
```

也可以直接跑脚本（会自动把包根目录加进 `sys.path`）：

```powershell
python aquapark/main.py
```

### 接入编程冒险岛

这个游戏是**站内功能**，不是外挂 exe：

| 位置 | 说明 |
| --- | --- |
| `app/aquapark/page.tsx` | 页面路由 `/aquapark` |
| `components/game/AquaparkGame.tsx` | 玩法介绍 + 截图 + 「启动游戏窗口」按钮 |
| 首页顶栏 | 「水乐园大乱斗」快捷入口 |
| `backend/app/api/v1/launcher.py` | 后端启动器，拉起 `python -m aquapark.main` |

点「启动游戏窗口」时前端 `POST /api/v1/launcher/aquapark`，后端 spawn 出游戏窗口。
启动器只在**本地环境**可用（线上服务器既没有显示器，也不该被任意网页拉起本地进程），
所以 `ENVIRONMENT == "production"` 时一律 403；页面拿不到启动器接口时会直接
说明原因，而不是给一个点了没反应的死按钮。

跑之前先在本机装好依赖：

```powershell
pip install -r aquapark/requirements.txt
```

## 3. 玩法与操作

| 操作 | 按键 |
| --- | --- |
| 转向 | `A` / `D`、`←` / `→`、鼠标左右移动、手柄左摇杆 |
| 起跳（腾空） | `空格`、`W`、`↑`、鼠标左键、手柄 A |
| 俯冲（砸人） | `S`、`↓`、手柄 B |
| 返回主菜单 | `Esc` |

规则：

* **自动加速**——滑道越陡滑得越快，不用一直按着方向键；
* **水柱喷泉**踩上去会被弹到空中，是「翱翔」的主要来源；
* **加速带**踩上去会猛冲一段；
* **空中俯冲砸中对手**会把对方**撞出水面**淘汰（对方几秒后回到赛道，落后一大截）；
* **金币**沿路撒了一路，捡到算分；
* 冲过终点线结算：**名次 / 用时 / 金币 / 撞飞人数**。

### 收集环节

除了比赛，游戏还有一层「收集 / 抽卡」的环节（主菜单和结算页都能进）：

* 顶部是三种货币：**金币 / 钻石 / 票**；
* 中间是收藏品卡片（遮阳伞、粉珊瑚、金币堆、海星、章鱼、魔术师），
  分普通 / 稀有 / 史诗三档，点一下就**装备**到选手头顶；
* 底部是**稀有礼包**，40 钻石开一次，按 72% / 28% 的概率开出稀有 / 史诗收藏品；
* 比赛结算会自动结算：金币进账、每局 +1 张票、前三名 +1 钻石、
  每撞飞一个人 +1 钻石；
* 进度存在 ``aquapark_save.json``（写在游戏目录里），跨局、跨次启动保留。

---

## 4. 文件结构

```text
aquapark/
├── __init__.py        # 包说明
├── config.py          # 所有可调参数（物理 / 赛道 / 配色 / UI）
├── fonts.py           # 中文字体解析（找不到中文字体自动切英文文案）
├── track.py           # 赛道生成 + 截面几何 + 网格构建（纯逻辑，可单测）
├── physics.py         # 赛道空间物理：加速 / 转向 / 离心力 / 起跳 / 俯冲
├── racer.py           # 选手：玩家和 AI 共用的状态 + 外观 + AI 走线
├── effects.py         # 水花、飞溅、涟漪（固定容量粒子池）
├── models.py          # 程序化模型：角色 / 喷泉 / 加速带 / 棕榈树 / 拱门
├── textures.py        # 程序化贴图：水面流纹、格纹横幅
├── collection.py     # 收集品定义 + 程序化图标（遮阳伞 / 章鱼 / 魔术师…）
├── save.py           # 存档：金币 / 钻石 / 票 / 收藏品 / 当前装备
├── ui.py              # 主菜单 / HUD / 倒计时 / 结算页 / 收集页 / 提示条
├── game.py            # 主状态机：菜单 → 倒计时 → 比赛 → 结算 → 收集
├── main.py            # 启动入口
├── requirements.txt
└── tests/
    ├── test_track.py  # 赛道生成、槽面数学、网格数据
    └── test_physics.py# 加速 / 转向 / 撞墙 / 起跳 / 俯冲 / 冲线
```

---

## 5. 几个关键设计

### 5.1 赛道空间：把复杂度压进三个属性

选手不直接在世界空间里做刚体物理，而是活在 **(s, lateral, height)** 这组坐标里：

* `s` —— 沿滑道中线的弧长
* `lateral` —— 偏离中线的横向距离（正数偏右）
* `height` —— 离滑道面的高度

世界的复杂度被压缩进赛道的三个属性里，于是每一条受力都变成一行公式：

| 现象 | 来源 |
| --- | --- |
| 越陡滑得越快 | `forward` 的竖直分量 |
| 转弯把人甩向外侧 | `curvature_right`（离心力 ∝ v²） |
| 弯道倾斜把人压向弯内侧 | `bank`（横向重力） |
| 槽壁把人推回水槽中间 | 槽面斜率（重力沿槽面的切向分量） |

槽面是一个**四分之一圆弧碗**，解析式 `y = wall_h * (1 - √(1 - q²))`。
好处是表面高度和表面斜率都有闭式解，角色贴壁时的视觉位置和受力完全一致。

### 5.2 Panda3D 是左手坐标系（踩过的坑）

两处必须注意，否则画面会「一片死灰」或者「水面凭空消失」：

1. **没有法线的几何体点不着灯**——程序化网格必须自己算法线；
2. **正反面判定和右手定则相反**——右手定则算出来指向观察者的面反而是背面，
   会被剔除。所以法线统一取反，让它始终指向「能看见的那一面」。

滑槽最终做成**一根闭合管子**（外壳 + 槽壁 + 水面 = 一个网格、一次绘制），
既没有接缝，也不用处理两个网格之间的 z-fighting。

### 5.3 水在流动

水面的流纹是运行时用 numpy 生成的灰度贴图，沿滑道方向铺开，
每帧滚动贴图的 v 偏移 → 水就在往下流。贴图对比度压得很低，
所以槽壁上只会看到一层若有若无的反光，不会跟着一起花。

---

## 6. 测试

赛道与物理是纯逻辑（只需要 `panda3d.core` 的 `Vec3`），不需要开窗口：

```powershell
python -m unittest discover -s aquapark/tests -t .
# 或者
python -m pytest aquapark/tests -q
```

---

## 7. 常见问题

**Q：窗口打开了但一片死灰 / 水面不见了？**
A：多半是网格缺法线或者绕序反了。`track.py::compute_normals` 里关于
Panda3D 左手坐标系的注释就是为这个准备的。

**Q：启动时报 `No module named ursina`？**
A：先执行 `pip install -r aquapark/requirements.txt`。

**Q：窗口一闪就没了 / 驱动报错？**
A：Ursina 需要 OpenGL 3.3+。可以先跑 `python -m unittest discover -s aquapark/tests -t .`
验证 Python 侧没问题，再检查显卡驱动。

**Q：中文显示成方块？**
A：`fonts.py` 会自动在 `C:\Windows\Fonts`（macOS / Linux 对应目录）里找微软雅黑、
黑体、苹方、Noto CJK 等字体。装好任一中文字体就能正常显示；找不到时游戏会自动
切成英文文案，不会崩。

---

## 8. 打包成独立 exe

主程序 `PythonAdventureIsland.exe` 里**没有** ursina / panda3d，所以桌面版要单独打一个 exe。
打完之后两个程序互不依赖：谁都不用装 Python。

```powershell
cd python-adventure

pip install -r aquapark/requirements.txt   # ursina + numpy + pillow
pip install pyinstaller

python scripts/build_aquapark_exe.py
```

产物：

| 路径 | 说明 |
| --- | --- |
| `dist/AquaparkIO/AquaparkIO.exe` | 桌面版主程序（onedir，旁边是 `_internal/`） |
| `dist/AquaparkIO-win-x64.zip` | 整包压缩，给别人直接解压就能玩 |
| `dist/PythonAdventureIsland/AquaparkIO/` | 如果主程序已经打过，会自动拷进去一起发 |

启动器（`backend/app/api/v1/launcher.py`）会**优先直接跑那个 exe** —— 别人拿到就能玩，
不用装 Python、更不用装 ursina。找不到 exe 时才回退到 `python -m aquapark.main`。
