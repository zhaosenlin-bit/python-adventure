/**
 * 3D 编程迷宫 —— 小跟班「小弟」的大脑（纯函数）
 *
 * 小弟不参与移动、不消耗指令，它只做三件事：
 *   1. 站在你右前方飘着，跟着你走（渲染在 MazeWorld 里）
 *   2. 嗅金币：告诉你最近的没捡的金币在哪一边、几格远
 *   3. 探陷阱：两格内有门就发抖报警（门长得都一样，靠它保命）
 *
 * 这里只负责「现在该是什么心情、该说哪句话、箭头指哪边」，
 * 不碰 three.js，所以可以直接做单元测试。
 */

import type { RunState } from './engine';
import {
    DIR_VECTORS,
    type Cell,
    type Facing,
    type Level3D,
    canWalk,
    cellKey,
    distanceMap,
} from './level';

export type GizmoMood = 'idle' | 'lead' | 'warn' | 'cheer';

export interface GizmoHint {
    mood: GizmoMood;
    /** 小弟头顶的小气泡台词 */
    text: string;
    /** 箭头指向（世界方位），null = 不显示箭头 */
    arrow: Facing | null;
    /** 到目标的格数 */
    distance: number;
    target: 'coin' | 'trap' | null;
}

const DIR_LABEL = ['正前方', '右手边', '身后', '左手边'];

/** 相对角色朝向说方位，比东南西北更好懂 */
function relativeLabel(facing: Facing, dir: Facing): string {
    return DIR_LABEL[((dir - facing) % 4 + 4) % 4];
}

/** 从 from 走向 target 的第一步朝哪（按 target 的 BFS 距离场下坡），走不到返回 null */
function firstStep(level: Level3D, from: Cell, target: Cell): Facing | null {
    const dist = distanceMap(level, target);
    const here = dist[from.z * level.width + from.x];
    if (here <= 0) return null;

    for (let facing = 0; facing < 4; facing++) {
        const dir = DIR_VECTORS[facing];
        const x = from.x + dir.dx;
        const z = from.z + dir.dz;
        if (!canWalk(level, x, z)) continue;
        if (dist[z * level.width + x] === here - 1) return facing as Facing;
    }
    return null;
}

function collectibleCoins(level: Level3D, state: RunState, dist: number[]): { cell: Cell; distance: number }[] {
    return level.coins
        .filter((coin) => !state.coins.includes(cellKey(coin.x, coin.z)))
        .map((coin) => ({ cell: coin, distance: dist[coin.z * level.width + coin.x] }))
        .filter((entry) => entry.distance > 0)
        .sort((a, b) => a.distance - b.distance);
}

function nearestTrap(level: Level3D, dist: number[]): { cell: Cell; distance: number } | null {
    const traps = level.doors
        .filter((door) => !door.correct)
        .map((door) => ({ cell: { x: door.x, z: door.z }, distance: dist[door.z * level.width + door.x] }))
        .filter((entry) => entry.distance > 0)
        .sort((a, b) => a.distance - b.distance);
    return traps[0] ?? null;
}

/**
 * @param leading 是否打开「带路」：关掉时只有很近的金币才会提示，避免一路剧透
 */
export function senseGizmo(level: Level3D, state: RunState, leading = false): GizmoHint {
    const here: Cell = { x: state.x, z: state.z };
    const dist = distanceMap(level, here);
    const trap = nearestTrap(level, dist);
    const coins = collectibleCoins(level, state, dist);
    const coin = coins[0];

    // 1) 危险优先：两格内有门，必须叫住你
    if (trap && trap.distance <= 2) {
        const arrow = firstStep(level, here, trap.cell);
        return {
            mood: 'warn',
            text:
                trap.distance === 1
                    ? `${relativeLabel(state.facing, arrow ?? state.facing)}就是一道门 —— 门后可能是陷阱，我有点怕`
                    : `${relativeLabel(state.facing, arrow ?? state.facing)} ${trap.distance} 格有门，先别急着进`,
            arrow,
            distance: trap.distance,
            target: 'trap',
        };
    }

    // 2) 带路：指向最近的没捡的金币
    if (coin && (leading || coin.distance <= 3)) {
        const arrow = firstStep(level, here, coin.cell);
        return {
            mood: 'lead',
            text: `金币！${relativeLabel(state.facing, arrow ?? state.facing)} ${coin.distance} 格，跟我走`,
            arrow,
            distance: coin.distance,
            target: 'coin',
        };
    }

    if (coin) {
        return {
            mood: 'idle',
            text: `还差 ${coins.length} 枚金币，点一下「带路」我给你指方向`,
            arrow: null,
            distance: coin.distance,
            target: null,
        };
    }

    return {
        mood: 'idle',
        text: '金币全捡完了，剩下的门自己挑吧 —— 我不敢替你开门',
        arrow: null,
        distance: 0,
        target: null,
    };
}

/** 通关/撞墙时的一次性台词，和状态机无关 */
export function gizmoReaction(kind: 'coin' | 'blocked' | 'win' | 'trap'): string {
    switch (kind) {
        case 'coin':
            return '捡到啦！';
        case 'blocked':
            return '哎，是墙。要不先转个弯？';
        case 'trap':
            return '我说了吧……快答题！';
        default:
            return '出口！我们出来了！';
    }
}
