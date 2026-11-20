# 🎮 编程冒险岛 · Code Adventure Island

> 一款面向青少年与儿童的**编程 + 学科 + 打字**综合学习游戏，把 Python、章节闯关、平台跳跃、宠物养成、实时对战、创意工坊、代码研究整合在一个可一键启动的 Next.js + FastAPI 全栈项目里。

| 项目 | 信息 |
| --- | --- |
| 当前版本 | **v2.3.0** (`game-google` · 2026-09-10 typing / world / auth 综合包) |
| 上游 GitHub | https://github.com/zhaosenlin12-creator/python-adventure |
| 部署域名 | `https://game.codebn.cn` |
| 前端端口 | 3003 (PM2 `game`) |
| 后端端口 | 8000 (PM2 `game-backend`) |
| 技术栈 | Next.js 16 · React 19 · TypeScript · Phaser 3 · FastAPI · SQLAlchemy · WebSocket |

---

## ✨ 项目特色

### 🎯 9 大可玩模式

| 模式 | 说明 |
| --- | --- |
| 🗺️ **开放世界** | Phaser 2D 大地图，自由探索猇亭，与 NPC / 站点互动，支持多玩家同屏 |
| 📚 **章节闯关** | 8 大章节、40+ 关卡，从零开始学 Python，含解释器、循环、函数等知识点 |
| ⚔️ **战役模式** | 10 大战役（宜昌猇亭文化主题），平台跳跃 + 重力翻转 + Boss 战 + 风力系统 |
| 🏆 **PvP 大乱斗** | 20 人实时混战，断线 AI 接管、房间生命周期、复活与同步补偿 |
| 🥊 **1v1 PvP** | 实时 1v1 编程对战，心跳 15s、60s 内最多 3 个房间 |
| 🐾 **宠物系统** | 宠物养成、孵化、装饰、小屋交互、宠物聊天（DeepSeek 兜底） |
| ⌨️ **打字训练** | 9 款独立打字游戏，课程进度落库，支持语音 TTS / 速度排行 |
| 🏔️ **3D 打字闯关** | 网页版（three.js，浏览器直接玩）：探索 → 答题 → 开门 → 下一关，每天 24 关，中文可按拼音打；另附 Ursina 桌面版 |
| 🧠 **代码研究** | AI 驱动的代码研究入口，配套战役化引导 |
| 🌊 **水乐园大乱斗** | 复刻 Poki 的《Aquapark.io》：巨型水滑梯竞速、踩水柱腾空、空中俯冲撞飞对手，外加收集 / 抽卡环节；Ursina 桌面版，从站内一键拉起 |

### 🛠️ 创意工坊

- 关卡拖拽编辑器（元素上限 500 / 50 个云端关卡）
- 自定义题库管理（选择 + 填空）
- 🤖 **AI 出题（DeepSeek）**：10 个科目 × 3 个年级分组 × 5 个快捷模板
- 预览 → 编辑 → 选择性导入工作流

### 👶 分龄段学习

- 小学低年级（1–3）/ 小学高年级（4–6）/ 初中（7–9）
- 自适应题库：数学、语文、英语、物理、化学、Python、Scratch、趣味推理、历史、科学常识

### 🔒 安全 / 性能

- JWT Token 黑名单（登出即失效）
- WebSocket / HTTP 接口统一鉴权
- bcrypt 密码哈希（兼容旧密码自动升级）
- XSS 消毒（创意工坊、关卡名）
- 数据库排行榜缓存（60s · 支持 Redis/内存双模式）
- 视口裁剪 + 状态同步 20fps 插值

---

## 🚀 快速开始

### 环境要求

- Node.js **v20+**（生产环境固定 `/www/server/nodejs/v20.19.6/bin`）
- Python **3.10+**（生产环境固定 `/www/server/python_manager/versions/3.10.0/bin/python3.10`）
- npm + PowerShell 5+（Windows 部署用）

### 一键启动（开发机 / Windows）

```powershell
# 完整启动：宠物系统数据修复 + 后端 + 前端
.\start-all.bat
```

启动后访问：

- 游戏首页：http://localhost:3000
- FastAPI 文档：http://localhost:8000/docs（非生产环境，**本地离线版**，断网也能看）
- 健康检查：http://localhost:8000/health

测试账号：`demo` / `123456`（本地新建；`senlin8dog` 是线上库的账号，本地不存在）

> `/docs` 用的是仓库自带的离线文档页（`backend/app/static/api-docs.html`），不加载任何 CDN 资源，
> 所以这台机器完全断网也能正常翻接口。它会读取 `/openapi.json` 自动列出全部接口与参数，
> 点右上角「授权」可以用 `demo` / `123456` 登录，之后每个接口都能直接「发送请求」试跑。
> 也可以直接双击 `backend/app/static/api-docs.html` 用 file:// 打开——页面会自动改连
> `http://localhost:8000`，顶部会出现提示条；后端的 CORS 已放行 `null` 来源，所以这样也能读接口、试接口。
> 需要登录的接口在卡片上会标「需登录」；没授权时点「发送请求」不会真的发请求，
> 而是提示先点「去授权」，避免控制台里出现一条没意义的 401。

### 初始化内容数据

仓库里有 20 多个 `init_*.py` 种子脚本，其中几个会**全量清空**地图对象表，
单独按任意顺序跑的话结果取决于「谁最后跑」，很多地图区域最后是空的。
统一入口：

```powershell
cd backend
.venv\Scripts\python.exe seed_all.py          # 重置内容表并灌入全部种子数据
.venv\Scripts\python.exe seed_all.py --keep   # 保留现有内容，增量补种
.venv\Scripts\python.exe seed_all.py --list   # 列出所有步骤
```

脚本会自己管理清理顺序、把旧区域名归一化到规范区域名，最后打印每个区域的对象数。
**不会碰** users / user_progress / pets / inventory 等用户数据。

### 打包桌面版 exe

打成一个不依赖 Node / Python 的 Windows 程序，双击即玩：

```powershell
python scripts\build_exe.py
```

产物：

- `dist\PythonAdventureIsland\PythonAdventureIsland.exe`（约 258 MB）
- `dist\PythonAdventureIsland-win-x64.zip`（分发用）

技术路线：Next.js 静态导出（`output: export`）+ FastAPI 直接托管前端，
再用 PyInstaller 打成一个目录版 exe（onedir，秒级启动；onefile 要解压
8000 多个资源文件，太慢）。

**运行机制**：

- 数据（数据库、密钥、日志）写在 exe 同级的 `data/`；该目录不可写时自动改用 `%APPDATA%\PythonAdventureIsland\data`。
- 首次启动会释放一份已经灌好内容的数据库，并创建测试账号 `demo` / `123456`（满级，可逛全部地图区域）。
- 端口优先用 8000，被占用时依次换 8001 / 8002 / 8123 / 8765。
- 启动后自动打开浏览器，**关掉那个命令行窗口即退出游戏**。
- `data\config.json` 里可以改 MiniMax / DeepSeek 的 key（打包时会把 `backend\.env` 里的值带过来）。

想重新打包时：

```powershell
python scripts\build_exe.py --skip-frontend   # 前端没改时，只重打后端
python scripts\build_exe.py --skip-seed       # 内容没改时，复用数据库模板
```

### 可选：外部 AI 能力

在 `backend/.env` 里配置，不配的话相关功能自动降级（启动日志会列出来）：

| 环境变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | AI 出题、宠物聊天 |
| `MINIMAX_API_KEY` + `MINIMAX_TTS_ENDPOINT` | 打字训练语音朗读 |

> MiniMax 国内版接口是 `https://api.minimaxi.com/v1/t2a_v2`，国际版是 `https://api.minimax.io/v1/t2a_v2`，
> 两边的 key **不通用**，用错会返回 `invalid api key`。

### 手动启动

**终端 1 · 后端**
```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate
pip install -r requirements.txt
python init_db_quick.py   # 首次运行初始化数据库表
python seed_all.py       # 首次运行灌入地图/任务/题库等内容
python -m uvicorn app.main:app --reload --port 8000
```

**终端 2 · 前端**
```bash
npm install
npm run dev
```

### 🏔️ 3D 打字闯关

在浏览器里直接玩的 3D 打字闯关，玩法参考 Poki 的《The Pillar》：
探索 → 答题 → 开门 → 进入下一关。

* **网页版（推荐）**：Next.js + three.js，浏览器直接玩，成绩存在本地
* **桌面版（附加）**：`game3d/` 里的 Ursina 独立程序，纯本地离线，游戏内可一键启动

#### 网页版

```powershell
npm install
npm run dev
```

启动后把下面这**一整行**复制到浏览器（只复制这一行，别把中文标点也带进去）：

```text
http://localhost:3000/typing-3d
```

| 操作 | 电脑 | 手机 |
| --- | --- | --- |
| 选出生点 | 点地面光环 / `1`~`4` 键 | 点底部列表 |
| 移动 | `W` `A` `S` `D` / 方向键 | 左下角虚拟摇杆 |
| 转视角 | 按住鼠标拖动 | 拖动屏幕 |
| 答题 | 走到发光面板按 `E` | 点「打开打字面板」 |
| 提交 / 取消 | `Enter` / `Esc` | 点按钮 |
| 切换第一 / 第三人称 | `V` | 点「视角」按钮 |
| 疾跑 | `Shift` | — |

* **题库来自站点自己的课程缓存**（3000+ 份离线课程），中文句段自带拼音，
  电脑没装中文输入法也能按拼音打；左上角可随时切换「打拼音 / 打汉字」
* **拼音怎么打都行**：带声调的 `wèi nán cháo`、不带声调的 `wei nan chao`、
  用 `v` 代替 `ü`（`lǜ` 写成 `lv` 也算对）、全大写、多打空格 —— 都能判对
* **手机上软键盘弹起来也不慌**：打字面板跟着 `visualViewport` 自动上移，
  输入框和「提交」按钮不会被键盘挡住
* **成绩会存下来**：成绩写进浏览器的 `lexiang.typing.history`（打字训练中心的游戏卡片
  会显示最好成绩），同时提交到服务端 `mode=3d-typing`（换台设备也看得见）；
  开场卡片会列出排行榜前三（每分钟字符数 + 正确率）
* 每天按系统日期 `YYYYMMDD` 作种子抽 **24 关**，当天固定、跨天自动换新、当天不重复
* 题目分「短 / 中 / 长」三档，逐关变难；关卡房间也越往后柱子越多
* 顶栏常驻显示「第 N / 24 关」、用时、正确率、连击；全部走完后出结算
* 首页顶栏、打字训练中心的游戏列表都能进
* 开局先选出生点：房间四边摆 4 个带名字的地面光环（南墙西段 / 南墙东段 / 西墙南段 / 东墙南段），
  点光环或按 `1`~`4` 键选中，再点「确认出发」才进入第 1 关；出生点不同，走向面板的路线也不同

题库是从课程缓存里现挖的，课程更新后重新生成即可：

```powershell
python scripts\build_typing3d_bank.py   # 生成 public/typing/data/typing3d-bank.json
```

#### 网页版 · 需求 → 代码对照

| 需求 | 网页版对应代码 |
| --- | --- |
| 主界面「3D 打字闯关」按钮 | `app/page.tsx::handleOpen3DTyping()` → `router.push("/typing-3d")` |
| 每天的题目（当天固定、跨天换新） | `lib/typing3d/bank.ts::selectDailyQuestions()`，种子是 `dateKeyFor()` 的 `YYYYMMDD` |
| 3D 房间 / 墙 / 门 / 柱子 / 答题面板 | `lib/typing3d/level.ts::buildLevel()`（纯数据，不碰 three.js） |
| 答题面板（发光材质、带「打字」字样、微微上下浮动） | `components/typing3d/engine.ts::buildPanel()`；面板上的「打字」角标画在 `paintPanelTexture()` 里，上下浮动在 `updateAnimations()` 里改 `panelFloat.position.y` |
| 雾效 + 暖色灯光 + 远处可见的光柱 | `engine.ts::loadLevel()` 里的 `THREE.Fog`；火盆暖光在 `buildBraziers()`，面板上方的光柱在 `buildPanel()` 的 `beacon` |
| 四个出生点（名字 + 地面光环） | `lib/typing3d/level.ts::buildSpawnPlans()`；光环 / 光柱 / 名字牌在 `components/typing3d/engine.ts::showSpawnMarkers()` |
| 选出生点 + 「确认出发」 | `components/typing3d/Typing3DGame.tsx` 里 `phase === "spawn"` 的选择界面 + `confirmSpawn()` |
| WASD 移动 / 碰撞 / 第一与第三人称 | `components/typing3d/engine.ts::updateMovement()`、`updateCamera()`（`V` 键切换视角） |
| 走近面板按 `E`，或直接点面板 | `engine.ts::updateNearPanel()` 与 `pickAt()` → `Typing3DGame.tsx::openTyping()` |
| 打字窗口（大题目 + 输入框 + 回车提交） | `Typing3DGame.tsx` 里 `phase === "typing"`；回车在输入框的 `onKeyDown` 里判断 |
| 手机上软键盘不挡住「提交」按钮 | `Typing3DGame.tsx` 里的 `keyboardInset`（跟 `window.visualViewport` 同步）+ 打字弹层的 `paddingBottom` |
| 打对 → 面板变绿、门缓缓升起 | `engine.ts::solvePanel()`；开门动画在 `updateAnimations()` 里插值 `doorSlab.position.y` |
| 打错 → 标红 + 「再试一次」 | `Typing3DGame.tsx::handleSubmit()` 的 else 分支 |
| 走进打开的门 → 下一关 | `engine.ts::checkDoor()` → `onReachDoor` → 换关 |
| 闯关完成结算页 | `Typing3DGame.tsx::finishRun()`（正确数 / 总用时 / 正确率 / 返回大厅） |
| 一键拉起桌面版 | `backend/app/api/v1/launcher.py` 的 `POST /api/v1/launcher/3d-typing` |

#### 桌面版（Ursina，可选）

```powershell
# 安装依赖（Python 3.10+）
pip install -r game3d\requirements.txt

# 在项目根目录（python-adventure）下启动
python -m game3d.main              # 窗口模式 1280x720
python -m game3d.main --fullscreen # 全屏
```

桌面版不依赖 Next.js 前端和 FastAPI 后端，纯本地运行、不联网。
模型全部用 Cube / Plane 拼，不依赖外部模型和贴图。
完整说明（文件结构、每个功能对应哪段代码、常见问题）见 [`game3d/README.md`](./game3d/README.md)。

### 校验

```bash
# 前端单元测试（Jest）
npm test

# 前端代码风格（ESLint）
npm run lint

# 后端测试（pytest）
python -m pytest backend/tests -q
```

```powershell
# 3D 打字闯关 · 每日题库自检（不需要图形环境）
python game3d\tests\test_questions.py
python -m game3d.questions      # 打印当天的题目清单
```

---

## 📁 项目结构

```text
game-google/
├── app/                         # Next.js 16 App Router
│   ├── page.tsx                # 首页（微工作室入口）
│   ├── campaign/               # 战役模式入口
│   ├── code-research/          # AI 代码研究
│   ├── editor/                 # 创意工坊关卡编辑器
│   ├── world/                  # 开放世界入口
│   └── api/typing/[...path]/   # 打字 SPA 数据/分数代理
│
├── components/                 # React 组件
│   ├── auth/                   # 鉴权弹窗（确定性渲染、无 Math.random）
│   ├── campaign/               # 战役门、Boss、平台视觉
│   ├── chat/                   # 聊天 / 私聊
│   ├── code-research/          # 代码研究抽屉
│   ├── common/                 # 通用 UI（错误回退、加载态）
│   ├── editor/                 # 拖拽编辑器
│   ├── game/                   # 章节、关卡、PvP、大乱斗
│   ├── layout/                 # 顶栏、移动端折叠菜单
│   ├── pet/                    # 宠物小屋、孵化、商店
│   ├── providers/              # 全局 Context
│   ├── ui/                     # 原子 UI
│   ├── world/                  # 开放世界场景 / 实体 / 技能
│   └── typing3d/               # 3D 打字闯关（three.js 引擎 + React 界面）
│
├── public/typing/              # 打字 SPA（独立 HTML/JS/CSS/资源）+ 3D 闯关离线题库
│
├── backend/                    # FastAPI 服务
│   ├── app/api/v1/             # 27 个路由：auth/pvp/pets/typing/...
│   ├── app/core/               # 配置、数据库、缓存
│   ├── app/models/             # SQLAlchemy ORM
│   ├── app/services/           # 业务服务
│   ├── migrations/             # 数据库迁移
│   └── tests/                  # pytest 覆盖
│
├── lib/                        # 战役配置、题库、输入管理、3D 闯关纯逻辑
├── store/                      # Zustand 状态（game/auth/pvp）
├── server/                     # Node 侧 WS / 实时网关
├── scripts/                    # 同步 / 资产刷新 / QA 脚本
├── game3d/                     # 🏔️ 3D 打字闯关（Ursina 桌面版，网页版的附加选项）
├── deploy/                     # 生产部署脚本 + nginx + 文档
├── release/                    # 部署包 + SHA256SUMS + 发布说明
└── __tests__/                  # Jest 单元测试（21 套件 / 100 用例）
```

---

## 🔧 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端框架 | Next.js 16 + React 19 + TypeScript 5 |
| 样式 | Tailwind CSS 4 |
| 游戏引擎 | Phaser 3.90 |
| 3D 引擎 | three.js 0.187（网页版 3D 打字闯关）+ Ursina 7.0 / Panda3D 1.10（桌面版） |
| 状态管理 | Zustand 5 |
| 后端框架 | FastAPI + SQLAlchemy + Pydantic |
| 数据库 | SQLite（生产固定 `/www/data/game-backend/code_adventure.db`） |
| 实时通信 | WebSocket（PvP / 大乱斗 / 开放世界） |
| AI 集成 | DeepSeek Chat Completions（创意工坊出题 + 宠物聊天兜底） |
| 浏览器内 Python | Pyodide 0.29 |
| 部署 | PM2 + Nginx + 自定义 post-upload 脚本 |

---

## 📦 生产部署

详细流程见 [`deploy/DEPLOY_SERVER_EXACT.md`](./deploy/DEPLOY_SERVER_EXACT.md)。

核心流程：**本地打 zip → 上传到服务器 → root 解压 → `su - game` 跑 post-upload 脚本**。**服务器上不做 `git pull`**。

```powershell
# 本地打两个包
powershell -ExecutionPolicy Bypass -File .\deploy\build-backend.ps1
powershell -ExecutionPolicy Bypass -File .\deploy\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-deploy-packages.ps1
```

包哈希写入 `release/SHA256SUMS.txt`。

服务器端（`game.codebn.cn`）：

- 前端代码目录：`/www/wwwroot/game`（PM2 `game`）
- 后端代码目录：`/www/wwwroot/game-backend`（PM2 `game-backend`）
- 数据库：永远在 `/www/data/game-backend/code_adventure.db`，**绝不放在代码目录**
- 6 小时 DB 备份 cron：`0 */6 * * * .../backup-database.sh`

### 关键环境变量

后端（`backend/.env` 或生产 `/www/wwwroot/game-backend/.env`）：

```env
ENVIRONMENT=production
DEBUG=false
SECRET_KEY=<至少 32 位强随机串>
DEEPSEEK_API_KEY=your-api-key
# 可选覆盖：
# DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions
# DEEPSEEK_MODEL=deepseek-chat
```

> `backend/.env.example` 只是模板，不会被程序读取。

前端（`.env.local`）：仅在需要自定义 API 域名时填写。

---

## 📝 更新日志

### 2026-09-10 · typing / world / auth 综合包

- 打字 SPA：新增 `/user/speed-test-rank` 与 `/lesson/speed-test`，重写 8 个 game-res 资源与 `daziya.com/lexq` 字体包
- 鉴权弹窗：确定性渲染（去掉 `Math.random`），平台装饰数组，可恢复错误回退
- 开放世界：微调 `MainScene`、新增 `worldSync` 覆盖（pong + HTTP 轮询兜底）
- 部署：nginx 静态资源 `1y` 缓存 + API / WS 速率限制放宽
- 后端：新增 speed-test 路由、规范化模式持久化

### 2026-08 · 战役 · 大乱斗 · 宠物 稳定版

- 大乱斗 20 人同步 / 断线接管 / 主机回收
- 战役平台视觉升级 + 移动端折叠菜单
- 宠物小屋、孵化、商店一致性打磨

### 2024-12 · v2.3.0 · AI 出题 + 安全加固

- 🤖 **AI 智能出题（DeepSeek）**：10 科目 × 3 年龄段 × 5 模板
- 🔒 **JWT 黑名单 / WS 鉴权 / bcrypt 升级 / XSS 消毒**
- 🎮 **PVP 断线 AI 接管 / 60s 心跳 / 房间生命周期**
- 🎨 **创意工坊编辑器 + 题库管理**
- ⚡ **排行榜缓存 / 视口裁剪 / 20fps 插值**

### 2024-12 · v2.1.x · 新年主题 / 年龄分段 / 移动端

- 移动端虚拟控制器（D-Pad + A/B/E/冲刺）
- 小学 / 初中分段题库
- 新年主题 UI

---

## 🧪 验证状态

最近一次推送前的本地校验（2026-09-17）：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npx jest --silent` | ✅ 15 suites / 64 tests passed |
| ESLint | `npx eslint . --max-warnings 0` | ✅ exit 0 |
| 部署包校验 | `scripts/verify-deploy-packages.ps1` | ✅ PASS（`game-deploy.zip` / `backend-deploy.zip`） |
| 部署包 SHA256 | `release/SHA256SUMS.txt` | ✅ 已生成 |

---

## 📄 License

MIT License

---

<p align="center">Made with ❤️ for young coders · v2.3.0 · 2026-09-10</p>

#### 网页版 · 验收脚本

两个脚本都要先起开发服务器（`.\start-dev.ps1` 或 `npm run dev`）：

```powershell
node scripts\qa-typing3d.mjs          # 主验收：画面、面板、答题、开门、换关、窄视口
node scripts\qa-typing3d-fullrun.mjs  # 整轮通关：24 关从头打到尾，再查成绩与排行榜
```

`qa-typing3d-fullrun.mjs` 会逐关检查「穿门后正好进到下一关」，
专门盯一次性穿门跳两关这种回归。
