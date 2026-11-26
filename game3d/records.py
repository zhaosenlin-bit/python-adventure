"""本地战绩存档 + 排行榜。

桌面版是「纯本地、不联网」的游戏，战绩没法像网页版那样存到服务器，
所以这里用一个很小的 JSON 文件放在玩家看得见的地方：

* 打包成 exe 时：exe 同目录（``typing3d_records.json``），玩家能直接删掉重置；
* 开发时：仓库根目录。

排序规则：**先看正确率，正确率一样再看用时**（用时短的在前）。
每天的题目按日期随机生成，同一天的题才完全可比，所以另外给一个「今日最佳」。

这一层是纯 Python 逻辑，**不需要 Ursina / 显卡**，可以直接跑：

    python -m pytest game3d/tests -q
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from datetime import date as date_cls
from pathlib import Path
from typing import Iterable, List, Optional

# 存档文件名（放在 exe 同目录 / 仓库根目录）
RECORDS_NAME = "typing3d_records.json"

# 存档里最多保留多少条战绩（超出按排名截断，避免文件无限变大）
MAX_RECORDS = 50


def records_path() -> Path:
    """存档文件的完整路径。

    打包成 exe 时放在 exe 同目录（玩家看得见、能删）；开发时放在仓库根目录。
    """
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).resolve().parent
    else:
        base = Path(__file__).resolve().parent.parent
    return base / RECORDS_NAME


def today_str(day: Optional[date_cls] = None) -> str:
    """当天日期串（YYYYMMDD），和题目随机种子用的是同一个日期。"""
    return (day or date_cls.today()).strftime("%Y%m%d")


@dataclass
class Record:
    """一局闯关的战绩。"""

    date: str  # YYYYMMDD
    correct: int
    total: int
    seconds: float
    eggs: int = 0
    played_at: float = 0.0

    @property
    def accuracy(self) -> float:
        """正确率（百分比）。"""
        return (self.correct / self.total * 100.0) if self.total else 0.0

    def to_dict(self) -> dict:
        return {
            "date": self.date,
            "correct": int(self.correct),
            "total": int(self.total),
            "seconds": round(float(self.seconds), 2),
            "eggs": int(self.eggs),
            "played_at": float(self.played_at),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Record":
        """从存档里的字典还原一条战绩（缺字段就补默认值）。"""
        return cls(
            date=str(data.get("date") or ""),
            correct=int(data.get("correct") or 0),
            total=int(data.get("total") or 0),
            seconds=float(data.get("seconds") or 0.0),
            eggs=int(data.get("eggs") or 0),
            played_at=float(data.get("played_at") or 0.0),
        )


def make_record(
    correct: int,
    total: int,
    seconds: float,
    eggs: int = 0,
    day: Optional[date_cls] = None,
) -> Record:
    """造一条当前时间的战绩。"""
    return Record(
        date=today_str(day),
        correct=int(correct),
        total=int(total),
        seconds=float(seconds),
        eggs=int(eggs),
        played_at=time.time(),
    )


def rank(records: Iterable[Record]) -> List[Record]:
    """排行榜：正确率高在前，正确率一样用时短的在前。"""
    return sorted(records, key=lambda record: (-record.accuracy, record.seconds))


def load_records(path: Optional[Path] = None) -> List[Record]:
    """读存档。文件不存在或损坏都当成「还没有战绩」。"""
    target = Path(path) if path is not None else records_path()
    try:
        if target.is_file():
            data = json.loads(target.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [Record.from_dict(item) for item in data if isinstance(item, dict)]
    except Exception:  # pragma: no cover - 存档损坏不该影响游戏
        pass
    return []


def save_records(records: Iterable[Record], path: Optional[Path] = None) -> None:
    """写存档。写失败（比如目录只读）不该影响游戏，所以静默忽略。"""
    target = Path(path) if path is not None else records_path()
    try:
        target.write_text(
            json.dumps([record.to_dict() for record in records], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:  # pragma: no cover - 存档失败不影响游戏
        pass


def add_record(record: Record, path: Optional[Path] = None) -> List[Record]:
    """记下一局，返回排好序的完整排行榜（最多留 MAX_RECORDS 条）。"""
    records = load_records(path)
    records.append(record)
    ranked = rank(records)[:MAX_RECORDS]
    save_records(ranked, path)
    return ranked


def best_of_day(
    records: Iterable[Record],
    day: Optional[date_cls] = None,
) -> Optional[Record]:
    """当天最好的一局。同一天的题目一样，所以可以直接比。"""
    key = today_str(day)
    same_day = [record for record in records if record.date == key]
    if not same_day:
        return None
    return rank(same_day)[0]
