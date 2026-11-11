/**
 * 3D 打字闯关（网页版）整轮通关验收：24 关从头打到尾。
 *
 * 跑之前先起开发服务器：
 *
 *     npm run dev
 *     node scripts/qa-typing3d-fullrun.mjs
 *
 * 每一关都：走到答题面板 -> 用**纯 ASCII 拼音**敲题 -> 门开 -> 穿门进下一关。
 * 全部走完后检查结算页、本地历史记录、服务端成绩记录。
 *
 * 比主 QA 慢不少（要打满 24 关），所以单独一个脚本，不进 npm test。
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", ".qa-typing3d");
const URL = process.env.QA_TYPING3D_URL || "http://localhost:3000/typing-3d";
const TOTAL = Number(process.env.QA_TYPING3D_TOTAL || 24);

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

function check(name, ok, detail = "") {
    console.log(`${ok ? "  OK  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function passSpawnScreen(page) {
    const option = page.locator('[data-testid="typing-3d-spawn-option-0"]');
    if (await option.count()) {
        await option.click();
        await page.click('[data-testid="typing-3d-spawn-confirm"]');
    }
}

/** 走到答题面板；返回是否成功站到面板前。 */
async function approachPanel(page) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
        const panel = await page.evaluate(() => window.__typing3d?.panel?.() ?? null);
        if (panel) {
            await page.evaluate(
                ([x, z]) => window.__typing3d?.teleport?.(x, z - 2.4),
                [panel.x, panel.z],
            );
        }
        if (await page.locator('[data-testid="typing-3d-panel-button"]').count()) return true;
        await page.waitForTimeout(350);
    }
    return false;
}

/** 穿过门进入下一关（直接挪到门口外侧，触发换关判定）。 */
async function passDoor(page) {
    const door = await page.evaluate(() => window.__typing3d?.door?.() ?? null);
    if (!door) return { ok: false, reason: "读不到门的位置" };
    const before = (await page.locator('[data-testid="typing-3d-level"]').textContent()) ?? "";
    // 打字弹层还开着的时候阶段不是 playing，引擎会忽略穿门，先等它关掉
    await page
        .waitForSelector('[data-testid="typing-3d-question"]', { state: "detached", timeout: 8000 })
        .catch(() => undefined);
    await page.evaluate(
        ([x, z]) => window.__typing3d?.teleport?.(x, z + 1.2),
        [door.x, door.z],
    );
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        const current =
            (await page.locator('[data-testid="typing-3d-level"]').textContent()) ?? "";
        // 最后一关穿门就是结算，关卡号不会再变
        if (await page.locator('[data-testid="typing-3d-finished"]').count()) {
            return { ok: true, finished: true, level: before };
        }
        if (current !== before) return { ok: true, finished: false, level: current };
        await page.waitForTimeout(200);
    }
    const diag = await page.evaluate(() => ({
        player: window.__typing3d?.player?.(),
        door: window.__typing3d?.door?.(),
        doorOpen: window.__typing3d?.doorOpen?.(),
    }));
    return { ok: false, reason: `门没触发换关 ${JSON.stringify(diag)}` };
}

async function main() {
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch({
        executablePath: resolveChromium(),
        args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 160)));

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="typing-3d-start"]:not([disabled])', { timeout: 60_000 });
    await page.click('[data-testid="typing-3d-start"]');
    await passSpawnScreen(page);
    await page.waitForTimeout(2500);

    const started = Date.now();
    let cleared = 0;

    for (let level = 1; level <= TOTAL; level += 1) {
        if (!(await approachPanel(page))) {
            check(`第 ${level} 关：走到答题面板`, false);
            break;
        }
        await page.click('[data-testid="typing-3d-panel-button"]');
        await page.waitForSelector('[data-testid="typing-3d-question"]', { timeout: 15_000 });
        await page.waitForTimeout(200);

        const pinyin = await page
            .locator('[data-testid="typing-3d-pinyin"]')
            .textContent()
            .catch(() => null);
        const question = await page.locator('[data-testid="typing-3d-question"]').textContent();
        const raw = (pinyin && pinyin.trim()) || (question || "").trim();
        // 真键盘敲不出声调符号，故意去掉声调再敲
        const answer = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        await page.keyboard.type(answer, { delay: 8 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(700);

        const doorOpen = await page.evaluate(() => window.__typing3d?.doorOpen?.() ?? false);
        if (!doorOpen) {
            check(`第 ${level} 关：答对后门打开`, false, `题目「${raw.slice(0, 16)}」`);
            break;
        }
        const passed = await passDoor(page);
        if (!passed.ok) {
            check(`第 ${level} 关：穿过门进入下一关`, false, passed.reason ?? "");
            break;
        }
        // 换关不能跳关：第 N 关穿门后应该正好变成第 N+1 关
        const got = Number((passed.level ?? "").match(/第\s*(\d+)/)?.[1] ?? -1);
        if (!passed.finished && got !== level + 1) {
            check(`第 ${level} 关：换关没跳关`, false, `期望第 ${level + 1} 关，实际「${passed.level}」`);
            break;
        }
        cleared += 1;
        process.stdout.write(`\r  已通关 ${cleared}/${TOTAL} 关   `);
    }
    process.stdout.write("\n");

    check(`连过 ${TOTAL} 关`, cleared === TOTAL, `实际 ${cleared} 关`);

    await page
        .waitForSelector('[data-testid="typing-3d-finished"]', { timeout: 15_000 })
        .catch(() => undefined);
    const finished = await page.locator('[data-testid="typing-3d-finished"]').count();
    check("出现结算页", finished > 0);
    await page.screenshot({ path: path.join(OUT, "16-fullrun-result.png") });

    // 本地历史：打字训练中心的游戏卡片靠它显示最好成绩
    const history = await page.evaluate(() => {
        try {
            const raw = window.localStorage.getItem("lexiang.typing.history");
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    });
    const mine = history.filter((item) => item && item.source === "typing-3d");
    check("本地历史写入 3D 成绩", mine.length > 0, mine.length ? `CPM ${mine[mine.length - 1].speed}` : "没有记录");

    // 服务端记录：换台设备也看得见
    const rankings = await page.evaluate(async () => {
        const response = await fetch("/api/typing/rankings?mode=3d-typing&limit=10");
        return response.ok ? response.json() : null;
    });
    const rows = Array.isArray(rankings?.rankings) ? rankings.rankings : [];
    check("服务端记录了 3D 成绩", rows.length > 0, rows.length ? `榜首 ${rows[0].username} ${rows[0].speed} CPM` : "没有记录");

    check("全程没有页面报错", errors.length === 0, errors.slice(0, 2).join(" | "));

    await browser.close();

    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`\n用时 ${minutes} 分钟，截图目录：${OUT}`);
    if (failures.length) {
        console.log(`\n${failures.length} 项未通过：`);
        failures.forEach((line) => console.log(`  ${line}`));
        process.exit(1);
    }
    console.log("\n全部通过 ✅");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
