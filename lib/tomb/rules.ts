/**
 * 3D古墓剧本杀 · 线索、身份与结局判定
 *
 * 结局判定优先级从上到下，满足即触发，停止判断。
 */

import { FIXED_GOOD, NPC_NAMES, RANDOM_ROLE_NPCS, type NpcId } from "./dialogue";

export const GAME_DURATION_SECONDS = 4 * 60;

export interface ClueDefinition {
    id: string;
    /** 场景中的位置名 */
    location: string;
    /** 是否为真线索（三真两假） */
    genuine: boolean;
    /** 场景中的世界坐标（x, z） */
    position: [number, number];
    text: string;
}

export const CLUES: readonly ClueDefinition[] = [
    {
        id: "mural",
        location: "壁画通道",
        genuine: true,
        position: [-8.2, -2],
        text: "笔记碎片1：伪人一共有2~4人，有概率自己就是伪人。",
    },
    {
        id: "artifact",
        location: "文物存放台角落",
        genuine: false,
        position: [-6, 6],
        text: "笔记碎片2：伪人只有2个，高教授是伪人。",
    },
    {
        id: "rubble",
        location: "碎石隔间地面",
        genuine: true,
        position: [-5, -6],
        text: "笔记碎片3：伪人回答真真假假，混杂真话和谎言误导别人。",
    },
    {
        id: "crevice",
        location: "暗室石缝",
        genuine: false,
        position: [7, -6],
        text: "笔记碎片4：小远是伪人。",
    },
    {
        id: "gategap",
        location: "石门旁边夹缝",
        genuine: true,
        position: [3, 8.6],
        text: "笔记碎片5：集齐任意3条线索，你就有足够信息分辨谎言。",
    },
];

export const REQUIRED_CLUES = 3;

export type EndingId =
    | "purge"
    | "accomplice"
    | "collapse"
    | "prey"
    | "escape"
    | "trapped"
    /** 以下为石门表决带来的结局 */
    | "verdict"
    | "partial"
    | "mistrial"
    | "deadlock"
    | "exiled"
    | "exposed";

export interface EndingDefinition {
    id: EndingId;
    title: string;
    achievement: string;
    tone: "good" | "bad";
    text: string;
}

export const ENDINGS: Record<EndingId, EndingDefinition> = {
    purge: {
        id: "purge",
        title: "肃清伪人",
        achievement: "真相猎手",
        tone: "good",
        text: "你依靠收集到的线索分辨出伪装的伪人，将它们全部肃清。高教授和小远平安无事，你们守住古墓，真相得以留存。",
    },
    accomplice: {
        id: "accomplice",
        title: "同谋屠戮",
        achievement: "共犯",
        tone: "bad",
        text: "你认清了自己的身份，和其余伪人联手，将所有好人清除，古墓再无活人。",
    },
    collapse: {
        id: "collapse",
        title: "自我崩坏",
        achievement: "失智",
        tone: "bad",
        text: "你拼凑线索，惊恐地发现自己就是伪人。认知彻底崩塌，你在黑暗之中疯狂，永远困在古墓。",
    },
    prey: {
        id: "prey",
        title: "被伪人清除",
        achievement: "猎物",
        tone: "bad",
        text: "伪人识破了你，你来不及反应，被伪人清除。",
    },
    escape: {
        id: "escape",
        title: "线索逃生",
        achievement: "逃出生天",
        tone: "good",
        text: "你找到了足够线索，解锁石门机关，带着幸存同伴从古墓成功逃离。",
    },
    trapped: {
        id: "trapped",
        title: "困死古墓",
        achievement: "迷失者",
        tone: "bad",
        text: "你没能搜集足够线索打开出口，古墓通道彻底封死，你永远被困在了这片黑暗之中。",
    },
    // ---------------------------------------------------------- 石门表决结局
    verdict: {
        id: "verdict",
        title: "石门审判",
        achievement: "审判者",
        tone: "good",
        text: "你在石门前亮出所有证据，最后一个伪人被全票指认。门轴转动的那一刻，六盏长明灯同时熄灭——像是有人终于肯闭上眼。你们走出去，身后只留下他的名字。",
    },
    partial: {
        id: "partial",
        title: "漏网的同类",
        achievement: "漏网",
        tone: "bad",
        text: "石门前处决了一个伪人，可你心里清楚，队伍里还有不肯露面的同伙。门开了，你们互相搀扶着走出去，没有人回头——因为回头就会看见谁在笑。",
    },
    mistrial: {
        id: "mistrial",
        title: "错杀同伴",
        achievement: "刀口向内",
        tone: "bad",
        text: "被票出的是好人。他倒下时还在解释，而真正的伪人就站在人群里，跟着一起叹气。石门开了，可走出去的人少了一个，也少了一份信任。",
    },
    deadlock: {
        id: "deadlock",
        title: "僵局",
        achievement: "僵持",
        tone: "bad",
        text: "票数咬死，谁也不肯让步。争执声在墓道里回荡，石门在没有结论的沉默中彻底闭合。",
    },
    exiled: {
        id: "exiled",
        title: "被同伴放逐",
        achievement: "替罪者",
        tone: "bad",
        text: "你成了票数最高的那个。你喊着自己的清白，可没有人再听——石门在你面前关上，你被留在了黑暗里。",
    },
    exposed: {
        id: "exposed",
        title: "身份败露",
        achievement: "现形",
        tone: "bad",
        text: "你以为自己藏得很好。可表决时，所有人几乎同时念出了你的名字。石门开了一条缝，你看见外面的光——然后门关上了。",
    },
};

export interface TombState {
    /** 玩家真实身份：true = 伪人 */
    playerIsImpostor: boolean;
    /** 伪人 NPC 列表 */
    impostorIds: NpcId[];
    /** 所有被击杀的 NPC */
    deadNpcs: NpcId[];
    /** 由玩家亲手击杀的 NPC（结局一要求伪人全部死于玩家之手） */
    playerKills: NpcId[];
    /** 已拾取的线索 id */
    clueIds: string[];
    /** 玩家是否被伪人袭击命中 */
    attackedByImpostor: boolean;
    /** 玩家是否进入石门出口区域 */
    reachedGate: boolean;
    /** 玩家身份是否已通过线索揭晓 */
    identityRevealed: boolean;
    /** 靠蛮力撬开机关拿到的线索（没有真正解开，表决时不能当证据用） */
    forcedClueIds?: string[];
}

function isDead(state: TombState, id: NpcId): boolean {
    return state.deadNpcs.includes(id);
}

/** 除玩家之外的好人 NPC（高教授、小远 + 随机三人中的好人） */
export function goodNpcIds(state: TombState): NpcId[] {
    return [...FIXED_GOOD, ...RANDOM_ROLE_NPCS.filter((id) => !state.impostorIds.includes(id))];
}

function shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

export function createInitialState(): TombState {
    const playerIsImpostor = Math.random() < 0.5;

    // 伪人总数 2~4 名（含玩家时）。小林/阿泽/老张共 3 人可伪装，
    // 因此玩家为好人时伪人总数上限为 3，玩家为伪人时为 1~3 名 NPC 伪人。
    let impostorIds: NpcId[];
    if (playerIsImpostor) {
        const npcImpostorCount = 1 + Math.floor(Math.random() * 3); // 1~3
        impostorIds = shuffle(RANDOM_ROLE_NPCS).slice(0, npcImpostorCount);
    } else {
        const npcImpostorCount = 2 + Math.floor(Math.random() * 2); // 2~3
        impostorIds = shuffle(RANDOM_ROLE_NPCS).slice(0, npcImpostorCount);
    }

    return {
        playerIsImpostor,
        impostorIds,
        deadNpcs: [],
        playerKills: [],
        clueIds: [],
        attackedByImpostor: false,
        reachedGate: false,
        identityRevealed: false,
    };
}

/**
 * 结局判定。返回 null 表示尚未触发任何结局。
 * 优先级：1 肃清伪人 > 2 同谋屠戮 > 3 自我崩坏 > 4 被伪人清除 > 5 线索逃生 > 6 困死古墓
 *
 * 注意：走到石门的正常路径现在会先进入「石门表决」（见 vote.ts），
 * 这里的 escape 只留给"队伍里已经没有伪人、门自己开了"的收尾情形。
 */
export function evaluateEnding(state: TombState, timedOut: boolean): EndingId | null {
    const clueCount = state.clueIds.length;
    const allImpostorsDead = state.impostorIds.every((id) => isDead(state, id));
    const allImpostorsKilledByPlayer = state.impostorIds.every((id) => state.playerKills.includes(id));
    const fixedGoodAlive = FIXED_GOOD.every((id) => !isDead(state, id));
    const fixedGoodDead = FIXED_GOOD.every((id) => isDead(state, id));
    const goodNpcs = goodNpcIds(state);
    const allGoodDead = goodNpcs.every((id) => isDead(state, id));

    // 优先级 1：隐藏结局【肃清伪人】
    if (!state.playerIsImpostor && clueCount >= REQUIRED_CLUES && allImpostorsKilledByPlayer && fixedGoodAlive) {
        return "purge";
    }

    // 优先级 2：伪人结局【同谋屠戮】
    if (state.playerIsImpostor && fixedGoodDead) {
        return "accomplice";
    }

    // 优先级 3：伪人结局【自我崩坏】
    // 集齐线索知道自己是伪人后，要么赶在计时结束前走到石门表决，要么在黑暗里崩掉
    if (state.playerIsImpostor && clueCount >= REQUIRED_CLUES && timedOut && !allGoodDead) {
        return "collapse";
    }

    // 优先级 4：坏结局【被伪人清除】
    if (!state.playerIsImpostor && state.attackedByImpostor) {
        return "prey";
    }

    // 优先级 5：好结局【线索逃生】——队里已经没有伪人，石门不必再表决
    if (!state.playerIsImpostor && clueCount >= REQUIRED_CLUES && state.reachedGate && allImpostorsDead) {
        return "escape";
    }

    // 优先级 6：兜底坏结局【困死古墓】
    if (timedOut) {
        return "trapped";
    }

    return null;
}

/** 结算时的身份揭示文案 */
export function identityRevealText(state: TombState): string {
    if (state.playerIsImpostor) {
        return "你终于看清了——队伍里的异常就是你自己。你是伪人。";
    }
    return "笔记碎片指向了唯一的结论：队伍里的异常并不包含你。你是好人。";
}

export function npcName(id: NpcId): string {
    return NPC_NAMES[id];
}

