/**
 * 3D 打字闯关 · 彩蛋 + 跑酷 的自动化验收。
 *
 * 跑之前先起开发服务器：
 *
 *     npm run dev
 *     node scripts/qa-typing3d-parkour.mjs
 *
 * 脚本会：进入 /typing-3d -> 选出生点 -> 检查这一关有没有跑酷塔和彩蛋 ->
 * 按空格跳一下（确认真的跳得起来）-> 挨个碰彩蛋（确认会弹提示、会被记下）->
 * 打开打字窗口看彩蛋换来的提示 -> 检查 HUD 上的彩蛋计数。
 * 截图落在 `.qa-typing3d/`。
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", ".qa-typing3d");
const URL = process.env.QA_TYPING3D_URL || "http://localhost:3000/typing-3d";

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
    await page.waitForSelector('[data-testid="typing-3d-start"]:not([disabled])', { timeout: 60_000 });
    await page.click('[data-testid="typing-3d-start"]');

    // 选第一个出生点，出发
    const spawnOption = page.locator('[data-testid="typing-3d-spawn-option-0"]');
    if (await spawnOption.count()) {
        await spawnOption.click();
        await page.click('[data-testid="typing-3d-spawn-confirm"]');
    }
    await page.waitForFunction(() => Boolean(window.__typing3d?.player), null, { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // ------------------------------------------------------------ 关卡内容
    const eggs = await page.evaluate(() => window.__typing3d?.eggs?.() ?? []);
    check("这一关有彩蛋", eggs.length >= 3, `${eggs.length} 个`);
    check(
        "彩蛋里有一个跑酷顶端的隐藏祭坛",
        eggs.filter((egg) => egg.kind === "altar").length === 1,
        eggs.map((egg) => `${egg.kind}#${egg.id}`).join(", "),
    );

    const panel = await page.evaluate(() => window.__typing3d?.panel?.() ?? null);
    check("答题面板还在", Boolean(panel), panel ? `(${panel.x.toFixed(1)}, ${panel.z.toFixed(1)})` : "没有");

    // 拍一张跑酷塔的全景图（存档用，顺便肉眼确认塔长得对）
    const altar = eggs.find((egg) => egg.kind === "altar");
    if (altar) {
        await page.evaluate((target) => {
            window.__typing3d.teleport(target.x + 7, target.z + 7);
            window.__typing3d.faceTowards(target.x, target.z);
        }, altar);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(OUT, "parkour-00-tower.png") });
    }

    // ------------------------------------------------------------ 跑酷：跳得起来
    await page.evaluate(() => window.__typing3d.jump());
    await page.waitForTimeout(260);
    const jumped = await page.evaluate(() => window.__typing3d.player());
    check("空格能跳起来", jumped.y > 0.4, `y=${Number(jumped.y).toFixed(2)}`);
    await page.waitForTimeout(2200);
    const landed = await page.evaluate(() => window.__typing3d.player());
    check("跳完会落回地面", landed.y < 0.2 && landed.grounded, `y=${Number(landed.y).toFixed(2)}`);
    await page.screenshot({ path: path.join(OUT, "parkour-01-jump.png") });

    // ------------------------------------------------------------ 平台能站人
    const platforms = await page.evaluate(() => window.__typing3d?.layout?.()?.platforms ?? []);
    const lowest = platforms.reduce((left, right) =>
        (left.baseY ?? 0) <= (right.baseY ?? 0) ? left : right,
    );
    if (lowest) {
        // 注意：这里不能叫 top，浏览器里 window.top 会撞名
        const platformTop = (lowest.baseY ?? 0) + lowest.height;
        await page.evaluate(({ box, top }) => {
            window.__typing3d.teleportTo(box.x, top + 0.4, box.z);
        }, { box: lowest, top: platformTop });
        await page.waitForTimeout(1200);
        const onPlatform = await page.evaluate(() => window.__typing3d.player());
        check(
            "跳上去能稳稳站在平台上",
            onPlatform.grounded && Math.abs(onPlatform.y - platformTop) < 0.12,
            `y=${Number(onPlatform.y).toFixed(2)}（平台面 ${platformTop.toFixed(2)}）`,
        );
    }

    const pad = await page.evaluate(() => {
    // ------------------------------------------------------------ 踩弹跳板
        const boxes = window.__typing3d?.layout?.()?.boxes ?? [];
        return boxes.find((box) => box.kind === "bounce") ?? null;
    });
    check("这一关有一块弹跳板", Boolean(pad), pad ? `(${pad.x.toFixed(1)}, ${pad.z.toFixed(1)})` : "没有");
    if (pad) {
        await page.evaluate((target) => {
            window.__typing3d.teleport(target.x, target.z);
        }, pad);
        await page.waitForTimeout(400);
        const onPad = await page.evaluate(() => window.__typing3d.player());
        check("踩上弹跳板会被弹起来", onPad.y > 0.6, `y=${Number(onPad.y).toFixed(2)}`);
        await page.screenshot({ path: path.join(OUT, "parkour-01b-bounce.png") });
        await page.waitForTimeout(1500);
    }

    // ------------------------------------------------------------ 挨个碰彩蛋
    let toastCount = 0;
    for (const egg of eggs) {
        await page.evaluate((target) => {
            window.__typing3d.teleportTo(target.x, target.y - 0.9, target.z);
        }, egg);
        // 弹窗按彩蛋编号认，别把上一个的提示算成这个的
        const toast = page.locator(`[data-egg-key="0-${egg.id}"]`);
        const appeared = await toast
            .waitFor({ state: "attached", timeout: 5000 })
            .then(() => true)
            .catch(() => false);
        if (appeared) {
            toastCount += 1;
            const text = (await toast.textContent()) || "";
            if (egg.kind === "altar") {
                check("祭坛彩蛋有专门的弹窗", text.includes("跑酷顶端"), text.trim().slice(0, 40));
            }
            await page.screenshot({ path: path.join(OUT, `parkour-02-egg-${egg.kind}-${egg.id}.png`) });
        }
    }
    check("每个彩蛋都会弹提示", toastCount === eggs.length, `${toastCount}/${eggs.length}`);

    const collected = await page.evaluate(() => window.__typing3d?.collected?.() ?? []);
    check("彩蛋都被记下来了", collected.length === eggs.length, `已收集 ${collected.length} 个`);

    // HUD 上要显示彩蛋数
    const hud = await page.locator('[data-testid="typing-3d-eggs"]').textContent();
    check("HUD 上有彩蛋计数", /\d/.test(hud || ""), (hud || "").trim());

    // ------------------------------------------------------------ 彩蛋换来的提示
    await page.evaluate(() => {
        const panel = window.__typing3d.panel();
        if (panel) window.__typing3d.teleport(panel.x, panel.z + 1.2);
    });
    await page.waitForTimeout(900);
    const panelButton = page.locator('[data-testid="typing-3d-panel-button"]');
    if (await panelButton.count()) {
        await panelButton.click();
        await page.waitForTimeout(600);
        const hint = page.locator('[data-testid="typing-3d-hint"]');
        check("打字窗口里出现彩蛋换来的提示", (await hint.count()) > 0);
        await page.screenshot({ path: path.join(OUT, "parkour-03-hint.png") });
        // 关掉打字窗口，继续后面的检查
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
    } else {
        check("打字窗口里出现彩蛋换来的提示", false, "没找到面板按钮");
    }

    // ------------------------------------------------------------ 原来的答题流程还正常
    const doorBefore = await page.evaluate(() => window.__typing3d?.doorOpen?.() ?? false);
    check("门一开始是关着的", doorBefore === false);

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
