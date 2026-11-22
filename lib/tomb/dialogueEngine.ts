/**
 * 3D古墓剧本杀 · 关键词匹配引擎
 *
 * 硬性规则：只做关键词匹配，不做语义理解、不自由发挥、不脑补。
 * 命中顺序：任务核心关键词 > 闲聊私人关键词 > 默认回复。
 */

import { DIALOGUE, type DialogueKind, type DialoguePools, type NpcId } from "./dialogue";

/** 任务核心关键词 */
export const TASK_KEYWORDS: readonly string[] = [
    "伪人",
    "坏人",
    "可疑",
    "是谁",
    "身份",
    "偷袭",
    "危险",
    "线索",
    "笔记",
    "出口",
    "石门",
    "离开",
    "逃生",
    "你是伪人吗",
    "我是伪人吗",
];

/** 闲聊私人关键词 */
export const CASUAL_KEYWORDS: readonly string[] = [
    "年龄",
    "名字",
    "家乡",
    "几岁",
    "认识我",
    "累吗",
    "吃饭",
    "哪里人",
    "以前",
    "经历",
];

export function classifyQuestion(text: string): DialogueKind {
    const input = (text ?? "").trim();
    if (!input) return "default";
    // 任务关键词优先：命中任务词即走任务池，绝不下落到闲聊池
    if (TASK_KEYWORDS.some((keyword) => input.includes(keyword))) return "task";
    if (CASUAL_KEYWORDS.some((keyword) => input.includes(keyword))) return "casual";
    return "default";
}

export interface NpcReply {
    text: string;
    kind: DialogueKind;
    /** 本次回答是否来自假话池（仅伪人可能为 true） */
    lied: boolean;
    /** 命中任务关键词时是否抽到了真话池 */
    truth: boolean;
}

export const IMPOSTOR_TRUTH_CHANCE = 0.2;

function pick<T>(pool: readonly T[]): T {
    return pool[Math.floor(Math.random() * pool.length)];
}

/** 对话状态：固定好人「固定台词」的轮转游标 */
export interface DialogueState {
    fixedTaskCursor: number;
}

export function createDialogueState(): DialogueState {
    return { fixedTaskCursor: 0 };
}

const fallbackState = createDialogueState();

/**
 * 向某个 NPC 提问，返回其回答。
 *
 * - 高教授 / 小远：固定好人，任务关键词命中的台词全部为真。
 * - 小林 / 阿泽 / 老张：身份随机。
 *   好人时始终说真话（真话池）；伪人时每次提问独立随机，20% 真话池 / 80% 假话池。
 */
export function askNpc(
    npcId: NpcId,
    isImpostor: boolean,
    question: string,
    state: DialogueState = fallbackState,
): NpcReply {
    const kind = classifyQuestion(question);
    const entry = DIALOGUE[npcId];

    if (kind === "casual") {
        return { text: pick(entry.good.casual), kind, lied: false, truth: true };
    }

    if (kind === "default") {
        return { text: entry.good.fallback, kind, lied: false, truth: true };
    }

    // kind === "task"
    const impostorPools = entry.impostor;
    if (!impostorPools) {
        // 固定好人（高教授 / 小远）：任务台词池天然为真
        const fixed = entry.good as DialoguePools;
        if (entry.taskPick === "cycle") {
            // 小远「固定全部真话」：按顺序轮转，问满一轮就能拿到全部证词
            const index = state.fixedTaskCursor % fixed.task.length;
            state.fixedTaskCursor += 1;
            return { text: fixed.task[index], kind, lied: false, truth: true };
        }
        return { text: pick(fixed.task), kind, lied: false, truth: true };
    }

    if (!isImpostor) {
        // 身份随机且当前为好人的 NPC：只说真话（其真话池）
        return { text: pick(impostorPools.truth), kind, lied: false, truth: true };
    }

    // 伪人：每次提问独立随机，20% 真话 / 80% 假话
    if (Math.random() < IMPOSTOR_TRUTH_CHANCE) {
        return { text: pick(impostorPools.truth), kind, lied: false, truth: true };
    }
    return { text: pick(impostorPools.lies), kind, lied: true, truth: false };
}
