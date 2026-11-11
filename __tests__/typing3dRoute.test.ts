import { isDirtyTyping3dPath, TYPING3D_PATH } from "@/lib/typing3d/route";

describe("3D 打字闯关的网址归一化", () => {
    it("干净地址不动", () => {
        expect(isDirtyTyping3dPath("/typing-3d")).toBe(false);
        expect(isDirtyTyping3dPath(TYPING3D_PATH)).toBe(false);
    });

    it("粘了中文标点的地址会被重定向", () => {
        expect(isDirtyTyping3dPath("/typing-3d。")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d，")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d、")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d？")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d！")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d）")).toBe(true);
    });

    it("多余的斜杠和句点也算脏", () => {
        expect(isDirtyTyping3dPath("/typing-3d/")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d//")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d.")).toBe(true);
    });

    it("真正的子路由放行，别劫持以后要加的页面", () => {
        expect(isDirtyTyping3dPath("/typing-3d/leaderboard")).toBe(false);
        expect(isDirtyTyping3dPath("/typing-3d/replay/12")).toBe(false);
    });

    it("别的路径不归它管", () => {
        expect(isDirtyTyping3dPath("/")).toBe(false);
        expect(isDirtyTyping3dPath("/typing")).toBe(false);
        expect(isDirtyTyping3dPath("/typing-3d-home")).toBe(false);
    });

    it("百分号编码的中文标点也要重定向", () => {
        expect(isDirtyTyping3dPath("/typing-3d%E3%80%82")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d%EF%BC%8C")).toBe(true);
        expect(isDirtyTyping3dPath("/typing-3d%E3%80%82/")).toBe(true);
    });
});
