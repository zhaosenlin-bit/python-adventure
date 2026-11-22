# 贡献者

本项目由多方联合开发，本分支（`feat/tomb-vote-sunmingze`）内的古墓剧本杀改动由 **孙铭泽** 完成。

## 孙铭泽

- `components/tomb/` · `lib/tomb/` 古墓剧本杀模块：3D 场景与 NPC 行为、线索机关、推理板、石门表决。
- 线索机关：三档 Python 关卡、破解回赠 12 秒、`蛮力撬开` 扣 25 秒且不能当证据、连错两次自动展开提示。
- 石门表决：确定性投票模型（`lib/tomb/vote.ts`）、票重随呈堂线索真假浮动、伪人抱团甩票、平票由玩家票裁定，新增 6 个表决结局。
- 规则可见性：开局界面只留世界观与键位，身份分布、说谎比例、回赠/撬开秒数等作为隐藏设定，由玩家自行摸索。
- 首页顶栏：入口按剩余宽度自适应，放不下的自动收进「更多」下拉，新增入口无需再调断点样式。
- 验证脚本：`scripts/tomb-vote-check.cjs`、`scripts/tomb-endings-check.cjs`、`scripts/home-nav-overflow-check.cjs`。

## 合作仓库

- 上游：<https://github.com/zhaosenlin-bit/python-adventure.git>
