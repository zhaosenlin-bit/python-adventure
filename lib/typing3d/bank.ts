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
 * 规则：先按难度分档（短 -> 中 -> 长），每档内随机但当天固定；
 * 某一档不够时用剩下的题补齐，保证每天都有足量的关卡。
 */
export function selectDailyQuestions(
    items: Typing3DItem[],
    dateKey: string,
    count: number = TYPING3D_DAILY_COUNT,
): Typing3DQuestion[] {
    if (!items.length || count <= 0) return [];

    const random = mulberry32(hashString(`typing3d:${dateKey}`));
    const buckets: Record<Typing3DTier, Typing3DItem[]> = { 1: [], 2: [], 3: [] };
    for (const item of items) {
        buckets[item.tier].push(item);
    }

    const shuffled: Record<Typing3DTier, Typing3DItem[]> = {
        1: shuffle(buckets[1], random),
        2: shuffle(buckets[2], random),
        3: shuffle(buckets[3], random),
    };

    const picked: Typing3DItem[] = [];
    const perTier = Math.ceil(count / 3);
    for (const tier of [1, 2, 3] as Typing3DTier[]) {
        picked.push(...shuffled[tier].slice(0, perTier));
    }

    // 某档不够就拿剩下的补
    if (picked.length < count) {
        const used = new Set(picked);
        const rest = shuffle(
            items.filter((item) => !used.has(item)),
            random,
        );
        picked.push(...rest.slice(0, count - picked.length));
    }

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
export function isAnswerCorrect(
    typed: string,
    question: Typing3DQuestion,
    mode: Typing3DInputMode,
): boolean {
    const norm = normalizerFor(question, mode);
    const left = norm(typed);
    const right = norm(targetFor(question, mode));
    return right.length > 0 && left === right;
}

/** 输入的前缀是否还对得上，用来实时给反馈。 */
export function prefixMatches(
    typed: string,
    question: Typing3DQuestion,
    mode: Typing3DInputMode,
): boolean {
    const norm = normalizerFor(question, mode);
    return norm(targetFor(question, mode)).startsWith(norm(typed));
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
    const target = targetFor(question, mode);
    const norm = normalizerFor(question, mode);
    const typedNorm = norm(typed);
    const targetNorm = norm(target);
    if (!targetNorm.startsWith(typedNorm)) return target;
    if (typedNorm.length >= targetNorm.length) return "";
    // 逐字规范化，记录每个规范化字符对应原字符串里的位置
    const map: number[] = [];
    for (let index = 0; index < target.length; index += 1) {
        const piece = norm(target[index]);
        for (let offset = 0; offset < piece.length; offset += 1) map.push(index);
    }
    return target.slice(map[typedNorm.length] ?? target.length);
}

