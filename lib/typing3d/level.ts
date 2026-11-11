/**
 * 关卡生成：纯数据，不碰 three.js，所以可以直接单测。
 *
 * 每一关是一个封闭石室：出生点在南墙边，答题面板在厅中央，
 * 答对后北墙的门会打开，穿过去就是下一关。越往后柱子越多、路越绕。
 */

import { mulberry32 } from "./bank";
import type { BoxSpec, LevelLayout, PanelSpec, SpawnOption } from "./types";

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

    return {
        index,
        width,
        depth,
        spawn,
        spawns,
        panels: [panel],
        door,
        boxes,
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

