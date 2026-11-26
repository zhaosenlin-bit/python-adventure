import { describe, expect, it } from '@jest/globals';
import { gizmoReaction, senseGizmo } from '@/lib/maze3d/gizmo';
import type { Level3D } from '@/lib/maze3d/level';
import type { RunState } from '@/lib/maze3d/engine';

/** 7×7 的空房间，只有外墙，方便精确算格子距离 */
function makeLevel(overrides: Partial<Level3D> = {}): Level3D {
    const width = 7;
    const height = 7;
    const walls: boolean[] = [];
    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            walls.push(z === 0 || z === height - 1 || x === 0 || x === width - 1);
        }
    }
    return {
        difficulty: 'easy',
        width,
        height,
        walls,
        start: { x: 1, z: 1 },
        exit: { x: 5, z: 5 },
        facing: 1,
        coins: [{ x: 3, z: 1 }],
        doors: [
            { x: 5, z: 5, correct: true },
            { x: 1, z: 5, correct: false },
        ],
        par: 8,
        seed: 1,
        ...overrides,
    };
}

function state(x: number, z: number, facing: RunState['facing'] = 1, coins: string[] = []): RunState {
    return { x, z, facing, coins, steps: 0 };
}

describe('senseGizmo 小跟班', () => {
    it('金币在三格内会主动指路，箭头指向东', () => {
        const hint = senseGizmo(makeLevel(), state(1, 1));
        expect(hint.mood).toBe('lead');
        expect(hint.arrow).toBe(1);
        expect(hint.distance).toBe(2);
        expect(hint.text).toContain('2 格');
    });

    it('金币很远又没开带路时只报个数量，不剧透方向', () => {
        const level = makeLevel({ coins: [{ x: 5, z: 3 }] });
        const hint = senseGizmo(level, state(1, 1), false);
        expect(hint.mood).toBe('idle');
        expect(hint.arrow).toBeNull();
        expect(hint.text).toContain('还差 1 枚金币');
    });

    it('打开带路后远处的金币也会给箭头', () => {
        const level = makeLevel({ coins: [{ x: 5, z: 3 }] });
        const hint = senseGizmo(level, state(1, 1), true);
        expect(hint.mood).toBe('lead');
        expect(hint.arrow).not.toBeNull();
        expect(hint.target).toBe('coin');
    });

    it('两格内有陷阱门就报警，并且用相对方位说话', () => {
        // 站在 (1,4) 朝北，陷阱门在正后方 (1,5)
        const hint = senseGizmo(makeLevel(), state(1, 4, 0));
        expect(hint.mood).toBe('warn');
        expect(hint.target).toBe('trap');
        expect(hint.distance).toBe(1);
        expect(hint.text).toContain('身后');
    });

    it('危险优先于金币：脚边有门时不再指金币', () => {
        const hint = senseGizmo(makeLevel({ coins: [{ x: 2, z: 4 }] }), state(1, 4, 2), true);
        expect(hint.mood).toBe('warn');
    });

    it('金币全捡完后不再乱指路', () => {
        const hint = senseGizmo(makeLevel(), state(1, 1, 1, ['3,1']), true);
        expect(hint.mood).toBe('idle');
        expect(hint.arrow).toBeNull();
        expect(hint.text).toContain('金币全捡完了');
    });

    it('脚下的金币不会当成目标', () => {
        const hint = senseGizmo(makeLevel(), state(3, 1, 1, []), true);
        expect(hint.mood).toBe('idle');
        expect(hint.arrow).toBeNull();
    });

    it('一次性反应台词都有内容', () => {
        (['coin', 'blocked', 'trap', 'win'] as const).forEach((kind) => {
            expect(gizmoReaction(kind).length).toBeGreaterThan(1);
        });
    });
});
