import {
    dateKeyFor,
    hashString,
    isAnswerCorrect,
    mulberry32,
    normalizeTyped,
    normalizePinyin,
    normalizerFor,
    parseBank,
    prefixMatches,
    remainingTarget,
    selectDailyQuestions,
    shuffle,
    targetFor,
} from "@/lib/typing3d/bank";
import type { Typing3DItem } from "@/lib/typing3d/types";

const SAMPLE: Typing3DItem[] = [
    { text: "你好", kind: "zh", tier: 1, pinyin: "ni hao" },
    { text: "今天天气不错", kind: "zh", tier: 2, pinyin: "jin tian tian qi bu cuo" },
    { text: "为南朝", kind: "zh", tier: 1, pinyin: "wèi nán cháo" },
    { text: "绿萝", kind: "zh", tier: 1, pinyin: "lǜ luó" },
    { text: "Hello world", kind: "en", tier: 2 },
    { text: "print(1)", kind: "code", tier: 1 },
    { text: "123456", kind: "sym", tier: 1 },
];

describe("题库解析", () => {
    it("接受紧凑数组格式", () => {
        const items = parseBank({
            items: [
                ["你好", "zh", 1, "ni hao"],
                ["Hello", "en", 2],
            ],
        });
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({ text: "你好", kind: "zh", tier: 1, pinyin: "ni hao" });
        expect(items[1].pinyin).toBeUndefined();
    });

    it("丢掉脏数据", () => {
        const items = parseBank({
            items: [
                ["", "zh", 1],
                [123, "zh", 1],
                ["好的", "不知道", 9],
                null,
            ],
        });
        expect(items).toHaveLength(1);
        expect(items[0].kind).toBe("en");
        expect(items[0].tier).toBe(1);
    });

    it("题库为空时返回空数组", () => {
        expect(parseBank(null)).toEqual([]);
        expect(parseBank({ items: "nope" })).toEqual([]);
    });
});

describe("随机与种子", () => {
    it("同种子产生同序列", () => {
        const left = shuffle([1, 2, 3, 4, 5], mulberry32(42));
        const right = shuffle([1, 2, 3, 4, 5], mulberry32(42));
        expect(left).toEqual(right);
    });

    it("不同种子结果不同", () => {
        const left = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(1));
        const right = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(2));
        expect(left).not.toEqual(right);
    });

    it("hashString 稳定", () => {
        expect(hashString("20261109")).toBe(hashString("20261109"));
        expect(hashString("a")).not.toBe(hashString("b"));
    });

    it("日期键是本地时区的 YYYYMMDD", () => {
        expect(dateKeyFor(new Date(2026, 0, 5))).toBe("20260105");
        expect(dateKeyFor(new Date(2026, 10, 9))).toBe("20261109");
    });
});

describe("每日选题", () => {
    it("同一天选出来的题目完全一样", () => {
        const first = selectDailyQuestions(SAMPLE, "20261109", 4);
        const second = selectDailyQuestions(SAMPLE, "20261109", 4);
        expect(first.map((item) => item.item.text)).toEqual(second.map((item) => item.item.text));
    });

    it("换一天题目就换新", () => {
        const today = selectDailyQuestions(SAMPLE, "20261109", 4).map((item) => item.item.text);
        const tomorrow = selectDailyQuestions(SAMPLE, "20261110", 4).map((item) => item.item.text);
        expect(today).not.toEqual(tomorrow);
    });

    it("关卡序号从 0 开始且连续", () => {
        const questions = selectDailyQuestions(SAMPLE, "20261109", 3);
        expect(questions.map((item) => item.index)).toEqual([0, 1, 2]);
    });

    it("题目不重复", () => {
        const questions = selectDailyQuestions(SAMPLE, "20261109", 5);
        const texts = questions.map((item) => item.item.text);
        expect(new Set(texts).size).toBe(texts.length);
    });

    it("题库不够时按实际数量给", () => {
        expect(selectDailyQuestions(SAMPLE, "20261109", 99)).toHaveLength(SAMPLE.length);
        expect(selectDailyQuestions([], "20261109", 5)).toEqual([]);
    });

    it("先短后长，难度由易到难", () => {
        const many: Typing3DItem[] = [];
        for (let index = 0; index < 12; index += 1) {
            many.push({ text: `短${index}`, kind: "zh", tier: 1 });
            many.push({ text: `中等长度${index}`, kind: "zh", tier: 2 });
            many.push({ text: `很长很长的一段文字${index}`, kind: "zh", tier: 3 });
        }
        const questions = selectDailyQuestions(many, "20261109", 9);
        const tiers = questions.map((item) => item.item.tier);
        expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    });
});

describe("答案判定", () => {
    const hanzi = { index: 0, item: SAMPLE[0] };   // 你好 / ni hao
    const toned = { index: 0, item: SAMPLE[2] };   // 为南朝 / wèi nán cháo
    const vPinyin = { index: 0, item: SAMPLE[3] }; // 绿萝 / lǜ luó
    const english = { index: 0, item: SAMPLE[4] }; // Hello world

    it("中文题可以按拼音答", () => {
        expect(targetFor(hanzi, "pinyin")).toBe("ni hao");
        expect(targetFor(hanzi, "hanzi")).toBe("你好");
        expect(isAnswerCorrect("ni hao", hanzi, "pinyin")).toBe(true);
        expect(isAnswerCorrect("nihao", hanzi, "pinyin")).toBe(true);
        expect(isAnswerCorrect("你好", hanzi, "hanzi")).toBe(true);
    });

    it("带声调的拼音目标，敲纯 ASCII 也算对（键盘敲不出声调符号）", () => {
        expect(targetFor(toned, "pinyin")).toBe("wèi nán cháo");
        expect(isAnswerCorrect("wei nan chao", toned, "pinyin")).toBe(true);
        expect(isAnswerCorrect("WEINANCHAO", toned, "pinyin")).toBe(true);
        expect(isAnswerCorrect("wèi nán cháo", toned, "pinyin")).toBe(true);
        expect(isAnswerCorrect("wei nan cha", toned, "pinyin")).toBe(false);
    });

    it("ü 敲成 v 也算对", () => {
        expect(normalizePinyin("lǜ luó")).toBe("luluo");
        expect(isAnswerCorrect("lv luo", vPinyin, "pinyin")).toBe(true);
        expect(isAnswerCorrect("lü luó", vPinyin, "pinyin")).toBe(true);
    });

    it("汉字模式不受拼音规则影响", () => {
        expect(isAnswerCorrect("为南朝", toned, "hanzi")).toBe(true);
        expect(isAnswerCorrect("wei nan chao", toned, "hanzi")).toBe(false);
    });

    it("英文题忽略大小写和空格", () => {
        expect(normalizeTyped("  Hello World ")).toBe("helloworld");
        expect(isAnswerCorrect("hello world", english, "hanzi")).toBe(true);
        expect(isAnswerCorrect("HELLO WORLD", english, "hanzi")).toBe(true);
    });

    it("答错就算错", () => {
        expect(isAnswerCorrect("helo", english, "hanzi")).toBe(false);
        expect(isAnswerCorrect("", english, "hanzi")).toBe(false);
    });

    it("前缀判定用于实时提示", () => {
        expect(prefixMatches("hel", english, "hanzi")).toBe(true);
        expect(prefixMatches("hej", english, "hanzi")).toBe(false);
        expect(prefixMatches("", english, "hanzi")).toBe(true);
        expect(prefixMatches("wei nan", toned, "pinyin")).toBe(true);
    });

    it("剩余提示按规范化后的长度对齐", () => {
        expect(remainingTarget("wei nan", toned, "pinyin")).toBe("cháo");
        expect(remainingTarget("wei nan chao", toned, "pinyin")).toBe("");
        expect(remainingTarget("wei nan cha", toned, "pinyin")).toBe("o");
        expect(remainingTarget("xyz", toned, "pinyin")).toBe("wèi nán cháo");
    });

    it("规范化方式按题目类型选择", () => {
        expect(normalizerFor(toned, "pinyin")).toBe(normalizePinyin);
        expect(normalizerFor(toned, "hanzi")).toBe(normalizeTyped);
        expect(normalizerFor(english, "pinyin")).toBe(normalizeTyped);
    });
});
