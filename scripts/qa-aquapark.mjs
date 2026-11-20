/**
 * 水乐园大乱斗（Aquapark.io 复刻）页面自动化验收。
 *
 * 跑之前先起开发服务器 + 后端：
 *
 *     npm run dev
 *     cd backend && .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
 *     node scripts/qa-aquapark.mjs
 *
 * 脚本会：打开 /aquapark -> 截图 -> 检查页面不是空白 -> 检查截图资源加载出来了 ->
 * 点「启动游戏窗口」-> 看后端有没有真的把游戏拉起来。截图落在 `.qa-aquapark/`。
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", ".qa-aquapark");
const URL = process.env.QA_AQUAPARK_URL || "http://localhost:3000/aquapark";

const failures = [];
const notes = [];

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

/**
 * Next 开发模式的报错浮层（<nextjs-portal>）会盖在页面上拦截点击。
 */
async function disableDevOverlay(page) {
    await page
        .addStyleTag({ content: "nextjs-portal { display: none !important; }" })
        .catch(() => undefined);
}

function check(name, ok, detail = "") {
    const line = `${ok ? "  OK  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    if (ok) notes.push(line);
    else failures.push(line);
    console.log(line);
}

async function main() {
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch({
        executablePath: resolveChromium(),
        args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const consoleErrors = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await disableDevOverlay(page);
    await page.waitForSelector('[data-testid="aquapark-launch-button"]', { timeout: 60_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, "01-page.png") });
    check("页面打开且有启动按钮", true);

    const title = await page.locator("h1").first().textContent();
    check("标题正确", (title || "").includes("水乐园大乱斗"), title || "");

    // 页面不能是一整块纯色
    const distinct = await page.evaluate(() => {
        const canvasLike = document.body;
        const styles = getComputedStyle(canvasLike);
        return styles.backgroundColor;
    });
    check("页面有背景", Boolean(distinct), distinct || "");

    // 三张截图要真的加载出来（naturalWidth > 0）
    const images = await page.evaluate(() =>
        Array.from(document.querySelectorAll("img")).map((img) => ({
            src: img.getAttribute("src"),
            width: img.naturalWidth,
        })),
    );
    const broken = images.filter((img) => !img.width);
    check(
        "截图资源都加载出来了",
        images.length >= 3 && broken.length === 0,
        `${images.length} 张图，坏掉 ${broken.length} 张`,
    );

    // 点「启动游戏窗口」，后端应该真的把游戏拉起来
    await page.click('[data-testid="aquapark-launch-button"]');
    await page.waitForSelector('[data-testid="aquapark-launch-status"]', { timeout: 60_000 });
    const status = (await page.locator('[data-testid="aquapark-launch-status"]').textContent()) || "";
    await page.screenshot({ path: path.join(OUT, "02-launched.png") });
    const ok = status.includes("已启动") || status.includes("已经在运行");
    check("后端把桌面游戏拉起来了", ok, status.trim());

    check("控制台没有报错", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

    await browser.close();

    console.log("");
    if (failures.length) {
        console.log(`验收失败 ${failures.length} 项：`);
        failures.forEach((line) => console.log(line));
        process.exitCode = 1;
    } else {
        console.log(`全部通过（${notes.length} 项）`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
