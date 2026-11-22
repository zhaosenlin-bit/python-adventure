/**
 * 关键词证词 × 线索碎片 的交叉验证
 *
 * 硬性规则：只做确定性匹配，不做语义分析、不脑补。
 *  - 小远（百分百纯真话）与高教授（固定好人）说的任务台词全部为真，可以当作基准
 *  - 任何与基准冲突的线索碎片，都判定为伪人篡改伪造
 *  - 拿到「五条线索、三真两假」这条证词后，只要揪出两条伪造，其余线索就全是真的
 *
 * 于是玩家的推理链路是：触发任务关键词 → 拿到可信证词 → 与手上的碎片交叉 → 得出真伪。
 */

import { NPC_NAMES, type NpcId } from "./dialogue";

/** 一条可信断言 */
export type TrustClaim =
    /** 某个角色是不是伪人 */
    | { kind: "identity"; subject: NpcId; isImpostor: boolean }
    /** 队伍里确实存在伪人 */
    | { kind: "impostor-exists" }
    /** 存在被篡改的线索 */
    | { kind: "forged-exist" }
    /** 线索总数与其中伪造的数量 */
    | { kind: "clue-mix"; total: number; forged: number };

export interface TrustStatement {
    claim: TrustClaim;
    /** 证词来源（一定是固定好人） */
    source: NpcId;
    /** 证词原文 */
    quote: string;
}

interface TrustedQuote {
    source: NpcId;
    quote: string;
    claims: TrustClaim[];
}

/**
 * 可信证词表。
 *
 * 只有固定好人（高教授 / 小远）在命中任务关键词时说的台词算数，
 * 且台词原文一字不差地来自对话数据库，不做任何改写。
 */
export const TRUSTED_QUOTES: readonly TrustedQuote[] = [
    {
        source: "xiaoyuan",
        quote: "高教授和我，是确定的好人。",
        claims: [
            { kind: "identity", subject: "gao", isImpostor: false },
            { kind: "identity", subject: "xiaoyuan", isImpostor: false },
        ],
    },
    {
        source: "xiaoyuan",
        quote: "队伍里面藏着伪人，数量不固定。",
        claims: [{ kind: "impostor-exists" }],
    },
    {
        source: "xiaoyuan",
        quote: "古墓遗留线索一共五条，三真两假。",
        claims: [{ kind: "clue-mix", total: 5, forged: 2 }],
    },
    {
        source: "gao",
        quote: "队伍里有异常存在，但我不敢随意指认。",
        claims: [{ kind: "impostor-exists" }],
    },
    {
        source: "gao",
        quote: "古墓的线索被动过手脚，真假混杂。",
        claims: [{ kind: "forged-exist" }],
    },
];

/**
 * 线索碎片里对角色身份的指认。
 *
 * 真线索不对具体的人下断言，所以只有两条假线索有。
 */
export const CLUE_CLAIMS: Record<string, TrustClaim[]> = {
    // 笔记碎片2：伪人只有2个，高教授是伪人
    artifact: [{ kind: "identity", subject: "gao", isImpostor: true }],
    // 笔记碎片4：小远是伪人
    crevice: [{ kind: "identity", subject: "xiaoyuan", isImpostor: true }],
};

/** 从问答记录里抽取玩家已经拿到的可信证词 */
export function extractTrustStatements(
    logs: Record<string, { answer: string }[]>,
): TrustStatement[] {
    const statements: TrustStatement[] = [];
    for (const entry of TRUSTED_QUOTES) {
        const answers = logs[entry.source] ?? [];
        const heard = answers.some((item) => item.answer.includes(entry.quote));
        if (!heard) continue;
        for (const claim of entry.claims) {
            statements.push({ claim, source: entry.source, quote: entry.quote });
        }
    }
    return statements;
}

export type ClueVerdict = "genuine" | "forged" | "unverified";

export interface ClueAssessment {
    clueId: string;
    verdict: ClueVerdict;
    /** 判定依据 */
    reason: string;
}

/**
 * 交叉验证已拾取的线索。
 *
 * 判定顺序：
 *  1. 线索里的身份指认与可信证词冲突 → forged
 *  2. 已知「五条线索、三真两假」且已揪出足够多的伪造 → 其余全部 genuine
 *  3. 否则 → unverified（真伪待验证）
 */
export function assessClues(
    clueIds: string[],
    statements: TrustStatement[],
): ClueAssessment[] {
    const identities = statements.filter(
        (item): item is TrustStatement & { claim: { kind: "identity"; subject: NpcId; isImpostor: boolean } } =>
            item.claim.kind === "identity",
    );
    const mix = statements.find((item) => item.claim.kind === "clue-mix");

    const results: ClueAssessment[] = clueIds.map((clueId) => {
        const claims = CLUE_CLAIMS[clueId] ?? [];
        for (const claim of claims) {
            if (claim.kind !== "identity") continue;
            const conflict = identities.find(
                (item) =>
                    item.claim.subject === claim.subject &&
                    item.claim.isImpostor !== claim.isImpostor,
            );
            if (conflict) {
                return {
                    clueId,
                    verdict: "forged" as const,
                    reason: `与${NPC_NAMES[conflict.source]}的证词「${conflict.quote}」矛盾，判定为伪造`,
                };
            }
        }
        return {
            clueId,
            verdict: "unverified" as const,
            reason: "暂时没有与可信证词冲突的证据",
        };
    });

    if (mix && mix.claim.kind === "clue-mix") {
        const forgedCount = results.filter((item) => item.verdict === "forged").length;
        if (forgedCount >= mix.claim.forged) {
            for (const item of results) {
                if (item.verdict !== "unverified") continue;
                item.verdict = "genuine";
                item.reason = `已揪出 ${forgedCount} 条伪造，线索共 ${mix.claim.total} 条三真两假，其余即为真`;
            }
        }
    }

    return results;
}
