/**
 * 古墓场景布局。
 *
 * 坐标：Y 轴向上，单位为米；地板贴图顶面在 y = FLOOR_TOP。
 * 房间内部范围 x ∈ [-10, 10]，z ∈ [-10, 10]（20m × 20m 方形墓室），
 * 石门位于 +Z 方向（北墙正中）。
 */

import { CLUES } from "@/lib/tomb/rules";
import type { NpcId } from "@/lib/tomb/dialogue";

/** 地板顶面高度 */
export const FLOOR_TOP = 0.05;
/** 墙体内边界 */
export const ROOM_HALF = 10;
/** 墙体模块厚度 */
export const WALL_THICKNESS = 0.4;
/** 墙体高度 */
export const WALL_HEIGHT = 3;
/** 石门（出口）碰撞区 */
export const GATE_POSITION: [number, number] = [0, 9.1];
export const GATE_RADIUS = 2.2;

export type AssetKey =
    | "flagstoneFloorTile"
    | "drainGrateTile"
    | "dungeonWallModule"
    | "burialNicheWall"
    | "barredPortcullis"
    | "barredCellDoor"
    | "ironBoundDoor"
    | "stoneSarcophagus"
    | "tombSlab"
    | "carvedKnightEffigy"
    | "standingKnightStatue"
    | "timberTrestleTable"
    | "scrollRack"
    | "funeraryUrn"
    | "clayStoragePot"
    | "fallenAshlarBlock"
    | "boneScatter"
    | "trapdoorPit"
    | "rootIntrusion"
    | "glowingRuneStone"
    | "carvedGraveStele"
    | "standingBrazier"
    | "wallTorchBracket"
    | "candleSpikeCluster"
    | "ironChandelier"
    | "standingWaterPool"
    | "mossPatch"
    | "cobwebDrape"
    | "strawPile"
    | "ossuarySkullShelf"
    | "armourStand"
    | "weaponRack"
    | "oakBarrel"
    | "timberCrate"
    | "ironBandedStrongbox"
    | "jewelledDagger"
    | "potionBottle"
    | "goblet"
    | "wallManacleFitting"
    | "stoneAltar"
    | "dungeonRat"
    | "shamblingGhoul"
    | "greatHelm"
    | "heaterShield"
    | "armingSword"
    | "goldIngot"
    | "looseFacetedGem";

export interface PropSpec {
    key: string;
    asset: AssetKey;
    /** 世界坐标 x, y, z */
    position: [number, number, number];
    /** 绕 Y 轴旋转（弧度） */
    rotationY?: number;
    params?: Record<string, unknown>;
    /** 是否参与碰撞 */
    solid?: boolean;
    /** 圆形碰撞半径（优先于自动包围盒） */
    radius?: number;
}

/** 全场景统一的破坏度与色调（kit 的 scene_wide_knobs） */
export const SCENE_KNOBS = { ruin: 0.55, tone: 0.42 } as const;

/**
 * 地砖配色。
 *
 * 素材自带一套「湿陷石板（wet flag）」——整块砖里最低的一块、颜色最暗。
 * 默认值接近纯黑（#414349），在本作这种暗调墓室里会被渲染成一个个"地面黑洞"，
 * 看上去像贴图破洞而不是石头。这里整体抬亮一档并压缩明度差：
 * 湿陷石板仍然是最深的一块，但读起来是"积水的暗石"，不是"缺失的一块地砖"。
 */
export const FLOOR_PALETTE = {
    flag: "#9aa0a6",
    slab: "#6d7178",
    grit: "#7c6350",
    wet: "#5b6068",
} as const;

/**
 * 地砖铺装方案。
 *
 * 素材的分割纹理由 (flags, bond) 共同决定（同参数必然得到同一张图），
 * 所以这里准备多套方案按位置分配，避免整间墓室的地板长成一个样。
 */
export const FLOOR_SCHEMES = [
    { flags: 7, bond: "random-ashlar" },
    { flags: 9, bond: "random-ashlar" },
    { flags: 11, bond: "coursed" },
    { flags: 8, bond: "coursed" },
    { flags: 13, bond: "random-ashlar" },
    { flags: 12, bond: "coursed" },
] as const;

/** 位置哈希：给每块地砖一个稳定的伪随机数，让铺装图案看起来随机但可复现 */
export function floorHash(x: number, z: number) {
    const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return value - Math.floor(value);
}

/** 取某块地砖的铺装方案与色调偏移 */
export function floorSchemeAt(x: number, z: number) {
    const hash = floorHash(x, z);
    const scheme = FLOOR_SCHEMES[Math.floor(hash * FLOOR_SCHEMES.length) % FLOOR_SCHEMES.length];
    return {
        ...scheme,
        ruin: 0.34 + floorHash(z, x) * 0.2,
        tone: 0.34 + hash * 0.24,
    };
}

const P = (key: string, asset: AssetKey, x: number, z: number, extra: Partial<PropSpec> = {}): PropSpec => ({
    key,
    asset,
    position: [x, FLOOR_TOP, z],
    ...extra,
});

/** 静态道具（含其碰撞体） */
export const PROPS: PropSpec[] = [
    // —— 中央祭坛与吊灯 ——
    P("altar", "stoneAltar", 0, 0, {
        params: { colorway: "crypt-granite", carving: "skull", bays: 3 },
        radius: 1.1,
    }),
    P("altar-candles", "candleSpikeCluster", -0.42, -0.12, {
        position: [-0.42, FLOOR_TOP + 0.98, -0.12],
        params: { colorway: "rusted-crypt", state: "fresh", candles: 8 },
        solid: false,
    }),
    P("altar-potion", "potionBottle", 0.36, 0.16, {
        position: [0.36, FLOOR_TOP + 0.98, 0.16],
        params: { colorway: "apothecary-green", fill: "half" },
        solid: false,
    }),
    P("altar-ingot", "goldIngot", 0.12, 0.44, {
        position: [0.12, FLOOR_TOP + 0.98, 0.44],
        params: { colorway: "gold" },
        solid: false,
    }),
    P("altar-gem", "looseFacetedGem", 0.42, 0.42, {
        position: [0.42, FLOOR_TOP + 0.98, 0.42],
        solid: false,
    }),
    P("chandelier", "ironChandelier", 0, 0, { solid: false }),

    // —— 四角火盆（主要光源）——
    P("brazier-nw", "standingBrazier", -6.5, -6.5, {
        params: { colorway: "rusted-crypt", state: "flame", coals: 8 },
        radius: 0.6,
    }),
    P("brazier-ne", "standingBrazier", 6.5, -6.5, {
        params: { colorway: "rusted-crypt", state: "flame", coals: 8 },
        radius: 0.6,
    }),
    P("brazier-sw", "standingBrazier", -6.5, 6.5, {
        params: { colorway: "rusted-crypt", state: "flame", coals: 8 },
        radius: 0.6,
    }),
    P("brazier-se", "standingBrazier", 6.5, 6.5, {
        params: { colorway: "rusted-crypt", state: "flame", coals: 8 },
        radius: 0.6,
    }),

    // —— 石门与两侧守卫 ——
    P("gate", "barredPortcullis", 0, 10.2, {
        position: [0, FLOOR_TOP, 10.2],
        params: { colorway: "oiled-iron", height: "dropped", bars: 8 },
        solid: false,
    }),
    P("gate-statue-l", "standingKnightStatue", -2.9, 9.1, {
        params: { colorway: "weathered-limestone", bulk: 1 },
        radius: 0.75,
    }),
    P("gate-statue-r", "standingKnightStatue", 2.9, 9.1, {
        params: { colorway: "weathered-limestone", bulk: 1 },
        radius: 0.75,
    }),
    P("gate-sarcophagus", "stoneSarcophagus", 4.8, 8.1, {
        params: { colorway: "crypt-granite", lidState: "ajar" },
        radius: 1.15,
    }),
    P("gate-dagger", "jewelledDagger", 3.2, 7.4, {
        params: { colorway: "gold" },
        solid: false,
    }),

    // —— 壁画通道（线索一）——
    P("mural-stele", "carvedGraveStele", -9.1, -3.6, {
        params: { colorway: "crypt-granite", condition: "weathered", lean: 8 },
        radius: 0.5,
    }),
    P("mural-wall-rune", "glowingRuneStone", -9.85, -2, {
        position: [-9.85, FLOOR_TOP, -2],
        params: { colorway: "crypt-granite", hue: "cyan-ward", glow: "dead", piece: "wall-block", rune: "algiz" },
        solid: false,
    }),

    // —— 文物存放台角落（线索二）——
    P("artifact-table", "timberTrestleTable", -6.8, 6.8, {
        params: { colorway: "bleached-crypt", piece: "table" },
        radius: 1,
    }),
    P("artifact-goblet", "goblet", -6.6, 6.7, {
        position: [-6.6, FLOOR_TOP + 0.76, 6.7],
        params: { colorway: "crypt-verdigris", gems: "encrusted" },
        solid: false,
    }),
    P("artifact-scrollrack", "scrollRack", -8.6, 5.6, {
        params: { colorway: "damp-crypt", rows: 5 },
        radius: 0.9,
    }),
    P("artifact-urn", "funeraryUrn", -7.6, 7.8, {
        params: { colorway: "limestone", state: "sealed" },
        radius: 0.3,
    }),
    P("artifact-pot", "clayStoragePot", -8.8, 7.9, {
        params: { colorway: "smoke-blackened", state: "tipped" },
        radius: 0.32,
    }),
    P("artifact-strongbox", "ironBandedStrongbox", -8.9, 4.4, {
        params: { colorway: "oiled-iron" },
        radius: 0.6,
    }),
    P("artifact-crates", "timberCrate", -9.1, 3.4, {
        params: { colorway: "oak", lid: "shut" },
        radius: 0.5,
    }),

    // —— 碎石隔间（线索三）——
    P("rubble-ashlar-1", "fallenAshlarBlock", -5.9, -6.3, {
        params: { colorway: "crypt-granite", variant: 2 },
        radius: 0.45,
    }),
    P("rubble-ashlar-2", "fallenAshlarBlock", -4.9, -6.9, {
        params: { colorway: "crypt-granite", variant: 4, length: 0.85 },
        radius: 0.45,
    }),
    P("rubble-ashlar-3", "fallenAshlarBlock", -6.3, -5.7, {
        params: { colorway: "wet-granite", variant: 1 },
        radius: 0.45,
    }),
    P("rubble-bones", "boneScatter", -4.5, -5.4, {
        params: { colorway: "earth-stained", piece: "full", count: 6 },
        solid: false,
    }),

    // —— 暗室石缝（线索四）——
    P("crevice-root", "rootIntrusion", 7.5, -6.5, {
        params: { colorway: "crypt-oak", state: "live", size: 0.9 },
        radius: 0.8,
    }),
    P("crevice-grate", "drainGrateTile", 6.1, -7.3, {
        params: { colorway: "flooded-black", state: "lifted" },
        radius: 1,
    }),
    P("crevice-pit", "trapdoorPit", 8.4, -8.6, {
        params: { colorway: "crypt-granite", lid: "ajar", depth: 4 },
        radius: 1.2,
    }),

    // —— 其余陈设 ——
    P("tomb-slab", "tombSlab", -2.6, 5.4, {
        params: { colorway: "grey-granite", carving: "worn", length: 2 },
        radius: 0.9,
    }),
    P("tomb-effigy", "carvedKnightEffigy", -2.6, 5.4, {
        position: [-2.6, FLOOR_TOP + 0.24, 5.4],
        params: { colorway: "weathered-limestone", beast: "lion" },
        solid: false,
    }),
    P("niche-wall-1", "burialNicheWall", -6, -9, {
        params: { colorway: "crypt-grey", fill: "mixed", rows: 3, columns: 2 },
        radius: 1.2,
    }),
    P("niche-wall-2", "burialNicheWall", -4, -9, {
        params: { colorway: "crypt-grey", fill: "mixed", rows: 3, columns: 2 },
        radius: 1.2,
    }),
    P("niche-wall-3", "burialNicheWall", 9, 4, {
        rotationY: Math.PI / 2,
        params: { colorway: "crypt-grey", fill: "sealed", rows: 2, columns: 2 },
        radius: 1.2,
    }),
    P("ossuary", "ossuarySkullShelf", -9.3, 2.4, {
        params: { colorway: "bone-limestone" },
        radius: 0.9,
    }),
    P("armour-stand", "armourStand", 9.2, 1.4, {
        params: { colorway: "crypt-find", filled: 0 },
        radius: 0.7,
    }),
    P("weapon-rack", "weaponRack", 9.3, -2.6, {
        rotationY: -Math.PI / 2,
        params: { colorway: "bleached-crypt", filled: 1 },
        radius: 0.85,
    }),
    P("barrel", "oakBarrel", 8.7, -5.2, { radius: 0.4 }),
    P("crate-2", "timberCrate", 5.9, 4.6, {
        params: { colorway: "iron-bound", lid: "ajar" },
        radius: 0.5,
    }),
    P("helm", "greatHelm", -1.5, 3.1, { solid: false }),
    P("shield", "heaterShield", 9.2, 5.4, {
        rotationY: -Math.PI / 2,
        solid: false,
    }),
    P("sword", "armingSword", -4.9, 4.1, {
        params: { colorway: "grave-rust", sheath: "scabbard" },
        solid: false,
    }),
    P("pool-1", "standingWaterPool", -3.3, -6.9, {
        params: { colorway: "crypt-seep", clarity: "silted" },
        solid: false,
    }),
    P("pool-2", "standingWaterPool", 6.3, 2.6, {
        params: { colorway: "iron-stained", clarity: "clear" },
        solid: false,
    }),
    P("moss-1", "mossPatch", -2.6, -7.4, { solid: false }),
    P("moss-2", "mossPatch", 7.9, -5.6, { solid: false }),
    P("moss-3", "mossPatch", -9.2, 0.2, { solid: false }),
    P("straw", "strawPile", 3.7, -3.4, {
        params: { colorway: "grey-rotted", state: "mouldered" },
        solid: false,
    }),
    P("candles-1", "candleSpikeCluster", -8.2, -4.4, {
        params: { colorway: "rusted-crypt", state: "burned" },
        radius: 0.25,
    }),
    P("candles-2", "candleSpikeCluster", 7.2, 8.2, {
        params: { colorway: "rusted-crypt", state: "guttered" },
        radius: 0.25,
    }),

    // —— 墙面装饰 ——
    P("torch-w1", "wallTorchBracket", -9.92, -0.5, {
        position: [-9.92, 0, -0.5],
        rotationY: Math.PI / 2,
        params: { colorway: "rusted-crypt", state: "burning" },
        solid: false,
    }),
    P("torch-w2", "wallTorchBracket", 9.92, 3.5, {
        position: [9.92, 0, 3.5],
        rotationY: -Math.PI / 2,
        params: { colorway: "rusted-crypt", state: "burning" },
        solid: false,
    }),
    P("torch-n1", "wallTorchBracket", -3.5, -9.92, {
        position: [-3.5, 0, -9.92],
        rotationY: 0,
        params: { colorway: "rusted-crypt", state: "unlit" },
        solid: false,
    }),
    P("torch-n2", "wallTorchBracket", 3.5, 9.92, {
        position: [3.5, 0, 9.92],
        rotationY: Math.PI,
        params: { colorway: "rusted-crypt", state: "burning" },
        solid: false,
    }),
    P("web-1", "cobwebDrape", -9.9, -9.9, {
        position: [-9.9, 0, -9.9],
        params: { colorway: "grave-dust", form: "corner" },
        solid: false,
    }),
    P("web-2", "cobwebDrape", 9.9, -9.9, {
        position: [9.9, 0, -9.9],
        params: { colorway: "grave-dust", form: "veil" },
        solid: false,
    }),
    P("web-3", "cobwebDrape", 9.9, 9.9, {
        position: [9.9, 0, 9.9],
        params: { colorway: "grave-dust", form: "corner" },
        solid: false,
    }),
    P("manacle-1", "wallManacleFitting", -9.92, -6.6, {
        position: [-9.92, 0, -6.6],
        rotationY: Math.PI / 2,
        params: { colorway: "rust-scabbed", fitting: "pair" },
        solid: false,
    }),
    P("manacle-2", "wallManacleFitting", 9.92, -7.4, {
        position: [9.92, 0, -7.4],
        rotationY: -Math.PI / 2,
        params: { colorway: "rust-scabbed", fitting: "ring" },
        solid: false,
    }),
    P("west-door", "ironBoundDoor", -10.05, -8, {
        position: [-10.05, FLOOR_TOP, -8],
        rotationY: Math.PI / 2,
        params: { colorway: "dressed-grey", open: 0.12 },
        solid: false,
    }),
    P("cell-door", "barredCellDoor", 10.02, 8, {
        position: [10.02, FLOOR_TOP, 8],
        rotationY: -Math.PI / 2,
        params: { colorway: "oiled-iron", state: "locked" },
        solid: false,
    }),
];

/** 墙体模块：四面墙 + 石门缺口 */
export interface WallSpec {
    position: [number, number, number];
    rotationY: number;
    params?: Record<string, unknown>;
}

export function buildWallSpecs(): WallSpec[] {
    const walls: WallSpec[] = [];
    const base = { colorway: "deep-crypt", piece: "straight", ...SCENE_KNOBS };
    for (let i = -9; i <= 9; i += 2) {
        // 南墙（z = -10.2）：完整一排
        walls.push({ position: [i, FLOOR_TOP, -10.2], rotationY: 0, params: base });
        // 北墙（z = +10.2）：正中留出石门
        if (i !== 0) {
            walls.push({ position: [i, FLOOR_TOP, 10.2], rotationY: 0, params: base });
        }
        // 西墙 / 东墙
        const sideParams = base;
        walls.push({ position: [-10.2, FLOOR_TOP, i], rotationY: Math.PI / 2, params: sideParams });
        walls.push({ position: [10.2, FLOOR_TOP, i], rotationY: -Math.PI / 2, params: sideParams });
    }
    return walls;
}

/** NPC 初始站位与朝向 */
export const NPC_SPAWNS: Record<NpcId, { position: [number, number]; facing: number }> = {
    gao: { position: [-4.2, 1.6], facing: 0.6 },
    xiaoyuan: { position: [4.2, 1.9], facing: -2.5 },
    xiaolin: { position: [-6.2, -3.4], facing: 2.1 },
    aze: { position: [6.3, -3.2], facing: -2.2 },
    laozhang: { position: [-3.2, -7.4], facing: 0.9 },
};

export const PLAYER_SPAWN: { position: [number, number]; facing: number } = {
    position: [0, -5.2],
    facing: 0,
};

/** 线索的世界坐标（复用规则层定义） */
export const CLUE_POSITIONS = CLUES.map((clue) => ({
    id: clue.id,
    location: clue.location,
    position: clue.position,
}));

/** 线索标记的符文样式（逐条不同） */
export const CLUE_RUNE_STYLES: Record<string, { rune: string; variant: number }> = {
    mural: { rune: "algiz", variant: 1 },
    artifact: { rune: "raidho", variant: 2 },
    rubble: { rune: "thurisaz", variant: 3 },
    crevice: { rune: "tiwaz", variant: 4 },
    gategap: { rune: "sowilo", variant: 5 },
};

