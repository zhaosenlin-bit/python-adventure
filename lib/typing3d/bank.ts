/**
 * 题库读取 + 每日选题。
 *
 * 题库是离线 JSON（由 `scripts/build_typing3d_bank.py` 从课程缓存里抽出来的），
 * 每天用日期做种子选出一组固定的题目，当天内刷新页面题目不变，第二天自动换新。
 */

import type { Typing3DInputMode, Typing3DItem, Typing3DQuestion, Typing3DTier } from "./types";

export const TYPING3D_BANK_URL = "/typing/data/typing3d-bank.json";

/** 一天闯几关。 */
export const TYPING3D_DAILY_COUNT = 24;

/** 每个难度档里至少要有多少英文题（题池不够时按实际数量给）。 */
const TIER_MIN_ENGLISH_RATIO = 0.35;

/** 每个难度档里代码 / 符号题最多占多少，免得「困难」档其实全是代码。 */
const TIER_MAX_CODE_RATIO = 0.25;

/**
 * 难度曲线：越往后越难。
 *
 * 两道分界线会随着进度一起往后收 —— 开局以简单题为主，中段用中等题过渡，
 * 收尾集中上困难题。返回第 index 关该用哪一档（1 简单 / 2 中等 / 3 困难）。
 *
 * 分界线单调收缩，所以分出来的三段一定是「先简单、再中等、最后困难」，
 * 不会出现难度来回跳。
 */
export function tierForIndex(index: number, count: number): Typing3DTier {
    const progress = (index + 0.5) / Math.max(1, count);
    const firstBoundary = 0.5 - 0.35 * progress;
    const secondBoundary = 0.8 - 0.3 * progress;
    if (progress < firstBoundary) return 1;
    if (progress < secondBoundary) return 2;
    return 3;
}

/** 32 位随机数发生器（mulberry32），同样的种子永远得到同样的顺序。 */
export function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 字符串 -> 32 位整数种子。 */
export function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/** 本地日期 -> `YYYYMMDD`。 */
export function dateKeyFor(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}${month}${day}`;
}

/** 题库 JSON -> 题目数组，顺手过滤掉脏数据。 */
export function parseBank(raw: unknown): Typing3DItem[] {
    const container = raw as { items?: unknown } | null;
    const rows = Array.isArray(container?.items) ? container.items : [];
    const items: Typing3DItem[] = [];
    for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const [text, kind, tier, pinyin] = row as [unknown, unknown, unknown, unknown?];
        if (typeof text !== "string" || !text.trim()) continue;
        const normalizedKind = kind === "zh" || kind === "en" || kind === "code" || kind === "sym" ? kind : "en";
        const normalizedTier: Typing3DTier = tier === 1 || tier === 2 || tier === 3 ? tier : 1;
        items.push({
            text: text.trim(),
            kind: normalizedKind,
            tier: normalizedTier,
            pinyin: typeof pinyin === "string" && pinyin.trim() ? pinyin.trim() : undefined,
        });
    }
    return items;
}

/** Fisher-Yates，用传入的随机源，保证结果可复现。 */
export function shuffle<T>(values: T[], random: () => number): T[] {
    const copy = [...values];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
}

/**
 * 选出今天要闯的关卡。
 *
 * 规则：
 * 1. 难度按关卡推进递增（简单 -> 中等 -> 困难），当天固定，跨天自动换新；
 * 2. 每档保底留一些英文题，别让「困难」档其实全是代码片段；
 * 3. 代码 / 符号题每档限量；
 * 4. 题库不够时用剩下的题补齐，保证每天都有足量的关卡。
 */
export function selectDailyQuestions(
    items: Typing3DItem[],
    dateKey: string,
    count: number = TYPING3D_DAILY_COUNT,
): Typing3DQuestion[] {
    if (!items.length || count <= 0) return [];

    const random = mulberry32(hashString(`typing3d:${dateKey}`));

    // 每档再拆成三个池子：英文、中文、代码 / 符号。
    const pools: Record<
        Typing3DTier,
        { en: Typing3DItem[]; zh: Typing3DItem[]; code: Typing3DItem[] }
    > = {
        1: { en: [], zh: [], code: [] },
        2: { en: [], zh: [], code: [] },
        3: { en: [], zh: [], code: [] },
    };
    for (const item of items) {
        const bucket = pools[item.tier];
        if (item.kind === "en") bucket.en.push(item);
        else if (item.kind === "code" || item.kind === "sym") bucket.code.push(item);
        else bucket.zh.push(item);
    }

    // 按难度曲线先算出每档要几关（简单 / 中等 / 困难各多少题）。
    const quotas: Record<Typing3DTier, number> = { 1: 0, 2: 0, 3: 0 };
    for (let index = 0; index < count; index += 1) {
        quotas[tierForIndex(index, count)] += 1;
    }

    const picked: Typing3DItem[] = [];
    for (const tier of [1, 2, 3] as Typing3DTier[]) {
        const quota = quotas[tier];
        if (quota <= 0) continue;
        const bucket = pools[tier];
        let english = shuffle(bucket.en, random);
        let chinese = shuffle(bucket.zh, random);
        let coded = shuffle(bucket.code, random);

        let remaining = quota;
        const tierPicks: Typing3DItem[] = [];
        /** 从池子里取题，已经取走的部分从池子里去掉，免得同一题出现两次。 */
        const take = (pool: Typing3DItem[], wanted: number): Typing3DItem[] => {
            const amount = Math.max(0, Math.min(wanted, pool.length, remaining));
            tierPicks.push(...pool.slice(0, amount));
            remaining -= amount;
            return pool.slice(amount);
        };

        // 英文保底 -> 代码限量 -> 中文补齐；某一类不够就换下一类补。
        english = take(english, Math.max(1, Math.round(quota * TIER_MIN_ENGLISH_RATIO)));
        coded = take(coded, Math.floor(quota * TIER_MAX_CODE_RATIO));
        chinese = take(chinese, remaining);
        english = take(english, remaining);
        coded = take(coded, remaining);

        picked.push(...tierPicks);
    }

    // 某档不够就拿剩下的题补齐
    if (picked.length < count) {
        const used = new Set(picked);
        const rest = shuffle(
            items.filter((item) => !used.has(item)),
            random,
        );
        picked.push(...rest.slice(0, count - picked.length));
    }

    // 按难度排一遍，保证关卡越往后越难（补题时也不会打乱顺序）。
    picked.sort((left, right) => left.tier - right.tier);

    return picked.slice(0, count).map((item, index) => ({ index, item }));
}

/** 这一关要打的字：中文题可以按拼音打，其余就是原文。 */
export function targetFor(question: Typing3DQuestion, mode: Typing3DInputMode): string {
    if (mode === "pinyin" && question.item.kind === "zh" && question.item.pinyin) {
        return question.item.pinyin;
    }
    return question.item.text;
}

/**
 * 比对前统一：去声调符号、去空格、转小写。
 *
 * 题库里的拼音是带声调符号的（wèi nán cháo），但键盘敲不出 ì ǐ ü，
 * 所以必须先把「ā á ǎ à …」折回基础字母再比。
 */
export function normalizeTyped(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "")
        .toLowerCase();
}

/**
 * 拼音模式额外把 v 当成 ü：键盘上没有 ü，声母 lǜ 只能敲成 lv。
 * 汉语拼音里 v 只用来代替 ü，所以这个替换只在拼音模式生效。
 */
export function normalizePinyin(value: string): string {
    return normalizeTyped(value).replace(/v/g, "u");
}

/** 这一关用哪种规范化方式比较。 */
export function normalizerFor(
    question: Typing3DQuestion,
    mode: Typing3DInputMode,
): (value: string) => string {
    const pinyinMode =
        mode === "pinyin" && question.item.kind === "zh" && Boolean(question.item.pinyin);
    return pinyinMode ? normalizePinyin : normalizeTyped;
}

/** 输入是否已经和目标一致（完全正确）。 */
export function acceptableTargets(
    question: Typing3DQuestion,
    mode: Typing3DInputMode,
): { text: string; norm: (value: string) => string }[] {
    const pinyin = question.item.pinyin;
    const pinyinMode = mode === "pinyin" && question.item.kind === "zh" && Boolean(pinyin);
    if (!pinyinMode || !pinyin) {
        return [{ text: question.item.text, norm: normalizeTyped }];
    }
    // 拼音模式下中文也算对：用户开着中文输入法时，拼音会被输入法转成汉字，
    // 输入框里已经是汉字了，那就是正确答案，不该因为「模式是拼音」被判错。
    return [
        { text: pinyin, norm: normalizePinyin },
        { text: question.item.text, norm: normalizeTyped },
    ];
}

/** 输入是否已经和目标一致（完全正确）。 */
export function isAnswerCorrect(
    typed: string,
    question: Typing3DQuestion,
    mode: Typing3DInputMode,
): boolean {
    return acceptableTargets(question, mode).some(({ text, norm }) => {
        const left = norm(typed);
        const right = norm(text);
        return right.length > 0 && left === right;
    });
}

/** 输入的前缀是否还对得上，用来实时给反馈。 */
export function prefixMatches(
    typed: string,
    question: Typing3DQuestion,
    mode: Typing3DInputMode,
): boolean {
    return acceptableTargets(question, mode).some(({ text, norm }) =>
        norm(text).startsWith(norm(typed)),
    );
}

/**
 * 目标里还没敲完的部分。
 *
 * 目标带声调、输入不带时两者长度对不上，不能直接按 typed.length 切；
 * 这里按规范化后的字符位置回溯到原字符串再切。
 */
export function remainingTarget(
    typed: string,
    question: Typing3DQuestion,
    mode: Typing3DInputMode,
): string {
    for (const { text, norm } of acceptableTargets(question, mode)) {
        const typedNorm = norm(typed);
        const targetNorm = norm(text);
        if (!targetNorm.startsWith(typedNorm)) continue;
        if (typedNorm.length >= targetNorm.length) return "";
        // 逐字规范化，记录每个规范化字符对应原字符串里的位置
        const map: number[] = [];
        for (let index = 0; index < text.length; index += 1) {
            const piece = norm(text[index]);
            for (let offset = 0; offset < piece.length; offset += 1) map.push(index);
        }
        return text.slice(map[typedNorm.length] ?? text.length);
    }
    return targetFor(question, mode);
}

