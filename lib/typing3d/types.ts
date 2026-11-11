/**
 * 3D 打字闯关（网页版）的公共类型。
 *
 * 玩法沿用桌面版 Ursina 的内核：探索 → 答题 → 开门 → 进入下一关。
 * 这里只放类型，逻辑都在同目录的其它文件里，方便单测。
 */

/** 题库分类：中文句段 / 英文词句 / 代码片段 / 符号练习。 */
export type Typing3DKind = "zh" | "en" | "code" | "sym";

/** 难度档：1 短、2 中、3 长。 */
export type Typing3DTier = 1 | 2 | 3;

/** 题库里的一条素材。 */
export interface Typing3DItem {
    text: string;
    kind: Typing3DKind;
    tier: Typing3DTier;
    /** 中文句段对应的拼音（音节之间用空格分隔），没有就为空。 */
    pinyin?: string;
}

/** 一天里的一关：一关一题。 */
export interface Typing3DQuestion {
    /** 从 0 开始的关卡序号。 */
    index: number;
    item: Typing3DItem;
}

/** 中文题的两种打法：直接打汉字，或者按拼音打。 */
export type Typing3DInputMode = "hanzi" | "pinyin";

/** 一个跑完的统计结果。 */
export interface Typing3DRunStats {
    solved: number;
    wrong: number;
    total: number;
    /** 总用时（毫秒）。 */
    elapsed: number;
    /** 打完的字数，用来算每分钟字符数。 */
    chars: number;
    bestCombo: number;
    combo: number;
}

export interface Vec2 {
    x: number;
    z: number;
}

/** 场景里的一个方块：墙、柱子、平台都用它。 */
export interface BoxSpec {
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
    kind: "wall" | "pillar" | "step";
}

/** 发光的答题面板。 */
export interface PanelSpec {
    x: number;
    z: number;
    /** 面朝方向（弧度，0 表示朝 +z）。 */
    rotation: number;
}

/** 关卡出口。 */
export interface DoorSpec {
    x: number;
    z: number;
    width: number;
    rotation: number;
}

/** A spawn point the player can pick before the run starts. */
export interface SpawnOption {
    /** Stable index inside LevelLayout.spawns. */
    id: number;
    /** Display name shown on the ground ring and in the picker. */
    name: string;
    x: number;
    z: number;
    /** Hex colour used by the ring, the light beam and the name label. */
    color: number;
}

/** 一个关卡的完整布局。 */
export interface LevelLayout {
    index: number;
    width: number;
    depth: number;
    spawn: Vec2;
    /** Spawn points the player can choose before the first level starts. */
    spawns: SpawnOption[];
    panels: PanelSpec[];
    door: DoorSpec;
    boxes: BoxSpec[];
    /** 每关换一点色调，避免 24 关长得一模一样。 */
    theme: {
        floor: number;
        wall: number;
        accent: number;
        glow: number;
        fog: number;
    };
}
