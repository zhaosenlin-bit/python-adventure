/**
 * 3D古墓剧本杀 · 线索编程关卡
 *
 * 每条线索都对应一道「藏宝机关」：必须写对一小段 Python 才能把线索挖出来。
 * 题目刻意做得很浅（填空 + 一行改动），但用的都是真知识点：
 * 循环计数、布尔运算、算术、成员判断、len()。
 *
 * initialCode 里用 ___ 表示要填的地方；solution 是填法的正确形态，
 * 供「Python 运行时不可用」时的简易校验兜底，免得玩家被卡死拿不到线索。
 *
 * 三档机关：第 1 档只要排对顺序，第 2 档要判断真假，第 3 档要数清循环。
 */

export const FORCE_OPEN_SECONDS = 25;
export const CHALLENGE_REWARD_SECONDS = 12;

export type ChallengeTier = 1 | 2 | 3;

export const TIER_LABELS: Record<ChallengeTier, string> = {
    1: "浅层机关 · 顺序与计数",
    2: "中层机关 · 真假与算术",
    3: "深层机关 · 名册与条件",
};

export interface ClueCodeChallenge {
    /** 对应的线索 id（与 CLUES 的 id 一致） */
    clueId: string;
    title: string;
    /** 机关剧情描述 + 任务要求 */
    description: string;
    /** 初始代码（Python） */
    initialCode: string;
    /** 期望的标准输出（trim 后逐字比较） */
    expectedOutput: string;
    /** 占位符的正确填法，简易校验模式用 */
    solution: string;
    /** 提示 */
    hint: string;
    /** 机关档位，越深越难 */
    tier: ChallengeTier;
    /** 简易校验时要命中的填法片段（会先去掉所有空白再比较） */
    fillChecks: string[];
}

export const CLUE_CHALLENGES: readonly ClueCodeChallenge[] = [
    {
        clueId: "mural",
        title: "壁画通道 · 数字机关",
        description:
            "壁画上刻着一排数字：伪人的数量在 2 到 4 之间（含两端）。用循环数一数这个区间里一共有多少个整数，把结果打印出来，机关就会松开。",
        initialCode: `low, high = 2, 4
count = 0
for n in range(low, high + 1):
    count += ___
print(count)`,
        expectedOutput: "3",
        solution: "1",
        hint: "每转一圈，count 就应该多记一个数，所以每次加 1。",
        tier: 1,
        fillChecks: ["count += 1"],
    },
    {
        clueId: "artifact",
        title: "文物存放台角落 · 断言机关",
        description:
            "这张纸条断言：「伪人只有 2 个，而且高教授是伪人」。高教授是队伍里公认的好人。把 gao_is_impostor 填对，再用 and 把两个条件合起来，判断这条断言是否成立。",
        initialCode: `impostor_count = 2
gao_is_impostor = ___
claim_holds = (impostor_count == 2) and gao_is_impostor
print(claim_holds)`,
        expectedOutput: "False",
        solution: "False",
        hint: "高教授是好人，所以 gao_is_impostor 要写成 False。",
        tier: 2,
        fillChecks: ["gao_is_impostor = False"],
    },
    {
        clueId: "rubble",
        title: "碎石隔间地面 · 概率机关",
        description:
            "地板下压着一条记录：伪人说话只有 20% 是真话，其余都是假话。算出假话占的比例，再判断它是不是比一半还大。",
        initialCode: `truth_rate = 0.2
lie_rate = 1 - ___
print(lie_rate > 0.5)`,
        expectedOutput: "True",
        solution: "truth_rate",
        hint: "假话比例 = 1 − 真话比例，所以这里要减去 truth_rate。",
        tier: 2,
        fillChecks: ["lie_rate = 1 - truth_rate"],
    },
    {
        clueId: "crevice",
        title: "暗室石缝 · 名册机关",
        description:
            "石缝里塞着一张名册，上面写着队伍里公认的好人。再加一句「小远是伪人」。用 in 判断小远到底在不在好人名单里。",
        initialCode: `good = ["gao", "xiaoyuan"]
claim_xiaoyuan_is_impostor = "xiaoyuan" ___ good
print(claim_xiaoyuan_is_impostor)`,
        expectedOutput: "False",
        solution: "not in",
        hint: "判断「不在名单里」要用 not in，而不是 in。",
        tier: 3,
        fillChecks: ['"xiaoyuan" not in good'],
    },
    {
        clueId: "gategap",
        title: "石门旁边夹缝 · 计数机关",
        description:
            "夹缝里的纸条写明：只要手上攒够 3 条线索，就足以分辨真话和假话。把已经挖到的线索编号放进列表，用 len() 看看够不够。",
        initialCode: `collected = ["mural", "rubble"]
enough = len(collected) >= ___
print(enough)`,
        expectedOutput: "True",
        solution: "3",
        hint: "纸条上写的门槛是 3 条线索。",
        tier: 3,
        fillChecks: ["enough = len(collected) >= 3"],
    },
];

const CHALLENGE_MAP = new Map(CLUE_CHALLENGES.map((item) => [item.clueId, item]));

/** 取某条线索对应的编程关卡 */
export function getCodeChallenge(clueId: string): ClueCodeChallenge | null {
    return CHALLENGE_MAP.get(clueId) ?? null;
}

/** 去掉所有空白，便于逐字比对填法 */
export function normalizeCode(code: string): string {
    return code.replace(/\s+/g, "");
}

/**
 * 简易校验：所有关键填法都出现在代码里才算通过。
 * 旧版只判断「代码里包含 1」这种子串，很容易被乱写蒙过去；
 * 现在逐条比对整行填法，既宽松又不可能靠一个数字混过去。
 */
export function checkSimpleSolution(code: string, challenge: ClueCodeChallenge): boolean {
    if (code.includes("___")) return false;
    const normalized = normalizeCode(code);
    return challenge.fillChecks.every((fragment) => normalized.includes(normalizeCode(fragment)));
}
