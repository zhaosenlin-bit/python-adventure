/**
 * 3D 打字闯关（网页版）自动化验收。
 *
 * 跑之前先起开发服务器：
 *
 *     npm run dev
 *     node scripts/qa-typing3d.mjs
 *
 * 脚本会：进入关卡 -> 截图 -> 检查画面不是空白 -> 走到答题面板 -> 敲对题 ->
 * 确认门打开 -> 穿门进下一关。全程截图落在 `.qa-typing3d/`。
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", ".qa-typing3d");
const URL = process.env.QA_TYPING3D_URL || "http://localhost:3000/typing-3d";

const failures = [];

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
const notes = [];

function check(name, ok, detail = "") {
    if (ok) {
        notes.push(`  OK  ${name}${detail ? ` — ${detail}` : ""}`);
    } else {
        failures.push(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
    console.log(`${ok ? "  OK " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
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
    await page.waitForSelector('[data-testid="typing-3d-start"]:not([disabled])', { timeout: 60_000 });
    await page.screenshot({ path: path.join(OUT, "01-intro.png") });
    check("开场界面出现", true);

    await page.click('[data-testid="typing-3d-start"]');
    // 新版流程：先挑出生点，再进关卡
    const spawnOption = page.locator('[data-testid="typing-3d-spawn-option-0"]');
    if (await spawnOption.count()) {
        await spawnOption.click();
        await page.click('[data-testid="typing-3d-spawn-confirm"]');
    }
    await page.waitForSelector("canvas", { timeout: 30_000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, "02-level.png") });

    // 画面像素检查：中心区域不能是一整块纯色
    const sample = await page.evaluate(() => window.__typing3d?.sample?.() ?? null);
    const distinct = sample ? new Set(sample.filter((_, index) => index % 4 !== 3)).size : 0;
    check("画面已渲染（中心像素有层次）", distinct > 1, `不同通道值 ${distinct} 个`);

    const panel = await page.evaluate(() => window.__typing3d?.panel?.() ?? null);
    check("拿到了答题面板坐标", Boolean(panel), panel ? `x=${panel.x.toFixed(1)} z=${panel.z.toFixed(1)}` : "");

    if (panel) {
        // 走到面板跟前
        await page.evaluate(
            ([x, z]) => window.__typing3d?.teleport?.(x, z - 2.2),
            [panel.x, panel.z],
        );
        await page.waitForSelector('[data-testid="typing-3d-panel-button"]', { timeout: 15_000 });
        check("靠近面板后出现答题提示", true);
        await page.screenshot({ path: path.join(OUT, "03-near-panel.png") });

        // 顺手用真实画面给打字训练中心的游戏列表生成封面
        const cover = path.join(
            HERE,
            "..",
            "public",
            "typing",
            "data",
            "assets",
            "daziya.com",
            "game-typing-3d.png",
        );
        if (!existsSync(cover) || process.env.QA_REFRESH_COVER === "1") {
            mkdirSync(path.dirname(cover), { recursive: true });
            await page.screenshot({
                path: cover,
                clip: { x: 400, y: 220, width: 640, height: 400 },
            });
            check("生成游戏封面", existsSync(cover), path.basename(cover));
        }

        await page.click('[data-testid="typing-3d-panel-button"]');
        await page.waitForSelector('[data-testid="typing-3d-question"]', { timeout: 15_000 });
        await page.waitForTimeout(300);

        const pinyin = await page
            .locator('[data-testid="typing-3d-pinyin"]')
            .textContent()
            .catch(() => null);
        const question = await page.locator('[data-testid="typing-3d-question"]').textContent();
        // 真键盘敲不出声调符号，这里故意去掉声调再敲，
        // 免得 QA 又像上次那样「照抄界面上的带调拼音」而把真实问题漏过去。
        const raw = (pinyin && pinyin.trim()) || (question || "").trim();
        const answer = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        check("读到题目", Boolean(answer), answer.slice(0, 24));
        await page.screenshot({ path: path.join(OUT, "04-typing.png") });

        await page.keyboard.type(answer, { delay: 12 });
        await page.waitForTimeout(200);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1200);

        const doorOpen = await page.evaluate(() => window.__typing3d?.doorOpen?.() ?? false);
        check("答对之后门打开", doorOpen === true);
        await page.screenshot({ path: path.join(OUT, "05-solved.png") });

        // 穿门进入下一关：先站到门口，再转身朝门走
        const before = await page.locator('[data-testid="typing-3d-level"]').textContent();
        const door = await page.evaluate(() => window.__typing3d?.door?.() ?? null);
        check("拿到了门的位置", Boolean(door));
        if (door) {
            await page.evaluate(
                ([x, z]) => {
                    const hook = window.__typing3d;
                    hook?.teleport?.(x, z - 3);
                    hook?.faceTowards?.(x, z);
                },
                [door.x, door.z],
            );
            // 头less 软件渲染帧率低，走多快不好说，这里轮询等过关
            await page.keyboard.down("KeyW");
            const deadline = Date.now() + 20000;
            while (Date.now() < deadline) {
                const current = await page
                    .locator('[data-testid="typing-3d-level"]')
                    .textContent();
                if (current !== before) break;
                await page.waitForTimeout(300);
            }
            await page.keyboard.up("KeyW");
        }
        await page.waitForTimeout(1400);
        const after = await page.locator('[data-testid="typing-3d-level"]').textContent();
        check("穿过门进入下一关", before !== after, `${before?.trim()} -> ${after?.trim()}`);
        await page.screenshot({ path: path.join(OUT, "06-next-level.png") });
    }

    const realErrors = consoleErrors.filter(
        (line) => !line.includes("Download the React DevTools") && !line.includes("[Fast Refresh]"),
    );
    check("控制台没有报错", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

    // 窄视口回归：DevTools 占位、浏览器缩放、小窗口下，弹层都不能被裁掉
    const narrow = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await narrow.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await narrow.waitForSelector('[data-testid="typing-3d-start"]:not([disabled])', { timeout: 60_000 });
    await narrow.click('[data-testid="typing-3d-start"]');
    const narrowSpawn = narrow.locator('[data-testid="typing-3d-spawn-option-0"]');
    if (await narrowSpawn.count()) {
        await narrowSpawn.click();
        await narrow.click('[data-testid="typing-3d-spawn-confirm"]');
    }
    await narrow.waitForTimeout(2500);
    for (let attempt = 0; attempt < 25; attempt += 1) {
        const spot = await narrow.evaluate(() => window.__typing3d?.panel?.() ?? null);
        if (spot) {
            await narrow.evaluate(
                ([x, z]) => window.__typing3d?.teleport?.(x, z - 2.4),
                [spot.x, spot.z],
            );
        }
        if (await narrow.locator('[data-testid="typing-3d-panel-button"]').count()) break;
        await narrow.waitForTimeout(400);
    }
    if (await narrow.locator('[data-testid="typing-3d-panel-button"]').count()) {
        await narrow.click('[data-testid="typing-3d-panel-button"]');
        await narrow.waitForSelector('[data-testid="typing-3d-question"]', { timeout: 15_000 });
        await narrow.waitForTimeout(400);
        const fits = await narrow.evaluate(() => {
            const card = document.querySelector('[data-testid="typing-3d-question"]')?.closest('div');
            if (!card) return null;
            const rect = card.getBoundingClientRect();
            const de = document.documentElement;
            return {
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                clientWidth: de.clientWidth,
                scrollWidth: de.scrollWidth,
            };
        });
        const inside =
            Boolean(fits) &&
            fits.left >= -1 &&
            fits.right <= fits.clientWidth + 1 &&
            fits.scrollWidth <= fits.clientWidth + 1;
        check("窄视口下弹层不越界", inside, JSON.stringify(fits));
        await narrow.screenshot({ path: path.join(OUT, "08-narrow.png") });
    } else {
        check("窄视口下弹层不越界", false, "没走到答题面板");
    }
    await narrow.close();

    await browser.close();

    console.log(`\n截图目录：${OUT}`);
    if (failures.length) {
        console.log(`\n${failures.length} 项未通过：`);
        failures.forEach((line) => console.log(line));
        process.exit(1);
    }
    console.log("\n全部通过 ✅");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
