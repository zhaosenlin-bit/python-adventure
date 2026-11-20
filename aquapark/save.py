"""存档：金币 / 钻石 / 票 / 收藏品 / 当前装备。

游戏本体是「一局一局」打的，但收集品和货币要跨局、跨次启动保留，
所以这里用一个很小的 JSON 文件存起来。

存放位置
--------
* 打包成 exe 时：exe 同目录（用户能直接看到 / 删掉重置）；
* 开发时：仓库根目录。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, Optional

SAVE_NAME = "aquapark_save.json"


def save_path() -> Path:
    """存档文件的完整路径。"""
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).resolve().parent
    else:
        base = Path(__file__).resolve().parent.parent
    return base / SAVE_NAME


class Profile:
    """玩家档案：货币 + 收藏品 + 装备。"""

    def __init__(self, data: Optional[Dict] = None) -> None:
        data = data or {}
        self.coins: int = int(data.get("coins", 0))
        self.gems: int = int(data.get("gems", 0))
        self.tickets: int = int(data.get("tickets", 0))
        self.packs_opened: int = int(data.get("packs_opened", 0))
        self.items: Dict[str, int] = {
            str(k): int(v) for k, v in (data.get("items") or {}).items()
        }
        self.equipped: Optional[str] = data.get("equipped") or None

    # ---------------------------------------------------------------- 读写

    def to_dict(self) -> Dict:
        return {
            "coins": self.coins,
            "gems": self.gems,
            "tickets": self.tickets,
            "packs_opened": self.packs_opened,
            "items": self.items,
            "equipped": self.equipped,
        }

    def save(self) -> None:
        """写盘。失败（例如目录只读）不该影响游戏，所以静默忽略。"""
        try:
            path = save_path()
            path.write_text(
                json.dumps(self.to_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:  # pragma: no cover - 存档失败不影响游戏
            pass

    @classmethod
    def load(cls) -> "Profile":
        """读盘。文件不存在或损坏都退回「全新档案」。"""
        try:
            path = save_path()
            if path.is_file():
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return cls(data)
        except Exception:  # pragma: no cover - 存档损坏不影响游戏
            pass
        return cls()

    # ---------------------------------------------------------------- 收藏

    def count(self, item_id: str) -> int:
        return int(self.items.get(item_id, 0))

    def add(self, item_id: str, amount: int = 1) -> None:
        self.items[item_id] = self.count(item_id) + amount

    def equip(self, item_id: Optional[str]) -> None:
        """装备某个收藏品（传 None 表示不装备）。"""
        self.equipped = item_id if item_id and self.count(item_id) > 0 else None
        self.save()


# 模块级单例：整个游戏共用一份档案
PROFILE = Profile.load()
