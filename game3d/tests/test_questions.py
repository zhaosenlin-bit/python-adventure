"""每日题库单元测试。

这一层是纯 Python 逻辑，**不需要 Ursina / 显卡**，所以在任何机器上都能跑：

    python -m pytest game3d/tests -q          # 有 pytest 时
    python game3d/tests/test_questions.py     # 没装 pytest 时直接跑
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta

# 允许直接 `python game3d/tests/test_questions.py` 运行
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from game3d.questions import (  # noqa: E402
    HARD_PHRASES,
    HARD_WORDS,
    MEDIUM_PHRASES,
    MEDIUM_WORDS,
    TIER_EASY,
    TIER_HARD,
    TIER_MEDIUM,
    bank_size,
    daily_questions,
    daily_seed,
    today,
)


def test_bank_has_at_least_200_entries() -> None:
    """内置题库不少于 200 个英文单词 / 短语。"""
    assert bank_size() >= 200, f"题库只有 {bank_size()} 条"


def test_three_tiers_are_populated() -> None:
    """简单 / 中等 / 困难三档都要有足够的题。"""
    assert len(MEDIUM_WORDS) + len(MEDIUM_PHRASES) >= 50
    assert len(HARD_WORDS) + len(HARD_PHRASES) >= 50
    assert len(MEDIUM_WORDS) + len(MEDIUM_PHRASES) + len(HARD_WORDS) + len(HARD_PHRASES) >= 100


def test_daily_question_count_in_range() -> None:
    """每天 20~30 题。"""
    day = date(2026, 1, 1)
    for offset in range(30):
        questions = daily_questions(day + timedelta(days=offset))
        assert 20 <= len(questions) <= 30, f"{day + timedelta(days=offset)} 有 {len(questions)} 题"


def test_questions_do_not_repeat_within_a_day() -> None:
    """当天题目不重复。"""
    day = date(2026, 3, 15)
    questions = daily_questions(day)
    texts = [q.text for q in questions]
    assert len(texts) == len(set(texts))


def test_same_day_is_stable() -> None:
    """同一天多次调用结果完全一致（当天固定）。"""
    day = date(2026, 5, 20)
    first = [q.text for q in daily_questions(day)]
    second = [q.text for q in daily_questions(day)]
    assert first == second


def test_new_day_gives_new_questions() -> None:
    """跨天自动换新。"""
    day = date(2026, 7, 1)
    first = [q.text for q in daily_questions(day)]
    second = [q.text for q in daily_questions(day + timedelta(days=1))]
    assert first != second


def test_seed_is_yyyymmdd() -> None:
    """随机种子就是系统日期 YYYYMMDD。"""
    day = date(2026, 11, 7)
    assert daily_seed(day) == 20261107
    assert daily_seed() == int(today().strftime("%Y%m%d"))


def test_all_three_tiers_appear_every_day() -> None:
    """每天的题目里三档难度都要出现，并且由易到难排列。"""
    questions = daily_questions(date(2026, 9, 9))
    tiers = [q.tier for q in questions]
    assert TIER_EASY in tiers
    assert TIER_MEDIUM in tiers
    assert TIER_HARD in tiers
    # 难度顺序：简单 -> 中等 -> 困难
    order = {TIER_EASY: 0, TIER_MEDIUM: 1, TIER_HARD: 2}
    ranks = [order[t] for t in tiers]
    assert ranks == sorted(ranks)


def test_answers_are_not_empty() -> None:
    """每道题都有可比较的答案。"""
    for q in daily_questions(date(2026, 2, 2)):
        assert q.answer.strip()
        assert q.text == q.text.strip()


if __name__ == "__main__":  # 手动运行
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    # Windows 控制台默认 GBK，中文会变乱码 —— 强制切 UTF-8
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover - 老 Python 没有 reconfigure
        pass
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS  {test.__name__}")
        except AssertionError as error:
            failed += 1
            print(f"FAIL  {test.__name__}: {error}")
    print(f"\n{len(tests) - failed}/{len(tests)} 通过")
    raise SystemExit(1 if failed else 0)
