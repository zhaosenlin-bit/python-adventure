"""本地战绩存档 + 排行榜单元测试。

这一层是纯 Python 逻辑，**不需要 Ursina / 显卡**，所以在任何机器上都能跑：

    python -m pytest game3d/tests -q          # 有 pytest 时
    python game3d/tests/test_records.py        # 没装 pytest 时直接跑
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

# 允许直接 `python game3d/tests/test_records.py` 运行
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from game3d.records import (  # noqa: E402
    MAX_RECORDS,
    RECORDS_NAME,
    Record,
    add_record,
    best_of_day,
    load_records,
    make_record,
    rank,
    records_path,
    save_records,
    today_str,
)


# ---------------------------------------------------------------- 基础数据结构


def test_make_record_fills_date_and_accuracy() -> None:
    """make_record 用当天日期，正确率按 百分比 计算。"""
    day = date(2026, 11, 26)
    record = make_record(18, 20, 42.5, eggs=3, day=day)
    assert record.date == "20261126"
    assert record.correct == 18
    assert record.total == 20
    assert record.eggs == 3
    assert abs(record.accuracy - 90.0) < 1e-6
    assert record.played_at > 0


def test_accuracy_of_empty_run_is_zero() -> None:
    """一题都没答时正确率是 0，不能抛除零异常。"""
    assert Record(date="20260101", correct=0, total=0, seconds=1.0).accuracy == 0.0


def test_today_str_matches_question_seed_format() -> None:
    """存档日期格式和题库随机种子保持一致（YYYYMMDD）。"""
    assert today_str(date(2026, 1, 5)) == "20260105"
    assert len(today_str()) == 8


# ---------------------------------------------------------------- 读写往返


def test_save_then_load_round_trip(tmp_path: Path) -> None:
    """写进去再读出来，字段一个都不能少。"""
    path = tmp_path / RECORDS_NAME
    original = make_record(15, 20, 33.333, eggs=2, day=date(2026, 11, 26))
    save_records([original], path)

    loaded = load_records(path)
    assert len(loaded) == 1
    back = loaded[0]
    assert back.date == original.date
    assert back.correct == original.correct
    assert back.total == original.total
    assert back.eggs == original.eggs
    assert abs(back.seconds - original.seconds) < 0.01
    assert abs(back.accuracy - original.accuracy) < 1e-6


def test_missing_file_reads_as_empty(tmp_path: Path) -> None:
    """存档还不存在时读出来是空列表，而不是报错。"""
    assert load_records(tmp_path / "nope.json") == []


def test_broken_file_falls_back_to_empty(tmp_path: Path) -> None:
    """存档损坏（半截 JSON / 不是列表）时退回空列表，不能让游戏崩。"""
    path = tmp_path / RECORDS_NAME
    path.write_text("{ this is not json", encoding="utf-8")
    assert load_records(path) == []

    path.write_text(json.dumps({"records": []}), encoding="utf-8")
    assert load_records(path) == []

    path.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
    assert load_records(path) == []


def test_record_from_dict_fills_missing_fields() -> None:
    """老存档缺字段时用默认值补齐，不要 KeyError。"""
    record = Record.from_dict({"correct": 3, "total": 5})
    assert record.correct == 3
    assert record.total == 5
    assert record.date == ""
    assert record.eggs == 0
    assert record.seconds == 0.0


# ---------------------------------------------------------------- 排行榜规则


def test_rank_sorts_by_accuracy_desc_then_seconds_asc() -> None:
    """正确率高的在前；正确率一样时用时短的在前。"""
    records = [
        Record(date="20261126", correct=10, total=20, seconds=30.0),  # 50%
        Record(date="20261126", correct=20, total=20, seconds=99.0),  # 100%
        Record(date="20261126", correct=15, total=20, seconds=50.0),  # 75%
        Record(date="20261126", correct=20, total=20, seconds=40.0),  # 100% 更快
    ]
    ordered = rank(records)
    assert [r.accuracy for r in ordered] == [100.0, 100.0, 75.0, 50.0]
    assert ordered[0].seconds == 40.0
    assert ordered[1].seconds == 99.0


def test_add_record_saves_and_returns_ranked_list(tmp_path: Path) -> None:
    """add_record 会写盘，并返回排好序的排行榜。"""
    path = tmp_path / RECORDS_NAME
    add_record(make_record(5, 20, 60.0, day=date(2026, 11, 26)), path)
    ranked = add_record(make_record(18, 20, 60.0, day=date(2026, 11, 26)), path)

    assert len(ranked) == 2
    assert ranked[0].accuracy > ranked[1].accuracy
    assert len(load_records(path)) == 2


def test_add_record_truncates_to_max_records(tmp_path: Path) -> None:
    """超过上限时按排名截断，存档不会无限变大。"""
    path = tmp_path / RECORDS_NAME
    for index in range(MAX_RECORDS + 12):
        add_record(
            make_record(index, 100, 100.0 - index, day=date(2026, 11, 26)),
            path,
        )

    stored = load_records(path)
    assert len(stored) == MAX_RECORDS
    # 分数最高的那几条必须被留下
    assert max(record.correct for record in stored) == MAX_RECORDS + 11


def test_best_of_day_picks_best_same_day_run(tmp_path: Path) -> None:
    """今日最佳只比当天的成绩（当天题目一样，可比）。"""
    day = date(2026, 11, 26)
    yesterday = day - timedelta(days=1)
    records = [
        make_record(20, 20, 30.0, day=yesterday),
        make_record(10, 20, 10.0, day=day),
        make_record(17, 20, 60.0, day=day),
    ]
    best = best_of_day(records, day=day)
    assert best is not None
    assert best.correct == 17
    assert best.accuracy == 85.0


def test_best_of_day_returns_none_when_no_run_today() -> None:
    """今天还没玩过 -> 没有今日最佳。"""
    day = date(2026, 11, 26)
    records = [make_record(20, 20, 30.0, day=day - timedelta(days=1))]
    assert best_of_day(records, day=day) is None
    assert best_of_day([], day=day) is None


# ---------------------------------------------------------------- 存档路径


def test_records_path_points_to_json_file() -> None:
    """存档固定是 JSON 文件；开发态落在仓库根目录，打包后落在 exe 同目录。"""
    path = records_path()
    assert path.name == RECORDS_NAME
    assert path.suffix == ".json"
    assert path.parent.exists()


if __name__ == "__main__":  # pragma: no cover - 没装 pytest 时直接跑
    import tempfile

    failures = []
    for name, func in sorted(list(globals().items())):
        if not name.startswith("test_") or not callable(func):
            continue
        try:
            if "tmp_path" in func.__code__.co_varnames[: func.__code__.co_argcount]:
                with tempfile.TemporaryDirectory() as tmp:
                    func(Path(tmp))
            else:
                func()
            print(f"  ok  {name}")
        except Exception as exc:  # noqa: BLE001
            failures.append((name, exc))
            print(f"FAIL  {name}: {exc}")

    print()
    if failures:
        print(f"{len(failures)} 个用例失败")
        raise SystemExit(1)
    print("全部通过")
