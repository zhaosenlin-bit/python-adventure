/**
 * 3D 编程迷宫 —— 关卡生成与移动规则
 */

import { applyBackward, applyCommand, bounceBack, createRunState, turn } from '@/lib/maze3d/engine';
import {
    DIFFICULTIES,
    DIR_VECTORS,
    type Cell,
    type Facing,
    type Level3D,
    canWalk,
    createLevel,
    distanceMap,
    isWall,
} from '@/lib/maze3d/level';

function facingToward(from: Cell, to: Cell): Facing {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const index = DIR_VECTORS.findIndex((dir) => dir.dx === dx && dir.dz === dz);
    return index as Facing;
}

function neighbours(level: Level3D, cell: Cell): Cell[] {
    return DIR_VECTORS.map((dir) => ({ x: cell.x + dir.dx, z: cell.z + dir.dz })).filter((next) =>
        canWalk(level, next.x, next.z),
    );
}

describe('createLevel', () => {
    it.each(DIFFICULTIES)('$id 生成正确尺寸与外墙', (config) => {
        const level = createLevel(config.id);

        expect(level.width).toBe(config.size);
        expect(level.height).toBe(config.size);
        expect(level.start).toEqual({ x: 1, z: 1 });
        expect(level.exit).toEqual({ x: config.size - 2, z: config.size - 2 });

        for (let i = 0; i < config.size; i++) {
            expect(isWall(level, i, 0)).toBe(true);
            expect(isWall(level, i, config.size - 1)).toBe(true);
            expect(isWall(level, 0, i)).toBe(true);
            expect(isWall(level, config.size - 1, i)).toBe(true);
        }
    });

    it.each(DIFFICULTIES)('$id 的出口可达，且 par 等于最短路', (config) => {
        const level = createLevel(config.id);
        const dist = distanceMap(level);

        expect(dist[level.exit.z * level.width + level.exit.x]).toBeGreaterThan(0);
        expect(level.par).toBe(dist[level.exit.z * level.width + level.exit.x]);
    });

    it.each(DIFFICULTIES)('$id 的金币都在通路上且不压门', (config) => {
        const level = createLevel(config.id);

        expect(level.coins).toHaveLength(config.coinCount);
        level.coins.forEach((coin) => {
            expect(canWalk(level, coin.x, coin.z)).toBe(true);
            expect(level.doors.some((door) => door.x === coin.x && door.z === coin.z)).toBe(false);
        });
        const keys = new Set(level.coins.map((coin) => `${coin.x},${coin.z}`));
        expect(keys.size).toBe(level.coins.length);
    });

    it.each(DIFFICULTIES)('$id 的陷阱门都放在死路上，出口门只有一扇', (config) => {
        const level = createLevel(config.id);
        const traps = level.doors.filter((door) => !door.correct);
        const exits = level.doors.filter((door) => door.correct);

        expect(traps).toHaveLength(config.trapCount);
        expect(exits).toHaveLength(1);
        expect(exits[0]).toMatchObject({ x: level.exit.x, z: level.exit.z });

        traps.forEach((door) => {
            expect(canWalk(level, door.x, door.z)).toBe(true);
            expect(neighbours(level, door)).toHaveLength(1);
            expect(door).not.toEqual(level.start);
        });
    });

    it('同一难度每次生成的迷宫完全一致（可复盘、可测试）', () => {
        const a = createLevel('medium');
        const b = createLevel('medium');

        expect(b.coins).toEqual(a.coins);
        expect(b.doors).toEqual(a.doors);
        expect(b.walls).toEqual(a.walls);
    });
});

describe('applyCommand', () => {
    const level = createLevel('easy');

    it('turn_left / turn_right 只改朝向，不算步数', () => {
        const start = createRunState(level);
        const left = applyCommand(level, start, 'left');

        expect(left.kind).toBe('turn');
        expect(left.state.facing).toBe((start.facing + 3) % 4);
        expect(left.state.steps).toBe(0);
        expect(turn(turn(start, 1), -1).facing).toBe(start.facing);
    });

    it('撞墙时原地不动', () => {
        const start = { ...createRunState(level), facing: 0 as Facing };
        const outcome = applyCommand(level, start, 'forward');

        expect(outcome.kind).toBe('blocked');
        expect(outcome.state).toMatchObject({ x: start.x, z: start.z, steps: 0 });
    });

    it('踩到金币会记录到 coins 里', () => {
        const coin = level.coins.find((cell) => neighbours(level, cell).length > 0);
        expect(coin).toBeDefined();
        if (!coin) return;

        const from = neighbours(level, coin)[0];
        const state = { ...createRunState(level), x: from.x, z: from.z, facing: facingToward(from, coin) };
        const outcome = applyCommand(level, state, 'forward');

        expect(outcome.kind).toBe('coin');
        expect(outcome.state.coins).toContain(`${coin.x},${coin.z}`);
        expect(outcome.state.steps).toBe(1);

        const again = applyCommand(level, outcome.state, 'left');
        expect(again.state.coins).toHaveLength(1);
    });

    it('走进陷阱门会被判 trap，并记住来路', () => {
        const trap = level.doors.find((door) => !door.correct);
        expect(trap).toBeDefined();
        if (!trap) return;

        const from = neighbours(level, trap)[0];
        const state = { ...createRunState(level), x: from.x, z: from.z, facing: facingToward(from, trap) };
        const outcome = applyCommand(level, state, 'forward');

        expect(outcome.kind).toBe('trap');
        if (outcome.kind !== 'trap') return;
        expect(outcome.door).toEqual(trap);
        expect(outcome.from).toEqual(from);
        expect(bounceBack(outcome.state, outcome.from)).toMatchObject({ x: from.x, z: from.z });
    });

    it('走进正确的门就是通关', () => {
        const exit = level.doors.find((door) => door.correct);
        expect(exit).toBeDefined();
        if (!exit) return;

        const from = neighbours(level, exit)[0];
        const state = { ...createRunState(level), x: from.x, z: from.z, facing: facingToward(from, exit) };

        expect(applyCommand(level, state, 'forward').kind).toBe('exit');
    });
});

describe('applyBackward（方向键 ↓）', () => {
    const level = createLevel('easy');

    it('朝反方向退一格，朝向不变，步数 +1', () => {
        // 找一条 A - B - C 直线通路：站在 B 朝向 C，后退应该落到 A
        let found: { a: Cell; b: Cell; c: Cell; facing: Facing } | null = null;
        for (let z = 1; z < level.height - 1 && !found; z++) {
            for (let x = 1; x < level.width - 1 && !found; x++) {
                if (!canWalk(level, x, z)) continue;
                for (let d = 0; d < DIR_VECTORS.length; d++) {
                    const dir = DIR_VECTORS[d];
                    const c = { x: x + dir.dx, z: z + dir.dz };
                    const a = { x: x - dir.dx, z: z - dir.dz };
                    if (canWalk(level, c.x, c.z) && canWalk(level, a.x, a.z)) {
                        found = { a, b: { x, z }, c, facing: d as Facing };
                        break;
                    }
                }
            }
        }
        expect(found).not.toBeNull();
        if (!found) return;

        const state = { ...createRunState(level), x: found.b.x, z: found.b.z, facing: found.facing, steps: 3 };
        const outcome = applyBackward(level, state);

        expect(['move', 'coin']).toContain(outcome.kind);
        expect(outcome.state).toMatchObject({
            x: found.a.x,
            z: found.a.z,
            facing: found.facing,
            steps: 4,
        });
    });

    it('背后是墙时原地不动，也不加步数', () => {
        // 起点 (1,1) 面向 +z，背后的 z-1 = 0 是外墙
        const state = { ...createRunState(level), facing: 2 as Facing };
        const outcome = applyBackward(level, state);

        expect(outcome.kind).toBe('blocked');
        expect(outcome.state).toMatchObject({ x: state.x, z: state.z, facing: 2, steps: 0 });
    });
});
