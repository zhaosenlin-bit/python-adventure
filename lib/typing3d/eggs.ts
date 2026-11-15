/**
 * 彩蛋文案与彩蛋奖励（纯逻辑，不碰 three.js，可以直接单测）。
 *
 * 彩蛋分两种：
 * - 空中问号方块（cube）：随手就能捡，给一个小提示 —— 揭示题目的第一个字符；
 * - 跑酷路线顶端的隐藏祭坛（altar）：得先跳上去，给大提示 —— 揭示题目一半。
 *
 * 文案按「当天日期 + 关卡 + 彩蛋编号」取，同一天固定，跨天换新。
 */

import { mulberry32 } from "./bank";
import type { EasterEggSpec } from "./types";

/** 空中问号方块里的话：短、轻、不剧透。 */
export const EGG_TEXTS: string[] = [
    "这个问号比你想象的更早就在这儿了。",
    "跳得高一点，好东西都在上面。",
    "别急着答题，先把这条路线走一遍。",
    "墙上有前辈留下的划痕，说这里曾经是食堂。",
    "你踩的这一块地板，是上个版本留下的。",
    "据说这关的柱子会自己换位置，其实不会。",
    "有人在这里练了三年打字，只为了不被门卡住。",
    "祭坛在顶上。想看的话，得跳得比别人高。",
    "找彩蛋不加分，但心情会好很多。",
    "这里的光是暖色的，所以让人想站一会儿。",
    "提示：你比你想的更接近答案。",
    "这一关的雾是昨天那场雨留下的。",
    "如果你是第一次玩，恭喜你发现了这里。",
    "别担心，掉下去也摔不疼。",
    "每个关卡都藏了一句话，今天这句是给你的。",
    "你走路的样子像在赶稿，其实是在闯关。",
    "门后面还有门，别怕，只是下一关。",
    "这条路线是给愿意多按两下空格的人准备的。",
];

/** 祭坛上的隐藏台词：一关只有一句，比较郑重。 */
export const ALTAR_TEXTS: string[] = [
    "「打字不是为了快，是为了把想法留在手边。」",
    "「你走过的每一关，都是自己敲出来的。」",
    "「最高的地方没有奖品，只有风景。」",
    "「先跳，再想。」",
    "「认真的人运气都不会太差。」",
    "「把键盘当成乐器，你就是演奏者。」",
    "「门一直都在，只是要有人愿意答对问题。」",
    "「恭喜你看到了这里，这句话没别人看见过。」",
];

export type EggKind = EasterEggSpec["kind"];

/**
 * 按种子挑一句彩蛋文案。
 * 同一个 (seed, level, eggId) 永远得到同一句 —— 当天固定、跨天换新。
 */
export function pickEggText(seed: number, levelIndex: number, eggId: number, kind: EggKind): string {
    const pool = kind === "altar" ? ALTAR_TEXTS : EGG_TEXTS;
    const random = mulberry32((seed + levelIndex * 7919 + eggId * 104729) >>> 0);
    const index = Math.floor(random() * pool.length) % pool.length;
    return pool[index];
}

/**
 * 彩蛋给的提示。
 * - cube：只透露第一个字符；
 * - altar：透露一半（多给几个字符）。
 */
export function eggHint(target: string, kind: EggKind): string {
    const text = (target ?? "").trim();
    if (!text) return "";
    if (kind === "altar") {
        const half = Math.max(2, Math.ceil(text.length / 2));
        return `题目前半句是「${text.slice(0, half)}」`;
    }
    return `题目的第一个字符是「${text.slice(0, 1)}」`;
}

/** 一关里所有彩蛋的编号顺序（给 React 层统计用）。 */
export function eggKey(egg: EasterEggSpec): string {
    return `${egg.kind}-${egg.id}`;
}
