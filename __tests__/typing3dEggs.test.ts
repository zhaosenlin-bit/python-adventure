import { hashString } from "@/lib/typing3d/bank";
import { ALTAR_TEXTS, EGG_TEXTS, eggHint, eggKey, pickEggText } from "@/lib/typing3d/eggs";
import type { EasterEggSpec } from "@/lib/typing3d/types";

describe("彩蛋文案", () => {
    const today = hashString("typing3d:20261115");
    const tomorrow = hashString("typing3d:20261116");

    it("同一天同一关同一个彩蛋，文案固定不变", () => {
        for (let level = 0; level < 24; level += 1) {
            for (let id = 0; id < 3; id += 1) {
                const first = pickEggText(today, level, id, "cube");
                const second = pickEggText(today, level, id, "cube");
                expect(first).toBe(second);
            }
        }
    });

    it("跨天自动换一批文案", () => {
        const changed = (() => {
            for (let level = 0; level < 24; level += 1) {
                for (let id = 0; id < 3; id += 1) {
                    if (pickEggText(today, level, id, "cube") !== pickEggText(tomorrow, level, id, "cube")) {
                        return true;
                    }
                }
            }
            return false;
        })();
        expect(changed).toBe(true);
    });

    it("文案都取自内置的文案池", () => {
        for (let level = 0; level < 24; level += 1) {
            for (let id = 0; id < 3; id += 1) {
                expect(EGG_TEXTS).toContain(pickEggText(today, level, id, "cube"));
                expect(ALTAR_TEXTS).toContain(pickEggText(today, level, id, "altar"));
            }
        }
    });

    it("文案池够大，彩蛋才有惊喜感", () => {
        expect(EGG_TEXTS.length).toBeGreaterThanOrEqual(15);
        expect(ALTAR_TEXTS.length).toBeGreaterThanOrEqual(6);
        expect(new Set(EGG_TEXTS).size).toBe(EGG_TEXTS.length);
        expect(new Set(ALTAR_TEXTS).size).toBe(ALTAR_TEXTS.length);
    });

    it("普通彩蛋只透露第一个字符，祭坛透露一半", () => {
        const cube = eggHint("planet", "cube");
        expect(cube).toContain("p");
        expect(cube).not.toContain("lanta");

        const altar = eggHint("planet", "altar");
        expect(altar).toContain("pla");
    });

    it("题目为空时不给提示", () => {
        expect(eggHint("", "cube")).toBe("");
        expect(eggHint("   ", "altar")).toBe("");
    });

    it("彩蛋编号在关卡内唯一", () => {
        const egg: EasterEggSpec = { id: 2, x: 0, y: 2, z: 0, kind: "cube" };
        expect(eggKey(egg)).toBe("cube-2");
        expect(eggKey({ ...egg, kind: "altar" })).toBe("altar-2");
    });
});
