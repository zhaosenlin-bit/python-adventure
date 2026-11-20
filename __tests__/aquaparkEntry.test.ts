import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const exists = (...parts: string[]) => fs.existsSync(path.join(ROOT, ...parts));

describe("水乐园大乱斗接入编程冒险岛", () => {
    it("有独立的页面路由", () => {
        expect(exists("app", "aquapark", "page.tsx")).toBe(true);
        expect(read("app", "aquapark", "page.tsx")).toContain("AquaparkGame");
    });

    it("首页快捷入口指向这个页面", () => {
        const home = read("app", "page.tsx");
        expect(home).toContain("aquapark-button");
        expect(home).toContain("router.push('/aquapark')");
    });

    it("页面里的启动按钮打的是本地启动器接口", () => {
        const page = read("components", "game", "AquaparkGame.tsx");
        expect(page).toContain("/api/v1/launcher/aquapark");
        expect(page).toContain("aquapark-launch-button");
    });

    it("后端启动器登记了这个桌面游戏", () => {
        const launcher = read("backend", "app", "api", "v1", "launcher.py");
        expect(launcher).toContain('"aquapark"');
        expect(launcher).toContain("aquapark.main");
        // 老的 3d 打字桌面版不能被改坏
        expect(launcher).toContain('"3d-typing"');
        expect(launcher).toContain("game3d.main");
    });

    it("游戏本体在仓库里（纯追加的新包）", () => {
        expect(exists("aquapark", "main.py")).toBe(true);
        expect(exists("aquapark", "game.py")).toBe(true);
        expect(exists("aquapark", "track.py")).toBe(true);
        expect(exists("aquapark", "requirements.txt")).toBe(true);
    });

    it("页面用到的截图都在 public 里", () => {
        expect(exists("public", "aquapark", "race.png")).toBe(true);
        expect(exists("public", "aquapark", "collection.png")).toBe(true);
        expect(exists("public", "aquapark", "menu.png")).toBe(true);
    });
});
