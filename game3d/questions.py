"""每日题库。

规则：
- 每天 20~30 题，用系统日期 ``YYYYMMDD`` 当随机种子，当天固定、跨天自动换新；
- 内置 210 个英文单词 / 短语，分「简单 / 中等 / 困难」三档；
- 当天题目不重复，且难度按关卡顺序由易到难排布。

本模块不依赖 Ursina，可以单独跑单元测试。
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date as date_cls
from datetime import datetime

from .config import DATE_SEED_FORMAT, MAX_QUESTIONS_PER_DAY, MIN_QUESTIONS_PER_DAY

# --------------------------------------------------------------------- 题库

# 简单：3~9 个字母的常见词（70 条）
EASY_WORDS = [
    "apple", "banana", "book", "candle", "cat", "dog", "egg", "fish", "girl", "boy",
    "house", "hand", "ice", "jump", "kite", "king", "leaf", "lion", "mouse", "nest",
    "orange", "pen", "queen", "rabbit", "sun", "tree", "umbrella", "violin", "window",
    "xylophone", "yellow", "zebra", "ant", "bee", "cake", "cloud", "door", "engine",
    "flower", "glass", "hat", "island", "jelly", "kettle", "ladder", "mask", "piano",
    "puzzle", "robot", "snake", "tiger", "volcano", "whale", "wolf", "arrow", "balloon",
    "castle", "dragon", "feather", "guitar", "hammer", "jungle", "lantern", "magnet",
    "orbit", "rocket", "shield", "tornado", "planet", "shadow",
]

# 中等：7~13 个字母的单词（52 条）
MEDIUM_WORDS = [
    "python", "variable", "function", "loop", "string", "number", "boolean", "monster",
    "treasure", "dungeon", "wizard", "knight", "phoenix", "galaxy", "crystal", "forest",
    "desert", "avalanche", "horizon", "compass", "anchor", "mosaic", "enigma",
    "labyrinth", "sanctuary", "orchestra", "symphony", "melody", "rhythm", "whisper",
    "mirror", "portrait", "journey", "expedition", "sunrise", "twilight", "midnight",
    "meteor", "nebula", "eclipse", "satellite", "telescope", "constellation",
    "blueprint", "algorithm", "recursive", "binary", "sequence", "parallel", "quantum",
    "molecule", "electron",
]

# 中等：常见短语（18 条）
MEDIUM_PHRASES = [
    "good morning", "thank you", "see you later", "open the door", "read the map",
    "find the key", "follow the path", "search for treasure", "light the torch",
    "cross the bridge", "solve the puzzle", "meet the guide", "break the code",
    "unlock the gate", "climb the tower", "hide in the shadows", "guard the castle",
    "learn to program",
]

# 困难：长词（45 条）
HARD_WORDS = [
    "programming", "cryptography", "neuroscience", "architecture", "encyclopedia",
    "hypotenuse", "photosynthesis", "microprocessor", "temperature", "electricity",
    "gravitational", "atmosphere", "laboratory", "imagination", "adventure", "discipline",
    "conference", "exhibition", "experience", "instrument", "knowledge", "mathematics",
    "microscope", "navigation", "observation", "parachute", "ultraviolet", "vocabulary",
    "wavelength", "yearning", "zeppelin", "binoculars", "thermometer", "wilderness",
    "underwater", "watermelon", "understanding", "celebration", "demonstration",
    "examination", "information", "keyboard", "lighthouse", "greenhouse", "talented",
]

# 困难：整句（25 条）
HARD_PHRASES = [
    "the quick brown fox jumps over the lazy dog",
    "practice makes perfect",
    "knowledge is power",
    "fortune favours the bold",
    "better late than never",
    "actions speak louder than words",
    "all that glitters is not gold",
    "never give up trying",
    "type faster with ten fingers",
    "learn to code step by step",
    "keep your friends close",
    "the early bird catches the worm",
    "a journey of a thousand miles",
    "every cloud has a silver lining",
    "the show must go on",
    "practice typing every single day",
    "explore the ancient ruins",
    "defeat the ice giant",
    "the dragon guards the treasure",
    "read carefully before you answer",
    "one step at a time",
    "the door opens when you succeed",
    "look around before you type",
    "master the keyboard shortcuts",
    "speed comes with practice",
]

TIER_EASY = "easy"
TIER_MEDIUM = "medium"
TIER_HARD = "hard"

# 每一档的题池
TIER_POOLS: dict[str, list[str]] = {
    TIER_EASY: EASY_WORDS,
    TIER_MEDIUM: MEDIUM_WORDS + MEDIUM_PHRASES,
    TIER_HARD: HARD_WORDS + HARD_PHRASES,
}

# 三档在一天里的配比（简单最多、困难收尾）
TIER_WEIGHTS = (0.40, 0.35, 0.25)
TIER_ORDER = (TIER_EASY, TIER_MEDIUM, TIER_HARD)


# --------------------------------------------------------------------- 结构


@dataclass(frozen=True)
class Question:
    """一道题。"""

    text: str
    tier: str
    index: int  # 0 基序号

    @property
    def tier_label(self) -> str:
        return {TIER_EASY: "简单", TIER_MEDIUM: "中等", TIER_HARD: "困难"}.get(self.tier, self.tier)

    @property
    def answer(self) -> str:
        """标准答案（去掉多余空格、统一小写比较时的基准）。"""
        return self.text.strip()


def today() -> date_cls:
    """今天的日期。"""
    return datetime.now().date()


def daily_seed(day: date_cls | None = None) -> int:
    """把日期转成整数种子（YYYYMMDD）。"""
    return int((day or today()).strftime(DATE_SEED_FORMAT))


def _split_counts(total: int) -> dict[str, int]:
    """把当天题量按配比拆到三档，保证总和等于 total 且每档至少 1 题。"""
    counts = {tier: int(total * weight) for tier, weight in zip(TIER_ORDER, TIER_WEIGHTS)}
    # 补齐 / 削减，保证总和精确等于 total
    while sum(counts.values()) > total:
        # 从占比最大的档位里减
        tier = max(counts, key=lambda t: counts[t])
        if counts[tier] <= 1:
            break
        counts[tier] -= 1
    while sum(counts.values()) < total:
        tier = TIER_ORDER[sum(counts.values()) % len(TIER_ORDER)]
        counts[tier] += 1
    return counts


def daily_questions(day: date_cls | None = None) -> list[Question]:
    """生成当天的题目列表。

    同一天调用结果完全一致；跨天自动换一批。题目不重复，难度由易到难。
    """
    seed = daily_seed(day)
    rng = random.Random(seed)
    total = rng.randint(MIN_QUESTIONS_PER_DAY, MAX_QUESTIONS_PER_DAY)
    counts = _split_counts(total)

    picked: list[tuple[str, str]] = []
    used: set[str] = set()
    for tier in TIER_ORDER:
        pool = list(TIER_POOLS[tier])
        rng.shuffle(pool)
        chosen = 0
        for text in pool:
            if text in used:
                continue
            used.add(text)
            picked.append((tier, text))
            chosen += 1
            if chosen >= counts[tier]:
                break
        # 题池不够时从剩余档位补齐（正常不会发生，池子足够大）
        if chosen < counts[tier]:
            for other in TIER_ORDER:
                for text in TIER_POOLS[other]:
                    if text in used:
                        continue
                    used.add(text)
                    picked.append((other, text))
                    chosen += 1
                    if chosen >= counts[tier]:
                        break
                if chosen >= counts[tier]:
                    break

    return [
        Question(text=text, tier=tier, index=index)
        for index, (tier, text) in enumerate(picked)
    ]


def bank_size() -> int:
    """题库总量。"""
    return sum(len(pool) for pool in TIER_POOLS.values())


if __name__ == "__main__":  # 手动自检：python -m game3d.questions
    import collections

    questions = daily_questions()
    print(f"题库总量: {bank_size()}")
    print(f"当天题量: {len(questions)} (seed={daily_seed()})")
    print("难度分布:", collections.Counter(q.tier for q in questions))
    print("去重后:", len({q.text for q in questions}) == len(questions))
    for q in questions[:5]:
        print(f"  {q.index + 1:>2}. [{q.tier_label}] {q.text}")
