/**
 * 石门表决 · 投票模型
 *
 * 单人局里的"投票"由两方合起来完成：
 *  1. 玩家自己的一票 —— 权重取决于呈堂线索的真伪（真证据有分量，假证据会反噬）；
 *  2. 五个 NPC 各自的票 —— 由「性格偏差 + 行为证据」决定。
 *
 * 伪人之间有同类直觉：不会互投，还会把票集中甩到同一个好人身上（剧本杀里最常见的抱团甩票）。
 * 好人只看得见名字、行为和自己的成见，所以票会散，玩家的加权票才能把局面拉回来。
 *
 * 整个模型确定性：种子由局面状态哈希得出，同一局面反复推演结果一致，
 * 既方便单测，也方便投票前给玩家做「风向」预告。
 */

import { FIXED_GOOD, NPC_NAMES, type NpcId } from "./dialogue";
import type { ClueVerdict } from "./deduction";
import type { EndingId, TombState } from "./rules";

export type VoteTarget = NpcId | "player";
export type PlayerBallot = VoteTarget | "abstain";

/** 表决席次顺序，也是揭票顺序 */
export const NPC_VOTE_ORDER: readonly NpcId[] = ["gao", "xiaoyuan", "xiaolin", "aze", "laozhang"];

/** 最多能呈堂几条线索 */
export const CITATION_LIMIT = 2;
/** 一条已验证线索给玩家票加的权重 */
export const GENUINE_CITATION_BONUS = 0.5;
/** 一条被证伪的线索扣掉的权重 */
export const FORGED_CITATION_PENALTY = 0.5;
/** 每呈堂一条被证伪的线索，别人对玩家的额外怀疑 */
export const FORGED_BETRAYAL_SUSPICION = 1.2;
/** 玩家每亲手杀一人，别人对他多一分怀疑 */
export const KILL_SUSPICION = 0.9;
/** 固定好人的名声能压掉一部分怀疑 */
export const FIXED_GOOD_TRUST = 1.1;
/** 伪人绝不互投（同类直觉） */
const KIN_LOOPHOLE = -3.2;

/* ------------------------------------------------------------------ 随机 */

function hashString(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 局面哈希成种子：同一局反复推演，票型一致 */
export function voteSeed(state: TombState): number {
    return hashString(
        [
            state.playerIsImpostor ? "I" : "G",
            state.impostorIds.join("-"),
            state.deadNpcs.join("-"),
            state.playerKills.join("-"),
            state.clueIds.join("-"),
        ].join("|"),
    );
}

/* ---------------------------------------------------------------- 人物性格 */

type PersonalityRow = Record<string, number>;

function buildPersonality(state: TombState, rand: () => number): Record<string, PersonalityRow> {
    const living = livingNpcIds(state);
    const targets: VoteTarget[] = [...living, "player"];
    const rows: Record<string, PersonalityRow> = {};
    for (const voter of living) {
        // 高教授记忆残缺，偏见最重也最飘；小远从不说谎，判断最稳
        const amplitude = voter === "gao" ? 1.7 : voter === "xiaoyuan" ? 0.9 : 1.35;
        const row: PersonalityRow = {};
        for (const target of targets) {
            row[target] = rand() * amplitude;
        }
        rows[voter] = row;
    }
    return rows;
}

export function livingNpcIds(state: TombState): NpcId[] {
    return NPC_VOTE_ORDER.filter((id) => !state.deadNpcs.includes(id));
}

function isImpostorTarget(state: TombState, target: VoteTarget): boolean {
    if (target === "player") return state.playerIsImpostor;
    return state.impostorIds.includes(target);
}

export function voteTargetName(target: VoteTarget): string {
    return target === "player" ? "你" : NPC_NAMES[target];
}

/* ---------------------------------------------------------------- 怀疑分 */

interface SuspicionArgs {
    state: TombState;
    voter: NpcId;
    target: VoteTarget;
    personality: Record<string, PersonalityRow>;
    playerBetrayed: boolean;
}

function suspicionOf({ state, voter, target, personality, playerBetrayed }: SuspicionArgs): number {
    const base = personality[voter]?.[target] ?? 0;
    const voterIsImpostor = state.impostorIds.includes(voter);

    if (voterIsImpostor) {
        // 同类不投；其余人里，谁看起来最好推就投谁
        if (isImpostorTarget(state, target)) return KIN_LOOPHOLE + base * 0.2;
        let score = base + 0.35;
        if (target === "player") score += KILL_SUSPICION * state.playerKills.length;
        return score;
    }

    let score = base;
    if (target === "player") {
        // 玩家动过手这件事，全队都看在眼里
        score += KILL_SUSPICION * state.playerKills.length;
        if (playerBetrayed) score += FORGED_BETRAYAL_SUSPICION;
    } else if (FIXED_GOOD.includes(target as NpcId)) {
        // 小远公开说过「高教授和我是确定的好人」，好人内部按这条基准行事
        score -= FIXED_GOOD_TRUST;
    }
    return score;
}

function pickTop(
    rand: () => number,
    candidates: VoteTarget[],
    scoreOf: (target: VoteTarget) => number,
): VoteTarget {
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const candidate of candidates) {
        // 一点抖动，避免同一局面下所有人的票完美对齐
        const score = scoreOf(candidate) + rand() * 0.25;
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best;
}

/**
 * 伪人的共同靶子：所有活着的伪人先"商量"一次，
 * 挑一个平均怀疑分最高的好人下手，这样票才不会散。
 */
function impostorBlocTarget(
    state: TombState,
    personality: Record<string, PersonalityRow>,
    rand: () => number,
): VoteTarget | null {
    const impostorVoters = livingNpcIds(state).filter((id) => state.impostorIds.includes(id));
    if (impostorVoters.length === 0) return null;

    const targets: VoteTarget[] = livingNpcIds(state).filter(
        (id) => !state.impostorIds.includes(id),
    );
    // 玩家动过手才有甩票的价值；玩家自己是伪人时，同类不会投他
    if (!state.playerIsImpostor && state.playerKills.length > 0) targets.push("player");
    if (targets.length === 0) return null;

    let best: VoteTarget = targets[0];
    let bestScore = -Infinity;
    for (const target of targets) {
        const total = impostorVoters.reduce(
            (sum, voter) => sum + suspicionOf({ state, voter, target, personality, playerBetrayed: false }),
            0,
        );
        const score = total + rand() * 0.2;
        if (score > bestScore) {
            bestScore = score;
            best = target;
        }
    }
    return best;
}

/* ------------------------------------------------------------------ 台词 */

const GOOD_LINES = [
    "从头到尾，你都在躲着我们。",
    "你说话的时候，眼睛一直在看别处。",
    "落单的时候，只有你不在队伍里。",
    "我不信你，就这么简单。",
];

const GOOD_KILL_LINES = [
    "你手上沾着血，别靠近我。",
    "我亲眼看见你动手了。",
    "死人不会替你说话，可大家都记得。",
];

const IMPOSTOR_LINES = [
    "我一直在观察你，你的破绽太多了。",
    "别装了，你的手在抖。",
    "我知道你是什么东西。",
    "把你留在门外，大家都安全。",
];

function voteLine(args: {
    rand: () => number;
    state: TombState;
    voter: NpcId;
    target: VoteTarget;
}): string {
    const { rand, state, voter, target } = args;
    const pool = state.impostorIds.includes(voter)
        ? IMPOSTOR_LINES
        : target === "player" && state.playerKills.length > 0
          ? GOOD_KILL_LINES
          : GOOD_LINES;
    return pool[Math.floor(rand() * pool.length) % pool.length];
}

/* ------------------------------------------------------------------ 投票 */

export interface CitationInput {
    clueId: string;
    verdict: ClueVerdict;
}

export interface VoteRecord {
    voter: VoteTarget;
    target: VoteTarget;
    /** 这一票的分量（NPC 恒为 1，玩家可能是 0.5~2） */
    weight: number;
    /** 投票人的原话 */
    line: string;
}

export interface VoteTally {
    target: VoteTarget;
    score: number;
    ballots: number;
}

export interface VoteResult {
    records: VoteRecord[];
    tallies: VoteTally[];
    /** 被票出的人；null 表示僵局 */
    condemned: VoteTarget | null;
    tieAtTop: boolean;
    playerBallot: PlayerBallot;
    playerWeight: number;
    /** 给玩家看的证据说明 */
    note: string;
}

/** 玩家一票的分量：真证据加分，假证据减分，最低 0.5 */
export function playerVoteWeight(citations: CitationInput[]): number {
    let weight = 1;
    for (const citation of citations.slice(0, CITATION_LIMIT)) {
        if (citation.verdict === "genuine") weight += GENUINE_CITATION_BONUS;
        else if (citation.verdict === "forged") weight -= FORGED_CITATION_PENALTY;
    }
    return Math.max(0.5, Math.round(weight * 100) / 100);
}

export interface CastVoteArgs {
    state: TombState;
    playerBallot: PlayerBallot;
    citations?: CitationInput[];
    /** 覆盖种子（测试用） */
    seed?: number;
}

export function castVotes({
    state,
    playerBallot,
    citations = [],
    seed,
}: CastVoteArgs): VoteResult {
    const rand = mulberry32(seed ?? voteSeed(state));
    const personality = buildPersonality(state, rand);
    const living = livingNpcIds(state);
    const playerBetrayed = citations.some((citation) => citation.verdict === "forged");
    const playerWeight = playerBallot === "abstain" ? 0 : playerVoteWeight(citations);

    const blocTarget = impostorBlocTarget(state, personality, rand);

    const records: VoteRecord[] = [];
    for (const voter of living) {
        const candidates = [...living.filter((id) => id !== voter), "player" as VoteTarget];
        let target: VoteTarget | null;

        if (state.impostorIds.includes(voter)) {
            target = blocTarget ?? pickTop(rand, candidates, (item) => suspicionOf({
                state,
                voter,
                target: item,
                personality,
                playerBetrayed,
            }));
        } else {
            target = pickTop(rand, candidates, (item) => suspicionOf({
                state,
                voter,
                target: item,
                personality,
                playerBetrayed,
            }));
        }

        if (!target) continue;
        records.push({
            voter,
            target,
            weight: 1,
            line: voteLine({ rand, state, voter, target }),
        });
    }

    // 玩家的票永远最后揭晓
    if (playerBallot !== "abstain") {
        records.push({
            voter: "player",
            target: playerBallot,
            weight: playerWeight,
            line:
                playerWeight >= 1.5
                    ? "我把证据摆在石门前：是他。"
                    : playerWeight < 1
                      ? "……我指认他。"
                      : "是他。",
        });
    }

    const tallies = tallyVotes(records);
    const top = tallies[0];
    const tied = tallies.filter((item) => Math.abs(item.score - (top?.score ?? 0)) < 0.011);

    let condemned: VoteTarget | null = null;
    if (top && tied.length === 1) {
        condemned = top.target;
    } else if (playerBallot !== "abstain" && tied.some((item) => item.target === playerBallot)) {
        // 平票时，玩家那一票就是决断（毕竟只有他拿得出证据）
        condemned = playerBallot;
    }

    const genuineCount = citations.filter((item) => item.verdict === "genuine").length;
    const forgedCount = citations.filter((item) => item.verdict === "forged").length;
    let note: string;
    if (playerBallot === "abstain") {
        note = "你放弃了表决。石门只记录票数，不记录沉默。";
    } else if (forgedCount > 0) {
        note = `你出示了 ${forgedCount} 条被证伪的线索——这反而把怀疑引到了自己身上（票重 ${playerWeight}）。`;
    } else if (genuineCount > 0) {
        note = `你出示了 ${genuineCount} 条已验证线索，众人不得不听你说完（票重 ${playerWeight}）。`;
    } else if (citations.length > 0) {
        note = `你呈堂的 ${citations.length} 条线索都还没验证，没有人愿意替你背书（票重 ${playerWeight}）。`;
    } else {
        note = `你手里没有任何证据，只说了一句「是他」（票重 ${playerWeight}）。`;
    }

    return {
        records,
        tallies,
        condemned,
        tieAtTop: tied.length > 1,
        playerBallot,
        playerWeight,
        note,
    };
}

function tallyVotes(records: VoteRecord[]): VoteTally[] {
    const map = new Map<VoteTarget, VoteTally>();
    for (const record of records) {
        const entry = map.get(record.target) ?? { target: record.target, score: 0, ballots: 0 };
        entry.score += record.weight;
        entry.ballots += 1;
        map.set(record.target, entry);
    }
    return [...map.values()].sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.011) return b.score - a.score;
        return b.ballots - a.ballots;
    });
}

/** 投票前的风向：每个活着的 NPC 现在最怀疑谁（不含玩家呈堂证据的影响） */
export interface SentimentEntry {
    voter: NpcId;
    target: VoteTarget;
}

export function previewSentiment(state: TombState, seed?: number): SentimentEntry[] {
    const rand = mulberry32(seed ?? voteSeed(state));
    const personality = buildPersonality(state, rand);
    const living = livingNpcIds(state);
    return living.map((voter) => {
        const candidates = [...living.filter((id) => id !== voter), "player" as VoteTarget];
        const target = pickTop(rand, candidates, (item) =>
            suspicionOf({ state, voter, target: item, personality, playerBetrayed: false }),
        );
        return { voter, target };
    });
}

/* ------------------------------------------------------------------ 结局 */

/** 表决结果落到哪个结局 */
export function voteEnding(state: TombState, result: VoteResult): EndingId {
    if (!result.condemned) return "deadlock";

    if (result.condemned === "player") {
        return state.playerIsImpostor ? "exposed" : "exiled";
    }

    if (!state.impostorIds.includes(result.condemned)) {
        return "mistrial";
    }

    const remaining = state.impostorIds.filter(
        (id) => id !== result.condemned && !state.deadNpcs.includes(id),
    );
    if (remaining.length > 0) return "partial";
    // 玩家自己就是伪人时，队伍"干净"了，可你还站着——这不算肃清
    return state.playerIsImpostor ? "partial" : "verdict";
}
