"""从本地课程缓存里挖出「3D 打字闯关」用的离线题库。

题目来源是 `public/typing/data/lessons/` 里已经抓好的课程内容（3000+ 份），
不依赖任何线上接口，所以桌面版 exe 离线也能玩。

输出 `public/typing/data/typing3d-bank.json`：

```json
{
  "generatedAt": "...",
  "items": [["文本", "zh", 2, "pīn yīn"], ...]
}
```

* 第 1 项：文本
* 第 2 项：类别（zh 中文句段 / en 英文词句 / code 代码片段 / sym 符号练习）
* 第 3 项：难度档（1 短 <=6 字 / 2 中 7~12 字 / 3 长 13~40 字）
* 第 4 项：拼音（只有中文句段有；没有中文输入法的电脑可以切到拼音模式）

用法：

```powershell
python scripts/build_typing3d_bank.py            # 生成题库
python scripts/build_typing3d_bank.py --report   # 只看统计，不写文件
```
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LESSON_DIR = PROJECT_ROOT / "public" / "typing" / "data" / "lessons"
OUTPUT_PATH = PROJECT_ROOT / "public" / "typing" / "data" / "typing3d-bank.json"

# 中文标点 + 换行：长课文按这些切开
SPLIT_PATTERN = re.compile(r"[\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u3001\n\r\u2026\u2014]+")
CJK_PATTERN = re.compile(r"[\u4e00-\u9fff]")
CODE_PATTERN = re.compile(r"[{}()\[\];=<>+\-*/%]")
CALL_PATTERN = re.compile(r"[a-zA-Z_]\w*\s*\(")
SPACE_PATTERN = re.compile(r"\s+")
PUNCT_CHARS = set("\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u3001\n\r\u2026\u2014\uff01\uff1f \t")

MIN_LEN = 2
MAX_LEN = 40

# 每类最多保留多少条，防止题库无限膨胀
KIND_LIMITS = {"zh": 1400, "en": 900, "code": 320, "sym": 120}


def normalize(text: str) -> str:
    """压掉多余空白，保证同一句话只有一种写法。"""
    text = unicodedata.normalize("NFKC", text)
    text = SPACE_PATTERN.sub(" ", text).strip()
    return text


def classify(text: str) -> str | None:
    """判断一句话属于哪一类；判不出来就丢掉。"""
    if not text:
        return None
    if CJK_PATTERN.search(text):
        # 中文里带函数调用的（`print("你好")`）算代码，其余算中文句段
        if CALL_PATTERN.search(text):
            return "code"
        return "zh"
    if re.fullmatch(r"[A-Za-z][A-Za-z ,'\-\.]*", text):
        return "en"
    if CODE_PATTERN.search(text):
        return "code"
    if re.fullmatch(r"[0-9\W_]+", text) and len(text) >= 3:
        return "sym"
    return None


def tier_of(text: str) -> int:
    length = len(text)
    if length <= 6:
        return 1
    if length <= 12:
        return 2
    return 3


def is_interesting(text: str) -> bool:
    """过滤掉纯符号、纯标点这类没营养的碎片。"""
    if len(text) < MIN_LEN or len(text) > MAX_LEN:
        return False
    if text.count(" ") >= len(text) * 0.6:
        return False
    # 课程原始数据里混进了 JSON 碎片和转义换行，打字关不要这些
    if "\\" in text or '"' in text or "\ufffd" in text:
        return False
    letters = sum(1 for ch in text if ch.isalnum() or CJK_PATTERN.match(ch))
    if letters < max(2, len(text) // 3):
        return False
    return True


def split_long(text: str) -> list[str]:
    """把一段长文本切成适合打字闯关的短句。"""
    pieces: list[str] = []
    for chunk in SPLIT_PATTERN.split(text):
        chunk = normalize(chunk)
        if not chunk:
            continue
        if len(chunk) <= MAX_LEN:
            pieces.append(chunk)
            continue
        # 还是太长：按空格再切一刀（英文长句）
        buffer = ""
        for word in chunk.split(" "):
            candidate = f"{buffer} {word}".strip()
            if len(candidate) > MAX_LEN:
                if buffer:
                    pieces.append(buffer)
                buffer = word[:MAX_LEN]
            else:
                buffer = candidate
        if buffer:
            pieces.append(buffer)
    return pieces


def parse_pinyin(raw: object) -> list[tuple[str, str]] | None:
    """课程里的拼音字段是一段 JSON 字符串，形如 [["这","zhè"], ...]。"""
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, list) or not parsed:
        return None
    pairs: list[tuple[str, str]] = []
    for item in parsed:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            char = str(item[0])
            pinyin = str(item[1] or "")
            pairs.append((char, pinyin))
    return pairs or None


def split_pairs(pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """按标点把 (字, 拼音) 序列切成短句，同时给出整句的拼音。"""
    segments: list[tuple[str, str]] = []
    chars: list[str] = []
    pinyins: list[str] = []

    def flush() -> None:
        if not chars:
            return
        text = "".join(chars)
        syllable = " ".join(part for part in pinyins if part)
        segments.append((text, syllable))
        chars.clear()
        pinyins.clear()

    for char, pinyin in pairs:
        if char in PUNCT_CHARS:
            flush()
            continue
        chars.append(char)
        pinyins.append(pinyin)
    flush()
    return segments


def harvest(lesson: dict) -> list[tuple[str, str]]:
    """从一份课程里抠出所有可用的候选文本，返回 (文本, 拼音)。"""
    data = lesson.get("data") or {}
    out: list[tuple[str, str]] = []

    for section in ("practice", "game", "test", "article"):
        for chapter in data.get(section) or []:
            pairs = parse_pinyin(chapter.get("pinyin"))
            if pairs:
                for text, pinyin in split_pairs(pairs):
                    out.append((text, pinyin))
                continue
            for raw in chapter.get("text") or []:
                if isinstance(raw, str):
                    for piece in split_long(raw):
                        out.append((piece, ""))

    return out


def sample_evenly(items: list[tuple[str, str, int]], limit: int) -> list[tuple[str, str, int]]:
    """均匀取样，避免只留下列表开头那一批课程。"""
    if len(items) <= limit:
        return list(items)
    stride = len(items) / limit
    return [items[int(index * stride)] for index in range(limit)]


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 3D 打字闯关离线题库")
    parser.add_argument("--report", action="store_true", help="只打印统计，不写文件")
    args = parser.parse_args()

    if not LESSON_DIR.is_dir():
        print(f"找不到课程缓存目录：{LESSON_DIR}")
        return 1

    seen: set[str] = set()
    buckets: dict[str, list[tuple[str, str, int]]] = {kind: [] for kind in KIND_LIMITS}
    kind_counter: Counter[str] = Counter()
    tier_counter: Counter[int] = Counter()
    pinyin_counter = 0
    lesson_count = 0

    for path in sorted(LESSON_DIR.glob("*.json")):
        try:
            lesson = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        lesson_count += 1
        for candidate, pinyin in harvest(lesson):
            text = normalize(candidate)
            if not is_interesting(text) or text in seen:
                continue
            kind = classify(text)
            if kind is None:
                continue
            seen.add(text)
            kind_counter[kind] += 1
            tier = tier_of(text)
            tier_counter[tier] += 1
            if pinyin:
                pinyin_counter += 1
            buckets[kind].append((text, pinyin, tier))

    # 类别交错排列，一局里不会连着来一整块同类型题
    order = ["zh", "en", "code", "sym"]
    by_kind: dict[str, list[list[object]]] = {}
    for kind, entries in buckets.items():
        picked = sample_evenly(entries, KIND_LIMITS[kind])
        by_kind[kind] = [
            [text, kind, tier, pinyin] if pinyin else [text, kind, tier]
            for text, pinyin, tier in picked
        ]

    pools = {kind: by_kind.get(kind, []) for kind in order}
    items: list[list[object]] = []
    while any(pools[kind] for kind in order):
        for kind in order:
            pool = pools[kind]
            if pool:
                items.append(pool.pop(0))

    report = {
        "lessons": lesson_count,
        "kinds": dict(kind_counter),
        "tiers": {str(k): v for k, v in sorted(tier_counter.items())},
        "with_pinyin": pinyin_counter,
        "kept": len(items),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if args.report:
        return 0

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "public/typing/data/lessons",
        "schema": ["text", "kind", "tier", "pinyin?"],
        "stats": report,
        "items": items,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"\n已写入 {OUTPUT_PATH}（{OUTPUT_PATH.stat().st_size / 1024:.0f} KB，共 {len(items)} 条）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
