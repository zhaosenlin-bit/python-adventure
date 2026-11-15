/**
 * 关卡生成：纯数据，不碰 three.js，所以可以直接单测。
 *
 * 每一关是一个封闭石室：出生点在南墙边，答题面板在厅中央，
 * 答对后北墙的门会打开，穿过去就是下一关。越往后柱子越多、路越绕。
 */

import { mulberry32 } from "./bank";
import type { BoxSpec, EasterEggSpec, LevelLayout, PanelSpec, SpawnOption } from "./types";

/** 几套配色轮着来，24 关不会看着都一样。 */
export const LEVEL_THEMES: LevelLayout["theme"][] = [
    { floor: 0x2b3152, wall: 0x3c4470, accent: 0x35d0c0, glow: 0x7ef9e4, fog: 0x0d1230 },
    { floor: 0x3a2c2b, wall: 0x5a3c31, accent: 0xffb347, glow: 0xffd9a0, fog: 0x2a1512 },
    { floor: 0x173a4c, wall: 0x1e4f6a, accent: 0x4fc3f7, glow: 0xa6ecff, fog: 0x071f2d },
    { floor: 0x20422f, wall: 0x2d5f49, accent: 0x9ae06a, glow: 0xdcffb8, fog: 0x0c241b },
];

const WALL_HEIGHT = 5;
const WALL_THICKNESS = 1;
const DOOR_WIDTH = 3.6;
const SPAWN_COLORS = [0x35d0c0, 0xffb347, 0x8aa4ff, 0xff7ab6];

/** 位置之间至少要隔多远才放得下东西。 */
function distance(ax: number, az: number, bx: number, bz: number): number {
    return Math.hypot(ax - bx, az - bz);
}

export function buildLevel(index: number, seed: number): LevelLayout {
    const random = mulberry32((seed + index * 7919) >>> 0);

    const growth = Math.min(index, 9) * 1.8;
    const width = 28 + growth;
    const depth = 28 + growth;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    const boxes: BoxSpec[] = [];

    // 门开在北墙 (-z 为出生点一侧，+z 为门)
    const doorX = (random() * 2 - 1) * Math.max(0, halfWidth - 6);
    const door: LevelLayout["door"] = {
        x: doorX,
        z: halfDepth,
        width: DOOR_WIDTH,
        rotation: 0,
    };

    // 出生点离南墙留点空间，镜头才有地方站
    const spawn = { x: 0, z: -halfDepth + 8 };

    // 四个可选出生点：都贴着南半边的墙，名字固定，一眼就认得出来。
    // 它们在放面板、摆柱子之前就算好，所以不会被挡住，也不会离面板太近。
    const spawns = buildSpawnPlans(halfWidth, halfDepth);

    // 跑酷路线：贴着一面墙斜着往上搭，终点是彩蛋祭坛
    const keepOut: KeepOut[] = [
        ...spawns.map((option) => ({ x: option.x, z: option.z, radius: 3.2 })),
        { x: door.x, z: door.z, radius: 5.5 },
    ];
    const parkour = buildParkourRoute(random, halfWidth, halfDepth, keepOut, door);

    // 外墙：北墙中间留一个门洞
    const addBox = (box: BoxSpec) => {
        boxes.push(box);
    };
    addBox({ x: 0, z: -halfDepth - WALL_THICKNESS / 2, width: width + WALL_THICKNESS * 2, depth: WALL_THICKNESS, height: WALL_HEIGHT, kind: "wall" });
    addBox({ x: -halfWidth - WALL_THICKNESS / 2, z: 0, width: WALL_THICKNESS, depth: depth + WALL_THICKNESS * 2, height: WALL_HEIGHT, kind: "wall" });
    addBox({ x: halfWidth + WALL_THICKNESS / 2, z: 0, width: WALL_THICKNESS, depth: depth + WALL_THICKNESS * 2, height: WALL_HEIGHT, kind: "wall" });

    const doorLeft = doorX - DOOR_WIDTH / 2;
    const doorRight = doorX + DOOR_WIDTH / 2;
    const leftSpan = doorLeft + halfWidth;
    const rightSpan = halfWidth - doorRight;
    if (leftSpan > 0.5) {
        addBox({ x: (-halfWidth + doorLeft) / 2, z: halfDepth + WALL_THICKNESS / 2, width: leftSpan, depth: WALL_THICKNESS, height: WALL_HEIGHT, kind: "wall" });
    }
    if (rightSpan > 0.5) {
        addBox({ x: (doorRight + halfWidth) / 2, z: halfDepth + WALL_THICKNESS / 2, width: rightSpan, depth: WALL_THICKNESS, height: WALL_HEIGHT, kind: "wall" });
    }

    // 答题面板：找一个离出生点够远、离门也不近的位置
    let panel: PanelSpec = { x: 0, z: 0, rotation: 0 };
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const x = (random() * 2 - 1) * Math.max(0, halfWidth - 4.5);
        const z = (random() * 2 - 1) * Math.max(0, halfDepth - 4.5);
        if (distance(x, z, spawn.x, spawn.z) < 9) continue;
        if (spawns.some((option) => distance(x, z, option.x, option.z) < 8)) continue;
        if (distance(x, z, door.x, door.z) < 7) continue;
        if (parkour.platforms.some((item) => distance(x, z, item.x, item.z) < 4.2)) continue;
        panel = { x, z, rotation: Math.atan2(spawn.x - x, spawn.z - z) };
        break;
    }

    // 柱子：越往后越多，但都要避开出生点、面板和门
    const pillarTarget = Math.min(9, 2 + Math.floor(index / 2));
    const pillarSpanX = 7;
    const pillarSpanZ = 7;
    const columns = Math.max(2, Math.round((width - 10) / pillarSpanX));
    const rows = Math.max(2, Math.round((depth - 10) / pillarSpanZ));
    const candidates: Array<{ x: number; z: number }> = [];
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const x = -halfWidth + 5 + ((width - 10) / Math.max(1, columns - 1)) * column;
            const z = -halfDepth + 5 + ((depth - 10) / Math.max(1, rows - 1)) * row;
            candidates.push({ x, z });
        }
    }
    for (let index2 = candidates.length - 1; index2 > 0; index2 -= 1) {
        const swap = Math.floor(random() * (index2 + 1));
        [candidates[index2], candidates[swap]] = [candidates[swap], candidates[index2]];
    }

    const placed: Array<{ x: number; z: number; radius: number }> = [
        { x: spawn.x, z: spawn.z, radius: 4.2 },
        ...spawns.map((option) => ({ x: option.x, z: option.z, radius: 3.2 })),
        { x: panel.x, z: panel.z, radius: 4.6 },
        { x: door.x, z: door.z - 1.5, radius: 5.4 },
        // 跑酷塔和弹跳板：柱子别长在路线上
        { x: parkour.center.x, z: parkour.center.z, radius: 4.4 },
        { x: parkour.launchPad.x, z: parkour.launchPad.z, radius: 2.6 },
    ];
    let placedCount = 0;
    for (const candidate of candidates) {
        if (placedCount >= pillarTarget) break;
        const radius = 2.1;
        if (placed.some((item) => distance(candidate.x, candidate.z, item.x, item.z) < item.radius + radius)) continue;
        const tall = random() > 0.45;
        const size = tall ? 2.4 : 3.6;
        boxes.push({
            x: candidate.x,
            z: candidate.z,
            width: size,
            depth: tall ? size : 1.2,
            height: tall ? 3.4 : 1.1,
            kind: tall ? "pillar" : "step",
        });
        placed.push({ x: candidate.x, z: candidate.z, radius });
        placedCount += 1;
    }

    // 弹跳板：路线起点前方的弹簧板，踩一下就能被弹上第一块平台
    boxes.push({
        x: parkour.launchPad.x,
        z: parkour.launchPad.z,
        width: 2.6,
        depth: 2.6,
        height: 0.35,
        kind: "bounce",
    });

    // 第三个彩蛋：藏在房间角落，得自己找
    const eggs: EasterEggSpec[] = [...parkour.eggs];
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const x = (random() * 2 - 1) * Math.max(0, halfWidth - 3);
        const z = (random() * 2 - 1) * Math.max(0, halfDepth - 3);
        if (distance(x, z, spawn.x, spawn.z) < 8) continue;
        if (spawns.some((option) => distance(x, z, option.x, option.z) < 6)) continue;
        if (distance(x, z, panel.x, panel.z) < 7) continue;
        if (distance(x, z, door.x, door.z) < 6) continue;
        if (parkour.platforms.some((item) => distance(x, z, item.x, item.z) < 3.5)) continue;
        if (boxes.some((box) => distance(x, z, box.x, box.z) < 3)) continue;
        // 2.4 米高：站着够不到，得跳起来
        eggs.push({ id: 2, x, y: 2.4, z, kind: "cube" });
        break;
    }

    return {
        index,
        width,
        depth,
        spawn,
        spawns,
        panels: [panel],
        door,
        boxes,
        platforms: parkour.platforms,
        eggs,
        theme: LEVEL_THEMES[index % LEVEL_THEMES.length],
    };
}

/** 出生点能不能站人（生成时兜底用，避免极端随机把点堵死）。 */
export function isSpawnClear(layout: LevelLayout): boolean {
    const options = layout.spawns?.length ? layout.spawns : [layout.spawn];
    return options.every((option) =>
        layout.boxes.every((box) => {
            const overlapX = Math.abs(box.x - option.x) < box.width / 2 + 1.2;
            const overlapZ = Math.abs(box.z - option.z) < box.depth / 2 + 1.2;
            return !(overlapX && overlapZ);
        }),
    );
}
/** 四个出生点：南半边墙上各一个，名字固定，开局让玩家挑一个。 */
function buildSpawnPlans(halfWidth: number, halfDepth: number): SpawnOption[] {
    const margin = 3.4;
    return [
        { id: 0, name: "南墙西段", x: -halfWidth * 0.5, z: -halfDepth + margin, color: SPAWN_COLORS[0] },
        { id: 1, name: "南墙东段", x: halfWidth * 0.5, z: -halfDepth + margin, color: SPAWN_COLORS[1] },
        { id: 2, name: "西墙南段", x: -halfWidth + margin, z: -halfDepth * 0.45, color: SPAWN_COLORS[2] },
        { id: 3, name: "东墙南段", x: halfWidth - margin, z: -halfDepth * 0.45, color: SPAWN_COLORS[3] },
    ];
}

/** 跑酷路线 + 彩蛋位置。 */
interface ParkourRoute {
    /** 塔的中心（柱子要避开这里）。 */
    center: { x: number; z: number };
    /** 悬空平台（含顶端的祭坛）。 */
    platforms: BoxSpec[];
    /** 路线上的彩蛋：祭坛 + 半空中的问号方块。 */
    eggs: EasterEggSpec[];
    /** 路线旁边的弹跳板。 */
    launchPad: { x: number; z: number };
}

/** 路线不能压到的地方（出生点、门口）。 */
interface KeepOut {
    x: number;
    z: number;
    radius: number;
}

/** 塔的半径：环形平台离中心的距离。 */
const TOWER_RADIUS = 2.1;
/** 每级平台高多少（一级跳能上 2.1 米，1.4 米很稳）。 */
const TOWER_STEP = 1.4;
/** 环形平台的数量。 */
const TOWER_STEPS = 4;
/** 塔顶祭坛的底面高度。 */
const ALTAR_BASE = 0.9 + TOWER_STEPS * TOWER_STEP;
/** 整个塔占地多大（用来避开出生点和门）。 */
const TOWER_FOOTPRINT = TOWER_RADIUS + 1.6;

/**
 * 跑酷塔：一圈环形平台绕着中心螺旋往上，顶端是彩蛋祭坛。
 *
 * 做成塔而不是沿墙的楼梯，是因为出生点和门都在墙边，
 * 塔身小、居中，才不会把出生点堵死，也不会挡住去门的路。
 */
function buildParkourRoute(
    random: () => number,
    halfWidth: number,
    halfDepth: number,
    keepOut: KeepOut[],
    door: { x: number; z: number },
): ParkourRoute {
    // 先在房间里找一块空地：离出生点和门都够远
    const candidates: Array<{ x: number; z: number }> = [];
    for (let attempt = 0; attempt < 140; attempt += 1) {
        const x = (random() * 2 - 1) * (halfWidth - TOWER_FOOTPRINT);
        const z = (random() * 2 - 1) * (halfDepth - TOWER_FOOTPRINT);
        if (Math.abs(x) > halfWidth - TOWER_FOOTPRINT) continue;
        if (Math.abs(z) > halfDepth - TOWER_FOOTPRINT) continue;
        if (keepOut.some((zone) => distance(x, z, zone.x, zone.z) < zone.radius + TOWER_FOOTPRINT)) {
            continue;
        }
        candidates.push({ x, z });
    }
    const center =
        candidates.length > 0
            ? candidates[Math.floor(random() * candidates.length) % candidates.length]
            : { x: 0, z: 0 };

    // 环形平台：一圈四个，每级高 1.4 米
    const offset = random() * Math.PI * 2;
    const platforms: BoxSpec[] = [];
    for (let index = 0; index < TOWER_STEPS; index += 1) {
        const angle = offset + (index * Math.PI * 2) / TOWER_STEPS;
        platforms.push({
            x: center.x + Math.cos(angle) * TOWER_RADIUS,
            z: center.z + Math.sin(angle) * TOWER_RADIUS,
            width: 2.8,
            depth: 2.8,
            height: 0.45,
            baseY: 0.9 + index * TOWER_STEP,
            kind: "platform",
        });
    }

    // 塔顶祭坛：彩蛋就摆在上面
    platforms.push({
        x: center.x,
        z: center.z,
        width: 4,
        depth: 4,
        height: 0.6,
        baseY: ALTAR_BASE,
        kind: "platform",
    });

    // 弹跳板：放在塔的背面（远离门那一侧），不会挡去门的路
    const awayX = center.x - door.x;
    const awayZ = center.z - door.z;
    const awayLength = Math.hypot(awayX, awayZ) || 1;
    const padX = center.x + (awayX / awayLength) * (TOWER_RADIUS + 2.3);
    const padZ = center.z + (awayZ / awayLength) * (TOWER_RADIUS + 2.3);
    const inside =
        Math.abs(padX) <= halfWidth - 1.5 && Math.abs(padZ) <= halfDepth - 1.5;
    const launchPad = inside
        ? { x: padX, z: padZ }
        : { x: center.x - (awayX / awayLength) * (TOWER_RADIUS + 2.3), z: center.z - (awayZ / awayLength) * (TOWER_RADIUS + 2.3) };

    const middle = platforms[2];
    const eggs: EasterEggSpec[] = [
        { id: 0, x: center.x, y: ALTAR_BASE + 0.6 + 0.85, z: center.z, kind: "altar" },
        {
            id: 1,
            x: middle.x,
            y: (middle.baseY ?? 0) + middle.height + 1.4,
            z: middle.z,
            kind: "cube",
        },
    ];

    return { center, platforms, eggs, launchPad };
}
