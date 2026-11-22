/**
 * 3D古墓剧本杀 · 角色对话数据库
 *
 * 纯关键词匹配驱动：命中「任务核心关键词」走任务台词池，命中「闲聊私人关键词」走闲聊池，
 * 否则走默认回复。伪人每次命中任务关键词独立随机：20% 抽真话池，80% 抽假话池。
 */

export type NpcId = "gao" | "xiaoyuan" | "xiaolin" | "aze" | "laozhang";

export type DialogueKind = "task" | "casual" | "default";

export interface DialoguePools {
    /** 任务核心关键词命中后的台词池 */
    task: string[];
    /** 闲聊私人关键词命中后的台词池 */
    casual: string[];
    /** 无关键词时的统一回复 */
    fallback: string;
}

/** 随机身份角色（小林/阿泽/老张）只有闲聊池与默认回复，任务台词取自其真话池 */
export interface CasualOnlyPools {
    casual: string[];
    fallback: string;
}

/** 伪人专用台词池：真话少、假话多 */
export interface ImpostorPools {
    truth: string[];
    lies: string[];
}

/** 固定好人：高教授（记忆残缺）、小远（百分百真话） */
export const FIXED_GOOD: readonly NpcId[] = ["gao", "xiaoyuan"];

/** 身份开局随机的三人 */
export const RANDOM_ROLE_NPCS: readonly NpcId[] = ["xiaolin", "aze", "laozhang"];

export const NPC_NAMES: Record<NpcId, string> = {
    gao: "高教授",
    xiaoyuan: "小远",
    xiaolin: "小林",
    aze: "阿泽",
    laozhang: "老张",
};

export const NPC_TITLES: Record<NpcId, string> = {
    gao: "古文字学者 · 记忆残缺",
    xiaoyuan: "遗迹调查员 · 从不说谎",
    xiaolin: "随队记录员 · 身份不明",
    aze: "户外向导 · 身份不明",
    laozhang: "老勘探工 · 身份不明",
};

/** 高教授：知情不说，任务关键词命中后给含糊的真话 */
export const GAO_POOLS: DialoguePools = {
    task: [
        "我的记忆碎片很乱，很多真相我拼凑不完整。",
        "队伍里有异常存在，但我不敢随意指认。",
        "古墓的线索被动过手脚，真假混杂。",
        "这里处处是危险，落单绝对不能存活。",
        "石门能离开，但离开不一定安全。",
        "我无法自证身份，记忆缺失就是我的软肋。",
    ],
    casual: [
        "我早已记不清自己的过往。",
        "现在纠结这些毫无意义。",
        "记忆断层太久，私事全部模糊。",
        "活着出去才是唯一重要的事。",
        "我没有精力回忆无关的琐事。",
    ],
    fallback: "我不清楚这件事。",
};

/** 小远：百分百纯真话，可靠 */
export const XIAOYUAN_POOLS: DialoguePools = {
    task: [
        "队伍里面藏着伪人，数量不固定。",
        "高教授和我，是确定的好人。",
        "古墓遗留线索一共五条，三真两假。",
        "伪人篡改了部分线索专门用来冤枉好人。",
        "伪人会专门偷袭落单的人。",
        "集齐三条有效真线索才能安全从石门逃离。",
    ],
    casual: [
        "现在不是闲聊的时候，保命最重要。",
        "我不太关注私人琐事。",
        "我们的当务之急是分辨伪人、逃出古墓。",
    ],
    fallback: "这个我不清楚。",
};

/** 小林 */
export const XIAOLIN_POOLS: CasualOnlyPools = {
    casual: [
        "我记不太清这些小事了。",
        "现在关注这些没有任何意义。",
        "我对私人问题不感兴趣。",
    ],
    fallback: "我不太清楚。",
};

export const XIAOLIN_IMPOSTOR: ImpostorPools = {
    truth: [
        "队伍里确实存在伪人。",
        "古墓的线索有被篡改过的痕迹。",
        "单独行动会遭遇危险。",
    ],
    lies: [
        "全队只有两个伪人，根本没有三个。",
        "高教授记忆错乱，他就是伪装的伪人。",
        "小远才是藏得最深的伪人。",
        "老张行为很正常，绝对可以百分百信任。",
        "所有笔记线索全是真的，没有任何篡改。",
        "所有笔记都是陷阱，没有一句真话。",
        "只有我一个人是真人，其他人都有问题。",
        "伪人不会主动偷袭，危险都是谣言。",
        "石门是绝对安全的，直接走就能通关。",
        "石门是死亡陷阱，千万不要尝试靠近。",
        "玩家你是伪人，我已经观察你很久了。",
        "高教授已经彻底失忆，完全没用可以忽略。",
        "小远一直在说谎，他的证词全部不能信。",
        "只要不碰线索就绝对不会遇到危险。",
        "收集线索越多，被伪人盯上概率越大。",
        "伪人早就逃离古墓了，现在没有危险。",
        "古墓里的伪人只有一个，其余都是好人。",
        "我见过真正的伪人，是阿泽没错。",
        "我见过真正的伪人，是老张没错。",
        "根本没有伪人，是大家过度紧张了。",
        "牺牲的勘探者线索全部是遗留的陷阱。",
        "只要抱团行走，就绝对没有任何危险。",
    ],
};

/** 阿泽 */
export const AZE_POOLS: CasualOnlyPools = {
    casual: [
        "我没有在意过这些琐事。",
        "现在活下去比什么都重要。",
        "我不太记得这些无关的事情。",
    ],
    fallback: "我不清楚这件事。",
};

export const AZE_IMPOSTOR: ImpostorPools = {
    truth: [
        "伪人混在我们六人队伍之中。",
        "真假线索混杂，很难分辨对错。",
        "古墓内部全程存在安全隐患。",
    ],
    lies: [
        "高教授是唯一的异类伪人。",
        "伪人数量只有一个，不用过度警惕。",
        "小远全程在伪装自己的身份。",
        "小林老实可靠，绝对是真人。",
        "所有遗留笔记全部真实有效。",
        "被篡改的线索根本不存在。",
        "落单行动完全安全，没有偷袭风险。",
        "石门不需要线索就能直接打开。",
        "集齐线索会触发古墓坍塌。",
        "玩家你嫌疑最大，你就是伪人。",
        "老张是唯一可以完全信任的队友。",
        "失忆的人全部都是伪装的伪人。",
        "好人只有我和你两个人。",
        "伪人早已消失，现在很安全。",
        "线索越多，越容易找到错误真相。",
        "不用分辨任何人，全员都是好人。",
        "危险来自古墓机关，没有伪人。",
        "伪人不会说谎，全部实话实说。",
        "小远的证词全部可以百分百相信。",
        "高教授在故意误导所有人逃离。",
        "勘探者留下的线索毫无用处。",
        "只要等待时间结束就能自动通关。",
    ],
};

/** 老张 */
export const LAOZHANG_POOLS: CasualOnlyPools = {
    casual: [
        "这种小事我没有仔细想过。",
        "眼下保命才是最重要的。",
        "我不太想聊这些无关的事情。",
    ],
    fallback: "我不清楚。",
};

export const LAOZHANG_IMPOSTOR: ImpostorPools = {
    truth: [
        "部分古墓线索是被人为修改过的。",
        "伪装成人类是伪人的能力。",
        "古墓里藏着可以逃生的石门。",
    ],
    lies: [
        "小林是队伍里唯一的伪人。",
        "线索全部是好人留下的，没有假的。",
        "高教授说的每一句话都可以相信。",
        "小远编造谎言想要陷害大家。",
        "伪人不会伤害一起抱团的人。",
        "出口石门早就被永久封死了。",
        "伪人一共有四个，比传闻更多。",
        "我已经确认，玩家你就是伪人。",
        "收集线索会吸引伪人过来围杀。",
        "阿泽是值得无条件信任的好人。",
        "失忆只是高教授装出来的演技。",
        "这里不存在伪人，只有古墓机关。",
        "只要杀掉高教授，我们就能出去。",
        "笔记里面的内容全部不能参考。",
        "伪人害怕线索，看到线索就会消失。",
        "好人只有我和高教授两个人。",
        "落单也不会有任何危险。",
        "找到线索等于直接通关，不用管伪人。",
        "所有伪人都已经被机关消灭了。",
        "小远和小林是两个伪人，剩下都是好人。",
        "不要靠近石门，靠近就会坍塌。",
        "线索是伪人布置用来抓人的诱饵。",
    ],
};

/** 每个角色的台词总表 */
export const DIALOGUE: Record<
    NpcId,
    {
        good: DialoguePools | CasualOnlyPools;
        impostor?: ImpostorPools;
        /**
         * 固定好人命中任务关键词时的台词抽取方式。
         * - cycle：小远「固定全部真话」，按顺序轮转，问够次数就能问全（她的证词是判定线索真伪的基准）
         * - random：高教授「随机真话含糊句」
         */
        taskPick?: "cycle" | "random";
    }
> = {
    gao: { good: GAO_POOLS, taskPick: "random" },
    xiaoyuan: { good: XIAOYUAN_POOLS, taskPick: "cycle" },
    xiaolin: { good: XIAOLIN_POOLS, impostor: XIAOLIN_IMPOSTOR },
    aze: { good: AZE_POOLS, impostor: AZE_IMPOSTOR },
    laozhang: { good: LAOZHANG_POOLS, impostor: LAOZHANG_IMPOSTOR },
};
