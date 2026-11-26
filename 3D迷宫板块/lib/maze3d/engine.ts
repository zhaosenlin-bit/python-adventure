/**
 * 3D 编程迷宫 —— 移动规则（纯函数）
 *
 * 场景组件只负责「把状态画出来」，走不走得动、踩到什么，全部在这里决定，
 * 所以这部分逻辑可以脱离 WebGL 单独做单元测试。
 */

import type { MazeCommand } from '@/lib/maze/levels';
import {
    DIR_VECTORS,
    type Cell,
    type Door,
    type Facing,
    type Level3D,
    canWalk,
    cellKey,
    coinAt,
    doorAt,
} from './level';

export interface RunState {
    x: number;
    z: number;
    facing: Facing;
    /** 已收集金币的坐标 key */
    coins: string[];
    /** 已经迈出的步数（转弯不算） */
    steps: number;
}

export type CommandOutcome =
    | { kind: 'move'; state: RunState }
    | { kind: 'coin'; state: RunState; coin: string }
    | { kind: 'turn'; state: RunState }
    | { kind: 'blocked'; state: RunState }
    | { kind: 'trap'; state: RunState; from: Cell; door: Door }
    | { kind: 'exit'; state: RunState };

export function createRunState(level: Level3D): RunState {
    return { x: level.start.x, z: level.start.z, facing: level.facing, coins: [], steps: 0 };
}

export function turn(state: RunState, delta: 1 | -1): RunState {
    return { ...state, facing: (((state.facing + delta) % 4 + 4) % 4) as Facing };
}

/**
 * 沿当前朝向走一格：sign 为 1 是前进，-1 是后退（后退不改变朝向）。
 * 前进/后退的落点判定完全一致，只是方向相反，所以合并在这里。
 */
function stepAlong(level: Level3D, state: RunState, sign: 1 | -1): CommandOutcome {
    const dir = DIR_VECTORS[state.facing];
    const x = state.x + dir.dx * sign;
    const z = state.z + dir.dz * sign;

    if (!canWalk(level, x, z)) {
        return { kind: 'blocked', state };
    }

    const key = cellKey(x, z);
    const hasCoin = coinAt(level, x, z);
    const collected = state.coins.includes(key);
    const moved: RunState = {
        ...state,
        x,
        z,
        steps: state.steps + 1,
        coins: hasCoin && !collected ? [...state.coins, key] : state.coins,
    };

    const door = doorAt(level, x, z);
    if (door) {
        if (door.correct) return { kind: 'exit', state: moved };
        return { kind: 'trap', state: moved, from: { x: state.x, z: state.z }, door };
    }

    if (hasCoin && !collected) return { kind: 'coin', state: moved, coin: key };
    return { kind: 'move', state: moved };
}

export function applyCommand(level: Level3D, state: RunState, command: MazeCommand): CommandOutcome {
    if (command === 'left') {
        return { kind: 'turn', state: turn(state, -1) };
    }
    if (command === 'right') {
        return { kind: 'turn', state: turn(state, 1) };
    }

    return stepAlong(level, state, 1);
}

/** 方向键 ↓ 用的后退：朝当前朝向的反方向退一格，朝向不变 */
export function applyBackward(level: Level3D, state: RunState): CommandOutcome {
    return stepAlong(level, state, -1);
}

/** 被陷阱门弹回原位：位置回到 from，已走步数保留 */
export function bounceBack(state: RunState, from: Cell): RunState {
    return { ...state, x: from.x, z: from.z };
}
