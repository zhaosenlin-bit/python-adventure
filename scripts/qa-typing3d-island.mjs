/**
 * 3D 打字闯关接入「Python 冒险岛」的自动化验收。
 *
 * 跑之前先起开发服务器：
 *
 *     npm run dev
 *     node scripts/qa-typing3d-island.mjs
 *
 * 脚本会：进入开放世界 -> 检查岛上多了一个「3D 打字闯关」站点 ->
 * 把角色挪到站点旁边按 E -> 确认跳到 /typing-3d。截图落在 `.qa-typing3d/`。
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", ".qa-typing3d");
const URL = process.env.QA_TYPING3D_URL || "http://localhost:3000/world";

const failures = [];
const notes = [];

function check(name, ok, detail = "") {
    const line = `${ok ? "  OK " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    notes.push(line);
    if (!ok) failures.push(line);
    console.log(line);
}

/** Playwright 自带的浏览器版本可能没装，这里退回到本机已装的 Chromium。 */
function resolveChromium() {
    if (process.env.QA_CHROMIUM_PATH) return process.env.QA_CHROMIUM_PATH;
    const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    if (!existsSync(root)) return undefined;
    const revisions = readdirSync(root)
        .filter((name) => name.startsWith("chromium-"))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const revision of revisions) {
        for (const folder of ["chrome-win64", "chrome-win"]) {
            const exe = path.join(root, revision, folder, "chrome.exe");
            if (existsSync(exe)) return exe;
        }
    }
    return undefined;
}

async function main() {
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch({
        executablePath: resolveChromium(),
        args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--disable-lcd-text",
        ],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const consoleErrors = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__worldPhaserGame), null, { timeout: 60_000 });
    // dev 模式 + 软渲染下，开放世界场景要十几秒才起得来，这里改成轮询等场景就绪
    await page.waitForFunction(
        () => {
            const scene = window.__worldPhaserGame?.scene?.getScene("MainScene");
            return Array.isArray(scene?.stations) && scene.stations.length > 0;
        },
        null,
        { timeout: 60_000 },
    );

    // 岛上应该多了一个「3D 打字闯关」站点
    const station = await page.evaluate(() => {
        const scene = window.__worldPhaserGame?.scene?.getScene("MainScene");
        const found = (scene?.stations || []).find((item) => item.id === "typing3d");
        return found ? { id: found.id, x: found.x, y: found.y, title: found.title } : null;
    });
    check("开放世界里出现了「3D 打字闯关」站点", Boolean(station), station ? `${station.title} @ x=${station.x}` : "没找到");
    if (!station) {
        await page.screenshot({ path: path.join(OUT, "island-01-missing-station.png") });
        await browser.close();
        process.exit(1);
    }

    // 把角色挪到站点跟前，按 E/F 触发交互
    await page.evaluate((target) => {
        const scene = window.__worldPhaserGame?.scene?.getScene("MainScene");
        scene?.player?.setPosition(target.x, target.y);
        scene?.player?.setVelocity(0, 0);
    }, station);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "island-02-at-station.png") });

    const prompt = await page.evaluate(() => {
        const scene = window.__worldPhaserGame?.scene?.getScene("MainScene");
        return scene?.interactionPrompt?.text || "";
    });
    check("靠近站点出现交互提示", prompt.includes("3D 打字闯关"), prompt || "没有提示");

    await page.keyboard.press("e");
    await page.waitForURL(/\/typing-3d/, { timeout: 20_000 });
    check("按 E 之后跳到 3D 打字闯关", page.url().includes("/typing-3d"), page.url());
    check("记住了是从岛里进来的", page.url().includes("from=world"), page.url());

    await page.waitForSelector("canvas", { timeout: 30_000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, "island-03-typing3d.png") });

    const sample = await page.evaluate(() => window.__typing3d?.sample?.() ?? null);
    const distinct = sample ? new Set(sample.filter((_, index) => index % 4 !== 3)).size : 0;
    check("3D 场景有画面", distinct > 1, `不同通道值 ${distinct} 个`);

    // 返回键：应该回岛里，而不是回落地页
    await page.getByRole("button", { name: "返回开放世界" }).first().click();
    await page.waitForURL(/\/world/, { timeout: 20_000 });
    check("点返回键回到开放世界", page.url().includes("/world"), page.url());

    check("控制台没有报错", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

    await browser.close();

    console.log(`\n截图目录：${OUT}`);
    if (failures.length) {
        console.log(`\n${failures.length} 项未通过 ❌`);
        process.exit(1);
    }
    console.log("\n全部通过 ✅");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
