import { hashString } from "@/lib/typing3d/bank";
import { buildLevel, isSpawnClear, LEVEL_THEMES } from "@/lib/typing3d/level";
import type { BoxSpec } from "@/lib/typing3d/types";

function overlaps(x: number, z: number, box: BoxSpec, padding = 0): boolean {
    return (
        Math.abs(x - box.x) <= box.width / 2 + padding && Math.abs(z - box.z) <= box.depth / 2 + padding
    );
}

describe("关卡生成", () => {
    const seed = hashString("typing3d:20261109");

    it("同一关同一种子结果一致", () => {
        const left = buildLevel(3, seed);
        const right = buildLevel(3, seed);
        expect(left).toEqual(right);
    });

    it("出生点是空的", () => {
        for (let index = 0; index < 24; index += 1) {
            const layout = buildLevel(index, seed);
            expect(isSpawnClear(layout)).toBe(true);
        }
    });

    it("答题面板不会卡在墙里", () => {
        for (let index = 0; index < 24; index += 1) {
            const layout = buildLevel(index, seed);
            const panel = layout.panels[0];
            for (const box of layout.boxes) {
                expect(overlaps(panel.x, panel.z, box, 0.6)).toBe(false);
            }
        }
    });

    it("门洞前面是空的，玩家走得过去", () => {
        for (let index = 0; index < 24; index += 1) {
            const layout = buildLevel(index, seed);
            const door = layout.door;
            // 门洞正前方留出通道
            expect(overlaps(door.x, door.z - 2, { x: 0, z: 0, width: 0.1, depth: 0.1, height: 1, kind: "wall" })).toBe(false);
            const blocked = layout.boxes.some(
                (box) =>
                    box.kind !== "wall" &&
                    Math.abs(box.x - door.x) < door.width / 2 + 1.2 &&
                    Math.abs(box.z - (door.z - 2)) < 2.5,
            );
            expect(blocked).toBe(false);
        }
    });

    it("房间随着关卡变大，柱子越来越多", () => {
        const first = buildLevel(0, seed);
        const later = buildLevel(12, seed);
        expect(later.width).toBeGreaterThan(first.width);
        const pillars = (layout: ReturnType<typeof buildLevel>) =>
            layout.boxes.filter((box) => box.kind === "pillar").length;
        expect(pillars(later)).toBeGreaterThan(pillars(first));
    });

    it("配色按关卡轮换", () => {
        expect(buildLevel(0, seed).theme).toEqual(LEVEL_THEMES[0]);
        expect(buildLevel(4, seed).theme).toEqual(LEVEL_THEMES[0]);
        expect(buildLevel(1, seed).theme).toEqual(LEVEL_THEMES[1]);
    });

    it("玩家和面板之间的距离足够走一段路", () => {

        for (let index = 0; index < 24; index += 1) {
            const layout = buildLevel(index, seed);
            const panel = layout.panels[0];
            const distance = Math.hypot(panel.x - layout.spawn.x, panel.z - layout.spawn.z);
            expect(distance).toBeGreaterThan(8);
        }
    });

    it("提供可选出生点，且每个都站得住人", () => {
        for (let index = 0; index < 24; index += 1) {
            const layout = buildLevel(index, seed);
            expect(layout.spawns.length).toBeGreaterThanOrEqual(3);
            layout.spawns.forEach((option, order) => {
                expect(option.id).toBe(order);
                expect(option.name).toBeTruthy();
                expect(Math.abs(option.x)).toBeLessThan(layout.width / 2);
                expect(Math.abs(option.z)).toBeLessThan(layout.depth / 2);
                const blocked = layout.boxes.some((box) => overlaps(option.x, option.z, box, 1));
                expect(blocked).toBe(false);
            });
        }
    });
});
